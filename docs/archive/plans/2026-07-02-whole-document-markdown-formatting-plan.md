# Whole-Document Markdown Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `markspec fmt` formats the entire Markdown document (prose, headings,
tables, lists — plus entry bodies) via an embedded dprint-markdown WASM plugin,
not just entry-block mechanics.

**Architecture:** A new optional `formatMarkdownProse` callback on
`FormatOptions` routes (a) prose segments outside entry blocks and (b) each
entry's AST-canonical body through dprint-markdown, each change gated by a new
CommonMark-semantic equivalence comparator (`markdownSemanticallyEquivalent`,
mdast-based — deliberately weaker than ADR-015's byte-verbatim `astEquivalent`,
which stays untouched). The callback is constructed by an async loader
(`loadMarkdownFormatter`) that CLI `fmt`, the `check` MSL-F010 drift gate, and
the LSP `documentFormatting` handler all call; when the callback is absent,
`format()` behaves byte-identically to today.

**Tech Stack:** Deno/TypeScript, `@dprint/formatter@0.5.1` (JS WASM host),
`@dprint/markdown@0.20.0` (plugin.wasm + `getPath()`), unified/remark-parse +
remark-gfm (already dependencies).

**Spec:** `docs/wip/2026-07-02-whole-document-markdown-formatting-design.md`

## Global Constraints

- **Pin EXACT versions** (spec risk 4): `npm:@dprint/formatter@0.5.1`,
  `npm:@dprint/markdown@0.20.0` (its `plugin.wasm` == dprint-plugin-markdown
  0.20.0, same version as this repo's `dprint.json` plugin). No `^`.
- **Fixed style, zero config** (spec): global
  `{ lineWidth: 80, newLineKind:
  "lf" }`; plugin
  `{ textWrap: "always", emphasisKind: "underscores",
  strongKind: "asterisks", unorderedListKind: "dashes" }`.
  Line endings follow the file's detected ending (already handled by
  `format()`'s `detectLineEnding`/`applyLineEnding`; the pass operates on the
  pure-LF buffer).
- **ADR-015's `astEquivalent` must NOT be weakened.** The MSL-F900 guard keeps
  using it. The new comparator is a separate function used only by the dprint
  pass.
- **Backward compatibility:** `format()` WITHOUT `formatMarkdownProse` must
  behave byte-identically to today — every existing formatter test must pass
  unchanged.
- **`core/mod.ts` is the library boundary** — `cli/`, `lsp/` import only from
  the barrel, never internal paths.
- **Node compat in `core/`:** no `Deno.*` APIs in library code;
  `node:fs/promises` and Web APIs are fine. `Deno.*` allowed in tests and CLI
  entry points.
- Work in a **git worktree** (superpowers:using-git-worktrees), run
  `./bootstrap`, verify `ls grammars/*.wasm` lists 9 files (copy from main
  checkout if not).
- Conventional Commits; allowed scopes here: `core`, `cli`, `lsp`, `docs`,
  `repo`, `deps`. Commit per task (PR is squash-merged).
- **No CHANGELOG edits** (batched at release).
- Before PR: `just build` (lint+test+typecheck+compile) AND `deno fmt --check`
  AND `dprint check` (the latter two are separate CI gates).
- Test commands: unit `deno test packages/markspec/`; e2e
  `deno test --allow-run --allow-read --allow-write tests/e2e/`; everything
  `deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi`.

---

### Task 1: Pinned deps + dprint loader (`core/formatter/dprint.ts`) + compiled-binary spike

