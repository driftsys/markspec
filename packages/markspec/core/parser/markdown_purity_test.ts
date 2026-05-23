/**
 * @module parser/markdown_purity_test
 *
 * Verifies that MarkSpec is a pure extension to CommonMark+GFM on
 * entry-free input: parsing a Markdown document that contains no entry
 * blocks must yield the exact same mdast tree as a vanilla
 * `remark-parse + remark-gfm` pipeline, and must emit zero entries and
 * zero diagnostics.
 *
 * The first test is the load-bearing regression guard: it constructs
 * the baseline freshly from the vendor packages so adding any
 * transformer to the shared processor would fail this test.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { parseMarkdown } from "./markdown.ts";
import { processor } from "./remark.ts";

const ENTRY_FREE_FIXTURES: Record<string, string> = {
  "atx headings + paragraph": `# Title

## Subhead

A paragraph with *emphasis*, **strong**, and \`code\`.
`,
  "setext heading": `Title
=====

Body.
`,
  "bullet list (no bracketed items)": `- one
- two
  - nested
- three
`,
  "ordered list": `1. first
2. second
3. third
`,
  "gfm table": `| col a | col b |
|-------|-------|
|   1   |   2   |
`,
  "gfm task list": `- [ ] todo
- [x] done
`,
  "fenced code block": `\`\`\`ts
const x: number = 1;
\`\`\`
`,
  "indented code block": `    indented code
    spans two lines
`,
  "blockquote": `> quoted
>
> second paragraph
`,
  "thematic break": `before

---

after
`,
  "reference-style link with definition": `See [the spec][cm] for details.

[cm]: https://commonmark.org
`,
  "autolink": `Visit <https://example.com> for info.
`,
  "inline html": `<div class="note">hand-written html</div>
`,
};

Deno.test("entry-free Markdown: shared processor produces the same mdast as a fresh vendor processor", () => {
  // Build a baseline that has never been touched by MarkSpec code. If
  // someone adds a transformer to the shared processor, the trees
  // diverge here.
  const baseline = unified().use(remarkParse).use(remarkGfm);

  for (const [name, md] of Object.entries(ENTRY_FREE_FIXTURES)) {
    const actual = processor.parse(md);
    const expected = baseline.parse(md);
    assertEquals(actual, expected, `mdast diverged for fixture: ${name}`);
  }
});

Deno.test("entry-free Markdown: parseMarkdown returns zero entries and zero diagnostics", () => {
  for (const [name, md] of Object.entries(ENTRY_FREE_FIXTURES)) {
    const { entries, diagnostics } = parseMarkdown(md);
    assertEquals(entries, [], `expected no entries for fixture: ${name}`);
    assertEquals(
      diagnostics,
      [],
      `expected no diagnostics for fixture: ${name}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Boundary case: `- [foo] bar` with no matching link definition
// ---------------------------------------------------------------------------
//
// The parser admits any list item shaped like `- [identifier] ...` as
// an entry candidate, then rejects it later when structural checks
// fail (missing body, missing Id, etc.). For unresolved shortcut-style
// references this means a list item the author intended as plain
// Markdown can still produce a MarkSpec diagnostic.
//
// This test pins down the current behavior so the boundary is visible.
// Pure-CommonMark prose that happens to contain `- [word]` items is
// NOT entry-free under MarkSpec's parser.

Deno.test("boundary: `- [foo] bar` with no link definition is treated as an entry attempt", () => {
  const md = `- [foo] this looks like a list item but foo has no definition
`;
  const { entries, diagnostics } = parseMarkdown(md);
  // The candidate is rejected — no entry is returned.
  assertEquals(entries, []);
  // But the rejection path emits diagnostics, so MarkSpec is not
  // strictly silent on this shape.
  assertNotEquals(diagnostics, []);
});
