# Formatting Fidelity — SP1 (Characterize the Lossy Surface) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a CI-runnable AST fidelity-matrix harness, a generated+committed
catalogue, a staleness CI gate, and `astEquivalent` unit tests — pure
characterization of the build/render lossy surface with **zero production-code
change**.

**Architecture:** A shared, pure util (`tests/e2e/ast_fidelity.ts`) holds a
data-driven corpus, the provisional `astEquivalent` relation, the per-sample
classifier, and the deterministic catalogue renderer. A standalone generator
script (`scripts/gen_ast_fidelity_matrix.ts`, modelled on
`scripts/gen_theme.ts`) writes `docs/product/ast-fidelity-matrix.md`. A Deno e2e
test (`tests/e2e/ast_fidelity_matrix_test.ts`) regenerates the catalogue
in-memory and asserts byte-equality with the committed file (in-test staleness
guard). A shell gate (`scripts/check_ast_fidelity_matrix.sh`, modelled on
`scripts/check_tokens.sh`) plus a CI job (modelled on the `tokens` job) enforce
staleness in CI. Unit tests pin `astEquivalent`.

**Tech Stack:** Deno / TypeScript, `@std/path`, the existing `core` AST API
(`buildBodyAst`, `render`, `format`, `parseFile`), GitHub Actions, `just`,
`dprint`, `markdownlint-cli2`.

---

## Hard invariants (do not regress — read before any task)

- **No production-code change.** SP1 must not modify anything under
  `packages/markspec/core/{ast,formatter,parser}/` or any other production
  module. Every new file is under `tests/`, `scripts/`, `docs/`, `.github/`, or
  `justfile`. If a task seems to require touching production code, **STOP** and
  surface it — that is a spec fork.
- **Never weaken `tests/e2e/ast_equivalence_test.ts`** or the formatter fallback
  guard in `packages/markspec/core/formatter/mod.ts` (`emitBodyViaAst`: the
  `if (emittedBody !== entry.body) { … continue; }` block). This plan does not
  touch either file.
- **`astEquivalent` is SP1-local and provisional.** It lives in the harness
  util. SP3 (a later sub-project) ratifies/hardens it as the formal §5 contract
  relation. Do not import it into production code; do not present it as
  normative.
- **Measurement only.** The harness must **not** assert
  `LOSS`/`NORMALIZE`/`UNREPRESENTABLE` counts are zero. The only SP1 CI gates
  are: (a) catalogue staleness, (b) `astEquivalent` + harness unit tests.

## Design decisions locked in (no guessing during execution)

1. **Import boundary exception (sanctioned).** `core/mod.ts` exports `render`,
   `format`, `parseFile`, and the `BodyBlock` type, but **not** `buildBodyAst`.
   The harness util imports `buildBodyAst` from the internal path
   `../../packages/markspec/core/ast/build.ts`. This is an intentional,
   design-mandated exception to the `core/mod.ts`-boundary convention
   (AGENTS.md), with established precedent: `tests/e2e/ast_equivalence_test.ts`
   already imports `render` from the internal `core/ast/render.ts` path. Both a
   code comment in the util and the PR body must state this rationale so
   reviewers do not flag it.
2. **`astEquivalent` definition (provisional).** Structural deep-equality of
   `BodyBlock[]` after recursively deleting every object key named `range` (the
   only `SourceRange`-typed field name across the taxonomy — see
   `core/ast/nodes.ts`; markers, list items, and every node use `range`). All
   other fields (`kind`, `text`, `canonical`, `raw`, `lang`, `alt`, `path`,
   `tex`, `ordered`, `spread`, `admonition`, `keyword`, `position`, marker
   arrays in order, etc.) are compared exactly. Rationale: in the
   build→render→build harness pipeline there is **no formatter pass**, so
   permitted §5.2 case normalizations (e.g. `ModalMarker.raw` `SHALL`→`shall`)
   never occur between `ast0` and `ast1`; a strict relation is the safe choice
   for a provisional lower-bound measurement (over-counting `LOSS` is safer than
   under-counting — §4.7). This exactly satisfies all four §4.6 unit cases.
