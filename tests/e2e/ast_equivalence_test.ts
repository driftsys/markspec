/**
 * @module tests/e2e/ast_equivalence_test
 *
 * Body-AST equivalence gate (PR 3 safety mechanism).
 *
 * For every corpus file that contains entries, and for every inline
 * edge-case body string, asserts:
 *
 *   render(entry.bodyAst ?? []) === entry.body
 *
 * byte-for-byte, where `entry.body` is the body text from parsing a
 * *formatted* (canonical) copy of the file. This proves that `render`
 * is the exact inverse of `buildBodyAst` on canonical input, which is
 * the contract PR 4's formatter cutover depends on.
 *
 * Corpus:
 *   1. Every .md file under tests/fixtures/ that contains entries.
 *   2. Every entry-bearing .md file under docs/product/ and docs/examples/
 *      (a file is entry-bearing if it contains a `- [` list item after
 *      formatting and parsing yields at least one entry).
 *   3. A curated inline edge-case set (one body per §2.4 block type,
 *      plus nesting and marker-in-prose cases, including GFM table
 *      shapes where separator rows may be wider than cell content, and
 *      blockquote/note bodies with interior blank quoted lines).
 *
 * KNOWN-GAP list (exclusions from broadened corpus, none at this time):
 *   Zero exclusions — all entry-bearing fixture and project doc entries
 *   round-trip byte-identically after the PR-3 fixes.
 */

import { assertEquals } from "@std/assert";
import { format, parseFile } from "../../packages/markspec/core/mod.ts";
import { render } from "../../packages/markspec/core/ast/render.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run the equivalence check for a single entry body string.
 * Formats it (to canonicalize), parses, then checks render reproduces body.
 */