Resolves spec risk 6 (packaging) FIRST. Route A = load `plugin.wasm` from the
npm package via `getPath()` + `node:fs/promises`. If the compiled-binary smoke
in Step 7 fails (wasm not in the binary's VFS), fall back to Route B: commit the
wasm at `packages/markspec/vendor/dprint/markdown.wasm` (precedent:
`packages/markspec-typst/vendor/cmarker/plugin.wasm` is committed) and load it
via `new URL("../../vendor/dprint/markdown.wasm", import.meta.url)` with a
`.wasm.bin` fallback (see `scripts/compile_binary.ts` header comment for why the
mirror exists).

**Files:**

- Modify: `packages/markspec/deno.json` (imports map)
- Create: `packages/markspec/core/formatter/dprint.ts`
- Create: `packages/markspec/core/formatter/dprint_test.ts`
- Modify: `packages/markspec/core/mod.ts` (barrel export)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `loadMarkdownFormatter(): Promise<ProseFormatter>` and
  `type ProseFormatter = (markdown: string) => string`, exported from
  `core/mod.ts`. All later tasks use exactly these names.

- [ ] **Step 1: Add pinned imports**

In `packages/markspec/deno.json`, add to `"imports"` (keep alphabetical-ish
placement near the top):

```json
"@dprint/formatter": "npm:@dprint/formatter@0.5.1",
"@dprint/markdown": "npm:@dprint/markdown@0.20.0",
```

Run: `deno check packages/markspec/main.ts` — expect: no errors (imports unused
yet).

- [ ] **Step 2: Write the failing test**

Create `packages/markspec/core/formatter/dprint_test.ts`:

```typescript
import { assertEquals, assertStringIncludes } from "@std/assert";
import { loadMarkdownFormatter } from "./dprint.ts";

Deno.test("loadMarkdownFormatter: wraps ragged prose at 80 columns", async () => {
  const fmt = await loadMarkdownFormatter();
  const input =
    "This is a very long line of prose that will certainly exceed the eighty column limit because it just keeps going and going.\n";
  const out = fmt(input);
  for (const line of out.split("\n")) {
    if (line.length > 80) {
      throw new Error(`line exceeds 80 cols: ${line}`);
    }
  }
  assertStringIncludes(out, "This is a very long line");
});

Deno.test("loadMarkdownFormatter: applies the fixed MarkSpec style", async () => {
  const fmt = await loadMarkdownFormatter();
  // emphasis → underscores, strong → asterisks, lists → dashes
  assertEquals(fmt("*em* and __strong__\n"), "_em_ and **strong**\n");
  assertEquals(fmt("* item one\n* item two\n"), "- item one\n- item two\n");
});

Deno.test("loadMarkdownFormatter: aligns tables and lets wide rows exceed 80", async () => {
  const fmt = await loadMarkdownFormatter();
  const out = fmt("| Mode | Longer heading |\n|--|--|\n| Fast | x |\n");
  assertStringIncludes(out, "| Mode | Longer heading |");
  assertStringIncludes(out, "| ---- | -------------- |");
});

Deno.test("loadMarkdownFormatter: caches — second call returns same instance fast", async () => {
  const a = await loadMarkdownFormatter();
  const b = await loadMarkdownFormatter();
  assertEquals(a === b, true);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `deno test packages/markspec/core/formatter/dprint_test.ts` Expected: FAIL
— `Module not found "./dprint.ts"`.

- [ ] **Step 4: Implement the loader**

Create `packages/markspec/core/formatter/dprint.ts`:

```typescript
/**
 * @module formatter/dprint
 *
 * Loader for the embedded dprint-markdown WASM plugin (ADR-029).
 * `markspec fmt` formats whole Markdown documents with one canonical,
 * zero-config style; this module owns that style and the (cached)
 * WASM instantiation. Dynamic imports keep the plugin off every code
 * path except formatting (`fmt`, the `check` MSL-F010 drift gate, LSP
 * documentFormatting).
 *
 * Node-compatible: `node:fs/promises` + WebAssembly only, no `Deno.*`.
 */

/** Formats a Markdown fragment to the canonical MarkSpec style. */
export type ProseFormatter = (markdown: string) => string;

/**
 * The fixed MarkSpec Markdown style (ADR-029). Zero configuration by
 * design — one canonical form across every project. `newLineKind` is
 * "lf" because `format()` operates on a pure-LF buffer and re-applies
 * the file's detected line ending on output.
 */
export const MARKSPEC_MARKDOWN_GLOBAL_CONFIG: {
  lineWidth: number;
  newLineKind: "lf";
} = {
  lineWidth: 80,
  newLineKind: "lf",
};

/** Plugin-level style knobs. See ADR-029 for the rationale per value. */
export const MARKSPEC_MARKDOWN_PLUGIN_CONFIG: Record<string, unknown> = {
  textWrap: "always",
  emphasisKind: "underscores",
  strongKind: "asterisks",
  unorderedListKind: "dashes",
};

let cached: Promise<ProseFormatter> | undefined;

/**
 * Load the dprint-markdown WASM plugin (once — subsequent calls return
 * the cached instance) and return a synchronous prose formatter.
 */
export function loadMarkdownFormatter(): Promise<ProseFormatter> {
  cached ??= instantiate();
  return cached;
}

async function instantiate(): Promise<ProseFormatter> {
  const { createFromBuffer } = await import("@dprint/formatter");
  const { getPath } = await import("@dprint/markdown");
  const { readFile } = await import("node:fs/promises");
  const wasm = await readFile(getPath());
  const formatter = createFromBuffer(wasm);
  formatter.setConfig(
    MARKSPEC_MARKDOWN_GLOBAL_CONFIG,
    MARKSPEC_MARKDOWN_PLUGIN_CONFIG,
  );
  return (markdown: string): string =>
    formatter.formatText({ filePath: "fragment.md", fileText: markdown });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test packages/markspec/core/formatter/dprint_test.ts` Expected: PASS
(4 tests). If the table-separator assertion fails on exact dashes, print the
actual output and adjust the expected string to dprint's real 0.20.0 normal form
— the assertion's point is "separator got normalized", not a specific dash
count.

- [ ] **Step 6: Export from the barrel**

In `packages/markspec/core/mod.ts`, next to the existing
`export ... from "./formatter/mod.ts"` lines, add:

```typescript
export {
  loadMarkdownFormatter,
  MARKSPEC_MARKDOWN_GLOBAL_CONFIG,
  MARKSPEC_MARKDOWN_PLUGIN_CONFIG,
} from "./formatter/dprint.ts";
export type { ProseFormatter } from "./formatter/dprint.ts";
```

Run: `deno check packages/markspec/core/mod.ts` — expect: no errors.

- [ ] **Step 7: Compiled-binary spike (Route A verification)**

Create a scratch file OUTSIDE the repo (e.g. `$SCRATCHPAD/smoke_main.ts` in the
session scratchpad):

```typescript
import { loadMarkdownFormatter } from "<ABSOLUTE-WORKTREE-PATH>/packages/markspec/core/formatter/dprint.ts";
const fmt = await loadMarkdownFormatter();
console.log(fmt("*hello* from a compiled binary\n"));
```

Run:

```bash
deno compile --allow-read -o "$SCRATCHPAD/smoke" "$SCRATCHPAD/smoke_main.ts"
"$SCRATCHPAD/smoke"
```

Expected: prints `_hello_ from a compiled binary`. **If this fails** (wasm
missing from the compiled VFS), switch to Route B (vendored wasm, described in
the task intro), re-run Steps 5 and 7, and record the route taken in the commit
body. Do not proceed to Task 2 until the smoke passes.

- [ ] **Step 8: Commit**

```bash
git add packages/markspec/deno.json deno.lock packages/markspec/core/formatter/dprint.ts packages/markspec/core/formatter/dprint_test.ts packages/markspec/core/mod.ts
git commit -m "feat(core): add embedded dprint-markdown formatter loader (ADR-029)"
```

---

### Task 2: CommonMark-semantic equivalence comparator (`core/formatter/md_equiv.ts`)

Resolves spec risk 1. Verified fact: `InlineContent.text` is **verbatim source
prose including line breaks** (`core/ast/nodes.ts:25-34`), and `astEquivalent`
is strict deep-equality eliding only `range` (`core/ast/equivalence.ts`). So the
strict gate rejects every re-wrapped paragraph — the dprint pass needs an
mdast-level comparator where soft-wrap positions, emphasis delimiter style,
table padding, and list marker style compare equal, but content changes don't.
Hard line breaks are `break` nodes in mdast (never `\n` inside `text` values),
so wrap-collapsing text values cannot erase a hard break.

**Files:**

- Create: `packages/markspec/core/formatter/md_equiv.ts`
- Create: `packages/markspec/core/formatter/md_equiv_test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks (remark is an existing dependency).
- Produces: `markdownSemanticallyEquivalent(a: string, b: string): boolean` —
  used by Tasks 3 and 5. NOT exported from the barrel (formatter-internal).

- [ ] **Step 1: Write the failing test**

Create `packages/markspec/core/formatter/md_equiv_test.ts`:

````typescript
import { assertEquals } from "@std/assert";
import { markdownSemanticallyEquivalent } from "./md_equiv.ts";

Deno.test("md_equiv: re-wrapped prose is equivalent", () => {
  assertEquals(
    markdownSemanticallyEquivalent(
      "aaa bbb ccc\nddd",
      "aaa\nbbb ccc ddd",
    ),
    true,
  );
});

Deno.test("md_equiv: dropped word is NOT equivalent", () => {
  assertEquals(
    markdownSemanticallyEquivalent("aaa bbb ccc", "aaa ccc"),
    false,
  );
});

Deno.test("md_equiv: emphasis delimiter style is equivalent", () => {
  assertEquals(
    markdownSemanticallyEquivalent("*em* __st__", "_em_ **st**"),
    true,
  );
});

Deno.test("md_equiv: hard break vs soft wrap is NOT equivalent", () => {
  // Two trailing spaces = hard break (mdast `break` node); plain
  // newline = soft wrap (text). Must not compare equal.
  assertEquals(
    markdownSemanticallyEquivalent("aaa  \nbbb", "aaa\nbbb"),
    false,
  );
});

Deno.test("md_equiv: table realignment is equivalent", () => {
  assertEquals(
    markdownSemanticallyEquivalent(
      "| a | b |\n|--|--|\n| 1 | 2 |",
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |",
    ),
    true,
  );
});

Deno.test("md_equiv: fenced code content is verbatim — whitespace change NOT equivalent", () => {
  assertEquals(
    markdownSemanticallyEquivalent(
      "```\nfoo  bar\n```",
      "```\nfoo bar\n```",
    ),
    false,
  );
});

Deno.test("md_equiv: list marker style is equivalent", () => {
  assertEquals(
    markdownSemanticallyEquivalent("* one\n* two", "- one\n- two"),
    true,
  );
});
````

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test packages/markspec/core/formatter/md_equiv_test.ts` Expected:
FAIL — `Module not found "./md_equiv.ts"`.

- [ ] **Step 3: Implement the comparator**

Create `packages/markspec/core/formatter/md_equiv.ts`:

```typescript
/**
 * @module formatter/md_equiv
 *
 * CommonMark-semantic Markdown equivalence — the gate for the ADR-029
 * dprint pass. Two fragments are equivalent when they parse to the
 * same mdast structure after eliding source `position`s and collapsing
 * whitespace runs inside `text` node values. Soft-wrap positions,
 * emphasis delimiter style (`*x*` vs `_x_`), table cell padding, and
 * list marker style are presentation, not content — they compare
 * equal. Hard breaks are `break` nodes in mdast, so wrap-collapsing
 * cannot erase or fabricate one. Code (`code`, `inlineCode`), `html`,
 * and definition `url`s stay byte-exact.
 *
 * DELIBERATELY weaker than ADR-015's `astEquivalent` (byte-verbatim on
 * inline markup). Used ONLY to accept/reject dprint output; the
 * ADR-015 relation still guards §5.2 body emission (MSL-F900) and must
 * not be modified.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const parser = unified().use(remarkParse).use(remarkGfm);

/** True when `a` and `b` are the same Markdown, modulo presentation. */
export function markdownSemanticallyEquivalent(
  a: string,
  b: string,
): boolean {
  if (a === b) return true;
  return deepEqual(
    normalize(parser.parse(a)),
    normalize(parser.parse(b)),
  );
}

/**
 * Recursively strip `position` keys and collapse whitespace runs in
 * `text` node values. Returns a plain JSON-ish structure for
 * comparison; never mutates the input tree.
 */
function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (node === null || typeof node !== "object") return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) {
    if (key === "position") continue;
    if (
      key === "value" && src.type === "text" &&
      typeof src.value === "string"
    ) {
      out.value = src.value.replace(/\s+/g, " ");
      continue;
    }
    out[key] = normalize(src[key]);
  }
  return out;
}