3. **Catalogue is dprint-excluded.** `docs/product/` is **not** in dprint's
   exclude list, and dprint reformats Markdown tables, which would fight the
   generator and the staleness gate. Mirror the established repo convention for
   generated/special Markdown (`docs/examples/` is dprint-excluded for the same
   reason): add `docs/product/ast-fidelity-matrix.md` to `dprint.json`
   `excludes`. The generated file must still be **markdownlint-clean**
   (markdownlint-cli2 runs in the CI `lint` job over all `.md`): single leading
   `#` H1, ATX headings, no trailing punctuation in headings, fenced blocks
   tagged `` ```text ``, GFM table (markdownlint `line-length.tables: false` so
   wide cells are fine). The volatile `delta` cell is wrapped in an inline-code
   span and pipe/backtick-escaped so `no-bare-urls` / `no-inline-html` /
   table-cell parsing never trip on corpus content.
4. **Approach-C str-fmt cross-check (signal-only).** Operationalized as: wrap
   the sample body in a minimal entry document with a **fixed** ULID
   `01ARZ3NDEKTSV4RRFFQ69G5FAV` (same constant
   `tests/e2e/ast_equivalence_test.ts` uses, for determinism), run `format()`,
   `parseFile()` the output, take the resulting `entry.body` (the formatter's
   canonical body for the sample), and record whether it equals
   `render(buildBodyAst(sample))`. Recorded for signal only; never used to
   classify (§4.3 step 5).
5. **One branch, one squashed Conventional Commit, one PR** (AGENTS.md "one
   commit per PR"; working conventions "one PR per slice"). Tasks may commit
   locally for checkpointing; Task 9 squashes to a single commit before the PR.
6. **Determinism.** Corpus is a fixed-order `readonly` array. `buildBodyAst`,
   `render`, `format`, `parseFile` are deterministic per spec §5.3. No
   timestamps, no run metadata in the catalogue. Diff-noise mitigated by stable
   corpus ordering + a stable `delta` encoding.

---

## File structure

| File                                    | Responsibility                                                                                                  | Action             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------ |
| `tests/e2e/ast_fidelity.ts`             | Pure util: `CORPUS`, `astEquivalent`, `classifySample`, `runMatrix`, `renderCatalogue`. No `Deno.*`.            | Create             |
| `tests/e2e/ast_fidelity_test.ts`        | Unit tests: `astEquivalent` (§4.6) + classifier + renderer determinism.                                         | Create             |
| `tests/e2e/ast_fidelity_matrix_test.ts` | e2e harness: regenerate in-memory, assert == committed catalogue, print headline. No loss/normalize assertions. | Create             |
| `scripts/gen_ast_fidelity_matrix.ts`    | Standalone generator (writes the catalogue). Mirrors `scripts/gen_theme.ts`.                                    | Create             |
| `scripts/check_ast_fidelity_matrix.sh`  | Staleness gate. Mirrors `scripts/check_tokens.sh`.                                                              | Create             |
| `docs/product/ast-fidelity-matrix.md`   | Generated + committed catalogue.                                                                                | Create (generated) |
| `dprint.json`                           | Add catalogue to `excludes`.                                                                                    | Modify             |
| `justfile`                              | Add `ast-fidelity-matrix` task (mirrors `tokens`).                                                              | Modify             |
| `.github/workflows/ci.yaml`             | Add `ast-fidelity-matrix` job (mirrors `tokens`).                                                               | Modify             |

---

## Task 0: Branch / isolated workspace + green baseline

**Files:** none (workspace setup).

- [ ] **Step 1: Create the isolated branch**

Per AGENTS.md (always work in a worktree) and the working conventions. From the
repo root on a clean `main`:

```bash
git checkout -b epic-formatting-fidelity-sp1
```

(If the execution skill provisions a git worktree instead, the branch name is
the same: `epic-formatting-fidelity-sp1`.)

- [ ] **Step 2: Confirm a green baseline**

Run: `just check` Expected: lint, test, and type-check all pass (exit 0). If
`just check` is not green on a clean `main`, **STOP** — that is a pre-existing
failure, not SP1's.

---

## Task 1: Util skeleton + the data-driven corpus

**Files:**

- Create: `tests/e2e/ast_fidelity.ts`

- [ ] **Step 1: Create the util with types, the corpus, and stub exports**

Create `tests/e2e/ast_fidelity.ts` with exactly this content:

````typescript
/**
 * @module tests/e2e/ast_fidelity
 *
 * SP1 — Formatting Fidelity characterization util (pure; no `Deno.*`).
 *
 * Owns: the data-driven corpus, the PROVISIONAL `astEquivalent` relation,
 * the per-sample classifier, and the deterministic catalogue renderer.
 *
 * `astEquivalent` is SP1-local and provisional. SP3 ratifies/hardens it as
 * the formal spec §5 contract relation. Do NOT import it into production
 * code.
 *
 * Import-boundary note: `core/mod.ts` is the library boundary, but it does
 * not export `buildBodyAst`. This characterization harness imports it from
 * the internal `core/ast/build.ts` path — an intentional, design-mandated
 * exception (SP1 design §4.3 names `buildBodyAst` explicitly), with
 * precedent: `tests/e2e/ast_equivalence_test.ts` already imports `render`
 * from the internal `core/ast/render.ts` path.
 */

import {
  type BodyBlock,
  format,
  parseFile,
  render,
} from "../../packages/markspec/core/mod.ts";
import { buildBodyAst } from "../../packages/markspec/core/ast/build.ts";

/** A single corpus sample. `markdown` is the bare entry-body text. */
export interface CorpusSample {
  readonly name: string;
  readonly markdown: string;
}

/** Fidelity class for a sample (SP1 design §4.3). */
export type FidelityClass =
  | "OK"
  | "NORMALIZE"
  | "LOSS"
  | "UNOWNED"
  | "UNREPRESENTABLE";

/** One classified matrix row. */
export interface MatrixRow {
  readonly name: string;
  readonly cls: FidelityClass;
  /** `render(buildBodyAst(s)) === s`. */
  readonly rEqualsS: boolean;
  /** `render(buildBodyAst(r)) === r`. */
  readonly idempotent: boolean;
  /** Approach-C signal: `render(ast0)` equals formatter's canonical body. */
  readonly strFmtAgrees: boolean;
  /** Stable, single-line encoding of the input→render delta. */
  readonly delta: string;
}

/** The full matrix: ordered rows + per-class counts + headline number. */
export interface Matrix {
  readonly rows: readonly MatrixRow[];
  readonly counts: Readonly<Record<FidelityClass, number>>;
  /** Headline surface = LOSS + UNREPRESENTABLE. */
  readonly surface: number;
}

/**
 * The corpus — every body construct the MarkSpec spec permits
 * (docs/specs/markspec-core-data-model.md §2.4–2.6) plus §2.4.1 excluded
 * constructs and edge cases. Data-driven and extendable: SP2/SP3 append
 * cases as they surface. Order is FIXED (catalogue determinism).
 */
export const CORPUS: readonly CorpusSample[] = [
  // ── §2.4 blocks ──────────────────────────────────────────────────────
  { name: "paragraph-plain", markdown: "The sensor driver shall debounce raw inputs." },
  { name: "paragraph-multiline", markdown: "The sensor driver shall debounce raw inputs\nbefore processing." },
  { name: "list-unordered-tight", markdown: "- check plausibility\n- validate range" },
  { name: "list-ordered-tight", markdown: "1. first step\n2. second step" },
  { name: "list-unordered-loose", markdown: "- a\n\n- b\n\n- c" },
  { name: "list-nested", markdown: "- outer one\n  - inner a\n  - inner b\n- outer two" },
  { name: "table-simple", markdown: "| A | B |\n|---|---|\n| 1 | 2 |" },
  { name: "table-padded", markdown: "| Name    | Value |\n|---------|-------|\n| foo     | 42    |" },
  { name: "table-sep-wider", markdown: "| Col A         | Col B |\n| ------------- | ----- |\n| x             | y     |" },
  { name: "figure-image", markdown: "![system diagram](docs/arch.svg)" },
  { name: "code-tagged", markdown: "```rust\nfn main() {}\n```" },
  { name: "code-untagged", markdown: "```\nverbatim content here\n```" },
  { name: "feature-gherkin", markdown: "```gherkin\nFeature: braking\n  Scenario: emergency stop\n    Given speed exceeds 30 km/h\n```" },
  { name: "math-block", markdown: "$$\nE = mc^2\n$$" },
  { name: "definition-list-single", markdown: "ASIL\n: Automotive Safety Integrity Level" },
  { name: "definition-list-multi", markdown: "Term A\n: definition A\n\nTerm B\n: definition B" },
  { name: "note-NOTE", markdown: "> [!NOTE]\n> This is an informational note." },
  { name: "note-TIP", markdown: "> [!TIP]\n> Consider using the default configuration." },
  { name: "note-IMPORTANT", markdown: "> [!IMPORTANT]\n> This setting affects safety behaviour." },
  { name: "note-WARNING", markdown: "> [!WARNING]\n> Failure to debounce may lead to spurious activation." },
  { name: "note-CAUTION", markdown: "> [!CAUTION]\n> Modifying this value requires re-validation." },
  { name: "note-multiline", markdown: "> [!WARNING]\n> line one\n> line two" },
  { name: "note-interior-blank", markdown: "> [!NOTE]\n> a\n>\n> c" },
  { name: "blockquote-plain", markdown: "> An external citation excerpt." },
  { name: "blockquote-multiline", markdown: "> line one\n> line two" },
  { name: "blockquote-interior-blank", markdown: "> a\n>\n> b" },
  { name: "caption-figure", markdown: "Figure: System context diagram" },
  { name: "caption-table", markdown: "Table: Sensor plausibility bounds" },
  // ── §2.5 inline ──────────────────────────────────────────────────────
  { name: "inline-emphasis", markdown: "The driver _shall_ debounce inputs." },
  { name: "inline-strong", markdown: "The driver **must** debounce inputs." },
  { name: "inline-combined", markdown: "The driver **_must always_** debounce." },
  { name: "inline-code", markdown: "Call `debounce(input)` before processing." },
  { name: "inline-link", markdown: "See [the spec](docs/specs/x.md) for detail." },
  { name: "inline-refstyle-link", markdown: "See [the spec][s] for detail.\n\n[s]: docs/specs/x.md" },
  { name: "inline-autolink", markdown: "Reference: <https://example.com/spec>." },
  { name: "inline-hardbreak-spaces", markdown: "line one  \nline two" },
  { name: "inline-hardbreak-backslash", markdown: "line one\\\nline two" },
  { name: "inline-entity-pascal", markdown: "The $BrakeController shall arm the actuator." },
  { name: "inline-entity-camel", markdown: "The $brakePedal signal shall be sampled." },
  { name: "inline-entity-screaming", markdown: "The $ASIL_LEVEL constant gates the path." },
  { name: "inline-modal-rfc2119", markdown: "The system shall validate and must reject invalid values." },
  { name: "inline-modal-ears", markdown: "When speed exceeds the limit the system shall warn." },
  // ── §2.4.1 excluded constructs (expect UNOWNED / diagnostic; never destroyed) ──
  { name: "excluded-heading", markdown: "# Not allowed in a body" },
  { name: "excluded-thematic-break", markdown: "before\n\n---\n\nafter" },
  { name: "excluded-task-list", markdown: "- [ ] todo item\n- [x] done item" },
  { name: "excluded-raw-html", markdown: "<div>raw block html</div>" },
  // ── Edge cases ───────────────────────────────────────────────────────
  { name: "edge-blank-line-runs", markdown: "para one\n\n\n\npara two" },
  { name: "edge-crlf", markdown: "line one\r\nline two" },
  { name: "edge-tabs", markdown: "col1\tcol2 with a tab" },
  { name: "edge-leading-trailing-ws", markdown: "   leading and trailing spaces   " },
  { name: "edge-mixed-blocks", markdown: "Intro prose.\n\n- a\n- b\n\n```rust\nfn x() {}\n```\n\n> [!NOTE]\n> done." },
  { name: "edge-paragraph-then-table", markdown: "See the table below.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nEnd of table." },
] as const;

// Stub exports — implemented in later tasks.

/** PROVISIONAL structural equivalence ignoring `SourceRange` (Task 2). */
export function astEquivalent(
  _a: readonly BodyBlock[],
  _b: readonly BodyBlock[],
): boolean {
  throw new Error("not implemented");
}

/** Classify one sample (Task 3). */
export async function classifySample(
  _sample: CorpusSample,
): Promise<MatrixRow> {
  throw new Error("not implemented");
}

/** Run the full matrix over `CORPUS` (Task 3). */
export async function runMatrix(): Promise<Matrix> {
  throw new Error("not implemented");
}

/** Render the deterministic catalogue Markdown (Task 4). */
export function renderCatalogue(_matrix: Matrix): string {
  throw new Error("not implemented");
}

// Re-export the core primitives the harness/generator compose, so callers
// import them from one place.
export { buildBodyAst, format, parseFile, render };
export type { BodyBlock };
````

- [ ] **Step 2: Type-check the new file**

Run: `deno check tests/e2e/ast_fidelity.ts` Expected: PASS (no type errors). The
stub bodies type-check; unused-param names are prefixed `_` so `deno lint` is
also clean.

- [ ] **Step 3: Lint + format the new file**

Run: `deno fmt tests/e2e/ast_fidelity.ts && deno lint tests/e2e/ast_fidelity.ts`
Expected: formatted in place; lint reports 0 problems.

- [ ] **Step 4: Commit (local checkpoint)**

```bash
git add tests/e2e/ast_fidelity.ts
git commit -m "wip(test): SP1 fidelity util skeleton + corpus"
```

---

## Task 2: `astEquivalent` (TDD)

**Files:**

- Modify: `tests/e2e/ast_fidelity.ts`
- Test: `tests/e2e/ast_fidelity_test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/e2e/ast_fidelity_test.ts` with exactly this content:

```typescript
/**
 * @module tests/e2e/ast_fidelity_test
 *
 * Unit tests for the SP1 characterization util. The provisional
 * `astEquivalent` relation is load-bearing for every classification
 * (SP1 design §4.6), so it is pinned directly here.
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  astEquivalent,
  type BodyBlock,
  buildBodyAst,
} from "./ast_fidelity.ts";

/** Build the AST for a bare body string (helper). */
function ast(body: string): BodyBlock[] {
  return buildBodyAst(body);
}

