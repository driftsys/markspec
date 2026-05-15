/**
 * @module core/ast/build_test
 *
 * TDD tests for buildBodyAst(). Written before the implementation.
 *
 * Coverage:
 *   1. Per-kind unit tests (all 12 node kinds).
 *   2. Inline marker tests (modal + entity-ref; excluded in Code/Feature).
 *   3. Characterisation tests (existing fixture files have bodyAst populated).
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import type {
  BlockquoteNode,
  CaptionNode,
  CodeNode,
  DefinitionListNode,
  FeatureNode,
  FigureNode,
  ListNode,
  MathNode,
  NoteNode,
  ParagraphNode,
  TableNode,
  UnknownNode,
} from "./nodes.ts";

// ----------------------------------------------------------------------------
// Helper — import lazily so tests can stub before loading (future).
// For now just import at the top.
// ----------------------------------------------------------------------------
import { buildBodyAst } from "./build.ts";
import { parseMarkdown } from "../parser/markdown.ts";

// ============================================================================
// 1. Per-kind unit tests
// ============================================================================

Deno.test("build: paragraph → ParagraphNode with text", () => {
  const blocks = buildBodyAst("Simple paragraph text.");
  assertEquals(blocks.length, 1);
  const p = blocks[0] as ParagraphNode;
  assertEquals(p.kind, "paragraph");
  assertEquals(p.content.text, "Simple paragraph text.");
  assertEquals(p.range.start.line, 1);
});

Deno.test("build: image-only paragraph → FigureNode", () => {
  const blocks = buildBodyAst("![a diagram](path/to/diagram.svg)");
  assertEquals(blocks.length, 1);
  const fig = blocks[0] as FigureNode;
  assertEquals(fig.kind, "figure");
  assertEquals(fig.alt, "a diagram");
  assertEquals(fig.path, "path/to/diagram.svg");
});

Deno.test("build: unordered list → ListNode", () => {
  const body = `- item one\n- item two`;
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const list = blocks[0] as ListNode;
  assertEquals(list.kind, "list");
  assertEquals(list.ordered, false);
  assertEquals(list.items.length, 2);
});

Deno.test("build: ordered list → ListNode with ordered=true", () => {
  const body = `1. first\n2. second`;
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const list = blocks[0] as ListNode;
  assertEquals(list.kind, "list");
  assertEquals(list.ordered, true);
});

Deno.test("build: GFM table → TableNode with raw field", () => {
  const body = `| A | B |\n|---|---|\n| 1 | 2 |`;
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const tbl = blocks[0] as TableNode;
  assertEquals(tbl.kind, "table");
  assertEquals(tbl.header.length, 2);
  assertEquals(tbl.header[0].text, "A");
  assertEquals(tbl.header[1].text, "B");
  assertEquals(tbl.rows.length, 1);
  assertEquals(tbl.rows[0][0].text, "1");
  assertEquals(tbl.rows[0][1].text, "2");
  // raw must equal the exact source substring
  assertEquals(tbl.raw, body);
});

Deno.test("build: table with wide separator row carries exact raw source", () => {
  // Separator row is wider than the cell content — the key round-trip case.
  const body =
    `| Col A         | Col B |\n| ------------- | ----- |\n| x             | y     |`;
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const tbl = blocks[0] as TableNode;
  assertEquals(tbl.kind, "table");
  // raw must equal the verbatim source — not the min-content reconstruction
  assertEquals(tbl.raw, body);
});

Deno.test("build: fenced code block → CodeNode", () => {
  const body = "```rust\nfn main() {}\n```";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const code = blocks[0] as CodeNode;
  assertEquals(code.kind, "code");
  assertEquals(code.lang, "rust");
  assertEquals(code.text, "fn main() {}");
});

Deno.test("build: code block with no lang → CodeNode with lang undefined", () => {
  const body = "```\nsome text\n```";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const code = blocks[0] as CodeNode;
  assertEquals(code.kind, "code");
  assertEquals(code.lang, undefined);
  assertEquals(code.text, "some text");
});

Deno.test("build: gherkin fence → FeatureNode", () => {
  const body = "```gherkin\nFeature: braking\n  Scenario: stop\n```";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const feat = blocks[0] as FeatureNode;
  assertEquals(feat.kind, "feature");
  assertEquals(feat.source, "Feature: braking\n  Scenario: stop");
});

Deno.test("build: $$ math block → MathNode", () => {
  const body = "$$\nE = mc^2\n$$";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const math = blocks[0] as MathNode;
  assertEquals(math.kind, "math");
  assertEquals(math.tex.trim(), "E = mc^2");
});

Deno.test("build: GitHub admonition blockquote → NoteNode", () => {
  const body = "> [!WARNING]\n> This is a warning.";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const note = blocks[0] as NoteNode;
  assertEquals(note.kind, "note");
  assertEquals(note.admonition, "WARNING");
  assertExists(note.content.text);
});

Deno.test("build: plain blockquote → BlockquoteNode", () => {
  const body = "> An external citation.";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const bq = blocks[0] as BlockquoteNode;
  assertEquals(bq.kind, "blockquote");
  assertExists(bq.content.text);
});

Deno.test("build: definition-list pattern → DefinitionListNode", () => {
  const body = "Term\n: A definition here.";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const dl = blocks[0] as DefinitionListNode;
  assertEquals(dl.kind, "definition-list");
  assertEquals(dl.items.length, 1);
  assertEquals(dl.items[0].term.text, "Term");
  assertEquals(dl.items[0].definition.text, "A definition here.");
});

Deno.test("build: heading → UnknownNode (excluded construct)", () => {
  const body = "# A heading";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const unk = blocks[0] as UnknownNode;
  assertEquals(unk.kind, "unknown");
});

Deno.test("build: caption paragraph → CaptionNode", () => {
  const body = "Figure: A system overview diagram.";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const cap = blocks[0] as CaptionNode;
  assertEquals(cap.kind, "caption");
  assertEquals(cap.keyword, "Figure");
  assertEquals(cap.text, "A system overview diagram.");
});

Deno.test("build: caption with Table keyword", () => {
  const body = "Table: Attribute definitions.";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const cap = blocks[0] as CaptionNode;
  assertEquals(cap.kind, "caption");
  assertEquals(cap.keyword, "Table");
});

Deno.test("build: SourceRange is body-relative 1-based", () => {
  const body = "First paragraph.\n\nSecond paragraph.";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 2);
  assertEquals(blocks[0].range.start.line, 1);
  assertEquals(blocks[1].range.start.line, 3);
});

// ============================================================================
// 2. Marker tests
// ============================================================================

Deno.test("build: paragraph with RFC2119 modal + entity ref → markers extracted", () => {
  const body = "The system shall read $Sensor.";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const p = blocks[0] as ParagraphNode;
  assertEquals(p.kind, "paragraph");

  const modalMarkers = p.content.markers.filter((m) => m.kind === "modal");
  const entityMarkers = p.content.markers.filter((m) => m.kind === "entity");

  assertEquals(modalMarkers.length, 1);
  assertEquals(modalMarkers[0].kind, "modal");
  if (modalMarkers[0].kind === "modal") {
    assertEquals(modalMarkers[0].cls, "rfc2119");
    assertEquals(modalMarkers[0].canonical, "shall");
  }

  assertEquals(entityMarkers.length, 1);
  assertEquals(entityMarkers[0].kind, "entity");
  if (entityMarkers[0].kind === "entity") {
    assertEquals(entityMarkers[0].ident, "$Sensor");
    assertEquals(entityMarkers[0].convention, "type");
  }
});

Deno.test("build: 'shall not' recognised as single RFC2119 modal", () => {
  const body = "The system shall not fail.";
  const blocks = buildBodyAst(body);
  const p = blocks[0] as ParagraphNode;
  const modals = p.content.markers.filter((m) => m.kind === "modal");
  assertEquals(modals.length, 1);
  if (modals[0].kind === "modal") {
    assertEquals(modals[0].canonical, "shall not");
  }
});

Deno.test("build: EARS 'When' recognised as ears modal", () => {
  const body = "When the sensor fails, the system shall stop.";
  const blocks = buildBodyAst(body);
  const p = blocks[0] as ParagraphNode;
  const modals = p.content.markers.filter((m) => m.kind === "modal");
  // At least a "When" EARS marker and a "shall" RFC2119 marker
  const ears = modals.filter((m) => m.kind === "modal" && m.cls === "ears");
  const rfc = modals.filter((m) => m.kind === "modal" && m.cls === "rfc2119");
  assertEquals(ears.length >= 1, true);
  assertEquals(rfc.length >= 1, true);
});

Deno.test("build: markers NOT extracted inside code fence", () => {
  const body = "```\nshall $Sensor\n```";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const code = blocks[0] as CodeNode;
  assertEquals(code.kind, "code");
  assertEquals(code.text, "shall $Sensor");
  assertEquals("markers" in code, false);
  assertEquals("content" in code, false);
});

Deno.test("build: markers NOT extracted inside $$ math block", () => {
  const body = "$$\nshall $Sensor\n$$";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const math = blocks[0] as MathNode;
  assertEquals(math.kind, "math");
  assertEquals("markers" in math, false);
  assertEquals("content" in math, false);
  assertStringIncludes(math.tex, "shall $Sensor");
});

Deno.test("build: markers NOT extracted inside gherkin Feature fence", () => {
  const body = "```gherkin\nGiven the sensor shall read $Sensor\n```";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const feat = blocks[0] as FeatureNode;
  assertEquals(feat.kind, "feature");
  // FeatureNode has no markers field
});

Deno.test("build: entity refs with different conventions", () => {
  const body = "Use $BrakeController for $rawPressure and $DEBOUNCE_WINDOW.";
  const blocks = buildBodyAst(body);
  const p = blocks[0] as ParagraphNode;
  const entities = p.content.markers.filter((m) => m.kind === "entity");
  assertEquals(entities.length, 3);
  if (entities[0].kind === "entity") {
    assertEquals(entities[0].convention, "type");
  }
  if (entities[1].kind === "entity") {
    assertEquals(entities[1].convention, "instance");
  }
  if (entities[2].kind === "entity") {
    assertEquals(entities[2].convention, "constant");
  }
});

// ============================================================================
// 3. Characterisation tests — wiring into Entry.bodyAst
// ============================================================================

Deno.test("characterisation: requirement-block.md entries all have bodyAst", async () => {
  const fixtureUrl = new URL(
    "../../../../tests/fixtures/requirement-block.md",
    import.meta.url,
  );
  const content = await Deno.readTextFile(fixtureUrl.pathname);
  const result = parseMarkdown(content, {
    file: fixtureUrl.pathname,
  });
  assertEquals(result.entries.length > 0, true, "fixture should have entries");
  for (const entry of result.entries) {
    assertExists(
      entry.bodyAst,
      `entry ${entry.displayId} should have bodyAst`,
    );
    assertEquals(
      Array.isArray(entry.bodyAst),
      true,
      `entry ${entry.displayId} bodyAst should be an array`,
    );
  }
});

Deno.test("build: file with no entries does not crash buildBodyAst", async () => {
  const md = await Deno.readTextFile(
    new URL(
      "../../../../tests/fixtures/traceability-matrix.md",
      import.meta.url,
    ),
  );
  const result = parseMarkdown(md, { file: "traceability-matrix.md" });
  assertEquals(result.entries.length, 0);
});
