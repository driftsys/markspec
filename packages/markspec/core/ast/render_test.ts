/**
 * @module core/ast/render_test
 *
 * Unit tests for render(). For each node kind (and a mixed-block case),
 * asserts that render(buildBodyAst(s)) === s for canonical body strings.
 */

import { assertEquals } from "@std/assert";
import { buildBodyAst } from "./build.ts";
import { render } from "./render.ts";

/** Round-trip helper: buildBodyAst → render should reproduce `s`. */
function roundTrip(s: string): string {
  return render(buildBodyAst(s));
}

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

Deno.test("render: empty body returns empty string", () => {
  assertEquals(render([]), "");
  assertEquals(roundTrip(""), "");
});

// ---------------------------------------------------------------------------
// ParagraphNode
// ---------------------------------------------------------------------------

Deno.test("render: paragraph round-trips plain prose", () => {
  const s = "The sensor driver shall debounce raw inputs.";
  assertEquals(roundTrip(s), s);
});

Deno.test("render: paragraph round-trips prose with modal keywords", () => {
  const s =
    "The system shall validate the input and must reject values below zero.";
  assertEquals(roundTrip(s), s);
});

Deno.test("render: paragraph round-trips multi-paragraph body", () => {
  const s = "First paragraph text.\n\nSecond paragraph text.";
  assertEquals(roundTrip(s), s);
});

// ---------------------------------------------------------------------------
// FigureNode
// ---------------------------------------------------------------------------

Deno.test("render: figure round-trips image link", () => {
  const s = "![a diagram](path/to/diagram.svg)";
  assertEquals(roundTrip(s), s);
});

Deno.test("render: figure round-trips figure with empty alt", () => {
  const s = "![](architecture.png)";
  assertEquals(roundTrip(s), s);
});

// ---------------------------------------------------------------------------
// CodeNode
// ---------------------------------------------------------------------------

Deno.test("render: code round-trips fenced block with language", () => {
  const s = "```rust\nfn main() {}\n```";
  assertEquals(roundTrip(s), s);
});

Deno.test("render: code round-trips fenced block without language", () => {
  const s = "```\nplain verbatim\n```";
  assertEquals(roundTrip(s), s);
});

// ---------------------------------------------------------------------------
// FeatureNode
// ---------------------------------------------------------------------------

Deno.test("render: feature round-trips gherkin fence", () => {
  const s =
    "```gherkin\nFeature: braking\n  Scenario: emergency\n    Given speed > 30\n```";
  assertEquals(roundTrip(s), s);
});

// ---------------------------------------------------------------------------
// MathNode
// ---------------------------------------------------------------------------

Deno.test("render: math round-trips $$ block", () => {
  const s = "$$\nE = mc^2\n$$";
  assertEquals(roundTrip(s), s);
});

// ---------------------------------------------------------------------------
// NoteNode (GitHub-style admonition)
// ---------------------------------------------------------------------------

Deno.test("render: note round-trips WARNING admonition", () => {
  const s =
    "> [!WARNING]\n> Failure to debounce may lead to spurious brake activation.";
  assertEquals(roundTrip(s), s);
});

Deno.test("render: note round-trips NOTE admonition", () => {
  const s = "> [!NOTE]\n> This is informational.";
  assertEquals(roundTrip(s), s);
});

Deno.test("render: note round-trips multi-line NOTE body", () => {
  const s = "> [!NOTE]\n> a\n> b\n> c";
  assertEquals(roundTrip(s), s);
});

Deno.test("render: note round-trips multi-line WARNING body (unit)", () => {
  // Focused unit: render(buildBodyAst(s)) must be byte-identical to s.
  const s = "> [!NOTE]\n> a\n> b\n> c";
  assertEquals(render(buildBodyAst(s)), s);
});

// ---------------------------------------------------------------------------
// BlockquoteNode
// ---------------------------------------------------------------------------

Deno.test("render: blockquote round-trips plain blockquote", () => {
  const s = "> An external citation excerpt.";
  assertEquals(roundTrip(s), s);
});

Deno.test("render: blockquote round-trips multi-line blockquote", () => {
  const s = "> line one\n> line two";
  assertEquals(roundTrip(s), s);
});