/** Structural deep-equality over the normalized trees. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every((k) =>
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      )
    );
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/formatter/md_equiv_test.ts` Expected:
PASS (7 tests). If the hard-break test fails because remark parsed
`"aaa  \nbbb"` without a `break` node, inspect
`console.log(JSON.stringify(parser.parse("aaa  \nbbb")))` and fix the test's
premise — do NOT loosen `normalize` to make it pass.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/formatter/md_equiv.ts packages/markspec/core/formatter/md_equiv_test.ts
git commit -m "feat(core): add CommonMark-semantic markdown equivalence gate (ADR-029)"
```

---

### Task 3: Prose segmentation pass (`core/formatter/prose.ts`)

**Files:**

- Create: `packages/markspec/core/formatter/prose.ts`
- Create: `packages/markspec/core/formatter/prose_test.ts`
- Modify: `packages/markspec/core/formatter/mod.ts:731` (export `findItemEnd`)

**Interfaces:**

- Consumes: `markdownSemanticallyEquivalent` (Task 2), `ProseFormatter` (Task
  1).
- Produces:
  `formatProseSegments(lines: readonly string[], entryExtents: readonly EntryExtent[], proseFormat: ProseFormatter): ProsePassResult`
  with `interface EntryExtent { readonly start: number; readonly end: number }`
  (0-based line indices, `[start, end)`) and
  `interface ProsePassResult { readonly lines: string[]; readonly changed: boolean; readonly fallbackStarts: readonly number[] }`
  (`fallbackStarts` = 0-based first line of each prose segment the gate
  rejected). Used by Task 4.

- [ ] **Step 1: Export `findItemEnd`**

In `packages/markspec/core/formatter/mod.ts`, change the declaration at line
~731 from `function findItemEnd(` to `export function findItemEnd(` and extend
its doc comment's first line with:
`Exported for the ADR-029 prose
pass (entry-extent computation).`

Run: `deno test packages/markspec/core/formatter/` — expect: existing tests
still PASS.

- [ ] **Step 2: Write the failing test**

Create `packages/markspec/core/formatter/prose_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { formatProseSegments } from "./prose.ts";

/** Fake formatter: joins each paragraph onto one line (semantically
 * equivalent — a wrap-only change). */
const unwrap = (md: string): string =>
  md
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n(?!$)/g, " "))
    .join("\n\n") + "\n";

/** Fake destructive formatter: drops the last word of the segment. */
const truncate = (md: string): string =>
  md.trimEnd().split(" ").slice(0, -1).join(" ") + "\n";

const DOC = [
  "# Overview",           // 0
  "",                     // 1
  "Some ragged",          // 2
  "prose here.",          // 3
  "",                     // 4
  "- [STK_0001] Title",   // 5  ← entry extent [5, 10)
  "",                     // 6
  "  Body prose.",        // 7
  "",                     // 8
  "      Id: 01JADYKACKQKGVGHT9K7Y6PBPA", // 9
  "",                     // 10
  "Trailing chapter",     // 11
  "prose.",               // 12
];

Deno.test("prose: formats segments outside entry extents only", () => {
  const res = formatProseSegments(DOC, [{ start: 5, end: 10 }], unwrap);
  assertEquals(res.changed, true);
  const text = res.lines.join("\n");
  // prose got unwrapped
  assertEquals(text.includes("Some ragged prose here."), true);
  assertEquals(text.includes("Trailing chapter prose."), true);
  // entry block untouched, byte for byte
  assertEquals(res.lines[res.lines.indexOf("- [STK_0001] Title") + 2], "  Body prose.");
  assertEquals(text.includes("      Id: 01JADYKACKQKGVGHT9K7Y6PBPA"), true);
});

Deno.test("prose: boundary blank lines around entries are preserved", () => {
  const res = formatProseSegments(DOC, [{ start: 5, end: 10 }], unwrap);
  const idx = res.lines.indexOf("- [STK_0001] Title");
  assertEquals(res.lines[idx - 1], "");
  assertEquals(res.lines[idx + 5], "");
});

Deno.test("prose: gate rejects non-equivalent output, reports fallback", () => {
  const res = formatProseSegments(DOC, [{ start: 5, end: 10 }], truncate);
  assertEquals(res.changed, false);
  assertEquals(res.lines, DOC);
  assertEquals(res.fallbackStarts.length, 2); // both prose segments rejected
});