async function checkBodyEquivalence(
  label: string,
  rawBody: string,
): Promise<void> {
  // Wrap in a minimal valid entry so format + parseFile can process it.
  const entryDoc = `- [TST_EQ_0001] Test entry\n\n  ${
    rawBody.replace(/\n/g, "\n  ")
  }\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n`;
  const formatted = format(entryDoc, { file: "test.md" }).output;
  const parsed = await parseFile(formatted, { file: "test.md" });
  if (parsed.entries.length === 0) {
    throw new Error(`${label}: no entries parsed from document`);
  }
  for (const entry of parsed.entries) {
    const bodyAst = entry.bodyAst ?? [];
    const rendered = render(bodyAst);
    if (rendered !== entry.body) {
      throw new Error(
        `${label} [${entry.displayId}]: byte mismatch\n` +
          `  Expected: ${JSON.stringify(entry.body)}\n` +
          `  Got:      ${JSON.stringify(rendered)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Corpus: fixture files
// ---------------------------------------------------------------------------

const FIXTURES_DIR = new URL("../fixtures", import.meta.url).pathname;

Deno.test("ast-equivalence: corpus files", async (t) => {
  // Walk all .md files under tests/fixtures/
  const mdFiles: string[] = [];
  for await (const entry of Deno.readDir(FIXTURES_DIR)) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      mdFiles.push(`${FIXTURES_DIR}/${entry.name}`);
    }
  }
  mdFiles.sort();

  let totalFiles = 0;
  let filesWithEntries = 0;
  let totalEntries = 0;

  for (const filePath of mdFiles) {
    const content = await Deno.readTextFile(filePath);
    // Format first → canonical form.
    const formatted = format(content, { file: filePath }).output;
    const parsed = await parseFile(formatted, { file: filePath });

    if (parsed.entries.length === 0) {
      // File has no entries — skip (but count it).
      totalFiles++;
      continue;
    }

    totalFiles++;
    filesWithEntries++;

    await t.step(`file: ${filePath.split("/").pop()}`, () => {
      for (const entry of parsed.entries) {
        const bodyAst = entry.bodyAst ?? [];
        const rendered = render(bodyAst);
        assertEquals(
          rendered,
          entry.body,
          `Entry [${entry.displayId}] in ${
            filePath.split("/").pop()
          }: render(bodyAst) !== entry.body\n` +
            `  Expected: ${JSON.stringify(entry.body)}\n` +
            `  Got:      ${JSON.stringify(rendered)}`,
        );
        totalEntries++;
      }
    });
  }

  // Summary (informational — not an assertion, but visible in verbose output).
  console.log(
    `ast-equivalence corpus: ${filesWithEntries}/${totalFiles} files with entries, ${totalEntries} entries checked`,
  );
});

// ---------------------------------------------------------------------------
// Corpus: docs/product/ and docs/examples/ (broadened real-project files)
// ---------------------------------------------------------------------------

/**
 * Recursively collect all .md file paths under a directory.
 * Returns paths in sorted order for deterministic test output.
 */
async function collectMdFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        result.push(...await collectMdFiles(path));
      } else if (entry.isFile && entry.name.endsWith(".md")) {
        result.push(path);
      }
    }
  } catch {
    // Directory may not exist in all worktree configurations; skip silently.
  }
  return result.sort();
}

const REPO_ROOT = new URL("../../", import.meta.url).pathname;

Deno.test("ast-equivalence: broadened corpus (docs/product + docs/examples)", async (t) => {
  // Collect all .md files under the two real-project directories.
  const searchDirs = [
    `${REPO_ROOT}docs/product`,
    `${REPO_ROOT}docs/examples`,
  ];
  const mdFiles: string[] = [];
  for (const dir of searchDirs) {
    mdFiles.push(...await collectMdFiles(dir));
  }

  let totalFiles = 0;
  let filesWithEntries = 0;
  let totalEntries = 0;

  for (const filePath of mdFiles) {
    totalFiles++;
    const content = await Deno.readTextFile(filePath);

    // Quick pre-check: skip files that contain no entry list items at all.
    // This avoids the format+parse round-trip on purely prose files.
    if (!content.includes("- [")) continue;

    // Format first → canonical form (idempotent on already-canonical files).
    const formatted = format(content, { file: filePath }).output;
    const parsed = await parseFile(formatted, { file: filePath });

    if (parsed.entries.length === 0) continue;

    filesWithEntries++;

    await t.step(
      `file: ${filePath.replace(REPO_ROOT, "")}`,
      () => {
        for (const entry of parsed.entries) {
          const bodyAst = entry.bodyAst ?? [];
          const rendered = render(bodyAst);
          assertEquals(
            rendered,
            entry.body,
            `Entry [${entry.displayId}] in ${
              filePath.replace(REPO_ROOT, "")
            }: render(bodyAst) !== entry.body\n` +
              `  Expected: ${JSON.stringify(entry.body)}\n` +
              `  Got:      ${JSON.stringify(rendered)}`,
          );
          totalEntries++;
        }
      },
    );
  }

  // Summary visible in verbose output.
  console.log(
    `ast-equivalence broadened corpus: ${filesWithEntries}/${totalFiles} entry-bearing files, ${totalEntries} entries checked`,
  );
});

// ---------------------------------------------------------------------------
// Edge-case set: one canonical body per §2.4 block type
// ---------------------------------------------------------------------------

Deno.test("ast-equivalence: edge cases", async (t) => {
  // Each entry: [label, canonicalBody]
  // The body strings here are already canonical (what the formatter would
  // produce). The gate wraps them in a minimal entry, formats (idempotent),
  // parses, and checks render reproduces entry.body byte-for-byte.
  const cases: [string, string][] = [
    // ParagraphNode — plain prose
    [
      "paragraph: plain prose",
      "The sensor driver shall debounce raw inputs.",
    ],
    // ParagraphNode — multi-line prose (newline preserved by parser)
    [
      "paragraph: multi-line",
      "The sensor driver shall debounce raw inputs\nbefore processing.",
    ],
    // ParagraphNode — modal keyword markers in prose
    [
      "paragraph: modal keywords",
      "The system shall validate and must reject invalid values.",
    ],
    // FigureNode — image-only paragraph
    [
      "figure: image link",
      "![system diagram](docs/arch.svg)",
    ],
    // CodeNode — fenced block with language
    [
      "code: fenced with lang",
      "```rust\nfn main() {}\n```",
    ],
    // CodeNode — fenced block without language
    [
      "code: fenced no lang",
      "```\nverbatim content here\n```",
    ],
    // FeatureNode — gherkin fence
    [
      "feature: gherkin block",
      "```gherkin\nFeature: braking\n  Scenario: emergency stop\n    Given speed exceeds 30 km/h\n```",
    ],
    // MathNode — $$ block
    [
      "math: LaTeX block",
      "$$\nE = mc^2\n$$",
    ],
    // NoteNode — GitHub admonition WARNING
    [
      "note: WARNING admonition",
      "> [!WARNING]\n> Failure to debounce may lead to spurious brake activation.",
    ],
    // NoteNode — GitHub admonition NOTE
    [
      "note: NOTE admonition",
      "> [!NOTE]\n> This is an informational note.",
    ],
    // NoteNode — multi-line body (regression: all content lines must carry `> `)
    [
      "note: multi-line WARNING body",
      "> [!WARNING]\n> line one\n> line two",
    ],
    // NoteNode — GitHub admonition TIP
    [
      "note: TIP admonition",
      "> [!TIP]\n> Consider using the default configuration.",
    ],
    // NoteNode — GitHub admonition IMPORTANT
    [
      "note: IMPORTANT admonition",
      "> [!IMPORTANT]\n> This setting affects safety behaviour.",
    ],
    // NoteNode — GitHub admonition CAUTION
    [
      "note: CAUTION admonition",
      "> [!CAUTION]\n> Modifying this value requires re-validation.",
    ],
    // CaptionNode — Figure keyword
    [
      "caption: Figure",
      "Figure: System context diagram",
    ],
    // CaptionNode — Table keyword
    [
      "caption: Table",
      "Table: Sensor plausibility bounds",
    ],
    // DefinitionListNode — single term
    [
      "definition-list: single term",
      "ASIL\n: Automotive Safety Integrity Level",
    ],
    // BlockquoteNode — multi-line (regression: all lines must carry `> `)
    [
      "blockquote: multi-line excerpt",
      "> line one\n> line two",
    ],
    // BlockquoteNode — interior blank quoted line (two paragraphs in blockquote)
    // build.ts must join paragraph children with "\n\n"; renderer must emit
    // bare `>` (no trailing space) for the empty separator line.
    [
      "blockquote: interior blank line",
      "> a\n>\n> b",
    ],
    // NoteNode — interior blank quoted line (two paragraphs inside a note)
    // The admonition marker occupies the first line of the first paragraph;
    // the second paragraph is separated by a bare `>` in the source.
    [
      "note: interior blank quoted line",
      "> [!NOTE]\n> a\n>\n> c",
    ],
    // ListNode — unordered, two items
    [
      "list: unordered two items",
      "- check plausibility\n- validate range",
    ],
    // ListNode — loose list (spread=true): blank lines between items in source
    [
      "list: loose list (spread)",
      "- a\n\n- b\n\n- c",
    ],
    // ListNode — ordered, two items
    [
      "list: ordered two items",
      "1. first step\n2. second step",
    ],
    // TableNode — simple GFM table
    [
      "table: simple two-column table",
      "| A | B |\n|---|---|\n| 1 | 2 |",
    ],
    // TableNode — separator row wider than cell content (key round-trip case)
    // Previously the re-padding logic would rewrite `| ------------- |` to
    // `| - |` (min-content); raw passthrough preserves it byte-for-byte.
    [
      "table: separator wider than cell content",
      "| Col A         | Col B |\n| ------------- | ----- |\n| x             | y     |",
    ],
    // TableNode — extra-padded data cells
    [
      "table: extra-padded data cells",
      "| Name    | Value |\n|---------|-------|\n| foo     | 42    |",
    ],
    // TableNode inside a multi-block body (paragraph + table + paragraph)
    [
      "table: inside multi-block body",
      "See the table below.\n\n| Col A | Col B |\n|-------|-------|\n| x     | y     |\n\nEnd of table.",
    ],
    // Mixed: paragraph + note
    [
      "mixed: paragraph + note",
      "The sensor driver shall debounce raw inputs.\n\n> [!WARNING]\n> Spurious activation risk.",
    ],
    // Mixed: paragraph + figure + caption
    [
      "mixed: paragraph + figure + caption",
      "System overview is shown below.\n\n![architecture](arch.svg)\n\nFigure: System architecture overview",
    ],
    // Mixed: two paragraphs
    [
      "mixed: two paragraphs",
      "First paragraph text.\n\nSecond paragraph text.",
    ],
    // Mixed: paragraph + code
    [
      "mixed: paragraph + code",
      "Implementation reference:\n\n```rust\nfn debounce(input: u32) -> u32 { input }\n```",
    ],
    // Mixed: paragraph + list
    [
      "mixed: paragraph + list",
      "The following checks shall be performed:\n\n- check A\n- check B\n- check C",
    ],
    // TableNode nested inside a list item (key nested round-trip case).
    // The list-continuation indent ("  ") must not be doubled on
    // render: raw is stored indent-normalised (column-0-anchored) and
    // renderListItem re-adds "  " uniformly.
    [
      "table: nested inside list item",
      "- item one\n\n  | H1 | H2 |\n  |----|----|\n  | v1 | v2 |\n\n- item two",
    ],
    // CodeNode nested inside a list item (regression guard for other
    // verbatim nodes in loose lists).
    [
      "code: nested inside list item",
      "- item one\n\n  ```rust\n  fn main() {}\n  ```\n\n- item two",
    ],
    [
      "paragraph: inline emphasis/strong/link preserved",
      "The driver _shall_ debounce **inputs** — see [spec](docs/x.md).",
    ],
    [
      "paragraph: hard line break (two-space)",
      "line one  \nline two",
    ],
    [
      "note: inline markup in admonition body",
      "> [!NOTE]\n> See _the spec_ and the [guide](docs/g.md).",
    ],
    [
      "blockquote: inline markup excerpt",
      "> An excerpt with _emphasis_ and a [link](docs/x.md).",
    ],
    [
      "definition-list: inline markup in definition",
      "ASIL\n: _Automotive_ Safety **Integrity** Level",
    ],
  ];

  for (const [label, body] of cases) {
    await t.step(label, () => checkBodyEquivalence(label, body));
  }
});