Deno.test("render: blockquote round-trips interior blank quoted line", () => {
  // Two paragraphs in a blockquote are separated by a bare `>` line in
  // source. build.ts must join them with "\n\n" and renderBlockquote must
  // emit `>` (no trailing space) for the empty separator line.
  const s = "> a\n>\n> b";
  assertEquals(roundTrip(s), s);
});

Deno.test("render: note round-trips interior blank quoted line", () => {
  // Two paragraphs inside a note, separated by a bare `>` line. The admonition
  // marker occupies the first line of the first paragraph; the second paragraph
  // text follows after the interior blank. build.ts must join them with "\n\n".
  const s = "> [!NOTE]\n> a\n>\n> c";
  assertEquals(roundTrip(s), s);
});

// ---------------------------------------------------------------------------
// CaptionNode
// ---------------------------------------------------------------------------

Deno.test("render: caption round-trips Figure caption", () => {
  const s = "Figure: System context diagram";
  assertEquals(roundTrip(s), s);
});

Deno.test("render: caption round-trips Table caption", () => {
  const s = "Table: Sensor plausibility bounds";
  assertEquals(roundTrip(s), s);
});

// ---------------------------------------------------------------------------
// DefinitionListNode
// ---------------------------------------------------------------------------

Deno.test("render: definition-list round-trips single term", () => {
  const s = "ASIL\n: Automotive Safety Integrity Level";
  assertEquals(roundTrip(s), s);
});

// ---------------------------------------------------------------------------
// ListNode
// ---------------------------------------------------------------------------

Deno.test("render: unordered list round-trips two items", () => {
  const s = "- item one\n- item two";
  assertEquals(roundTrip(s), s);
});

Deno.test("render: ordered list round-trips two items", () => {
  const s = "1. first item\n2. second item";
  assertEquals(roundTrip(s), s);
});

// ---------------------------------------------------------------------------
// TableNode — byte-identical round-trip via raw field
// ---------------------------------------------------------------------------

Deno.test("render: table round-trips simple table", () => {
  const s = "| A | B |\n|---|---|\n| 1 | 2 |";
  assertEquals(roundTrip(s), s);
});

Deno.test("render: table round-trips separator-wider-than-content", () => {
  // The separator row `| ------------- |` is wider than the content `| x |`.
  // This is the key regression case: the old re-padding logic would rewrite
  // the separator to min-content width; raw passthrough preserves it exactly.
  const s =
    "| Col A         | Col B |\n| ------------- | ----- |\n| x             | y     |";
  assertEquals(roundTrip(s), s);
});

Deno.test("render: table round-trips extra-padded data cells", () => {
  const s = "| Name    | Value |\n|---------|-------|\n| foo     | 42    |";
  assertEquals(roundTrip(s), s);
});

// ---------------------------------------------------------------------------
// Mixed — multiple block kinds in one body
// ---------------------------------------------------------------------------

Deno.test("render: mixed blocks separated by one blank line", () => {
  const s = [
    "The sensor driver shall debounce raw inputs.",
    "> [!WARNING]\n> Failure to debounce may lead to spurious brake activation.",
    "- check plausibility\n- validate range",
  ].join("\n\n");
  assertEquals(roundTrip(s), s);
});

Deno.test("render: paragraph + figure + caption mixed", () => {
  const s = [
    "System overview is shown below.",
    "![architecture](arch.svg)",
    "Figure: System architecture overview",
  ].join("\n\n");
  assertEquals(roundTrip(s), s);
});

// ---------------------------------------------------------------------------
// Nested verbatim blocks inside list items (round-trip regression cases)
// ---------------------------------------------------------------------------

Deno.test("render: table nested inside list item round-trips byte-identically", () => {
  // The list-continuation indent ("  ") must not be doubled on render.
  // TableNode.raw is stored indent-normalised (column-0-anchored) so that
  // renderListItem's uniform "  " re-indent reproduces the original.
  const s =
    "- item one\n\n  | H1 | H2 |\n  |----|----|\n  | v1 | v2 |\n\n- item two";
  assertEquals(roundTrip(s), s);
});

Deno.test("render: code block nested inside list item round-trips byte-identically", () => {
  // Regression guard for loose-list item separation: items separated by
  // blank lines must render with "\n\n" between them (spread=true).
  const s = "- item one\n\n  ```rust\n  fn main() {}\n  ```\n\n- item two";
  assertEquals(roundTrip(s), s);
});