Deno.test("astEquivalent: identical structure, different SourceRange → equivalent", () => {
  // Same prose at two different body offsets: the leading blank-line run
  // shifts every node's `range` but not its structure/content.
  const a = ast("The system shall validate inputs.");
  const b = ast("\n\nThe system shall validate inputs.");
  assert(astEquivalent(a, b));
});

Deno.test("astEquivalent: dropped emphasis (structural difference) → not equivalent", () => {
  // SP1 FINDING: `buildBodyAst` erases inline emphasis/strong markup, so
  // `_shall_` and `shall` parse to identical ASTs (see the characterization
  // test below). We therefore hand-construct the two ASTs — exactly as the
  // `Unknown` cases below do — to pin astEquivalent's discriminating power:
  // an AST that still carries the emphasis vs one where it was dropped must
  // NOT be equivalent. This is the §4.6 "dropped emphasis → not equivalent"
  // property of the relation itself, independent of builder fidelity.
  const withEmphasis: BodyBlock[] = [{
    kind: "paragraph",
    content: { text: "The driver _shall_ debounce inputs.", markers: [] },
    range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
  }];
  const dropped: BodyBlock[] = [{
    kind: "paragraph",
    content: { text: "The driver shall debounce inputs.", markers: [] },
    range: { start: { line: 9, column: 9 }, end: { line: 9, column: 9 } },
  }];
  assertFalse(astEquivalent(withEmphasis, dropped));
});

Deno.test("characterization: buildBodyAst erases inline emphasis (SP1 LOSS finding)", () => {
  // FINDING (SP1): the builder drops Markdown emphasis/strong markup —
  // `_shall_` and `shall` produce structurally identical ASTs (modulo
  // SourceRange). Because this loss is stable across build→render→build
  // (it happens IN buildBodyAst, not in the round-trip), the provisional
  // Approach-A classifier records emphasis samples as NORMALIZE, not LOSS;
  // the design (§4.7) already frames the headline surface as a lower bound.
  // SP2 (faithful builder) must flip this — this test pins the current
  // behaviour so SP2's fix visibly breaks it (a deliberate tripwire).
  const emphasised = ast("The driver _shall_ debounce inputs.");
  const plain = ast("The driver shall debounce inputs.");
  assert(astEquivalent(emphasised, plain));
});

Deno.test("astEquivalent: fused hard line break → not equivalent", () => {
  const a = ast("line one  \nline two");
  const b = ast("line one line two");
  assertFalse(astEquivalent(a, b));
});

Deno.test("astEquivalent: reordered children → not equivalent", () => {
  const a = ast("- alpha\n- beta");
  const b = ast("- beta\n- alpha");
  assertFalse(astEquivalent(a, b));
});

Deno.test("astEquivalent: same-order children → equivalent", () => {
  const a = ast("- alpha\n- beta");
  const b = ast("- alpha\n- beta");
  assert(astEquivalent(a, b));
});

Deno.test("astEquivalent: Unknown(raw=x) vs Unknown(raw=y) → not equivalent", () => {
  const a: BodyBlock[] = [{
    kind: "unknown",
    raw: "x",
    range: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
  }];
  const b: BodyBlock[] = [{
    kind: "unknown",
    raw: "y",
    range: { start: { line: 9, column: 9 }, end: { line: 9, column: 9 } },
  }];
  assertFalse(astEquivalent(a, b));
});

Deno.test("astEquivalent: Unknown same raw, different range → equivalent", () => {
  const a: BodyBlock[] = [{
    kind: "unknown",
    raw: "x",
    range: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
  }];
  const b: BodyBlock[] = [{
    kind: "unknown",
    raw: "x",
    range: { start: { line: 9, column: 9 }, end: { line: 9, column: 9 } },
  }];
  assert(astEquivalent(a, b));
});

