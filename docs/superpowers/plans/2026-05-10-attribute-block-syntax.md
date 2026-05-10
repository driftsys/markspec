# Attribute Block Syntax — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Spec:**
[`docs/superpowers/specs/2026-05-10-attribute-block-syntax-design.md`](../specs/2026-05-10-attribute-block-syntax-design.md)

**Goal:** Switch the entry attribute block from `Key: Value\`-trailing-paragraph
to a 4-space indented code block. One canonical form; no compact variant.

**Architecture:** The current parser is already shape-agnostic —
`splitBodyAndAttributes`
([`packages/markspec/core/parser/attributes.ts:118-151`](../../../packages/markspec/core/parser/attributes.ts))
and `findAttributeBlockRange`
([`packages/markspec/core/formatter/mod.ts:332-363`](../../../packages/markspec/core/formatter/mod.ts))
both walk lines, trim, and match the `[A-Z][A-Za-z-]*:` shape after trimming.
Indented code blocks (where each line is `Key: Value` with leading spaces) parse
identically once trimmed. The actual implementation is therefore: change the
**formatter emission** to indented form, update the **spec** and **LSP
snippet**, migrate **fixtures + project docs**, refresh **snapshots**. No parser
logic change.

**Tech stack:** Deno + TypeScript, Cliffy CLI, unified/remark/mdast, `just` task
runner, `assertSnapshot` for prose, `assertEquals` for behavioral.

---

## Pre-flight

You're working in worktree `feat-attribute-block-indented-code`. Verify baseline
before starting:

```bash
just check
```

Expected: PASS.

If anything fails on `main` baseline, stop and ask before continuing.

---

## Task 1: Rewrite language spec §2 — Attribute blocks

**Files:**

- Modify: `docs/spec/language/language.md` (§2 under "Part 1 — Markdown Flavor",
  lines around 309-323)

- [ ] **Step 1: Read the current section**

```bash
sed -n '309,330p' docs/spec/language/language.md
```

Expected: existing `#### §2 Attribute blocks` section describing trailing `\`.

- [ ] **Step 2: Replace the section body**

Replace the current section in `docs/spec/language/language.md` (the block under
`#### §2 Attribute blocks` up to but not including `#### §3 Table captions`)
with:

````markdown
#### §2 Attribute blocks

An attribute block is the **trailing indented code block** of an entry. Each
content line is a single `Key: Value` pair. No trailing line-continuation
characters.

The block is indented 4 spaces relative to the entry body indent (CommonMark
indented-code-block rule). Inside a Markdown list item, that means 6 absolute
columns before the `Key`; inside a source-file doc comment (no enclosing list),
4 columns relative to the comment content column.

**Example 3 — attribute block:**

```markdown
- [SRS_BRK_0001] Sensor debouncing

  Sensor driver shall debounce raw inputs.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDE
      Satisfies: SYS_BRK_0042
      Labels: ASIL-B
```

The set of valid attributes is the universal set (Part 2 §2.1) plus whatever the
active profile declares for the entry's shape and inferred type.

**Generated attributes** (build-time inverses of authored relations such as
`Verified-by` from `Verifies`, `Cited-by` from `References`) are computed by
tooling and never appear in source. The exact set is profile-declared.

