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
import { fromFileUrl } from "@std/path";
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
import { buildBodyAst, verbatimSlice } from "./build.ts";
import { render } from "./render.ts";
import { loadGherkin } from "../gherkin/load.ts";
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

Deno.test("build: nested list paragraph keeps emphasis and round-trips", () => {
  const s = "- outer _one_\n  - inner **a**\n- outer two";
  assertEquals(render(buildBodyAst(s)), s);
});

Deno.test("build: task-list checkbox is captured and round-trips", () => {
  const s = "- [ ] todo item\n- [x] done item";
  const list = buildBodyAst(s)[0] as ListNode;
  assertEquals(list.kind, "list");
  assertEquals(list.hasTaskItems, true); // B042 source unchanged
  assertEquals(list.items[0].checked, false);
  assertEquals(list.items[1].checked, true);
  assertEquals(render(buildBodyAst(s)), s); // round-trips byte-identically
});

Deno.test("build: single loose item paragraph+code round-trips", () => {
  const s = "- item one\n\n  ```rust\n  fn x(){}\n  ```";
  assertEquals(render(buildBodyAst(s)), s);
});

Deno.test("build: single item paragraph+nested list round-trips", () => {
  const s = "- outer\n\n  - inner";
  assertEquals(render(buildBodyAst(s)), s);
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

Deno.test("build: feature fence → FeatureNode", () => {
  const body = "```feature\nFeature: braking\n  Scenario: stop\n```";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const feat = blocks[0];
  assertEquals(feat.kind, "feature");
  if (feat.kind === "feature") {
    assertEquals(feat.source, "Feature: braking\n  Scenario: stop");
  }
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

Deno.test("build: note preserves inline emphasis and round-trips", () => {
  const s = "> [!NOTE]\n> See _the spec_ for **detail**.";
  const n = buildBodyAst(s)[0] as NoteNode;
  assertEquals(n.kind, "note");
  assertEquals(n.admonition, "NOTE");
  assertEquals(render(buildBodyAst(s)), s);
});

Deno.test("build: blockquote preserves inline link and round-trips", () => {
  const s = "> See [the spec](docs/x.md) for detail.";
  assertEquals(render(buildBodyAst(s)), s);
});

Deno.test("build: note/blockquote canonical shapes still byte-exact", () => {
  for (
    const s of [
      "> [!WARNING]\n> line one\n> line two",
      "> [!NOTE]\n> a\n>\n> c",
      "> line one\n> line two",
      "> a\n>\n> b",
      "> [!NOTE]\n> This is an informational note.",
    ]
  ) {
    assertEquals(render(buildBodyAst(s)), s, `failed: ${JSON.stringify(s)}`);
  }
});

Deno.test("note: same-line marker body round-trips", () => {
  const s = "> [!NOTE] inline body text.";
  assertEquals(render(buildBodyAst(s)), s);
});

Deno.test("note: own-line marker body still round-trips", () => {
  const s = "> [!NOTE]\n> own-line body text.";
  assertEquals(render(buildBodyAst(s)), s);
});

Deno.test("note: same-line marker multi-line body round-trips", () => {
  const s = "> [!WARNING] first line\n> second line";
  assertEquals(render(buildBodyAst(s)), s);
});

Deno.test("build: emphasised modal in a note has content text", () => {
  const n = buildBodyAst("> [!NOTE]\n> The driver _shall_ act.")[0] as NoteNode;
  assertExists(n.content.text);
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
// 2. Verbatim text tests (ADR-016: markers moved to Entry.bodyTokens)
// ============================================================================

Deno.test("build: paragraph with modal and entity ref stores verbatim text", () => {
  const body = "The system shall read $Sensor.";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const p = blocks[0] as ParagraphNode;
  assertEquals(p.kind, "paragraph");
  assertEquals(p.content.text, body);
});

Deno.test("build: code fence content stored verbatim; no content field on CodeNode", () => {
  const body = "```\nshall $Sensor\n```";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const code = blocks[0] as CodeNode;
  assertEquals(code.kind, "code");
  assertEquals(code.text, "shall $Sensor");
  assertEquals("content" in code, false);
});

Deno.test("build: $$ math block content stored verbatim; no content field on MathNode", () => {
  const body = "$$\nshall $Sensor\n$$";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const math = blocks[0] as MathNode;
  assertEquals(math.kind, "math");
  assertEquals("content" in math, false);
  assertStringIncludes(math.tex, "shall $Sensor");
});

Deno.test("build: gherkin Feature fence → FeatureNode (no content field)", () => {
  const body = "```gherkin\nGiven the sensor shall read $Sensor\n```";
  const blocks = buildBodyAst(body);
  assertEquals(blocks.length, 1);
  const feat = blocks[0] as FeatureNode;
  assertEquals(feat.kind, "feature");
  assertEquals("content" in feat, false);
});

// ============================================================================
// 2b. Faithful paragraph (SP2 verbatim-text contract)
// ============================================================================

Deno.test("build: paragraph preserves inline emphasis verbatim", () => {
  const s = "The driver _shall_ debounce inputs.";
  const blocks = buildBodyAst(s);
  const p = blocks[0] as ParagraphNode;
  assertEquals(p.kind, "paragraph");
  assertEquals(p.content.text, s); // verbatim — markup NOT flattened
  assertEquals(render(blocks), s); // round-trips byte-identically
});

Deno.test("build: strong / link / autolink / hardbreak preserved verbatim", () => {
  for (
    const s of [
      "The driver **must** debounce inputs.",
      "See [the spec](docs/specs/x.md) for detail.",
      "Reference: <https://example.com/spec>.",
      "line one  \nline two",
      "line one\\\nline two",
    ]
  ) {
    const blocks = buildBodyAst(s);
    assertEquals(
      render(blocks),
      s,
      `round-trip failed for ${JSON.stringify(s)}`,
    );
  }
});

// ============================================================================
// 3. Characterisation tests — wiring into Entry.bodyAst
// ============================================================================

Deno.test("characterisation: requirement-block.md entries all have bodyAst", async () => {
  const fixturePath = fromFileUrl(
    new URL(
      "../../../../tests/fixtures/requirement-block.md",
      import.meta.url,
    ),
  );
  const content = await Deno.readTextFile(fixturePath);
  const result = parseMarkdown(content, {
    file: fixturePath,
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

// ============================================================================
// 4. verbatimSlice unit tests
// ============================================================================

Deno.test("verbatimSlice: top-level node returns exact source slice", () => {
  const body = "alpha _beta_ gamma";
  const pos = {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 19, offset: 18 },
  };
  assertEquals(verbatimSlice(body, pos), "alpha _beta_ gamma");
});

Deno.test("verbatimSlice: nested node strips list-continuation indent", () => {
  // Two-line slice whose continuation line carries a 2-space list indent.
  const body = "- x\n\n  line a\n  line b";
  const pos = {
    start: { line: 3, column: 3, offset: 7 },
    end: { line: 4, column: 9, offset: 22 },
  };
  // start.column 3 → strip 2 leading spaces from every line after the first.
  assertEquals(verbatimSlice(body, pos), "line a\nline b");
});

Deno.test("verbatimSlice: no-offset pos uses line/column fallback", () => {
  const body = "- x\n\n  line a\n  line b";
  const pos = {
    start: { line: 3, column: 3 }, // no offset
    end: { line: 4, column: 9 },
  };
  assertEquals(verbatimSlice(body, pos), "line a\nline b");
});

Deno.test("verbatimSlice: undefined position → empty string", () => {
  assertEquals(verbatimSlice("anything", undefined), "");
});

Deno.test("build: definition list preserves inline markup and round-trips", () => {
  const s = "ASIL\n: _Automotive_ Safety **Integrity** Level";
  const blocks = buildBodyAst(s);
  const dl = blocks[0] as DefinitionListNode;
  assertEquals(dl.kind, "definition-list");
  assertEquals(dl.items.length, 1); // single-item deferral pinned (multi-item is deferred)
  assertEquals(dl.items[0].term.text, "ASIL");
  assertEquals(
    dl.items[0].definition.text,
    "_Automotive_ Safety **Integrity** Level",
  );
  assertEquals(render(blocks), s);
});

Deno.test("deflist: verbatim term/def captured, never flattened", () => {
  const s = "ASIL\n: _Automotive_ Safety **Integrity** Level";
  const dl = buildBodyAst(s)[0] as DefinitionListNode;
  assertEquals(dl.kind, "definition-list");
  assertEquals(dl.items.length, 1);
  assertEquals(dl.items[0].term.text, "ASIL");
  assertEquals(
    dl.items[0].definition.text,
    "_Automotive_ Safety **Integrity** Level",
  );
  assertEquals(render(buildBodyAst(s)), s);
});

Deno.test("deflist: indented/edge form still verbatim (no flattened fallback)", () => {
  // Probe the DEFLIST_RE-vs-verbatim-slice mismatch the SP2 TODO flagged.
  const s = "$DEBOUNCE_WINDOW\n: between _1 ms_ and **100 ms**, default 10 ms.";
  const dl = buildBodyAst(s)[0] as DefinitionListNode;
  assertEquals(dl.items[0].term.text, "$DEBOUNCE_WINDOW");
  assertEquals(
    dl.items[0].definition.text,
    "between _1 ms_ and **100 ms**, default 10 ms.",
  );
  assertEquals(render(buildBodyAst(s)), s);
});

Deno.test("deflist: multi-line definition body round-trips (regression: DEFLIST_RE truncation)", () => {
  // Old DEFLIST_RE.exec(verbatim) captured only "line one" — the (.+)$/m
  // anchor stops at the embedded newline, silently dropping "still def".
  // splitVerbatimDeflist takes the full remainder after the first \n:.
  const s = "Term\n: line one\nstill def";
  const dl = buildBodyAst(s)[0] as DefinitionListNode;
  assertEquals(dl.kind, "definition-list");
  assertEquals(dl.items[0].term.text, "Term");
  assertEquals(dl.items[0].definition.text, "line one\nstill def");
  assertEquals(render(buildBodyAst(s)), s);
});

Deno.test("build: table with inline markup in a cell round-trips via raw", () => {
  const s = "| A | B |\n|---|---|\n| _x_ | **y** |";
  assertEquals(render(buildBodyAst(s)), s); // raw passthrough — exact
});

Deno.test("build: thematic break preserved verbatim and round-trips", () => {
  const s = "before\n\n---\n\nafter";
  const blocks = buildBodyAst(s);
  const tb = blocks.find((b) => b.kind === "unknown") as UnknownNode;
  assertEquals(tb.subkind, "thematic-break");
  assertEquals(tb.raw, "---");
  assertEquals(render(blocks), s);
});

Deno.test("build: heading preserved verbatim (# survives) and round-trips", () => {
  const s = "# Not allowed in a body";
  const blocks = buildBodyAst(s);
  const h = blocks[0] as UnknownNode;
  assertEquals(h.kind, "unknown");
  assertEquals(h.subkind, "heading");
  assertEquals(h.raw, s);
  assertEquals(render(blocks), s);
});

Deno.test("build: link reference definition preserved verbatim", () => {
  const s = "See [the spec][s] for detail.\n\n[s]: docs/specs/x.md";
  assertEquals(render(buildBodyAst(s)), s);
});

Deno.test("build: feature node has no AST while the parser is not loaded", () => {
  // Own module graph per test file: nothing here loads the parser.
  const blocks = buildBodyAst("```gherkin\nScenario: x\n  Given a\n```");
  const node = blocks[0] as FeatureNode;
  assertEquals(node.kind, "feature");
  assertEquals(node.feature, undefined);
  assertEquals(node.parseError, undefined);
});

Deno.test("build: feature node gets its AST once the parser is loaded", async () => {
  await loadGherkin();
  const blocks = buildBodyAst("```gherkin\nScenario: x\n  Given a\n```");
  const node = blocks[0] as FeatureNode;
  assertEquals(node.feature?.scenarios.length, 1);
  const bad = buildBodyAst("```gherkin\nScenario: x\n  Given a\n Bogus\n```");
  assertEquals((bad[0] as FeatureNode).parseError?.line, 3);
});

// #989: an encoded (`&#58;`) or escaped (`\:`) colon at the start of a line
// is prose, not a definition-list marker. The paragraph keeps every line.
for (const colon of ["&#58;", "\\:"]) {
  Deno.test(`build: '${colon}' at a line start is a paragraph, not a definition list (#989)`, () => {
    const s = `Term\n${colon} first line\nsecond line.\nthird line shall stay.`;
    const blocks = buildBodyAst(s);
    assertEquals(blocks.length, 1);
    const p = blocks[0] as ParagraphNode;
    assertEquals(p.kind, "paragraph");
    assertEquals(p.content.text, s);
    assertEquals(render(blocks), s);
  });
}

Deno.test("build: a multi-line definition after a literal colon keeps every line (#989)", () => {
  const s = "Term\n: first line\nsecond line.\nthird line shall stay.";
  const dl = buildBodyAst(s)[0] as DefinitionListNode;
  assertEquals(dl.kind, "definition-list");
  assertEquals(dl.items[0].term.text, "Term");
  assertEquals(
    dl.items[0].definition.text,
    "first line\nsecond line.\nthird line shall stay.",
  );
  assertEquals(render(buildBodyAst(s)), s);
});

// The first `\n:` of the source is not a marker: one line holds an escaped
// colon, the next a colon with no space after it. Only `Term\n: ...` is the
// marker. Splitting at the first `\n:` (the code before #989) stored
// `Intro\n\: not a marker` as the term and rendered `:no space` as
// `: no space`, which changes the text.
Deno.test("build: the definition-list split skips colon lines that are not markers (#989)", () => {
  const s =
    "Intro\n\\: not a marker\n:no space, not a marker\nTerm\n: the definition.";
  const blocks = buildBodyAst(s);
  const dl = blocks[0] as DefinitionListNode;
  assertEquals(dl.kind, "definition-list");
  assertEquals(
    dl.items[0].term.text,
    "Intro\n\\: not a marker\n:no space, not a marker\nTerm",
  );
  assertEquals(dl.items[0].definition.text, "the definition.");
  assertEquals(render(blocks), s);
});

// #1008: captions, figures, math and fenced code keep the verbatim source
// that the renderer needs to write them back without losing text.

Deno.test("build: a multi-line caption keeps every line and its markup (#1008)", () => {
  const s =
    "Table: see [the spec](http://a.example/p) and *this*\nsecond line &amp; kept.";
  const blocks = buildBodyAst(s);
  const cap = blocks[0] as CaptionNode;
  assertEquals(cap.kind, "caption");
  assertEquals(cap.keyword, "Table");
  // The detection fields are unchanged: flattened text of the first line.
  assertEquals(cap.text, "see the spec and this");
  assertEquals(cap.raw, s);
  assertEquals(render(blocks), s);
});

Deno.test("build: caption position detection is unchanged by the verbatim source (#1008)", () => {
  const s = "Table: *above*\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n" +
    "![x](p.png)\n\nFigure: below\nsecond line.";
  const blocks = buildBodyAst(s);
  assertEquals((blocks[0] as CaptionNode).position, "above");
  assertEquals((blocks[3] as CaptionNode).position, "below");
  assertEquals(render(blocks), s);
});

Deno.test("build: a figure keeps its title and alt markup (#1008)", () => {
  const s = '![a *b* &amp; c](p.png "The title")';
  const blocks = buildBodyAst(s);
  const fig = blocks[0] as FigureNode;
  assertEquals(fig.kind, "figure");
  assertEquals(fig.alt, "a b & c");
  assertEquals(fig.path, "p.png");
  assertEquals(fig.raw, s);
  assertEquals(render(blocks), s);
});

Deno.test("build: math keeps TeX escapes and character references (#1008)", () => {
  const s = "$$\na \\\\ b \\_c &amp; d\n$$";
  const blocks = buildBodyAst(s);
  const math = blocks[0] as MathNode;
  assertEquals(math.kind, "math");
  assertEquals(math.tex, "\na \\\\ b \\_c &amp; d\n");
  assertEquals(render(blocks), s);
});

Deno.test("build: escaped dollar signs are a paragraph, not math (#1008)", () => {
  const s = "\\$\\$x\\$\\$";
  const blocks = buildBodyAst(s);
  assertEquals(blocks[0].kind, "paragraph");
  assertEquals(render(blocks), s);
});

Deno.test("build: a code fence keeps the info string after the language (#1008)", () => {
  const s = "```js title=x {1,3}\nconst a = 1;\n```";
  const blocks = buildBodyAst(s);
  const code = blocks[0] as CodeNode;
  assertEquals(code.kind, "code");
  assertEquals(code.lang, "js");
  assertEquals(code.meta, " title=x {1,3}");
  assertEquals(code.text, "const a = 1;");
  assertEquals(render(blocks), s);
});

Deno.test("build: a code fence without an info string has no meta (#1008)", () => {
  const code = buildBodyAst("```js\nx\n```")[0] as CodeNode;
  assertEquals("meta" in code, false);
});

Deno.test("build: a gherkin fence keeps the info string after the language (#1008)", () => {
  const s = "```gherkin title=x\nFeature: f\n```";
  const blocks = buildBodyAst(s);
  const feat = blocks[0] as FeatureNode;
  assertEquals(feat.kind, "feature");
  assertEquals(feat.meta, " title=x");
  assertEquals(render(blocks), s);
});

// The info string after the language is the verbatim source of the fence
// line: escapes, character references and the spaces before it are kept,
// and trailing spaces are removed (#1008).
for (
  const [name, fenceLine, meta, rendered] of [
    ["a character reference", "```js a&amp;b", " a&amp;b", "```js a&amp;b"],
    [
      "backslash escapes",
      "```js a\\_b \\{1\\}",
      " a\\_b \\{1\\}",
      "```js a\\_b \\{1\\}",
    ],
    [
      "several spaces after the language",
      "```js    title=x",
      "    title=x",
      "```js    title=x",
    ],
    ["trailing spaces", "```js title=x  ", " title=x", "```js title=x"],
  ]
) {
  Deno.test(`build: a code fence info string keeps ${name} (#1008)`, () => {
    const blocks = buildBodyAst(`${fenceLine}\nconst a = 1;\n\`\`\``);
    const code = blocks[0] as CodeNode;
    assertEquals(code.kind, "code");
    assertEquals(code.lang, "js");
    assertEquals(code.meta, meta);
    assertEquals(render(blocks), `${rendered}\nconst a = 1;\n\`\`\``);
  });
}

Deno.test("build: a gherkin fence info string is verbatim (#1008)", () => {
  const s = "```gherkin   a&amp;b\nFeature: f\n```";
  const feat = buildBodyAst(s)[0] as FeatureNode;
  assertEquals(feat.meta, "   a&amp;b");
  assertEquals(render([feat]), s);
});

Deno.test("build: a fence with only trailing spaces after the language has no meta (#1008)", () => {
  const code = buildBodyAst("```js   \nx\n```")[0] as CodeNode;
  assertEquals("meta" in code, false);
});

Deno.test("build: an indented code block that starts with a fence line has no meta (#1008)", () => {
  const blocks = buildBodyAst("Text.\n\n    ```js x\n    y");
  const code = blocks[1] as CodeNode;
  assertEquals(code.kind, "code");
  assertEquals(code.lang, undefined);
  assertEquals("meta" in code, false);
  assertEquals(code.text, "```js x\ny");
  assertEquals(render(blocks), "Text.\n\n```\n```js x\ny\n```");
});
