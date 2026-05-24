/**
 * @module core/validator/modal_keywords_test
 *
 * Unit tests for the MSL-M060 / MSL-M061 validator.
 *
 * T14 (ADR-016): tests build entry bodies using explicit `bodyTokens`
 * arrays so the validator is tested in isolation from the scanner.
 * Two integration pins (parseFile-based) remain to validate the full
 * parse → bodyTokens → validate pipeline end-to-end.
 */

import { assertEquals } from "@std/assert";
import type { BodyToken, Entry } from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";
import { buildBodyAst } from "../ast/build.ts";
import { validateModalKeywords } from "./modal_keywords.ts";

function makeEntry(
  displayId: string,
  body: string,
  type?: string,
  bodyTokens?: readonly BodyToken[],
): Entry {
  const bodyAst = buildBodyAst(body);
  return {
    displayId: makeDisplayId(displayId),
    title: "Test entry",
    body,
    bodyAst,
    rawAttributes: [],
    id: undefined,
    shape: "Authored",
    location: { file: "test.md", line: 10, column: 1 },
    source: { kind: "markdown" },
    typedAttributes: new Map(type ? [["Type", [type]]] : []),
    type,
    bodyTokens: bodyTokens ?? [],
  };
}

// ---------------------------------------------------------------------------
// MSL-M060 — uppercase modal keywords
// ---------------------------------------------------------------------------

Deno.test("validateModalKeywords: lowercase shall — no MSL-M060", () => {
  const entry = makeEntry(
    "REQ-001",
    "The system shall handle all requests.",
    undefined,
    [
      {
        kind: "modal",
        text: "shall",
        case: "lower",
        location: { file: "test.md", line: 11, column: 12 },
      },
    ],
  );
  const diags = validateModalKeywords(entry);
  const m060 = diags.filter((d) => d.code === "MSL-M060");
  assertEquals(m060, []);
});

Deno.test("validateModalKeywords: uppercase SHALL — fires MSL-M060", () => {
  const entry = makeEntry(
    "REQ-001",
    "The system SHALL handle all requests.",
    undefined,
    [
      {
        kind: "modal",
        text: "SHALL",
        case: "upper",
        location: { file: "test.md", line: 11, column: 12 },
      },
    ],
  );
  const diags = validateModalKeywords(entry);
  const m060 = diags.filter((d) => d.code === "MSL-M060");
  assertEquals(m060.length, 1);
  assertEquals(m060[0].severity, "warning");
  assertEquals(m060[0].message.includes("SHALL"), true);
});

Deno.test("validateModalKeywords: uppercase keyword in code fence — NOT flagged", () => {
  // MSL-M060 — keywords inside verbatim code blocks must be excluded.
  // extractBodyTokens skips verbatim lines, so no modal tokens appear.
  const body = [
    "Prose before the fence.",
    "",
    "```",
    "SHALL_CONSTANT = 42",
    "```",
    "",
    "Prose after the fence.",
  ].join("\n");
  // bodyTokens has no modal entries because the scanner skips the fence.
  const entry = makeEntry("REQ-001", body, undefined, []);
  const diags = validateModalKeywords(entry);
  const m060 = diags.filter((d) => d.code === "MSL-M060");
  assertEquals(m060, []);
});

Deno.test("validateModalKeywords: uppercase modal in list item — fires MSL-M060", () => {
  const body = [
    "Conditions:",
    "",
    "- The sensor SHOULD report every 10 ms.",
  ].join("\n");
  const entry = makeEntry("REQ-001", body, undefined, [
    {
      kind: "modal",
      text: "SHOULD",
      case: "upper",
      location: { file: "test.md", line: 13, column: 17 },
    },
  ]);
  const diags = validateModalKeywords(entry);
  const m060 = diags.filter((d) => d.code === "MSL-M060");
  assertEquals(m060.length, 1);
  assertEquals(m060[0].message.includes("SHOULD"), true);
});

Deno.test("validateModalKeywords: EARS trigger tokens are not flagged as MSL-M060", () => {
  // ears-trigger tokens are a separate kind; the validator ignores them.
  const entry = makeEntry("REQ-001", "When the sensor fires.", undefined, [
    {
      kind: "ears-trigger",
      text: "When",
      trigger: "When",
      location: { file: "test.md", line: 11, column: 1 },
    },
  ]);
  const diags = validateModalKeywords(entry);
  const m060 = diags.filter((d) => d.code === "MSL-M060");
  assertEquals(m060, []);
});