**Disambiguation from body code blocks.** The trailing indented code block
qualifies as an attribute block only when every one of its content lines matches
`^[A-Z][A-Za-z-]*:` shape. Otherwise it remains a regular code block and the
entry is treated as having no attribute block. Fenced code blocks (```) anywhere
in the entry are body content and never confused with the attribute block —
different syntactic shape.

**Trailing position is required.** If body prose appears after an indented
`Key: Value` block, that block is not trailing — it is treated as a regular code
block with no attribute meaning. Authors must place attributes at the very end
of the entry.

**Backward compatibility.** During the transition, the parser also accepts the
legacy paragraph-with-trailing-`\` shape. Running `markspec format` rewrites
legacy blocks to the canonical indented form. The legacy shape emits a
deprecation diagnostic (`MSL-DEPRECATED-ATTR-001`) and will be removed in a
future major release.
````

- [ ] **Step 3: Build the spec book to catch markdown errors**

```bash
just check
```

Expected: PASS (lint + type-check + tests).

- [ ] **Step 4: Commit**

```bash
git add docs/spec/language/language.md
git commit -m "docs(spec): rewrite attribute block syntax to indented code block

Replaces the trailing-backslash paragraph form with a 4-space indented
code block. References the design doc for trade-offs and migration plan."
```

---

## Task 2: Update ast.md if it describes the attribute block AST shape

**Files:**

- Check: `docs/spec/language/ast.md`

- [ ] **Step 1: Inspect the file**

```bash
grep -n -A 5 -i "attribute\|trailing\|backslash" docs/spec/language/ast.md
```

If no attribute-block AST description exists, skip to Task 3.

- [ ] **Step 2: If a description exists, update it**

Change references from "paragraph with hard line breaks" → "indented code block
(`code` mdast node)". Keep the description focused on AST representation, not
authoring syntax (that's language.md's job).

- [ ] **Step 3: Build**

```bash
just check
```

Expected: PASS.

- [ ] **Step 4: Commit (if file was modified)**

```bash
git add docs/spec/language/ast.md
git commit -m "docs(spec): update AST description for indented-code attribute block"
```

---

## Task 3: Add formatter test asserting new emission shape (failing)

**Files:**

- Modify: `packages/markspec/core/formatter/mod_test.ts`

- [ ] **Step 1: Find the existing renderAttributeBlock or format-output test**

```bash
grep -n "renderAttributeBlock\|backslash\|Id: 01H" packages/markspec/core/formatter/mod_test.ts | head -20
```

Note one existing test name so you can place the new test next to it.

- [ ] **Step 2: Append a new test asserting indented-code-block emission**

Add to `packages/markspec/core/formatter/mod_test.ts`:

```typescript
Deno.test("renderAttributeBlock: emits indented code block (4-space prefix, no backslash)", () => {
  const block = renderAttributeBlock(
    [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDE" },
      { key: "Satisfies", value: "SYS_BRK_0042" },
      { key: "Labels", value: "ASIL-B" },
    ],
    2, // body indent of a list-item entry
  );

  const expected =
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDE\n" +
    "      Satisfies: SYS_BRK_0042\n" +
    "      Labels: ASIL-B";

  assertEquals(block, expected);
});

Deno.test("renderAttributeBlock: doc-comment indent (no list wrapper)", () => {
  const block = renderAttributeBlock(
    [{ key: "Id", value: "01HGW3C4DEF6ABCDEFGHJKMNPQ" }],
    0, // doc comment, no list nesting
  );
  assertEquals(block, "    Id: 01HGW3C4DEF6ABCDEFGHJKMNPQ");
});
```

If `renderAttributeBlock` isn't imported in the test file yet, add the import.
Look at the existing imports at the top and add `renderAttributeBlock` to the
list, e.g.:

```typescript
import {
  format,
  renderAttributeBlock,
  // ... existing imports
} from "./mod.ts";
```

- [ ] **Step 3: Run the new tests and verify they fail**

```bash
deno test packages/markspec/core/formatter/mod_test.ts --filter "renderAttributeBlock: emits indented" --allow-read
```

Expected: FAIL — current implementation emits `Id: ...\` at 2-space indent, not
`Id: ...` at 6-space.

- [ ] **Step 4: Commit the failing tests**

```bash
git add packages/markspec/core/formatter/mod_test.ts
git commit -m "test(core): add failing tests for indented-code-block attribute emission"
```

---

## Task 4: Update renderAttributeBlock to emit indented code block

**Files:**

- Modify: `packages/markspec/core/formatter/mod.ts` (function
  `renderAttributeBlock`, lines 283-298)

- [ ] **Step 1: Replace the function**

In `packages/markspec/core/formatter/mod.ts`, replace lines 283-298 with:

```typescript
/**
 * Render attributes as an indented code block.
 * Each line is `Key: Value` at (indent + 4) absolute columns;
 * no trailing line-continuation characters.
 *
 * @param attributes - The attributes to render, in canonical order.
 * @param indent - Body indent for the entry (2 for list-wrapped entries,
 *   0 for entries inside source-file doc comments).
 */
export function renderAttributeBlock(
  attributes: Attribute[],
  indent: number,
): string {
  const prefix = " ".repeat(indent + 4);
  return attributes
    .map((attr) => `${prefix}${attr.key}: ${attr.value}`)
    .join("\n");
}
```

- [ ] **Step 2: Run the new tests and verify they pass**

```bash
deno test packages/markspec/core/formatter/mod_test.ts --filter "renderAttributeBlock" --allow-read
```

Expected: PASS.

- [ ] **Step 3: Run the full formatter test file**

```bash
deno test packages/markspec/core/formatter/ --allow-read --allow-write
```

Expected: most other tests in `mod_test.ts` will FAIL because their expected
output strings still use the old `\` form. That's the next task. Note the
failing test names.

- [ ] **Step 4: Commit the implementation**

```bash
git add packages/markspec/core/formatter/mod.ts
git commit -m "feat(core): emit attribute blocks as indented code blocks

Drops the trailing-backslash hard-line-break paragraph in favor of a
4-space indented code block per the new spec. Parser-side detection is
unchanged (line-trim + Key: Value match accepts both shapes during the
transition)."
```

---

## Task 5: Update cascading formatter tests for the new shape

**Files:**

- Modify: `packages/markspec/core/formatter/mod_test.ts`

- [ ] **Step 1: Identify failing tests**

```bash
deno test packages/markspec/core/formatter/mod_test.ts --allow-read --allow-write 2>&1 | grep -E "^test |FAIL" | head -30
```

Expected: a list of tests with their pass/fail status.

- [ ] **Step 2: For each failing test, update the expected output**

For every failing test, locate its expected-output string (the one with
`Id: 01H...\` or `Labels: ...\`) and rewrite it to the new shape:

- Drop trailing `\` from each line.
- Indent each `Key: Value` line by (body-indent + 4) spaces.
- Body indent stays as-is (2 for `.md` list, 0 for doc comments).

Example transformation:

Before:

```typescript
const expected = `- [SRS_BRK_0001] Title

  Body.

  Id: 01HGW...\\
  Labels: ASIL-B
`;
```

After:

```typescript
const expected = `- [SRS_BRK_0001] Title

  Body.

      Id: 01HGW...
      Labels: ASIL-B
`;
```

- [ ] **Step 3: Run the full file until green**

```bash
deno test packages/markspec/core/formatter/mod_test.ts --allow-read --allow-write
```

Expected: PASS, all tests.

- [ ] **Step 4: Commit**

```bash
git add packages/markspec/core/formatter/mod_test.ts
git commit -m "test(core): update formatter test fixtures for indented-code attribute shape"
```

---

## Task 6: Add explicit parser tests asserting both shapes parse identically

**Files:**

- Modify: `packages/markspec/core/parser/attributes_test.ts`

- [ ] **Step 1: Append two paired tests**

Add to `packages/markspec/core/parser/attributes_test.ts`:

```typescript
Deno.test("splitBodyAndAttributes: indented-code-block form (new canonical)", () => {
  // Body indent is already stripped by the caller; the input below is what
  // extractBodyContent returns for an entry whose attribute block is an
  // indented code block at body+4 columns.
  const content =
    "Body sentence.\n" +
    "\n" +
    "    Id: 01HGW2Q8MNP3RSTVWXYZABCDE\n" +
    "    Satisfies: SYS_BRK_0042\n" +
    "    Labels: ASIL-B";

  const [body, attrs] = splitBodyAndAttributes(content);

  assertEquals(body, "Body sentence.");
  assertEquals(attrs, [
    "Id: 01HGW2Q8MNP3RSTVWXYZABCDE",
    "Satisfies: SYS_BRK_0042",
    "Labels: ASIL-B",
  ]);
});

Deno.test("splitBodyAndAttributes: legacy backslash-paragraph form still parses", () => {
  const content =
    "Body sentence.\n" +
    "\n" +
    "Id: 01HGW2Q8MNP3RSTVWXYZABCDE\\\n" +
    "Satisfies: SYS_BRK_0042\\\n" +
    "Labels: ASIL-B";

  const [body, attrs] = splitBodyAndAttributes(content);

  assertEquals(body, "Body sentence.");
  // Note: trailing `\` is preserved by splitBodyAndAttributes;
  // parseAttributes strips it via ATTRIBUTE_RE's optional `\\?`.
  assertEquals(attrs, [
    "Id: 01HGW2Q8MNP3RSTVWXYZABCDE\\",
    "Satisfies: SYS_BRK_0042\\",
    "Labels: ASIL-B",
  ]);
});

Deno.test("parseAttributes: both shapes produce identical Attribute[]", () => {
  const newShape = parseAttributes([
    "Id: 01HGW2Q8MNP3RSTVWXYZABCDE",
    "Satisfies: SYS_BRK_0042",
  ]);
  const legacyShape = parseAttributes([
    "Id: 01HGW2Q8MNP3RSTVWXYZABCDE\\",
    "Satisfies: SYS_BRK_0042\\",
  ]);
  assertEquals(newShape, legacyShape);
});
```

If `splitBodyAndAttributes` isn't imported, add it:

```typescript
import { parseAttributes, splitBodyAndAttributes } from "./attributes.ts";
```

- [ ] **Step 2: Run the file**

```bash
deno test packages/markspec/core/parser/attributes_test.ts --allow-read
```

Expected: PASS, all tests. (These tests document existing behavior — no parser
change was needed.)

- [ ] **Step 3: Commit**

```bash
git add packages/markspec/core/parser/attributes_test.ts
git commit -m "test(core): assert parser accepts both legacy and indented-code attribute shapes"
```

---

## Task 7: Update LSP completion snippet to emit indented-code form

**Files:**

- Modify: `packages/markspec/lsp/completions.ts` (function
  `buildBlockScaffoldItems`, around lines 98-124)
- Verify: any test file that asserts the snippet text (likely none — completions
  logic is mostly behavior-asserted).

- [ ] **Step 1: Read the current snippet template**

```bash
grep -n -B 2 -A 10 "insertText" packages/markspec/lsp/completions.ts
```

You'll see the generic snippet (lines ~105-109) and the per-type snippet (line
~119).

- [ ] **Step 2: Replace both insertText templates**

In `packages/markspec/lsp/completions.ts`, replace the generic snippet block:

```typescript
return [
  {
    label: "New entry",
    insertText:
      "${1:PREFIX_NNNN}] ${2:Title}\n\n  ${3:Body.}\n\n      Id: \\${ULID}",
    isSnippet: true,
    kind: KIND_SNIPPET,
  },
];
```

And the per-type snippet (inside the `.map(...)`):

```typescript
insertText:
  `${displayId}] \${1:Title}\n\n  \${2:Body.}\n\n      Id: \\$\{ULID}\n      \${3:Satisfies: }`,
```

Note the snippet template no longer needs the double-escaped `\\\\`
line-continuation — each attribute is on its own snippet line at body+4 indent.

- [ ] **Step 3: Test the completions module if tests exist**

```bash
ls packages/markspec/lsp/*_test.ts 2>/dev/null
```

If a test file exists, run it:

```bash
deno test packages/markspec/lsp/ --allow-read
```

Expected: PASS.

- [ ] **Step 4: Manually verify the snippet via the LSP**

This is hard to automate; skip for the plan and rely on the post-merge
`just build` smoke test.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/lsp/completions.ts
git commit -m "feat(lsp): update block-scaffold snippet to indented-code attribute form"
```

---

## Task 8: Verify render/styles handles the new shape

**Files:**

- Inspect: `packages/markspec/render/styles/mod.ts`
- Test: `packages/markspec/render/styles/mod_test.ts`

The renderer's `splitBodyAttributes` already uses the same trim + ATTR_LINE_RE
approach as the core parser, so both shapes should already work. We add a
regression test to lock that in.

- [ ] **Step 1: Inspect mod_test.ts for an existing styled-render test**

```bash
grep -n "Deno.test" packages/markspec/render/styles/mod_test.ts
```

Note the convention (test name shape, imports, fixture style).

- [ ] **Step 2: Add a regression test for the new shape**

Append to `packages/markspec/render/styles/mod_test.ts`:

```typescript
Deno.test("styleRequirementBlocks: parses attributes from indented-code form", () => {
  const markdown = [
    "- [SRS_TEST_0001] Render styles regression",
    "",
    "  Body.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDE",
    "      Labels: ASIL-B",
    "",
  ].join("\n");

  // Empty compiled context is fine — styler only needs the entry shape.
  const compiled = {
    entries: new Map(),
    links: [],
    forward: new Map(),
    reverse: new Map(),
  };

  const result = styleRequirementBlocks(markdown, compiled as never);

  // The styled output must include the attribute row(s) from the table.
  assertStringIncludes(result.output, "**Id**");
  assertStringIncludes(result.output, "01HGW2Q8MNP3RSTVWXYZABCDE");
  assertStringIncludes(result.output, "**Labels**");
});
```

If `assertStringIncludes` isn't imported, add it from `@std/assert`.

- [ ] **Step 3: Run the test**

```bash
deno test packages/markspec/render/styles/mod_test.ts --allow-read
```

Expected: PASS (no implementation change required — confirms the renderer
accepts the new shape).

- [ ] **Step 4: Commit**

```bash
git add packages/markspec/render/styles/mod_test.ts
git commit -m "test(render): assert styled renderer accepts indented-code attribute form"
```

---

## Task 9: Migrate test fixtures via `markspec format`

**Files:**

- Modify: `tests/fixtures/traceability-matrix.md`, `tests/fixtures/glossary.md`,
  `tests/fixtures/requirement-block.md` (and any other `.md` under
  `tests/fixtures/` containing `\`-trailer attribute blocks)

- [ ] **Step 1: List fixture files containing the legacy shape**

```bash
grep -rln '\\$' tests/fixtures/ 2>/dev/null
```

Note the result.

- [ ] **Step 2: Run `markspec format` on each file**

For each file listed in Step 1, run:

```bash
deno run --allow-read --allow-write packages/markspec/main.ts format <file>
```

Expected: `format` rewrites the file's attribute blocks to the indented-code
form. The CLI prints `1 file(s) formatted, 0 unchanged (1 total)` per call.

- [ ] **Step 3: Review the diff**

```bash
git diff tests/fixtures/
```

Expected: each entry's attribute paragraph is replaced by an indented code block
at 6 columns. Body content and entry headers are unchanged.

- [ ] **Step 4: Run all tests**

```bash
just test
```

Expected: PASS. If snapshot tests (`*.snap`) fail because their stored output
references the old fixtures, refresh them in Step 5.

- [ ] **Step 5: If snapshots failed, refresh them**

```bash
deno test --allow-run --allow-read --allow-write -- --update
```

Review the snapshot diff with `git diff tests/`. Each `.snap` change should
reflect the same paragraph → indented-block transformation.

- [ ] **Step 6: Run all tests again**

```bash
just test
```

Expected: PASS.

- [ ] **Step 7: Commit fixtures + snapshots together**

```bash
git add tests/
git commit -m "test(repo): migrate fixtures and snapshots to indented-code attribute form"
```

---

## Task 10: Migrate project docs and example files

**Files:**

- Modify: `docs/product/stakeholder-requirements.md`,
  `docs/product/software-architecture.md`, `docs/examples/entry-rendering.md`,
  any other `.md` under `docs/` containing legacy `\` trailers.

Note: `docs/examples/` is excluded from `deno fmt` and `dprint`, but
`markspec format` operates on entry-block content independently — it will
rewrite the attribute blocks while leaving the surrounding example prose
untouched.

- [ ] **Step 1: List files containing the legacy shape**

```bash
grep -rln '\\$' docs/product/ docs/examples/ 2>/dev/null
```

- [ ] **Step 2: Run `markspec format` on each file**

For each file listed in Step 1, run:

```bash
deno run --allow-read --allow-write packages/markspec/main.ts format <file>
```

- [ ] **Step 3: Review the diff carefully**

```bash
git diff docs/product/ docs/examples/
```

Look at each entry: the body should be unchanged; only the attribute block
should be reshaped.

- [ ] **Step 4: Run `just build` to confirm doc pipelines still work**

```bash
just build
```

Expected: PASS (build runs lint + test + type-check + compile).

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs(repo): migrate project STK/SAD and example entries to indented-code attribute form"
```

---

## Task 11: Update AGENTS.md examples

**Files:**

- Modify: `AGENTS.md` (V-model section, Rust doc-comment examples)

The AGENTS.md contains hand-written Rust code samples whose embedded MarkSpec
entries still use `\` trailers. These are illustrative — `markspec format` won't
touch `.md` Rust fences — so they must be hand-edited.

- [ ] **Step 1: Find the affected examples**

```bash
grep -n '\\$' AGENTS.md
```

Expected: matches inside the V-model fenced `` ```rust `` blocks (search for
`/// Id:`, `/// Satisfies:`, etc.).

- [ ] **Step 2: Rewrite each example**

For each entry inside a fenced Rust block in AGENTS.md, transform:

```rust
/// [SRS_AEB_0030] Time-to-collision calculation
///
/// The decision module shall compute time-to-collision as
/// the ratio of range to closing velocity for each tracked
/// object.
///
/// Id: 01HGW3C4DEF6ABCDEFGHJKMNPQ \
/// Satisfies: SYS_AEB_0012 \
/// Labels: ASIL-B
```

into:

```rust
/// [SRS_AEB_0030] Time-to-collision calculation
///
/// The decision module shall compute time-to-collision as
/// the ratio of range to closing velocity for each tracked
/// object.
///
///     Id: 01HGW3C4DEF6ABCDEFGHJKMNPQ
///     Satisfies: SYS_AEB_0012
///     Labels: ASIL-B
```

Note: `///` + 4 spaces = 8 columns of doc-comment prefix; this matches the
spec's doc-comment indent rule.

Apply the same transformation to every `///`-style entry in AGENTS.md.
Block-comment (`/** */`) examples follow the same rule: 4-space indent on the
attribute lines, no trailing `\`.

- [ ] **Step 3: Run dprint to confirm formatting still passes**

```bash
dprint check AGENTS.md
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs(repo): update AGENTS.md V-model examples for indented-code attribute form"
```

---

## Task 12: Add deprecation diagnostic for legacy shape (optional)

This task implements the `MSL-DEPRECATED-ATTR-001` warning mentioned in the
spec. It requires AST-level inspection (because the string-based parser can't
tell paragraph-with-`\` from indented-code-block once trimmed). If time-boxed,
this task can be deferred to a follow-up issue — the migration completes
correctly without it.

**Files:**

- Modify: `packages/markspec/core/parser/markdown.ts`
- Modify: `packages/markspec/core/parser/attributes_test.ts` (add diagnostic
  assertion)

- [ ] **Step 1: Locate the entry-extraction point in markdown.ts**

```bash
grep -n "extractEntry\|extractBodyContent\|splitBodyAndAttributes" packages/markspec/core/parser/markdown.ts
```

You'll see `extractEntry` at line 128 and `extractBodyContent` at line 269.

- [ ] **Step 2: Inspect the list-item's children to detect the legacy shape**

Inside `extractEntry`, after the call to `splitBodyAndAttributes` (around line
205), inspect `item.children` (the mdast ListItem children) to see whether the
trailing block of `Key: Value` content came from a `paragraph` node (legacy) or
a `code` node (canonical).

Add helper detection:

```typescript
function detectLegacyAttributeShape(item: ListItem): boolean {
  // Walk the list-item children backwards, skipping trailing whitespace.
  for (let i = item.children.length - 1; i >= 0; i--) {
    const node = item.children[i];
    if (node.type === "paragraph") {
      // Check whether the paragraph's text content matches the legacy
      // "Key: Value" + hard-break pattern. We test whether the FIRST
      // child is a Text whose content starts with `[A-Z][A-Za-z-]*: `.
      const first = node.children[0];
      if (first && first.type === "text") {
        return /^[A-Z][A-Za-z-]*: /.test(first.value);
      }
      return false;
    }
    if (node.type === "code") {
      return false; // canonical shape
    }
  }
  return false;
}
```

If `detectLegacyAttributeShape(item)` returns true AND the parsed attribute list
is non-empty, push a diagnostic:

```typescript
if (attributes.length > 0 && detectLegacyAttributeShape(item)) {
  diagnostics.push({
    code: "MSL-DEPRECATED-ATTR-001",
    severity: "warning",
    message:
      "legacy attribute block (paragraph + trailing `\\`) is deprecated; " +
      "run `markspec format` to convert to indented code block",
    location: { file, line: entryStartLine, column: 1 },
  });
}
```

(Adapt to the parser's existing diagnostic plumbing — look for nearby
`diagnostics.push` calls.)

- [ ] **Step 3: Write a test asserting the warning fires for legacy shape and is
      silent for canonical**

Add to `packages/markspec/core/parser/attributes_test.ts` or a more appropriate
test file (search `grep -l MSL-DEP packages/markspec` first to see if there's a
convention):

```typescript
Deno.test("parseFile: legacy shape emits MSL-DEPRECATED-ATTR-001", async () => {
  const md = [
    "- [SRS_TEST_0001] Legacy entry",
    "",
    "  Body.",
    "",
    "  Id: 01HGW2Q8MNP3RSTVWXYZABCDE\\",
    "  Labels: ASIL-B",
    "",
  ].join("\n");

  const result = await parseFile(md, { file: "test.md" });
  const codes = result.diagnostics.map((d) => d.code);
  assert(codes.includes("MSL-DEPRECATED-ATTR-001"), `got: ${codes.join(",")}`);
});

Deno.test("parseFile: canonical indented-code form emits no deprecation warning", async () => {
  const md = [
    "- [SRS_TEST_0001] Canonical entry",
    "",
    "  Body.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDE",
    "      Labels: ASIL-B",
    "",
  ].join("\n");

  const result = await parseFile(md, { file: "test.md" });
  const codes = result.diagnostics.map((d) => d.code);
  assert(
    !codes.includes("MSL-DEPRECATED-ATTR-001"),
    `unexpected warning: ${codes.join(",")}`,
  );
});
```

- [ ] **Step 4: Run the tests**

```bash
deno test packages/markspec/core/parser/ --allow-read
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/parser/markdown.ts packages/markspec/core/parser/attributes_test.ts
git commit -m "feat(core): warn on legacy attribute block shape via MSL-DEPRECATED-ATTR-001"
```

---

## Task 13: Final verification

- [ ] **Step 1: Run the full build**

```bash
just build
```

Expected: PASS (lint + test + type-check + compile).

- [ ] **Step 2: Spot-check a rendered document**

Pick one project doc that was migrated:

```bash
deno run --allow-read --allow-write --allow-env --allow-ffi packages/markspec/main.ts doc build docs/product/stakeholder-requirements.md -o /tmp/stk-preview.pdf
```

Expected: renders without errors. Open the PDF and confirm entry blocks render
correctly (the change is to authoring syntax; the rendered output should look
identical to before).

- [ ] **Step 3: Compile the project and inspect the validate output**

```bash
deno run --allow-read --allow-env packages/markspec/main.ts validate docs/product/stakeholder-requirements.md
```

Expected: no `MSL-DEPRECATED-ATTR-001` warnings (Task 12 confirms migration is
complete).

- [ ] **Step 4: Push the branch**

```bash
git push -u origin worktree-feat-attribute-block-indented-code
```

(Ask the user before pushing if uncertain.)

---

## Out-of-scope reminders

- Compact one-line attribute form: rejected in spec §4.6; do NOT add.
- Per-attribute formatting heuristics: the formatter has one rule (indented code
  block). No conditional compact/block selection.
- Removing the legacy parser path: that lands in a future major release, not
  this PR.
- Citation header-embedded URI (`- [iso-26262-6](urn:...) Title`): separate
  design.

## Migration guarantees

- **Parser:** accepts both shapes throughout this PR. No source breakage for
  downstream users.
- **Formatter:** emits only the canonical form. `markspec format` rewrites old →
  new losslessly.
- **Validator:** no semantic change. Old shape emits a warning (Task 12); new
  shape is silent.
- **Diff scope:** attribute blocks change form; entry body and headers are
  untouched.

## Risk

The biggest risk is incomplete fixture migration. Strategy: rely on
`git grep '\\$' -- '*.md'` after Tasks 9-10 to confirm no `.md` file still uses
the legacy form. Then Task 13 surfaces any remaining warnings via `validate`.

The Rust doc-comment examples in AGENTS.md are migrated manually in Task 11; the
formatter does not touch `.rs` files (yet). If users have their own `.rs` source
files with embedded entries in the legacy form, they migrate via
`markspec format` on their source files (or hand-edit until the formatter's
source-file path is wired).
