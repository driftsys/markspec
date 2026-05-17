/**
 * @module core/validator/captions_test
 *
 * Unit tests for the MSL-C070 / MSL-C071 validator.
 *
 * PR 5: validates the AST-based migration. Tests build entry bodies
 * using `buildBodyAst` so `entry.bodyAst` is populated with `CaptionNode`
 * blocks recognised by the builder.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Entry } from "../model/mod.ts";
import { buildBodyAst } from "../ast/build.ts";
import { validateCaptions } from "./captions.ts";

function makeEntry(displayId: string, body: string): Entry {
  return {
    displayId,
    title: "Test entry",
    body,
    bodyAst: buildBodyAst(body),
    rawAttributes: [],
    id: undefined,
    shape: "Authored",
    location: { file: "test.md", line: 10, column: 1 },
    source: "markdown",
    typedAttributes: new Map(),
  };
}

// ---------------------------------------------------------------------------
// MSL-C070 — orphan caption (no adjacent captionable block)
// ---------------------------------------------------------------------------

Deno.test("validateCaptions: orphan Figure caption → MSL-C070", () => {
  const body = [
    "This is body text.",
    "",
    "Figure: An orphan caption with no figure adjacent",
    "",
    "More body text.",
  ].join("\n");
  const entry = makeEntry("REQ-001", body);
  const diags = validateCaptions(entry);
  const c070 = diags.filter((d) => d.code === "MSL-C070");
  assertEquals(c070.length, 1);
  assertEquals(c070[0].severity, "error");
  assertStringIncludes(c070[0].message, "Figure");
});

// ---------------------------------------------------------------------------
// MSL-C071 — caption adjacent to wrong block type
// ---------------------------------------------------------------------------

Deno.test("validateCaptions: Equation caption adjacent to Figure → MSL-C071", () => {
  const body = [
    "![Sensor diagram](sensor.svg)",
    "",
    "Equation: This claims to be an equation but the block above is an image",
  ].join("\n");
  const entry = makeEntry("REQ-001", body);
  const diags = validateCaptions(entry);
  const c071 = diags.filter((d) => d.code === "MSL-C071");
  assertEquals(c071.length, 1);
  assertEquals(c071[0].severity, "error");
});

Deno.test("validateCaptions: Figure caption adjacent to image → valid, no diagnostic", () => {
  const body = [
    "![Sensor diagram](sensor.svg)",
    "",
    "Figure: Sensor connection diagram",
  ].join("\n");
  const entry = makeEntry("REQ-001", body);
  const diags = validateCaptions(entry);
  assertEquals(diags, []);
});

// ---------------------------------------------------------------------------
// Caption-fence ambiguity — PR 5 regression guard
// ---------------------------------------------------------------------------

Deno.test("validateCaptions: caption inside fenced code block — NOT flagged", () => {
  // PR 5 migration: builder does not emit CaptionNode for captions inside
  // fenced code blocks. The validator must not flag them.
  const body = [
    "Body text.",
    "",
    "```",
    "Figure: this is sample code, not a real caption",
    "```",
  ].join("\n");
  const entry = makeEntry("REQ-001", body);
  const diags = validateCaptions(entry);
  assertEquals(diags, []);
});

Deno.test("validateCaptions: Table caption adjacent to fenced code → MSL-C071 with Listing or Feature label", () => {
  // The Listing/Feature ambiguity must be preserved: a CodeNode is
  // indistinguishable from a FeatureNode without the language tag.
  // The mismatch label must say "Listing or Feature (fenced)".
  const body = [
    "```",
    "some code",
    "```",
    "",
    "Table: claims to be a table but the block above is a fenced block",
  ].join("\n");
  const entry = makeEntry("REQ-001", body);
  const diags = validateCaptions(entry);
  const c071 = diags.filter((d) => d.code === "MSL-C071");
  assertEquals(c071.length, 1);
  assertStringIncludes(c071[0].message, "Listing or Feature");
});

// ---------------------------------------------------------------------------
// PR-5 strict-parity regression guard
//
// Baseline (65cbafc): the old string-scanner matched the IMMEDIATE line
// neighbour of a caption. When the immediate neighbour was another caption
// line, `classifyAdjacentBlock` found no captionable matcher → `undefined`
// → MSL-C070.  The AST-based validator must replicate this exactly: a
// CaptionNode immediate-neighbour is NOT a captionable block on that side.
// ---------------------------------------------------------------------------

Deno.test(
  "validateCaptions (PR-5 parity): orphan Table caption after Figure caption → MSL-C070 not MSL-C071",
  () => {
    // Entry body:
    //   ![image](foo.svg)          ← FigureNode
    //   Figure: matches above      ← CaptionNode (valid — ignored here)
    //   Table: orphan              ← CaptionNode under test
    //
    // The Table: caption's immediate previous block is the Figure: CaptionNode.
    // A CaptionNode is not a captionable block → that side contributes
    // undefined to the mismatch classification. The immediate next block is
    // absent (end of body). → mismatchKind = undefined → MSL-C070.
    //
    // Pre-fix PR 5 erroneously skipped intermediate captions and found the
    // FigureNode, yielding MSL-C071 ("adjacent to a Figure block"). This
    // test locks baseline parity so that regression cannot recur.
    const body = [
      "![image](foo.svg)",
      "",
      "Figure: This matches the above image",
      "",
      "Table: This is orphan",
    ].join("\n");
    const entry = makeEntry("REQ-PARITY", body);
    const diags = validateCaptions(entry);

    // The Figure: caption is valid (adjacent to the FigureNode above it).
    const c071 = diags.filter((d) => d.code === "MSL-C071");
    assertEquals(
      c071.length,
      0,
      "must not emit MSL-C071 for the orphan Table:",
    );

    // The Table: caption is an orphan → MSL-C070.
    const c070 = diags.filter((d) => d.code === "MSL-C070");
    assertEquals(c070.length, 1);
    assertEquals(c070[0].severity, "error");
    assertStringIncludes(c070[0].message, "Table");
    assertStringIncludes(
      c070[0].message,
      "caption is not adjacent to a captionable block of type Table",
    );
    // Line number: entry.location.line(10) + body-relative line of "Table:"(5) = 15
    assertEquals(c070[0].location?.line, 15);
  },
);