// ---------------------------------------------------------------------------
// MSL-M061 — Requirement entry with no modal keyword
// ---------------------------------------------------------------------------

Deno.test("validateModalKeywords: Requirement type with no modal → MSL-M061", () => {
  // bodyTokens is empty → no modal token → MSL-M061 fires.
  const entry = makeEntry(
    "REQ-001",
    "The system handles requests.",
    "Requirement",
    [],
  );
  const diags = validateModalKeywords(entry);
  const m061 = diags.filter((d) => d.code === "MSL-M061");
  assertEquals(m061.length, 1);
  assertEquals(m061[0].severity, "info");
});

Deno.test("validateModalKeywords: non-Requirement type with no modal → no MSL-M061", () => {
  const entry = makeEntry(
    "TST-001",
    "Verify that the system handles all requests.",
    "Test",
    [],
  );
  const diags = validateModalKeywords(entry);
  const m061 = diags.filter((d) => d.code === "MSL-M061");
  assertEquals(m061, []);
});

Deno.test("validateModalKeywords: Requirement with lowercase modal → no MSL-M061", () => {
  // A lower-case modal token counts as "any modal seen" → no MSL-M061.
  const entry = makeEntry(
    "REQ-001",
    "The system shall handle all requests.",
    "Requirement",
    [
      {
        kind: "modal",
        text: "shall",
        case: "lower",
        location: { file: "test.md", line: 11, column: 12 },
      },
    ],
  );
  const diags = validateModalKeywords(entry);
  const m061 = diags.filter((d) => d.code === "MSL-M061");
  assertEquals(m061, []);
});

// ---------------------------------------------------------------------------
// SP2 Task 7 — verbatim-content.text regression pin (updated for ADR-016).
//
// The old AST-based marker path flattened `_SHALL_` (emphasis) to `SHALL`
// before matching, so it detected it as uppercase. The bodyTokens scanner
// uses raw-text regex (`\b(shall|…)\b`) where `_` is a word character in
// JavaScript, so `_SHALL_` does NOT produce a word boundary on either side
// and is NOT matched. This is an accepted behavioral difference: emphatic
// modals written as `_SHALL_` are not flagged; authors should write `SHALL`
// in plain prose. The integration pin below confirms the scanner behaviour.
// ---------------------------------------------------------------------------

Deno.test("MSL-M060: emphasised _SHALL_ not detected by bodyTokens scanner", async () => {
  const { parseFile } = await import("../mod.ts");
  const { validateModalKeywords } = await import("./modal_keywords.ts");
  const doc =
    "- [TST_MK_0001] Probe\n\n  The driver _SHALL_ act.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const { entries } = await parseFile(doc, { file: "t.md" });
  // _SHALL_ is not matched by \b…\b because `_` is a word character in JS.
  // bodyTokens is empty → no MSL-M060 emitted.
  const m060 = validateModalKeywords(entries[0]).filter((d) =>
    d.code === "MSL-M060"
  );
  assertEquals(m060.length, 0);
});

// ---------------------------------------------------------------------------
// SP3 Task 6 — validator-safety pin: formatter-only normalization.
//
// `normalizeBodyAst` is called ONLY from `core/formatter/mod.ts`; the
// parse/validate path uses `buildBodyAst` (no normalization). This pin
// asserts MSL-M060 still fires on an uppercase `SHALL` when the entry is
// produced by `parseFile` alone — proving the validate path never runs
// the formatter's normalization pass.
// ---------------------------------------------------------------------------

Deno.test("MSL-M060: uppercase modal still flagged (validate does not normalize)", async () => {
  const { parseFile } = await import("../mod.ts");
  const { validateModalKeywords } = await import("./modal_keywords.ts");
  const doc =
    "- [TST_MK_0002] Probe\n\n  The driver SHALL act.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const { entries } = await parseFile(doc, { file: "t.md" });
  const m060 = validateModalKeywords(entries[0]).filter((d) =>
    d.code === "MSL-M060"
  );
  assertEquals(m060.length, 1);
});