Deno.test("astEquivalent: different block count → not equivalent", () => {
  const a = ast("para one\n\npara two");
  const b = ast("para one");
  assertEquals(a.length, 2);
  assertFalse(astEquivalent(a, b));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/ast_fidelity_test.ts`
Expected: FAIL — every test errors with `not implemented` (the Task 1 stub).

- [ ] **Step 3: Implement `astEquivalent`**

In `tests/e2e/ast_fidelity.ts`, replace the `astEquivalent` stub with:

```typescript
/**
 * PROVISIONAL structural equivalence of two `BodyBlock[]` (SP1 design
 * §4.3/§4.6). Recursively deletes every `range` key (the only
 * `SourceRange`-typed field name in the §2.4–2.6 taxonomy — see
 * `core/ast/nodes.ts`) then compares the remaining structure for deep
 * equality. Every other field (kind, text, canonical, raw, lang, alt,
 * path, tex, ordered, spread, admonition, keyword, position, marker
 * arrays in order, …) is compared exactly. Array order is significant.
 *
 * SP3 ratifies/hardens this as the formal §5 contract relation. Until
 * then it is deliberately strict: in the build→render→build harness
 * pipeline there is no formatter pass, so permitted §5.2 case
 * normalizations never occur between ast0 and ast1, and over-counting
 * LOSS is the safe direction for a lower-bound measurement.
 */
export function astEquivalent(
  a: readonly BodyBlock[],
  b: readonly BodyBlock[],
): boolean {
  return deepEqualIgnoringRanges(a, b);
}

/** Deep structural equality with every `range` key elided at any depth. */
function deepEqualIgnoringRanges(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualIgnoringRanges(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).filter((k) => k !== "range").sort();
    const bk = Object.keys(bo).filter((k) => k !== "range").sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) {
      if (ak[i] !== bk[i]) return false;
    }
    for (const k of ak) {
      if (!deepEqualIgnoringRanges(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/ast_fidelity_test.ts`
Expected: PASS — all 9 tests green (8 `astEquivalent` cases incl. the
hand-constructed dropped-emphasis case, + 1 `characterization` test pinning the
builder's emphasis-erasure SP1 finding).

- [ ] **Step 5: Lint + format**

Run:
`deno fmt tests/e2e/ && deno lint tests/e2e/ast_fidelity.ts tests/e2e/ast_fidelity_test.ts`
Expected: formatted; 0 lint problems.

- [ ] **Step 6: Commit (local checkpoint)**

```bash
git add tests/e2e/ast_fidelity.ts tests/e2e/ast_fidelity_test.ts
git commit -m "wip(test): SP1 provisional astEquivalent + unit tests"
```

---

## Task 3: Classifier — `classifySample` + `runMatrix` (TDD)

**Files:**

- Modify: `tests/e2e/ast_fidelity.ts`
- Test: `tests/e2e/ast_fidelity_test.ts`

- [ ] **Step 1: Write failing classifier tests**

Append to `tests/e2e/ast_fidelity_test.ts`:

```typescript
import {
  classifySample,
  CORPUS,
  type FidelityClass,
  runMatrix,
} from "./ast_fidelity.ts";

Deno.test("classifySample: plain prose round-trips → OK", async () => {
  const row = await classifySample({
    name: "t-plain",
    markdown: "The system shall validate inputs.",
  });
  assertEquals(row.cls, "OK");
  assert(row.rEqualsS);
  assert(row.idempotent);
  assertEquals(row.delta, "—");
});

Deno.test("classifySample: excluded heading is not destroyed (UNOWNED or LOSS, never silent drop)", async () => {
  const row = await classifySample({
    name: "t-heading",
    markdown: "# heading in body",
  });
  // Whatever the class, the construct must be characterized, not lost
  // silently: an excluded construct is either preserved verbatim as an
  // Unknown node (UNOWNED) or it changes shape (LOSS/NORMALIZE). It must
  // never classify OK by vanishing.
  const allowed: FidelityClass[] = [
    "UNOWNED",
    "LOSS",
    "NORMALIZE",
    "UNREPRESENTABLE",
  ];
  assert(allowed.includes(row.cls), `unexpected class ${row.cls}`);
});

Deno.test("runMatrix: covers the whole corpus, deterministic order, counts sum", async () => {
  const m1 = await runMatrix();
  const m2 = await runMatrix();
  assertEquals(m1.rows.length, CORPUS.length);
  // Deterministic: identical rows + order across runs.
  assertEquals(
    m1.rows.map((r) => `${r.name}:${r.cls}:${r.delta}`),
    m2.rows.map((r) => `${r.name}:${r.cls}:${r.delta}`),
  );
  // Row order mirrors corpus order exactly.
  assertEquals(
    m1.rows.map((r) => r.name),
    CORPUS.map((c) => c.name),
  );
  const total = m1.counts.OK + m1.counts.NORMALIZE + m1.counts.LOSS +
    m1.counts.UNOWNED + m1.counts.UNREPRESENTABLE;
  assertEquals(total, CORPUS.length);
  assertEquals(m1.surface, m1.counts.LOSS + m1.counts.UNREPRESENTABLE);
});
```

- [ ] **Step 2: Run to verify failure**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/ast_fidelity_test.ts`
Expected: FAIL — new tests error with `not implemented`; the Task 2 tests still
pass.

- [ ] **Step 3: Implement the classifier**

In `tests/e2e/ast_fidelity.ts`, replace the `classifySample` and `runMatrix`
stubs with:

```typescript
/** Fixed ULID for deterministic wrapping (matches ast_equivalence_test.ts). */
const FIXED_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

/** True when every block is an `unknown` node carrying verbatim `raw`. */
function allUnknownVerbatim(blocks: readonly BodyBlock[]): boolean {
  return blocks.length > 0 &&
    blocks.every((b) => b.kind === "unknown" && typeof b.raw === "string");
}

/** Stable, single-line, human-readable input→render delta. */
function encodeDelta(s: string, r: string): string {
  if (r === s) return "—";
  // JSON-escape (handles \n, \r, \t, quotes deterministically), keep it on
  // one line. Truncate very long values stably so the catalogue diff stays
  // small while remaining a faithful signal.
  const cap = (x: string) => {
    const j = JSON.stringify(x);
    return j.length > 160 ? `${j.slice(0, 157)}...` : j;
  };
  return `${cap(s)} → ${cap(r)}`;
}

/**
 * Approach-C signal (§4.3 step 5; not the classifier): does
 * `render(buildBodyAst(s))` equal the formatter's canonical body for `s`?
 * Wrap `s` in a minimal entry with a fixed ULID, `format()`, re-parse, and
 * compare to the resulting `entry.body`.
 */
async function strFmtAgrees(sample: string, renderedAst0: string): Promise<boolean> {
  const indented = sample.split("\n").join("\n  ");
  const doc = `- [TST_FM_0001] Fidelity probe\n\n  ${indented}\n\n      Id: ${FIXED_ULID}\n`;
  const formatted = format(doc, { file: "fidelity.md" }).output;
  const parsed = await parseFile(formatted, { file: "fidelity.md" });
  if (parsed.entries.length === 0) return false;
  return parsed.entries[0].body === renderedAst0;
}

export async function classifySample(
  sample: CorpusSample,
): Promise<MatrixRow> {
  const s = sample.markdown;
  const ast0 = buildBodyAst(s);
  const r = render(ast0);
  const ast1 = buildBodyAst(r);

  const rEqualsS = r === s;
  const idempotent = render(ast1) === r;
  const equivalent = astEquivalent(ast0, ast1);

  let cls: FidelityClass;
  if (rEqualsS) {
    cls = "OK";
  } else if (allUnknownVerbatim(ast0)) {
    // Spec §5.4: a construct the model does not own, kept verbatim as
    // Unknown(raw). Acceptable.
    cls = "UNOWNED";
  } else if (equivalent) {
    // §5.2: representation differs, meaning preserved → SP3 territory.
    cls = "NORMALIZE";
  } else if (ast0.some((b) => b.kind === "unknown")) {
    // Spec-permitted prose partially collapsed into an Unknown/raw
    // fallback — residual SP3 must close or spec-record.
    cls = "UNREPRESENTABLE";
  } else {
    // §5.1: the AST itself changed/lost information → SP2 territory.
    cls = "LOSS";
  }

  return {
    name: sample.name,
    cls,
    rEqualsS,
    idempotent,
    strFmtAgrees: await strFmtAgrees(s, r),
    delta: encodeDelta(s, r),
  };
}

export async function runMatrix(): Promise<Matrix> {
  const rows: MatrixRow[] = [];
  for (const sample of CORPUS) {
    rows.push(await classifySample(sample));
  }
  const counts: Record<FidelityClass, number> = {
    OK: 0,
    NORMALIZE: 0,
    LOSS: 0,
    UNOWNED: 0,
    UNREPRESENTABLE: 0,
  };
  for (const row of rows) counts[row.cls]++;
  return {
    rows,
    counts,
    surface: counts.LOSS + counts.UNREPRESENTABLE,
  };
}
```

- [ ] **Step 4: Run to verify the classifier tests pass**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/ast_fidelity_test.ts`
Expected: PASS — all tests green (Task 2 + Task 3).

- [ ] **Step 5: Lint + format**

Run:
`deno fmt tests/e2e/ && deno lint tests/e2e/ast_fidelity.ts tests/e2e/ast_fidelity_test.ts`
Expected: formatted; 0 lint problems.

- [ ] **Step 6: Commit (local checkpoint)**

```bash
git add tests/e2e/ast_fidelity.ts tests/e2e/ast_fidelity_test.ts
git commit -m "wip(test): SP1 sample classifier + matrix runner"
```

---

## Task 4: Deterministic catalogue renderer (TDD)

**Files:**

- Modify: `tests/e2e/ast_fidelity.ts`
- Test: `tests/e2e/ast_fidelity_test.ts`
- Modify: `dprint.json` (pull the catalogue exclude forward from Task 5 so the
  renderer JSDoc's "dprint-excluded" claim is true the moment it is written, and
  SP1's only gate is not left dependent on a later task's ordering —
  code-quality review of this task required this)

- [ ] **Step 1: Write failing renderer tests**

Append to `tests/e2e/ast_fidelity_test.ts`:

```typescript
import { renderCatalogue } from "./ast_fidelity.ts";

Deno.test("renderCatalogue: deterministic + markdownlint-safe shape", async () => {
  const m = await runMatrix();
  const a = renderCatalogue(m);
  const b = renderCatalogue(m);
  assertEquals(a, b); // pure + deterministic

  // Single leading H1 (markdownlint first-line-heading / single-title).
  assert(a.startsWith("# AST Fidelity Matrix\n"));
  assertEquals(a.match(/^# /gm)?.length, 1);
  // Generated-file banner so humans do not hand-edit it.
  assert(a.includes("<!-- Generated by scripts/gen_ast_fidelity_matrix.ts"));
  // Headline number present.
  assert(a.includes(`surface = LOSS + UNREPRESENTABLE = ${m.surface}`));
  // Table header present and every corpus row rendered.
  assert(a.includes("| Construct | Class | r==s | idempotent | str-fmt agrees | delta |"));
  for (const row of m.rows) {
    assert(a.includes(`| ${row.name} |`), `missing row ${row.name}`);
  }
  // Trailing newline, single (file is dprint-excluded; keep it tidy).
  assert(a.endsWith("\n"));
  assertFalse(a.endsWith("\n\n"));
  // No raw pipe leaks from delta: every data row has exactly 6 cells → 7
  // structural `|` delimiters. cell() escapes any in-delta pipe as `\|`
  // (which still contains a `|`), so strip escaped pipes first — the count
  // must reflect table structure, not delta content.
  for (const line of a.split("\n")) {
    if (line.startsWith("| ") && !line.includes("Construct") && !line.startsWith("| ---")) {
      const structural = (line.replace(/\\\|/g, "").match(/\|/g) ?? []).length;
      assertEquals(structural, 7, `bad row: ${line}`);
    }
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/ast_fidelity_test.ts`
Expected: FAIL — renderer test errors with `not implemented`; others pass.

- [ ] **Step 3: Implement `renderCatalogue`**

In `tests/e2e/ast_fidelity.ts`, replace the `renderCatalogue` stub with:

```typescript
/** Order classes appear in the summary block (stable). */
const CLASS_ORDER: readonly FidelityClass[] = [
  "OK",
  "NORMALIZE",
  "LOSS",
  "UNOWNED",
  "UNREPRESENTABLE",
];

/**
 * Make a string safe to drop into a single GFM table cell wrapped in an
 * inline-code span: no newlines (delta is already single-line), pipes
 * escaped, backticks neutralised. Wrapping in backticks also exempts the
 * content from markdownlint `no-bare-urls` / `no-inline-html`.
 * Backslashes are escaped first (correct-by-construction).
 */
function cell(value: string): string {
  const safe = value
    // Escape backslashes first so the count before any `|` is always odd
    // (2n+1) after the pipe-escape below — the table cell can never split,
    // independent of input. (Was relying on the JSON-stringified-input
    // invariant; this makes it correct by construction. CodeQL
    // js/incomplete-string-escaping.)
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "ʼ") // U+02BC — keeps the cell a valid single code span
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
  return value === "—" ? "—" : `\`${safe}\``;
}

/**
 * Render the deterministic, markdownlint-clean catalogue. The owning file
 * `docs/product/ast-fidelity-matrix.md` is dprint-excluded (see
 * `dprint.json`), so this exact byte sequence is the committed artifact and
 * the staleness gate compares against it verbatim.
 */
export function renderCatalogue(matrix: Matrix): string {
  const lines: string[] = [];
  lines.push("# AST Fidelity Matrix");
  lines.push("");
  lines.push(
    "<!-- Generated by scripts/gen_ast_fidelity_matrix.ts — do not edit by hand. -->",
  );
  lines.push("");
  lines.push(
    "SP1 characterization of the canonical body-AST build/render surface",
  );
  lines.push(
    "(`buildBodyAst` → `render` → `buildBodyAst`). Measurement only — no",
  );
  lines.push(
    "production behaviour depends on this file. See the SP1 design:",
  );
  lines.push(
    "`docs/superpowers/specs/2026-05-16-formatting-fidelity-epic-design.md` §4.",
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const c of CLASS_ORDER) {
    lines.push(`- ${c}: ${matrix.counts[c]}`);
  }
  lines.push("");
  lines.push(
    `Headline: surface = LOSS + UNREPRESENTABLE = ${matrix.surface} of ${matrix.rows.length} corpus samples.`,
  );
  lines.push("");
  lines.push("## Matrix");
  lines.push("");
  lines.push(
    "| Construct | Class | r==s | idempotent | str-fmt agrees | delta |",
  );
  lines.push(
    "| --------- | ----- | ---- | ---------- | -------------- | ----- |",
  );
  for (const row of matrix.rows) {
    lines.push(
      `| ${row.name} | ${row.cls} | ${row.rEqualsS ? "yes" : "no"} | ` +
        `${row.idempotent ? "yes" : "no"} | ` +
        `${row.strFmtAgrees ? "yes" : "no"} | ${cell(row.delta)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run to verify renderer tests pass**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/ast_fidelity_test.ts`
Expected: PASS — all tests green.

> Post-ship hardening: a CodeQL js/incomplete-string-escaping alert on this
> `cell()` was resolved by escaping backslashes first (correct-by-construction;
> the catalogue's backslash deltas now render doubled — accepted for a
> measurement artifact).

- [ ] **Step 5: Add the `dprint.json` exclude (pulled forward from Task 5)**

In `dprint.json`, the `excludes` array currently ends with `"docs/examples/"`.
Add `"docs/product/ast-fidelity-matrix.md"` immediately after it (keep valid
JSON — add the comma). The array becomes:

```json
"excludes": [
  "**/node_modules",
  "**/target",
  "**/dist",
  "**/build",
  "_site",
  "npm",
  "CHANGELOG.md",
  "docs/examples/",
  "docs/product/ast-fidelity-matrix.md"
],
```

No `.md` artifact exists yet (Task 5 generates it), so this is an inert,
forward-looking exclude that makes the renderer JSDoc accurate now. Run
`dprint check` — expected: clean (nothing to format; the exclude targets a
not-yet-existing path harmlessly).

- [ ] **Step 6: Lint + format**

Run:
`deno fmt tests/e2e/ && deno lint tests/e2e/ast_fidelity.ts tests/e2e/ast_fidelity_test.ts`
Expected: formatted; 0 lint problems. (`dprint.json` is hand-edited valid JSON;
`dprint fmt`/`deno fmt` do not own it here — do not let any formatter reorder
the excludes array.)

- [ ] **Step 7: Commit (local checkpoint)**

```bash
git add tests/e2e/ast_fidelity.ts tests/e2e/ast_fidelity_test.ts dprint.json
git commit -m "wip(test): SP1 deterministic catalogue renderer"
```

---

## Task 5: Generator script + justfile + dprint exclude + generate the catalogue

**Files:**

- Create: `scripts/gen_ast_fidelity_matrix.ts`
- Modify: `justfile`
- (`dprint.json` exclude already added in Task 4 — Step 2 below only verifies
  it)
- Create (generated): `docs/product/ast-fidelity-matrix.md`

- [ ] **Step 1: Create the generator script**

Create `scripts/gen_ast_fidelity_matrix.ts` with exactly this content (modelled
on `scripts/gen_theme.ts`):

```typescript
/**
 * Generate docs/product/ast-fidelity-matrix.md from the SP1 corpus.
 *
 * Usage: deno run --allow-read --allow-write scripts/gen_ast_fidelity_matrix.ts
 *
 * SP1 — pure characterization. This script does not modify any production
 * code; it only (re)writes the committed catalogue. The staleness gate
 * scripts/check_ast_fidelity_matrix.sh re-runs this and fails CI on drift.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { renderCatalogue, runMatrix } from "../tests/e2e/ast_fidelity.ts";

const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const OUT_PATH = join(ROOT, "docs/product/ast-fidelity-matrix.md");

const matrix = await runMatrix();
const markdown = renderCatalogue(matrix);
await Deno.writeTextFile(OUT_PATH, markdown);
console.error(
  `wrote ${OUT_PATH} (surface = ${matrix.surface}/${matrix.rows.length})`,
);
```

- [ ] **Step 2: Verify the `dprint.json` exclude (added in Task 4)**

The catalogue exclude was pulled forward into Task 4. Confirm it is present (do
NOT add it again):

Run: `grep -n 'docs/product/ast-fidelity-matrix.md' dprint.json` Expected: one
line inside the `excludes` array (after `"docs/examples/"`). If it is missing,
add `"docs/product/ast-fidelity-matrix.md"` after `"docs/examples/"` (valid
JSON, comma added) — but it should already be there from Task 4.

- [ ] **Step 3: Add the `justfile` task**

In `justfile`, immediately after the `tokens:` task (the block that runs
`deno run --allow-read --allow-write scripts/gen_theme.ts`), add:

```text
# Regenerate the SP1 AST fidelity matrix catalogue
ast-fidelity-matrix:
    deno run --allow-read --allow-write scripts/gen_ast_fidelity_matrix.ts
```

(Use a literal TAB or the file's existing recipe indentation — match the
surrounding recipes exactly so `just` parses it.)

- [ ] **Step 4: Generate the catalogue**

Run: `just ast-fidelity-matrix` Expected: stderr prints
`wrote …/docs/product/ast-fidelity-matrix.md (surface = N/…)`;
`docs/product/ast-fidelity-matrix.md` now exists.

- [ ] **Step 5: Inspect the generated catalogue**

Run: `sed -n '1,30p' docs/product/ast-fidelity-matrix.md` Expected: a
`# AST Fidelity Matrix` H1, the generated-by comment, a `## Summary` list with
per-class counts, the headline line, and a `## Matrix` GFM table beginning with
the `| Construct | Class | …` header. Confirm visually that the per-class counts
are plausible (there will be `OK`, almost certainly some
`NORMALIZE`/`LOSS`/`UNOWNED`; a non-zero `surface` is expected and is the
baseline — **not** a failure).

- [ ] **Step 6: Verify dprint and markdownlint do not fight the generator**

Run: `dprint check docs/product/ast-fidelity-matrix.md` Expected: `dprint`
reports the file is **excluded / not matched** (no reformatting proposed). If
dprint proposes changes, the exclude in Step 2 is wrong — fix it before
continuing.

Run (if `markdownlint-cli2` is available locally; the CI `lint` job runs it):
`npx --yes markdownlint-cli2 docs/product/ast-fidelity-matrix.md` Expected: 0
errors. If a rule trips (e.g. `no-bare-urls`, `no-inline-html`,
`no-trailing-punctuation`, `first-line-heading`), the renderer in Task 4 must be
adjusted (re-run Task 4 Step 3..6 then regenerate) — **STOP and fix the
renderer**, never hand-edit the generated file. If `markdownlint-cli2` is not
installed, note that the CI `lint` job is the authority and proceed; Task 8
re-checks the whole tree.

- [ ] **Step 7: Commit (local checkpoint)**

```bash
git add scripts/gen_ast_fidelity_matrix.ts justfile dprint.json docs/product/ast-fidelity-matrix.md
git commit -m "wip(repo): SP1 catalogue generator + generated catalogue"
```

---

## Task 6: CI-runnable harness with in-test staleness guard (TDD)

**Files:**

- Create: `tests/e2e/ast_fidelity_matrix_test.ts`

- [ ] **Step 1: Write the harness test**

Create `tests/e2e/ast_fidelity_matrix_test.ts` with exactly this content:

```typescript
/**
 * @module tests/e2e/ast_fidelity_matrix_test
 *
 * SP1 — the CI-runnable AST fidelity-matrix harness.
 *
 * This is PURE CHARACTERIZATION. It deliberately does NOT assert that
 * LOSS / NORMALIZE / UNREPRESENTABLE counts are zero — those classes
 * exist today and are the baseline SP2/SP3 drive down (SP1 design §4.5).
 *
 * The only assertion here is the in-test staleness guard: the committed
 * catalogue must byte-match what the harness regenerates. The shell gate
 * scripts/check_ast_fidelity_matrix.sh enforces the same in CI; this
 * keeps the signal inside `deno test` too (the harness is the primary
 * surface — §4.6).
 */

import { assertEquals } from "@std/assert";
import { renderCatalogue, runMatrix } from "./ast_fidelity.ts";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const CATALOGUE_PATH = `${REPO_ROOT}docs/product/ast-fidelity-matrix.md`;

Deno.test("ast-fidelity-matrix: committed catalogue is not stale", async () => {
  const matrix = await runMatrix();
  const expected = renderCatalogue(matrix);
  const committed = await Deno.readTextFile(CATALOGUE_PATH);

  // Visible baseline signal (informational, never an assertion).
  console.log(
    `ast-fidelity surface = LOSS(${matrix.counts.LOSS}) + ` +
      `UNREPRESENTABLE(${matrix.counts.UNREPRESENTABLE}) = ${matrix.surface} ` +
      `of ${matrix.rows.length}; OK=${matrix.counts.OK} ` +
      `NORMALIZE=${matrix.counts.NORMALIZE} UNOWNED=${matrix.counts.UNOWNED}`,
  );

  assertEquals(
    committed,
    expected,
    "docs/product/ast-fidelity-matrix.md is stale — run " +
      "`just ast-fidelity-matrix` and stage the result.",
  );
});
```

- [ ] **Step 2: Run the harness — verify it passes against the committed file**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/ast_fidelity_matrix_test.ts`
Expected: PASS. The `console.log` line prints the baseline surface number.
(Because Task 5 already generated and committed the catalogue, the staleness
assertion holds.)

- [ ] **Step 3: Prove the staleness guard actually fails on drift**

Temporarily corrupt the committed file, run, confirm FAIL, then restore:

```bash
printf '\nstale\n' >> docs/product/ast-fidelity-matrix.md
deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/ast_fidelity_matrix_test.ts || echo "EXPECTED-FAIL-OK"
git checkout -- docs/product/ast-fidelity-matrix.md
```

Expected: the test FAILS with the "is stale" message, then `EXPECTED-FAIL-OK`
prints, then the file is restored. Re-run the test to confirm PASS again:

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/ast_fidelity_matrix_test.ts`
Expected: PASS.

- [ ] **Step 4: Lint + format**

Run: `deno fmt tests/e2e/ && deno lint tests/e2e/ast_fidelity_matrix_test.ts`
Expected: formatted; 0 lint problems.

- [ ] **Step 5: Commit (local checkpoint)**

```bash
git add tests/e2e/ast_fidelity_matrix_test.ts
git commit -m "wip(test): SP1 fidelity-matrix harness + in-test staleness guard"
```

---

## Task 7: Shell staleness gate + CI job

**Files:**

- Create: `scripts/check_ast_fidelity_matrix.sh`
- Modify: `.github/workflows/ci.yaml`

- [ ] **Step 1: Create the staleness gate script**

Create `scripts/check_ast_fidelity_matrix.sh` with exactly this content
(modelled on `scripts/check_tokens.sh`):

```bash
#!/bin/bash
# Verify the committed AST fidelity matrix catalogue is up to date.
# Exits non-zero if stale. SP1 — measurement only; this gate enforces
# only catalogue freshness, never LOSS/NORMALIZE counts.

set -euo pipefail

deno run --allow-read --allow-write \
  scripts/gen_ast_fidelity_matrix.ts > /dev/null 2>&1

if ! git diff --quiet docs/product/ast-fidelity-matrix.md 2>/dev/null; then
  echo "error: docs/product/ast-fidelity-matrix.md is stale — run 'just ast-fidelity-matrix' and stage the result"
  git diff --stat docs/product/ast-fidelity-matrix.md
  exit 1
fi
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/check_ast_fidelity_matrix.sh` Expected: no output; file
mode now `+x`. Confirm `scripts/check_tokens.sh` is also `+x` (parity) via
`ls -l scripts/check_tokens.sh scripts/check_ast_fidelity_matrix.sh`.

- [ ] **Step 3: Run the gate against the clean tree — expect pass**

Run: `bash scripts/check_ast_fidelity_matrix.sh` Expected: exit 0, no output
(catalogue matches; `git diff --quiet` succeeds).

- [ ] **Step 4: Prove the gate fails on drift**

```bash
printf '\nstale\n' >> docs/product/ast-fidelity-matrix.md
git add docs/product/ast-fidelity-matrix.md
bash scripts/check_ast_fidelity_matrix.sh || echo "EXPECTED-FAIL-OK"
git checkout -- docs/product/ast-fidelity-matrix.md
git add docs/product/ast-fidelity-matrix.md
```

Expected: the gate regenerates (overwriting the manual edit), `git diff` is now
empty vs the regenerated content **but** the staged blob differed — confirm the
gate prints the "is stale" error and `EXPECTED-FAIL-OK`. Then the file is
restored and re-staged clean. Re-run `bash scripts/check_ast_fidelity_matrix.sh`
and expect exit 0.

> Note: the gate mirrors `check_tokens.sh` exactly — it regenerates then
> `git diff --quiet`s the working tree against HEAD/stage. Drift = the
> regenerated bytes differ from what is committed.

- [ ] **Step 5: Add the CI job**

In `.github/workflows/ci.yaml`, the `tokens:` job is the last job before
`commits:`. Add a new job immediately after the `tokens:` job's last line
(`- run: bash scripts/check_tokens.sh`) and before `commits:`:

```yaml
ast-fidelity-matrix:
  name: AST fidelity matrix
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v6
    - uses: denoland/setup-deno@v2
      with:
        deno-version: v2.x
    - run: bash scripts/check_ast_fidelity_matrix.sh
```

- [ ] **Step 6: Validate the workflow YAML**

Run:
`deno run --allow-read --allow-net npm:yaml-lint .github/workflows/ci.yaml 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yaml')); print('yaml-ok')"`
Expected: `yaml-ok` (or yaml-lint clean). The new job is well-formed and
indented consistently with `tokens:`.

- [ ] **Step 7: Commit (local checkpoint)**

```bash
git add scripts/check_ast_fidelity_matrix.sh .github/workflows/ci.yaml
git commit -m "wip(repo): SP1 catalogue staleness gate + CI job"
```

---

## Task 8: Full verification (no production drift, all gates green)

**Files:** none (verification only).

- [ ] **Step 1: Assert zero production-code change**

Run: `git diff --name-only main...HEAD` Expected: ONLY these paths appear —
`tests/e2e/ast_fidelity.ts`, `tests/e2e/ast_fidelity_test.ts`,
`tests/e2e/ast_fidelity_matrix_test.ts`, `scripts/gen_ast_fidelity_matrix.ts`,
`scripts/check_ast_fidelity_matrix.sh`, `docs/product/ast-fidelity-matrix.md`,
`docs/superpowers/plans/2026-05-16-formatting-fidelity-sp1.md`, `dprint.json`,
`justfile`, `.github/workflows/ci.yaml`. If anything under
`packages/markspec/core/**` (or any other production module) appears — **STOP**,
that violates the SP1 hard invariant.

- [ ] **Step 2: Confirm the equivalence gate + formatter guard are untouched**

Run:
`git diff main...HEAD -- tests/e2e/ast_equivalence_test.ts packages/markspec/core/formatter/mod.ts`
Expected: **empty** (no diff). These must not change in SP1.

- [ ] **Step 3: Full `just check`**

Run: `just check` Expected: `deno lint` 0 problems, all tests pass (the new
harness + unit tests included), `deno check …` clean. Green.

- [ ] **Step 4: dprint + deno fmt check (CI parity)**

Run: `deno fmt --check && dprint check` Expected: both clean. `dprint check`
must NOT propose changes to `docs/product/ast-fidelity-matrix.md` (it is
excluded).

- [ ] **Step 5: Run the staleness gate one more time**

Run: `bash scripts/check_ast_fidelity_matrix.sh && echo GATE-OK` Expected:
`GATE-OK` (exit 0).

- [ ] **Step 6: Markdownlint the generated catalogue (CI `lint` parity)**

Run:
`npx --yes markdownlint-cli2 "docs/product/ast-fidelity-matrix.md" && echo MDLINT-OK`
Expected: `MDLINT-OK`. If it fails, fix the **renderer** (Task 4), regenerate
(Task 5 Step 4), recommit; never hand-edit the generated file. (If
`markdownlint-cli2` cannot be installed offline, record that CI will be the
authority and proceed — the CI `ast-fidelity-matrix` + `lint` jobs will catch
any issue on the PR.)

---

## Task 9: Squash, push, PR, watch, merge

**Files:** none (delivery).

- [ ] **Step 1: Squash all WIP commits into one Conventional Commit**

```bash
git reset --soft main
git add -A
git status --short
```

Expected: all SP1 files staged, no `packages/markspec/core/**` paths.

- [ ] **Step 2: Create the single commit**

Use a heredoc (no backticks in the body — they break `$()`):

```bash
git commit -F - <<'EOF'
feat(repo): SP1 — AST fidelity-matrix harness, catalogue, and staleness gate

Characterizes the canonical body-AST build/render lossy surface with zero
production-code change (Formatting Fidelity epic, SP1; design doc
docs/superpowers/specs/2026-05-16-formatting-fidelity-epic-design.md §4).

- tests/e2e/ast_fidelity.ts: data-driven corpus, provisional SP1-local
  astEquivalent (SP3 ratifies), sample classifier, deterministic catalogue
  renderer. Imports buildBodyAst from the internal core/ast path — an
  intentional design-mandated exception (core/mod.ts does not export it),
  with precedent in ast_equivalence_test.ts.
- tests/e2e/ast_fidelity_test.ts: astEquivalent + classifier + renderer
  unit tests.
- tests/e2e/ast_fidelity_matrix_test.ts: CI-runnable harness with an
  in-test staleness guard; measurement only — no LOSS/NORMALIZE assertions.
- scripts/gen_ast_fidelity_matrix.ts + scripts/check_ast_fidelity_matrix.sh:
  generator + staleness gate, modelled on gen_theme.ts / check_tokens.sh.
- docs/product/ast-fidelity-matrix.md: generated, committed catalogue.
- dprint.json: exclude the generated catalogue (parity with docs/examples/).
- justfile + .github/workflows/ci.yaml: ast-fidelity-matrix task + CI job.

Does not touch build/render/formatter or the equivalence gate. SP2 (faithful
builder) and SP3 (AST-equivalence contract) follow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
```

- [ ] **Step 3: Final pre-push gate**

Run: `just check && bash scripts/check_ast_fidelity_matrix.sh && echo READY`
Expected: `READY`. (The pre-commit hook also auto-runs fmt + lint + typecheck +
commit-msg lint on commit; this is the explicit belt-and-suspenders check.)

- [ ] **Step 4: Push the branch**

```bash
git push -u origin epic-formatting-fidelity-sp1
```

Expected: branch pushed.

- [ ] **Step 5: Open the PR with a body file**

```bash
cat > /tmp/sp1-pr-body.md <<'EOF'
## Formatting Fidelity — SP1: Characterize the lossy surface

Implements SP1 of the Formatting Fidelity epic (design:
docs/superpowers/specs/2026-05-16-formatting-fidelity-epic-design.md §4).
Per PROCESS.md the epic issue is human-created and intentionally not opened
here; the merged design doc is the record.

**Pure characterization — zero production-code change.** Does not modify
build/render/formatter, and does not weaken tests/e2e/ast_equivalence_test.ts
or the formatter fallback guard.

### Delivered

- CI-runnable harness: tests/e2e/ast_fidelity_matrix_test.ts (measurement
  only — no LOSS/NORMALIZE red-bar; the only assertion is catalogue
  staleness).
- Generated + committed catalogue: docs/product/ast-fidelity-matrix.md.
- Staleness CI gate: scripts/check_ast_fidelity_matrix.sh + a CI job,
  modelled on check_tokens.sh / the tokens job.
- Provisional SP1-local astEquivalent with dedicated unit tests
  (tests/e2e/ast_fidelity_test.ts). SP3 ratifies it as the formal §5
  relation.

### Notes for reviewers

- astEquivalent is provisional and SP1-local by design (§4.3); it is a
  strict structural relation ignoring SourceRange.
- The harness imports buildBodyAst from the internal core/ast/build.ts
  path: core/mod.ts does not export it, and the SP1 design names it
  explicitly. Precedent: ast_equivalence_test.ts imports render from the
  internal core/ast/render.ts path.
- docs/product/ast-fidelity-matrix.md is dprint-excluded (parity with the
  existing docs/examples/ exclusion) because dprint reformats Markdown
  tables and would fight the generator/gate; it is kept markdownlint-clean.
- The reported surface (LOSS + UNREPRESENTABLE) is the SP1 baseline that
  SP2/SP3 drive to zero — a non-zero number here is expected, not a failure.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF

gh pr create --base main --head epic-formatting-fidelity-sp1 \
  --title "feat(repo): SP1 — AST fidelity-matrix harness, catalogue, staleness gate" \
  --body-file /tmp/sp1-pr-body.md
```

Expected: PR URL printed. Capture the PR number `<N>`.

- [ ] **Step 6: Watch CI**

Run: `gh pr checks <N> --watch --interval 20` Expected: all jobs (fmt, dprint,
lint, check, test, tokens, ast-fidelity-matrix, commits) succeed. If
`ast-fidelity-matrix` or `test` fails on the runner but passed locally, inspect
logs — most likely a non-determinism leak (a corpus sample whose
`buildBodyAst`/`render` output is environment-sensitive). **STOP and surface**
rather than patching blindly: non-determinism is a real finding, not a flake.

- [ ] **Step 7: Merge**

Run: `gh pr merge <N> --merge --delete-branch` Expected: PR merged to `main`,
branch deleted.

- [ ] **Step 8: Post-merge memory update**

Update the memory file
`/Users/sebastientasson/.claude/projects/-Users-sebastientasson-Workspace-driftsys-markspec/memory/project_path_a_ast_refactor.md`
(and `MEMORY.md` index if a new file is warranted) to record: SP1 shipped (PR
`<N>`), the baseline surface number from the catalogue, that `astEquivalent` is
provisional pending SP3, and that SP2 (faithful builder) is the next
sub-project. Keep it to the non-obvious facts (the baseline number, the
provisional-relation status, the next step) — do not duplicate what the design
doc or git history already record.

---

## Self-review (performed against the SP1 design §4)

- **§4.1 deliverables** — harness (Task 6), generated catalogue (Task 5),
  staleness gate `scripts/check_ast_fidelity_matrix.sh` mirroring
  `check_tokens.sh` (Task 7): covered.
- **§4.2 corpus** — every §2.4 block (incl. ordered/unordered/nested/loose/tight
  list, tagged/untagged code, all 5 admonitions), §2.5 inline (emphasis/strong/
  combined, inline code, inline link, reference-style link + definition,
  autolink, both hard-break forms, all 3 entity-ref conventions, RFC 2119 + EARS
  modals), §2.4.1 excluded constructs (heading, thematic break, task list, raw
  HTML), and edge cases (blank-line runs, CRLF, tabs, leading/trailing ws, mixed
  blocks): present in `CORPUS` (Task 1). Data-driven + extendable.
- **§4.3 mechanism** — `ast0=buildBodyAst(s)`, `r=render(ast0)`,
  `ast1=buildBodyAst(r)`, the 5-class table (OK/NORMALIZE/LOSS/UNOWNED/
  UNREPRESENTABLE), the Approach-C str-fmt signal column, the idempotence
  column: implemented in `classifySample` (Task 3). `astEquivalent` is a pure
  util function (Task 2).
- **§4.4 generated catalogue** — deterministic table + per-class summary +
  single headline number, corpus order: `renderCatalogue` (Task 4); generator
  writes it (Task 5).
- **§4.5 CI stance** — measurement only; no LOSS/NORMALIZE/UNREPRESENTABLE
  red-bar; only gates are catalogue staleness (Tasks 6/7) and astEquivalent +
  harness unit tests (Tasks 2–4). Asserted explicitly in Task 8 Step 1–2 (zero
  production change; gate + guard untouched).
- **§4.6 testing** — the four required `astEquivalent` cases (SourceRange
  ignored; dropped emphasis / fused hard break; reordered children; `Unknown`
  raw differs/same) are in Task 2, plus extra coverage.
- **§4.7 risks** — provisional `astEquivalent` pinned by unit tests; corpus
  data-driven/extendable with the headline framed as a lower bound; diff noise
  controlled by fixed corpus order + stable `delta` + dprint exclusion; scope
  creep prevented by the Task 8 zero-production-change assertion.
- **Placeholder scan** — every code/script/YAML step contains complete content;
  no TBD/TODO/"similar to".
- **Type consistency** — `CorpusSample`, `MatrixRow`, `Matrix`, `FidelityClass`,
  `astEquivalent`, `classifySample`, `runMatrix`, `renderCatalogue` names and
  signatures are identical across Tasks 1–6, the generator, and the harness.

```
```