Deno.test("prose: no entries — whole document is one segment", () => {
  const res = formatProseSegments(
    ["Ragged", "line."],
    [],
    unwrap,
  );
  assertEquals(res.lines, ["Ragged line."]);
  assertEquals(res.changed, true);
});

Deno.test("prose: already-canonical input is a no-op", () => {
  const res = formatProseSegments(
    ["One line.", "", "- [STK_0001] T", "", "      Id: 01JADYKACKQKGVGHT9K7Y6PBPA"],
    [{ start: 2, end: 5 }],
    (md) => md.endsWith("\n") ? md : md + "\n",
  );
  assertEquals(res.changed, false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `deno test packages/markspec/core/formatter/prose_test.ts` Expected: FAIL —
`Module not found "./prose.ts"`.

- [ ] **Step 4: Implement**

Create `packages/markspec/core/formatter/prose.ts`:

```typescript
/**
 * @module formatter/prose
 *
 * ADR-029 whole-document Markdown pass: splits a document's lines into
 * prose / entry-block segments and routes each prose segment through
 * the injected {@linkcode ProseFormatter} (dprint-markdown). Every
 * rewritten segment must pass {@linkcode markdownSemanticallyEquivalent}
 * against its original — a rejected segment is kept byte-identical and
 * reported via `fallbackStarts` so `format()` can emit an advisory
 * diagnostic ("never make a file worse").
 *
 * Entry blocks (title line → item end, trailers included) are never
 * given to dprint here; entry BODIES are polished separately inside
 * `emitBodyViaAst` (core/formatter/mod.ts) where the parser's
 * dedent/re-indent machinery and the body-AST gate already live.
 */

import type { ProseFormatter } from "./dprint.ts";
import { markdownSemanticallyEquivalent } from "./md_equiv.ts";

/** 0-based `[start, end)` line span of one entry block. */
export interface EntryExtent {
  readonly start: number;
  readonly end: number;
}

/** Result of {@linkcode formatProseSegments}. */
export interface ProsePassResult {
  readonly lines: string[];
  readonly changed: boolean;
  /** 0-based first line of each prose segment the gate rejected. */
  readonly fallbackStarts: readonly number[];
}

/**
 * Format every prose gap between entry extents. Boundary blank lines
 * stay outside the formatted chunk so entry-block separation is never
 * disturbed.
 */
export function formatProseSegments(
  lines: readonly string[],
  entryExtents: readonly EntryExtent[],
  proseFormat: ProseFormatter,
): ProsePassResult {
  const extents = [...entryExtents].sort((a, b) => a.start - b.start);
  const out: string[] = [];
  const fallbackStarts: number[] = [];
  let changed = false;
  let cursor = 0;

  const flushProse = (gapStart: number, gapEnd: number): void => {
    const segment = lines.slice(gapStart, gapEnd);
    // Keep boundary blank lines verbatim, format only the core.
    let from = 0;
    while (from < segment.length && segment[from].trim() === "") from++;
    let to = segment.length;
    while (to > from && segment[to - 1].trim() === "") to--;
    if (from >= to) {
      out.push(...segment);
      return;
    }
    const chunk = segment.slice(from, to).join("\n");
    const formatted = proseFormat(chunk).replace(/\n$/, "");
    if (formatted === chunk) {
      out.push(...segment);
      return;
    }
    if (!markdownSemanticallyEquivalent(chunk, formatted)) {
      fallbackStarts.push(gapStart + from);
      out.push(...segment);
      return;
    }
    changed = true;
    out.push(...segment.slice(0, from));
    out.push(...formatted.split("\n"));
    out.push(...segment.slice(to));
  };

  for (const extent of extents) {
    if (extent.start > cursor) flushProse(cursor, extent.start);
    out.push(...lines.slice(extent.start, extent.end));
    cursor = extent.end;
  }
  if (cursor < lines.length) flushProse(cursor, lines.length);

  return { lines: out, changed, fallbackStarts };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test packages/markspec/core/formatter/prose_test.ts` Expected: PASS
(5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/formatter/prose.ts packages/markspec/core/formatter/prose_test.ts packages/markspec/core/formatter/mod.ts
git commit -m "feat(core): add gated prose-segment formatting pass (ADR-029)"
```

---

### Task 4: Wire the prose pass into `format()`

**Files:**

- Modify: `packages/markspec/core/formatter/mod.ts` (three anchors: the
  `FormatOptions` interface ~line 323; the empty-document early return ~line
  408; after the `emitBodyViaAst` call ~line 543-552)
- Test: `packages/markspec/core/formatter/mod_test.ts` (append)

**Interfaces:**

- Consumes: `formatProseSegments`, `EntryExtent` (Task 3), `findItemEnd`
  (exported in Task 3).
- Produces: `FormatOptions.formatMarkdownProse?: (markdown: string) => string` —
  the single public switch every caller (Tasks 6-8) uses. New diagnostic code
  **MSL-F011** (severity `info`) for gate fallbacks.

- [ ] **Step 1: Write the failing tests**

Append to `packages/markspec/core/formatter/mod_test.ts`:

```typescript
Deno.test("format: formatMarkdownProse formats prose around entries", () => {
  const input = `# Title

Ragged
prose.

- [STK_0001] Entry

  Body.

      Id: 01JADYKACKQKGVGHT9K7Y6PBPA
`;
  const unwrap = (md: string): string =>
    md.split(/\n{2,}/).map((p) => p.replace(/\n(?!$)/g, " ")).join("\n\n") +
    "\n";
  const result = format(input, {
    file: "t.md",
    formatMarkdownProse: unwrap,
  });
  assertEquals(result.changed, true);
  assertStringIncludes(result.output, "Ragged prose.");
  assertStringIncludes(result.output, "- [STK_0001] Entry");
  assertStringIncludes(result.output, "      Id: 01JADYKACKQKGVGHT9K7Y6PBPA");
});

Deno.test("format: formatMarkdownProse formats entry-less documents", () => {
  const unwrap = (md: string): string => md.replace(/\n(?!$)/g, " ");
  const result = format("Just\nprose.\n", {
    file: "t.md",
    formatMarkdownProse: unwrap,
  });
  assertEquals(result.changed, true);
  assertEquals(result.output, "Just prose.\n");
});

Deno.test("format: without formatMarkdownProse, entry-less documents are untouched", () => {
  const result = format("Just\nprose.\n", { file: "t.md" });
  assertEquals(result.changed, false);
  assertEquals(result.output, "Just\nprose.\n");
});

Deno.test("format: prose gate fallback emits MSL-F011 info", () => {
  const truncate = (md: string): string =>
    md.trimEnd().split(" ").slice(0, -1).join(" ") + "\n";
  const result = format("some prose words here\n", {
    file: "t.md",
    formatMarkdownProse: truncate,
  });
  assertEquals(result.changed, false);
  assertEquals(
    result.diagnostics.some((d) => d.code === "MSL-F011"),
    true,
  );
});
```

(Match the file's existing import style for `format`, `assertEquals`,
`assertStringIncludes` — they are already imported at the top.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/formatter/mod_test.ts` Expected: the four
new tests FAIL (`formatMarkdownProse` unknown option — TS error). Type errors
count as the red step here.

- [ ] **Step 3: Implement**

In `packages/markspec/core/formatter/mod.ts`:

(a) Add imports near the other formatter-internal imports:

```typescript
import { formatProseSegments } from "./prose.ts";
```

(b) In `FormatOptions` (after the `today` member), add:

```typescript
/**
 * Whole-document Markdown formatter (ADR-029). When supplied, prose
 * segments outside entry blocks and each entry body are routed
 * through it (dprint-markdown), gated by CommonMark-semantic
 * equivalence. When absent, format() is entry-only — the exact
 * pre-ADR-029 behaviour.
 */
readonly formatMarkdownProse?: (markdown: string) => string;
```

(c) Replace the early return (currently
`if (entries.length === 0 && !fm.hadFrontMatter) {`) with:

```typescript
const proseFormat = options?.formatMarkdownProse;
if (entries.length === 0 && !fm.hadFrontMatter && proseFormat === undefined) {
```

(body of the `if` unchanged).

(d) After the `emitBodyViaAst(...)` call block and BEFORE
`const formattedBody = collapsedLines.join("\n");`, insert:

```typescript
// ADR-029 whole-document Markdown pass: prose segments outside entry
// blocks through dprint, gated per segment. Entry bodies were already
// polished inside emitBodyViaAst. Re-parse for fresh extents when any
// earlier pass changed line positions.
let proseLines = collapsedLines;
if (proseFormat !== undefined) {
  const proseEntries = changed
    ? parseMarkdown(collapsedLines.join("\n"), { file }).entries
    : entries;
  const extents = proseEntries.map((e) => {
    const start = e.location.line - 1;
    const entryIndent = (e.location.column - 1) + 2;
    return { start, end: findItemEnd(collapsedLines, start, entryIndent) };
  });
  const prose = formatProseSegments(collapsedLines, extents, proseFormat);
  if (prose.changed) changed = true;
  for (const lineIdx of prose.fallbackStarts) {
    diagnostics.push({
      code: "MSL-F011",
      severity: "info",
      message:
        "Markdown pass produced non-equivalent output for this prose " +
        "segment — kept the original text",
      location: { file, line: lineIdx + 1, column: 1 },
    });
  }
  proseLines = prose.lines;
}
```

and change the following line to use it:

```typescript
const formattedBody = proseLines.join("\n");
```

(e) `changed` accuracy for the front-matter branch is already handled (it
compares `outputLf !== normalisedMarkdown`); no change needed there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/formatter/` Expected: ALL tests pass —
the four new ones AND every pre-existing test (back-compat constraint: no
`formatMarkdownProse` → byte-identical behaviour).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/formatter/mod.ts packages/markspec/core/formatter/mod_test.ts
git commit -m "feat(core): route prose segments through the markdown pass in format() (ADR-029)"
```

---

### Task 5: Polish entry bodies inside `emitBodyViaAst`

The body is already dedented (`entry.body`) and re-indented on splice by
existing machinery; we polish the AST-canonical `emittedBody` with dprint and
gate with the semantic comparator. The ADR-015 strict gate (MSL-F900) runs
first, unchanged.

**Files:**

- Modify: `packages/markspec/core/formatter/mod.ts` (`emitBodyViaAst`, ~lines
  213-321, and its call site ~line 543)
- Test: `packages/markspec/core/formatter/mod_test.ts` (append)

**Interfaces:**

- Consumes: `markdownSemanticallyEquivalent` (Task 2),
  `FormatOptions.formatMarkdownProse` (Task 4).
- Produces: entry bodies in dprint normal form when the callback is present;
  MSL-F011 info diagnostic on body-gate fallback (same code as prose fallback,
  message names the entry).

- [ ] **Step 1: Write the failing tests**

Append to `packages/markspec/core/formatter/mod_test.ts`:

```typescript
Deno.test("format: formatMarkdownProse re-wraps entry bodies (gated)", () => {
  const input = `- [STK_0001] Entry

  Ragged
  body prose.

      Id: 01JADYKACKQKGVGHT9K7Y6PBPA
`;
  const unwrap = (md: string): string =>
    md.split(/\n{2,}/).map((p) => p.replace(/\n(?!$)/g, " ")).join("\n\n") +
    "\n";
  const result = format(input, { file: "t.md", formatMarkdownProse: unwrap });
  assertEquals(result.changed, true);
  assertStringIncludes(result.output, "  Ragged body prose.");
});

Deno.test("format: body gate rejects destructive output with MSL-F011, keeps canonical body", () => {
  const input = `- [STK_0001] Entry

  Body prose here.

      Id: 01JADYKACKQKGVGHT9K7Y6PBPA
`;
  const truncate = (md: string): string =>
    md.trimEnd().split(" ").slice(0, -1).join(" ") + "\n";
  const result = format(input, {
    file: "t.md",
    formatMarkdownProse: truncate,
  });
  assertStringIncludes(result.output, "  Body prose here.");
  assertEquals(
    result.diagnostics.some(
      (d) => d.code === "MSL-F011" && d.message.includes("STK_0001"),
    ),
    true,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/formatter/mod_test.ts` Expected: first
new test FAILS (body stays ragged — prose pass doesn't enter entry extents);
second FAILS (no MSL-F011 naming the entry).

- [ ] **Step 3: Implement**

In `packages/markspec/core/formatter/mod.ts`:

(a) Add the import:

```typescript
import { markdownSemanticallyEquivalent } from "./md_equiv.ts";
```

(b) Extend `emitBodyViaAst`'s signature (and its doc comment) with a final
parameter:

```typescript
function emitBodyViaAst(
  lines: string[],
  file: string,
  diagnostics: Diagnostic[],
  cachedEntries: Entry[] | undefined,
  proseFormat: ((markdown: string) => string) | undefined,
): boolean {
```

(c) Inside the entry loop, immediately AFTER the existing MSL-F900 guard
(`if (!astEquivalent(...)) { ...; continue; }`) and BEFORE the
`const rawSegment = ...` line, insert:

```typescript
// ADR-029: polish the canonical body with the whole-document
// Markdown formatter. Gated by CommonMark-semantic equivalence —
// NOT the strict ADR-015 relation, which is byte-verbatim on
// inline markup and would reject every legitimate re-wrap. On
// rejection keep the AST-canonical body and say so (info).
let finalBody = emittedBody;
if (proseFormat !== undefined) {
  const polished = proseFormat(emittedBody).replace(/\n$/, "");
  if (polished !== emittedBody) {
    if (markdownSemanticallyEquivalent(emittedBody, polished)) {
      finalBody = polished;
    } else {
      diagnostics.push({
        code: "MSL-F011",
        severity: "info",
        message: `${entry.displayId}: Markdown pass produced a ` +
          `non-equivalent body — kept the canonical body`,
        location: entry.location,
      });
    }
  }
}
```

(d) Change the splice to use `finalBody`:

```typescript
const emittedLines = finalBody.split("\n").map((l) =>
  l ? `${indentStr}${l}` : l
);
```

(e) Update the call site in `format()` to pass the callback:

```typescript
if (
  emitBodyViaAst(
    collapsedLines,
    file,
    diagnostics,
    changed ? undefined : entries,
    proseFormat,
  )
) changed = true;
```

(Note: `proseFormat` is already in scope from Task 4 step 3(c) — it is declared
before the early return; if you placed it later, move the declaration above this
call.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/formatter/` Expected: ALL pass, including
every pre-existing test.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/formatter/mod.ts packages/markspec/core/formatter/mod_test.ts
git commit -m "feat(core): polish entry bodies via the markdown pass in emitBodyViaAst (ADR-029)"
```

---

### Task 6: Idempotency corpus test with the real dprint plugin

Spec risk 2: `format(format(x)) === format(x)` is a hard requirement (MSL-F010
depends on it). Run the REAL plugin over every fixture.

**Files:**

- Create: `packages/markspec/core/formatter/prose_idempotence_test.ts`
- Possibly create fixtures: `tests/fixtures/prose_document.md` (only if no
  existing fixture has substantial prose around entries)

**Interfaces:**

- Consumes: `loadMarkdownFormatter` (Task 1), `format` + `formatMarkdownProse`
  (Tasks 4-5).
- Produces: nothing — a regression gate.

- [ ] **Step 1: Add a prose-heavy fixture**

Create `tests/fixtures/prose_document.md`:

```markdown
# System Overview

This introductory chapter describes the context of the system and deliberately
contains a very long ragged line that exceeds the eighty column limit so the
wrap pass has work to do.

| Mode | Longer heading           |
| ---- | ------------------------ |
| Fast | x                        |
| Safe | a much longer cell value |

- [STK_9001] Prose fixture entry

  The system shall demonstrate a body with a table.

  | Key | Value |
  | --- | ----- |
  | a   | 1     |

      Id: 01JADYKACKQKGVGHT9K7Y6PBPB

Closing prose with a long reference
<https://example.com/a/very/long/url/that/exceeds/eighty/columns/deliberately/for/the/soft-limit/contract>.
```

- [ ] **Step 2: Write the idempotency test**

Create `packages/markspec/core/formatter/prose_idempotence_test.ts`:

```typescript
/**
 * ADR-029 idempotency gate: format ∘ format === format over the whole
 * fixture corpus, with the REAL dprint-markdown plugin injected.
 * MSL-F010 (fmt drift in `check`) depends on this property — a
 * non-idempotent file would drift forever.
 */
import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl } from "@std/path";
import { format } from "./mod.ts";
import { loadMarkdownFormatter } from "./dprint.ts";

const FIXTURES = fromFileUrl(
  new URL("../../../../tests/fixtures/", import.meta.url),
);

Deno.test("ADR-029: format is idempotent over the fixture corpus", async () => {
  const proseFormat = await loadMarkdownFormatter();
  let count = 0;
  for await (const f of walk(FIXTURES, { exts: [".md"], includeDirs: false })) {
    const src = await Deno.readTextFile(f.path);
    const once = format(src, { file: f.path, formatMarkdownProse: proseFormat });
    const twice = format(once.output, {
      file: f.path,
      formatMarkdownProse: proseFormat,
    });
    assertEquals(twice.output, once.output, `not idempotent: ${f.path}`);
    assertEquals(twice.changed, false, `changed=true on 2nd run: ${f.path}`);
    count++;
  }
  if (count === 0) throw new Error("no fixtures found — wrong path?");
});
```

- [ ] **Step 3: Run it**

Run:
`deno test --allow-read packages/markspec/core/formatter/prose_idempotence_test.ts`
Expected: PASS. **If any fixture is non-idempotent:** this is a real design
finding, not a test to weaken. Diagnose which pass flips (diff `once.output` vs
`twice.output`), fix the interaction (most likely candidates: blank-line
boundaries in `formatProseSegments`, or render-vs-dprint block layout in the
body path), and only then proceed. If it cannot be fixed locally, STOP and
surface to the user (spec risk 2 stop-condition).

- [ ] **Step 4: Run the full unit suite**

Run: `deno test --allow-read --allow-write --allow-env packages/markspec/`
Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/formatter/prose_idempotence_test.ts tests/fixtures/prose_document.md
git commit -m "test(core): ADR-029 idempotency corpus gate with real dprint plugin"
```

---

### Task 7: CLI wiring (`fmt`, `check`) + E2E tests

**Files:**

- Modify: `packages/markspec/cli/commands/fmt.ts:36-37,79`
- Modify: `packages/markspec/cli/commands/check.ts:116` (and the import block of
  its enclosing fmt-drift gate section)
- Test: `tests/e2e/format_test.ts` (append; use its local `runFormat` helper
  which returns `readFile`)
- Test: `tests/e2e/check_project_test.ts` (append one MSL-F010 prose-drift test;
  this file already holds the MSL-F010 gate tests, a `BASE_FILES` project
  fixture, and a `markspec(args, { files })` helper — see its existing test at
  ~line 116)

**Interfaces:**

- Consumes: `loadMarkdownFormatter` from `../../core/mod.ts` (barrel),
  `formatMarkdownProse` option.
- Produces: user-visible behaviour — `markspec fmt` / `fmt --check` / bare
  `markspec check` now cover whole-document Markdown.

- [ ] **Step 1: Write failing E2E tests**

Append to `tests/e2e/format_test.ts`:

```typescript
Deno.test("fmt: aligns misaligned tables in entry bodies (#649)", async () => {
  const input = `- [STK_0006] Misaligned table

  Intro prose.

  | Mode | Longer heading |
  |--|--|
  | Fast | x |
  | Safe | a much longer cell value |

      Id: 01JADYKACKQKGVGHT9K7Y6PBPA
`;
  const { code, readFile } = await runFormat({ "t.md": input });
  assertEquals(code, 0);
  const out = await readFile("t.md");
  assertStringIncludes(out, "| Safe | a much longer cell value |");
  assertStringIncludes(out, "| Fast | x                        |");
});

Deno.test("fmt: wraps ragged prose chapters at 80 columns", async () => {
  const long =
    "This overview chapter line is deliberately much longer than the eighty column limit so the formatter must wrap it.";
  const input = `# Overview\n\n${long}\n\n- [STK_0007] E\n\n  B.\n\n      Id: 01JADYKACKQKGVGHT9K7Y6PBPC\n`;
  const { code, readFile } = await runFormat({ "t.md": input });
  assertEquals(code, 0);
  const out = await readFile("t.md");
  for (const line of out.split("\n")) {
    if (line.length > 80 && !line.includes("|")) {
      throw new Error(`prose line exceeds 80 cols: ${line}`);
    }
  }
});

Deno.test("fmt: soft-limit contract — wide tables and long URLs stay single-line", async () => {
  const url =
    "<https://example.com/a/very/long/url/that/exceeds/eighty/columns/deliberately/xyz>";
  const input = `Prose with ${url} inside.\n\n| A wide table heading here | another wide heading here | third wide heading |\n|--|--|--|\n| a | b | c |\n`;
  const { code, readFile } = await runFormat({ "t.md": input });
  assertEquals(code, 0);
  const out = await readFile("t.md");
  assertStringIncludes(out, "https://example.com/a/very/long/url");
  assertStringIncludes(
    out,
    "| A wide table heading here | another wide heading here | third wide heading |",
  );
});

Deno.test("fmt: preserves CRLF line endings through the markdown pass", async () => {
  const input = "Ragged\r\nprose line that is short.\r\n";
  const { code, readFile } = await runFormat({ "t.md": input });
  assertEquals(code, 0);
  const out = await readFile("t.md");
  assertStringIncludes(out, "\r\n");
  assertEquals(out.includes("\n") && !out.replace(/\r\n/g, "").includes("\n"), true);
});

Deno.test("fmt --check: exits 1 on markdown-only drift", async () => {
  const { code } = await runFormat(
    { "t.md": "* asterisk bullet\n" },
    ["--check"],
  );
  assertEquals(code, 1);
});
```

(Adjust the exact table-padding expectation strings to dprint 0.20.0's real
output on first run — assert the normalized form, don't guess it.)

Append to `tests/e2e/check_project_test.ts`, next to the existing MSL-F010 tests
(~line 116), using the same `markspec` helper and `BASE_FILES` fixture:

```typescript
Deno.test("check: markdown-only prose drift fails the gate with MSL-F010 (ADR-029)", async () => {
  const { code, stderr } = await markspec(["check"], {
    files: {
      ...BASE_FILES,
      // No entries at all — but the asterisk bullet is not the
      // canonical dash form, so the ADR-029 whole-document pass
      // reports fmt drift.
      "docs/overview.md": "# Overview\n\n* asterisk bullet\n",
    },
  });
  assertStringIncludes(stderr, "MSL-F010");
  assertEquals(code, 1);
});
```

**Watch out:** the existing test
`"check: formatted project does not emit
MSL-F010"` (~line 136) will start
failing if any prose in `BASE_FILES` / `CLEAN_REQ` is not dprint-canonical. If
it does, reformat those fixture strings to the canonical form (run them through
`markspec fmt` mentally or literally) — do NOT weaken the assertion.

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-run --allow-read --allow-write tests/e2e/format_test.ts`
Expected: new tests FAIL (files unchanged / exit 0 where 1 expected).

- [ ] **Step 3: Wire `fmt.ts`**

In `packages/markspec/cli/commands/fmt.ts`, after the
`const { format } = await import("../../core/mod.ts");` line (~37), add:

```typescript
const { loadMarkdownFormatter } = await import("../../core/mod.ts");
const formatMarkdownProse = await loadMarkdownFormatter();
```

and change line ~79 to:

```typescript
const result = format(content, { file: filePath, formatMarkdownProse });
```

- [ ] **Step 4: Wire `check.ts`**

In `packages/markspec/cli/commands/check.ts`, locate the fmt-drift gate (line
~116: `if (format(content, { file: filePath }).changed) {`). In the same block
where `format` is imported, also import and await `loadMarkdownFormatter` ONCE
before the file loop (not per file), then:

```typescript
if (
  format(content, { file: filePath, formatMarkdownProse }).changed
) {
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test --allow-run --allow-read --allow-write tests/e2e/` Expected: ALL
e2e pass (snapshots included — if a help snapshot changed, something is wrong:
this feature adds no flags).

- [ ] **Step 6: Compiled-binary smoke**

```bash
just compile
printf '* bullet\n\nragged\nprose\n' > "$SCRATCHPAD/smoke.md"
./dist/markspec fmt "$SCRATCHPAD/smoke.md" && cat "$SCRATCHPAD/smoke.md"
```

Expected: `- bullet` and `ragged prose` (joined/wrapped) — proves the wasm loads
inside the compiled binary end-to-end. If it fails: Route B (Task 1 intro), then
re-run.

- [ ] **Step 7: Commit**

```bash
git add packages/markspec/cli/commands/fmt.ts packages/markspec/cli/commands/check.ts tests/e2e/format_test.ts tests/e2e/validate_test.ts
git commit -m "feat(cli): whole-document markdown formatting in fmt and check (ADR-029, closes #649)"
```

---

### Task 8: LSP wiring (`documentFormatting`)

**Files:**

- Modify: `packages/markspec/lsp/server.ts:1330` (the
  `connection.onDocumentFormatting` handler) and its core import list

**Interfaces:**

- Consumes: `loadMarkdownFormatter` from `../core/mod.ts` (it self-caches; no
  local memoization needed).
- Produces: editor format-on-save output identical to CLI `fmt` (drift can never
  flap between editor and CLI).

- [ ] **Step 1: Implement**

In `packages/markspec/lsp/server.ts`:

(a) Add `loadMarkdownFormatter` to the existing `from "../core/mod.ts"` import
list.

(b) Make the handler async and inject the callback — the handler currently
reads:

```typescript
connection.onDocumentFormatting((params) => {
  ...
  const result = format(currentText, { file: filePath });
```

change to:

```typescript
connection.onDocumentFormatting(async (params) => {
  ...
  const result = format(currentText, {
    file: filePath,
    formatMarkdownProse: await loadMarkdownFormatter(),
  });
```

(everything else in the handler unchanged; vscode-languageserver handlers accept
promises).

- [ ] **Step 2: Type-check and run LSP tests**

Run:
`deno check packages/markspec/lsp/server.ts && deno test packages/markspec/lsp/`
Expected: clean check; unit tests pass (formatting edit-building is tested via
`buildFormattingEdits`, which is unchanged).

Then run the E2E LSP formatting suite, which drives the REAL server:

Run:
`deno test --allow-run --allow-read --allow-write --allow-env tests/e2e/lsp_formatting_test.ts`
Expected: PASS — but if its fixtures contain non-canonical prose, the server now
formats it and expectations change. Update the expected texts to the new
(correct) whole-document output; do not disable the prose pass to keep old
expectations.

- [ ] **Step 3: Commit**

```bash
git add packages/markspec/lsp/server.ts
git commit -m "feat(lsp): whole-document markdown formatting in documentFormatting (ADR-029)"
```

---

### Task 9: ADR-029, docs, repo excludes, one-time self-reformat

**Files:**

- Create: `docs/architecture/adr-029-whole-document-markdown-formatting.md`
- Modify: `docs/guide/cli.md` (fmt section), `AGENTS.md` (fmt row in the CLI
  table + ADR list), `project.yaml` (excludes),
  `.claude/rules/markspec-core-rules.md` (formatter bullet list)
- Modify: any skill under `skills/` whose text says fmt only stamps
  IDs/indentation (grep `"markspec fmt"` in `skills/`)

**Interfaces:** none — documentation and repo migration.

- [ ] **Step 1: Write ADR-029**

Create `docs/architecture/adr-029-whole-document-markdown-formatting.md` with
this content (adapt formatting to the house ADR template — check ADR-028's
section headings and match them):

```markdown
# ADR-029 — Whole-Document Markdown Formatting

## Status

Accepted (2026-07-02).

## Context

`markspec fmt` formatted only entry-block mechanics; surrounding Markdown passed
through verbatim and tables were silently skipped (#649). Authors expect
`markspec fmt` to be _the_ formatter for MarkSpec documents.

## Decision

`markspec fmt` formats the entire Markdown document by default, Markdown files
only, with a fixed zero-config style, via the embedded dprint-markdown WASM
plugin (`@dprint/formatter` host, exact-pinned `@dprint/markdown@0.20.0`),
lazily loaded on the fmt code path.

Style: lineWidth 80 (soft target — table rows, links/references, and inline code
may exceed it and are never split), textWrap always, emphasis underscores,
strong asterisks, dashes for lists; line endings follow the file's detected
convention. dprint's `<!-- dprint-ignore -->` directives work as a per-block
opt-out, but an ignore-start/end pair MUST NOT span an entry block (segments
format independently).

Entry-block coexistence (approach B): prose segments outside entry blocks and
each entry's AST-canonical body go through dprint; title lines and trailers
never do. Every dprint rewrite is gated by a CommonMark-semantic equivalence
comparator (`markdownSemanticallyEquivalent`, mdast-based: positions elided,
whitespace runs in text values collapsed) — soft-wrap positions and delimiter
styles compare equal, content changes do not. A rejected rewrite is kept as-was
and reported as MSL-F011 (info). ADR-015's byte-verbatim `astEquivalent` is
unchanged and still guards §5.2 body emission (MSL-F900).

Idempotency (`format ∘ format === format`) is a tested hard requirement —
MSL-F010 depends on it.

## Consequences

- One-time reformat churn on existing projects (pre-1.0 no-migration policy);
  `check`'s MSL-F010 now covers prose drift.
- Deliberately-unformatted files use `project.yaml exclude:`.
- A future `@dprint/markdown` bump changes the canonical form — version bumps
  are release-notes-worthy events, pins are exact.
- Semantic line breaks (one sentence per line) do not survive
  `textWrap: always`.

## Alternatives considered

Delegating to an external dprint (violates one-binary expectation);
`remark-stringify` printing (cannot hard-wrap); whole-file dprint with per-file
fallback (fights the entry grammar); prose-only segmentation (leaves bodies
ragged, #649 unfixed).
```

- [ ] **Step 2: Update guide + AGENTS.md + rules + skills**

- `docs/guide/cli.md` fmt section: state whole-document scope, the fixed style
  values, the 80-column soft-limit contract, the `exclude:` escape hatch, and
  the dprint-ignore-must-not-span-an-entry limitation.
- `AGENTS.md`: fmt row in the CLI table → "Stamp ULIDs, fix indentation,
  normalize attributes, and format the whole Markdown document (ADR-029)"; add
  the ADR-029 line to the ADR list.
- `.claude/rules/markspec-core-rules.md`: extend the "the formatter:" bullet
  list with "- formats the surrounding Markdown (wrap at 80, tables, lists —
  ADR-029)".
- `grep -rn "markspec fmt" skills/` — update any skill prose that enumerates
  what fmt does.

- [ ] **Step 3: Repo excludes + self-reformat**

Add to `project.yaml`:

```yaml
exclude:
  - "skills/"
  - "docs/examples/"
  - "CHANGELOG.md"
  - "docs/product/ast-fidelity-matrix.md"
```

(mirrors `dprint.json` excludes — files whose long lines are deliberate).

Then run the one-time reformat and verify convergence with the external dprint
(same engine, same settings — the diff should be near-zero because the repo is
already dprint-formatted):

```bash
deno run --allow-read --allow-write --allow-env packages/markspec/main.ts fmt
git diff --stat
dprint check
deno run --allow-read --allow-write --allow-env packages/markspec/main.ts check
```

Expected: small or empty diff; `dprint check` clean (both formatters agree);
`check` green. If the diff is large, inspect before committing; if
`dprint check` and `markspec fmt` fight (flip-flopping bytes), STOP — that
contradicts the same-engine premise and must be diagnosed.

- [ ] **Step 4: Commit**

```bash
git add -A
git status   # review: only .md reformats + the doc/config files above
git commit -m "docs(repo): ADR-029 whole-document markdown formatting + one-time reformat"
```

---

### Task 10: Finalize — full gates, gardening, PR

- [ ] **Step 1: Full verification**

```bash
just build
deno fmt --check
dprint check
```

Expected: all green (`just build` does NOT run `deno fmt --check` — run it
separately; both are CI gates).

- [ ] **Step 2: Garden working memory**

Run the `sdd-gardening` skill: the spec + this plan move out of `docs/wip/`
(spec content is now durably captured by ADR-029 + guide; originals go to
`docs/archive/`). `docs/wip/` must be empty on the PR branch.

- [ ] **Step 3: Open the PR**

Single PR (squash-merged). Body first line: `Closes #649.` Then summary:
default-on whole-document Markdown formatting (ADR-029), embedded
dprint-markdown 0.20.0 (exact pin), semantic gate + MSL-F011 fallback,
idempotency corpus gate, one-time repo reformat. Release-notes call-outs:
one-time `markspec fmt` needed per project; MSL-F010 now covers prose; semantic
line breaks do not survive; `exclude:` for deliberately-unformatted files.

- [ ] **Step 4: Post-PR review**

Run `/review` on the PR and post findings as a PR comment (repo workflow rule).

---

## Self-review notes (spec → plan coverage)

- Default-on / zero-config / Markdown-only → Tasks 4, 7 (no flags added).
- Embedded WASM + lazy load + packaging spike → Task 1 (Route A/B decision).
- Approach B segmentation → Task 3 (prose), Task 5 (bodies).
- Softbreak/gate spike → resolved during planning (InlineContent.text is
  verbatim ⇒ strict gate rejects re-wraps); comparator = Task 2. ADR-015
  untouched.
- Fallback ladder + MSL-F011 visibility → Tasks 4, 5.
- Idempotency hard requirement → Task 6 (corpus gate, stop-condition).
- Fixed style + soft-limit contract + CRLF preservation → Tasks 1, 7 tests.
- dprint-ignore cross-segment limitation → Task 9 docs.
- MSL-F010 prose drift + one-time reformat + excludes + blame noise → Tasks 7, 9
  (blame-ignore-revs only if the repo diff turns out large — expected near-zero,
  decided in Task 9 Step 3).
- ADR-029 + guide + skills wording + closes #649 → Task 9, PR body Task 10.
