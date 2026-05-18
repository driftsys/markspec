# SP3 — AST-Equivalence Formatting Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the formatter apply the §5.2 body-internal normalizations through
the AST, replace the byte-identical `emitBodyViaAst` guard with the ratified
`astEquivalent` relation, close the SP2 residuals, and evolve the SP1 matrix so
the build/render/format fidelity surface reaches the epic end-state (only
`OK`/`UNOWNED`, zero residual).

**Architecture:** Promote SP1's `astEquivalent` to production
(`core/ast/equivalence.ts`) unchanged. Add a pure deterministic
`normalizeBodyAst` AST pass (`core/ast/normalize.ts`) that applies the §3.4.1
modal-case rewrite on `InlineContent.text` at `ModalMarker` spans.
`emitBodyViaAst` becomes
`emitted = render(normalizeBodyAst(buildBodyAst(
body)))`, gated by
`astEquivalent(buildBodyAst(emitted), canonical)` with a loud diagnosed
never-firing string-keep fallback. renderNote/deflist residuals fixed. The SP1
matrix classifier evolves from build/render to build/render/**format**. `format`
stays idempotent + total.

**Tech Stack:** Deno/TypeScript, mdast/remark, `@std/assert`, `just`, dprint.

**Spec:** `docs/superpowers/specs/2026-05-18-formatting-fidelity-sp3-design.md`.

**Working conventions (project memory + the spec):** Work stays in the existing
worktree (`worktree-formatting-fidelity-sp3`, branched from `1202d94` = SP2 +
shape rename #352; bootstrapped; baseline `just check` already verified clean).
WIP-commit each task with `git commit --no-verify -m "wip(...)"`; **Task 9**
squashes to ONE Conventional Commit onto `$(git merge-base origin/main HEAD)`.
If any step uncovers a genuine design fork or a conflict the spec did not
anticipate, **STOP and surface to the owner** — do not weaken a test, the
equivalence gate, or the idempotence corpus to make something pass.

**Environment hazard (observed in SP2):** subagent file/`git` tools may resolve
to the _other_ checkout `/Users/sebastientasson/Workspace/driftsys/
markspec`
(an advanced `main`). The ONLY tree to modify is the absolute worktree path
`/Users/sebastientasson/Workspace/driftsys/markspec/.claude/
worktrees/formatting-fidelity-sp3`.
Before any edit: `cd` there and confirm `git rev-parse --abbrev-ref HEAD` ==
`worktree-formatting-fidelity-sp3`. After committing, confirm
`git -C /Users/sebastientasson/Workspace/driftsys/
markspec status --porcelain`
shows no modified tracked files (main untouched).

---

## File Structure

| File                                                                          | Responsibility                                                                                                                 | Change           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `packages/markspec/core/ast/equivalence.ts`                                   | The ratified formal §5 AST-equivalence relation (SP1's `deepEqualIgnoringRanges`, unchanged).                                  | Create           |
| `packages/markspec/core/ast/equivalence_test.ts`                              | First-class unit tests for the now-load-bearing relation.                                                                      | Create           |
| `packages/markspec/core/ast/normalize.ts`                                     | `normalizeBodyAst` — deterministic AST→AST §3.4.1 modal-case pass.                                                             | Create           |
| `packages/markspec/core/ast/normalize_test.ts`                                | Colocated TDD unit tests for `normalizeBodyAst`.                                                                               | Create           |
| `packages/markspec/core/mod.ts`                                               | Library boundary. Export `astEquivalent`.                                                                                      | Modify           |
| `packages/markspec/core/ast/nodes.ts`                                         | Add `NoteNode.markerInline?` (same-line admonition body flag).                                                                 | Modify           |
| `packages/markspec/core/ast/build.ts`                                         | Capture `NoteNode.markerInline`; close the deflist `TODO(SP2-Task5)` verbatim-split fallback.                                  | Modify           |
| `packages/markspec/core/ast/render.ts`                                        | `renderNote` reproduces same-line-marker form.                                                                                 | Modify           |
| `packages/markspec/core/formatter/mod.ts`                                     | `emitBodyViaAst`: normalize + guard swap + residual diagnostic; remove the pre-parse body modal string pass; rewire `changed`. | Modify           |
| `packages/markspec/core/ast/build_test.ts` / `render_test.ts`                 | TDD pins for the renderNote + deflist fixes.                                                                                   | Add tests        |
| `packages/markspec/core/formatter/mod_test.ts`                                | Idempotence + guard-behaviour + residual-diagnostic pins.                                                                      | Add tests        |
| `packages/markspec/core/validator/*_test.ts`                                  | Pin MSL-M060 et al. unaffected by the formatter-only normalization.                                                            | Add tests        |
| `tests/e2e/ast_fidelity.ts`                                                   | Import production `astEquivalent` (delete local copy); evolve the classifier to build/render/**format**.                       | Modify           |
| `tests/e2e/ast_fidelity_test.ts`                                              | Update SP1 unit tests to the evolved classification.                                                                           | Modify           |
| `tests/e2e/ast_equivalence_test.ts`                                           | Strengthen with §5.2-normalization cases (append-only).                                                                        | Add cases        |
| `scripts/gen_ast_fidelity_matrix.ts` / `scripts/check_ast_fidelity_matrix.sh` | Adjust if the catalogue shape changes.                                                                                         | Modify if needed |
| `docs/product/ast-fidelity-matrix.md`                                         | Regenerated (build/render/format; OK/UNOWNED only).                                                                            | Regenerate       |
| `docs/specs/markspec-core-data-model.md`                                      | §5: record the formal relation + `build(format(x)) ≈ normalizeBodyAst(build(x))`.                                              | Modify           |
| `docs/architecture/adr-015-ast-equivalence-formatting-contract.md`            | New ADR (immutable; supersedes ADR-014 Decision-2 caveat).                                                                     | Create           |
| `docs/architecture/adr-014-canonical-body-ast.md`                             | One forward cross-reference note to ADR-015.                                                                                   | One-line add     |
| `AGENTS.md`                                                                   | Add ADR-015 to the ADR index.                                                                                                  | One-line add     |

---

## Task 1: Ratify `astEquivalent` into production (behaviour-preserving)

Move SP1's relation to a production module, export it, make the SP1 harness
consume the production copy. Zero behaviour change — the harness classifies
identically; proven by regenerating the matrix to a zero diff.

**Files:**

- Create: `packages/markspec/core/ast/equivalence.ts`,
  `packages/markspec/core/ast/equivalence_test.ts`
- Modify: `packages/markspec/core/mod.ts`, `tests/e2e/ast_fidelity.ts`

- [ ] **Step 1: Create the production module**

Create `packages/markspec/core/ast/equivalence.ts`. Open
`tests/e2e/ast_fidelity.ts`, copy the EXACT current bodies of `astEquivalent`
and its private `deepEqualIgnoringRanges` (the strict `BodyBlock[]`
deep-equality that elides every `range` key), and paste them here unchanged. The
module:

```typescript
/**
 * @module core/ast/equivalence
 *
 * The formal §5 AST-equivalence relation (ADR-015). Two `BodyBlock[]` are
 * equivalent iff structurally deep-equal after eliding every `range`
 * (`SourceRange`) key at any depth. Adopted UNCHANGED from SP1's
 * provisional relation — SP3 ratifies, it does not redefine. All §5.2
 * normalization is explicit in `normalizeBodyAst`, never in this
 * comparator (Formalization A).
 *
 * Load-bearing: consumed by the formatter guard (`emitBodyViaAst`) and
 * the SP1 fidelity harness. Pure library code: no `Deno.*`.
 */

import type { BodyBlock } from "./nodes.ts";

/** Formal §5 AST-equivalence: strict structural deep-equality of
 * `BodyBlock[]` ignoring every `range`. */
export function astEquivalent(
  a: readonly BodyBlock[],
  b: readonly BodyBlock[],
): boolean {
  return deepEqualIgnoringRanges(a, b);
}

// <paste the EXACT current `deepEqualIgnoringRanges` body from
//  tests/e2e/ast_fidelity.ts here, unchanged>
```

(Read the current `deepEqualIgnoringRanges` from `tests/e2e/ast_fidelity.ts` and
paste it verbatim — it is the array/object recursive walk that filters out
`range` keys. Do not alter its logic.)

- [ ] **Step 2: Write the failing unit test**

Create `packages/markspec/core/ast/equivalence_test.ts`:

```typescript
import { assert, assertFalse } from "@std/assert";
import { astEquivalent } from "./equivalence.ts";
import type { BodyBlock } from "./nodes.ts";

const para = (text: string, line = 1): BodyBlock[] => [{
  kind: "paragraph",
  content: { text, markers: [] },
  range: { start: { line, column: 1 }, end: { line, column: 1 } },
}];

Deno.test("astEquivalent: identical structure, different range → equivalent", () => {
  assert(astEquivalent(para("x", 1), para("x", 9)));
});

Deno.test("astEquivalent: differing text → not equivalent", () => {
  assertFalse(astEquivalent(para("x"), para("y")));
});

Deno.test("astEquivalent: differing block count → not equivalent", () => {
  assertFalse(astEquivalent([...para("a")], [...para("a"), ...para("b", 3)]));
});

Deno.test("astEquivalent: Unknown raw differs → not equivalent", () => {
  const u = (raw: string): BodyBlock[] => [{
    kind: "unknown",
    raw,
    range: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
  }];
  assertFalse(astEquivalent(u("---"), u("***")));
  assert(astEquivalent(u("---"), u("---")));
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd <worktree> && deno test packages/markspec/core/ast/equivalence_test.ts`
Expected: FAIL — `./equivalence.ts` not found (until Step 1 saved) / import
error. (If Step 1 is already saved, this passes immediately — that is acceptable
for a behaviour-preserving extraction; proceed.)

- [ ] **Step 4: Export from the library boundary**

In `packages/markspec/core/mod.ts`, add an export of `astEquivalent` alongside
the existing `./ast/render.ts` / `./ast/nodes.ts` exports (match the file's
existing `export { … } from "./ast/…";` style). Example shape (adapt to the
file's actual formatting):

```typescript
export { astEquivalent } from "./ast/equivalence.ts";
```

- [ ] **Step 5: Make the SP1 harness consume the production relation**

In `tests/e2e/ast_fidelity.ts`: delete the local `astEquivalent` wrapper **and**
the local `deepEqualIgnoringRanges` definition; add
`import { astEquivalent } from "../../packages/markspec/core/ast/equivalence.ts";`
(internal-path import — same precedent as the existing `buildBodyAst` import in
that file). Keep the re-export of `astEquivalent` if other test modules import
it from `ast_fidelity.ts` (grep first:
`grep -rn 'astEquivalent' tests/ packages/` — if `ast_fidelity_test.ts` or
others import it from `./ast_fidelity.ts`, re-export it:
`export { astEquivalent } from "../../packages/markspec/core/ast/equivalence.ts";`).

- [ ] **Step 6: Type-check, test, prove zero behaviour change**

Run, from `<worktree>`:

```
deno check packages/markspec/core/mod.ts packages/markspec/core/ast/equivalence.ts
deno test packages/markspec/core/ast/equivalence_test.ts
deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/ast_fidelity_test.ts tests/e2e/ast_equivalence_test.ts
just ast-fidelity-matrix
git diff --stat docs/product/ast-fidelity-matrix.md
```

Expected: type-check clean; equivalence_test passes; SP1 harness tests pass;
**`git diff` on the catalogue is EMPTY** (the extraction is behaviour-
preserving — the relation is byte-identical, so the regenerated matrix is
identical). If the catalogue changes, the extraction altered behaviour — STOP
and report BLOCKED.

- [ ] **Step 7: Commit**

```bash
git add packages/markspec/core/ast/equivalence.ts packages/markspec/core/ast/equivalence_test.ts packages/markspec/core/mod.ts tests/e2e/ast_fidelity.ts
git commit --no-verify -m "wip(core): ratify astEquivalent into core/ast/equivalence.ts"
```

---

## Task 2: `normalizeBodyAst` — the AST-native §3.4.1 pass (pure)

Pure module, no formatter wiring yet. Applies the §3.4.1 modal-keyword case rule
to every prose-bearing node's `InlineContent.text` at its `ModalMarker` spans.
Idempotent + total.

**Files:**

- Create: `packages/markspec/core/ast/normalize.ts`,
  `packages/markspec/core/ast/normalize_test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/markspec/core/ast/normalize_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { buildBodyAst } from "./build.ts";
import { render } from "./render.ts";
import { normalizeBodyAst } from "./normalize.ts";

function rt(s: string): string {
  return render(normalizeBodyAst(buildBodyAst(s)));
}

Deno.test("normalizeBodyAst: RFC-2119 modal lowercased mid-sentence", () => {
  assertEquals(rt("The driver SHALL debounce inputs."),
    "The driver shall debounce inputs.");
});

Deno.test("normalizeBodyAst: sentence-initial EARS keeps capitalization", () => {
  assertEquals(rt("When speed exceeds the limit the system SHALL warn."),
    "When speed exceeds the limit the system shall warn.");
});

Deno.test("normalizeBodyAst: idempotent", () => {
  const once = normalizeBodyAst(buildBodyAst("The system MUST stop."));
  const twice = normalizeBodyAst(once);
  assertEquals(render(twice), render(once));
  assertEquals(render(once), "The system must stop.");
});

Deno.test("normalizeBodyAst: total — no-modal prose unchanged", () => {
  assertEquals(rt("Plain prose with no modal keyword."),
    "Plain prose with no modal keyword.");
});

Deno.test("normalizeBodyAst: modal inside a note normalized", () => {
  assertEquals(rt("> [!NOTE]\n> The driver SHALL act."),
    "> [!NOTE]\n> The driver shall act.");
});

Deno.test("normalizeBodyAst: already-canonical body is a no-op", () => {
  const s = "The driver shall debounce inputs.";
  assertEquals(rt(s), s);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd <worktree> && deno test packages/markspec/core/ast/normalize_test.ts`
Expected: FAIL — `./normalize.ts` not found.

- [ ] **Step 3: Implement `normalizeBodyAst`**

First READ `packages/markspec/core/formatter/mod.ts` `normalizeModalKeywords`
(~line 83) and its helpers `walkProseLines`, `isSentenceInitial`,
`RFC2119_MODAL_RE`, `EARS_KEYWORD_RE` — that is the canonical §3.4.1 rule
(RFC-2119 → lowercase unconditionally; EARS → lowercase unless
sentence-initial). Also READ `packages/markspec/core/ast/build.ts`
`extractMarkersFromText` (~line 69) and `inlineContent`/`InlineContent` so the
new module re-derives markers consistently.

Create `packages/markspec/core/ast/normalize.ts`. Design:

- `export function normalizeBodyAst(blocks: readonly BodyBlock[]): BodyBlock[]`
  — recursively maps every node. For each prose-bearing node (`paragraph`,
  `note`, `blockquote`, list-item child blocks, table-cell `InlineContent`,
  definition-list `term`/`definition`), produce a new `InlineContent` whose
  `text` has every modal keyword normalized per §3.4.1, then re-derive `markers`
  from the normalized text via the same extraction `build.ts` uses (import/than
  reuse — if `extractMarkersFromText` is not exported, export it from `build.ts`
  for reuse here; do NOT duplicate the regex).
- §3.4.1 rule, applied to a prose string: RFC-2119 tokens
  (`shall|should|may|must|shall not|should not|must not`, case-insensitive) →
  lowercase; EARS tokens (`When|While|Where|Unless`) → lowercase unless
  sentence-initial (port `isSentenceInitial`). Implement a pure helper
  `normalizeModalsInText(text: string): string` (no `Deno.*`); the formatter's
  `normalizeModalKeywords` can later delegate to it (Task 5 removes the
  formatter's pre-parse pass entirely, so duplication is temporary).
- Recurse structurally: `ListNode.items[].blocks`, `NoteNode.content`,
  `BlockquoteNode.content`, `ParagraphNode.content`,
  `DefinitionListNode.items[].term/.definition`, `TableNode` cell
  `InlineContent` (NB: `TableNode` renders via `raw`; still normalize the cell
  `InlineContent` for validator-view consistency but know it does not affect
  render — verify the table round-trip stays byte-exact). `CodeNode`,
  `FeatureNode`, `MathNode`, `FigureNode`, `CaptionNode`, `UnknownNode`:
  returned unchanged (no modal recognition in verbatim content per §2.5;
  `CaptionNode.keyword` is already a TitleCase enum — no-op).
- Deterministic + total: never throws; unknown shapes pass through; output is a
  new array (do not mutate input).

Make the six tests pass.

- [ ] **Step 4: Run to verify pass**

Run: `cd <worktree> && deno test packages/markspec/core/ast/normalize_test.ts`
Expected: PASS (6).

- [ ] **Step 5: No-regression check**

Run:
`cd <worktree> && deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/core/ast/ && deno lint packages/markspec/core/ast/normalize.ts && deno check packages/markspec/core/ast/normalize.ts`
Expected: PASS, clean (the module is not yet wired into the formatter — pure
addition).

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/ast/normalize.ts packages/markspec/core/ast/normalize_test.ts packages/markspec/core/ast/build.ts
git commit --no-verify -m "wip(core): add normalizeBodyAst §3.4.1 AST pass"
```

(`build.ts` only if `extractMarkersFromText` was exported for reuse.)

---

## Task 3: renderNote same-line-marker round-trip

Close the SP2 residual: `> [!NOTE] text` must round-trip faithfully.

**Files:**

- Modify: `packages/markspec/core/ast/nodes.ts`,
  `packages/markspec/core/ast/build.ts`, `packages/markspec/core/ast/render.ts`
- Test: `packages/markspec/core/ast/build_test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/markspec/core/ast/build_test.ts`:

```typescript
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
```

(`render`, `buildBodyAst`, `assertEquals` are already imported in
`build_test.ts` from SP2; verify and add only if missing.)

- [ ] **Step 2: Run to verify failure**

Run each filter separately (Deno `--filter` is literal substring):
`cd <worktree> && deno test packages/markspec/core/ast/build_test.ts --filter "note: same-line marker body round-trips"`
Expected: FAIL — `renderNote` always emits `> [!KIND]\n> …`, so the same-line
form becomes `> [!NOTE]\n> inline body text.` (≠ source).

- [ ] **Step 3: Add the flag, capture it, render it**

In `packages/markspec/core/ast/nodes.ts`, add to `NoteNode` (after `content`):

```typescript
/**
 * True when the admonition body began on the marker line in source
 * (`> [!NOTE] text`) rather than its own quoted line. Round-tripped by
 * the renderer. Absent ⇒ own-line form (the canonical default).
 */
readonly markerInline?: boolean;
```

In `packages/markspec/core/ast/build.ts` `case "blockquote"` note branch (the
SP2 `deQuote`-based branch): after `[!KIND]` is matched, the de-quoted first
line is `[!KIND]<rest>`. Set `markerInline: true` when `<rest>` (the text after
the `[!KIND]` token on the first line, before any newline) is non-empty; store
the body content unchanged (it already includes that text). READ the current
note branch to integrate exactly; the flag is
`...(markerInlinePresent ? { markerInline: true } : {})` matching the existing
optional-field spread style (`checked`/`spread` precedent).

In `packages/markspec/core/ast/render.ts` `renderNote`: when `node.markerInline`
is true, emit the first body line on the marker line:

```typescript
function renderNote(node: NoteNode): string {
  const text = node.content.text;
  if (!text) return `> [!${node.admonition}]`;
  const lines = text.split("\n");
  if (node.markerInline) {
    const [first, ...rest] = lines;
    return `> [!${node.admonition}] ${first}` +
      (rest.length
        ? "\n" + rest.map((l) => l ? `> ${l}` : `>`).join("\n")
        : "");
  }
  return `> [!${node.admonition}]\n` +
    lines.map((l) => l ? `> ${l}` : `>`).join("\n");
}
```

(Integrate against the ACTUAL current `renderNote` — preserve its existing
empty-text and blank-quoted-line handling exactly; only add the `markerInline`
branch.)

- [ ] **Step 4: Run to verify pass**

Run the three filters separately. Expected: PASS (3).

- [ ] **Step 5: No-regression (existing note/blockquote shapes)**

Run:
`cd <worktree> && deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/core/ast/ tests/e2e/ast_equivalence_test.ts packages/markspec/core/validator/`
Expected: PASS — every existing SP2 note/blockquote gate case still
byte-identical. If an existing canonical shape regresses, STOP / BLOCKED (do not
weaken).

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/ast/nodes.ts packages/markspec/core/ast/build.ts packages/markspec/core/ast/render.ts packages/markspec/core/ast/build_test.ts
git commit --no-verify -m "wip(core): faithful renderNote same-line marker round-trip"
```

---

## Task 4: Close the SP2 deflist verbatim-split fallback (`TODO(SP2-Task5)`)

The single-item `case "paragraph"` deflist branch must ALWAYS store the verbatim
term/definition — never fall back to the flattened form.

**Files:**

- Modify: `packages/markspec/core/ast/build.ts`
- Test: `packages/markspec/core/ast/build_test.ts`

- [ ] **Step 1: Write the failing/guard tests**

Add to `packages/markspec/core/ast/build_test.ts`:

```typescript
Deno.test("deflist: verbatim term/def captured, never flattened", () => {
  const s = "ASIL\n: _Automotive_ Safety **Integrity** Level";
  const dl = buildBodyAst(s)[0] as DefinitionListNode;
  assertEquals(dl.kind, "definition-list");
  assertEquals(dl.items.length, 1);
  assertEquals(dl.items[0].term.text, "ASIL");
  assertEquals(dl.items[0].definition.text,
    "_Automotive_ Safety **Integrity** Level");
  assertEquals(render(buildBodyAst(s)), s);
});

Deno.test("deflist: indented/edge form still verbatim (no flattened fallback)", () => {
  // Probe the DEFLIST_RE-vs-verbatim-slice mismatch the SP2 TODO flagged.
  const s = "$DEBOUNCE_WINDOW\n: between _1 ms_ and **100 ms**, default 10 ms.";
  const dl = buildBodyAst(s)[0] as DefinitionListNode;
  assertEquals(dl.items[0].term.text, "$DEBOUNCE_WINDOW");
  assertEquals(dl.items[0].definition.text,
    "between _1 ms_ and **100 ms**, default 10 ms.");
  assertEquals(render(buildBodyAst(s)), s);
});
```

(`DefinitionListNode` is already imported in `build_test.ts` from SP2.)

- [ ] **Step 2: Run to verify status**

Run both filters separately. If both PASS, the SP2 fallback never actually fires
for these — proceed to Step 3 to make the verbatim path unconditional anyway
(remove the dead flattened fallback so it can never regress). If either FAILS,
that is the SP2 residual reproduced — fix in Step 3.

- [ ] **Step 3: Make verbatim capture unconditional**

READ the `case "paragraph"` deflist branch in `build.ts` (the
`tryDefinitionList` + `DEFLIST_RE.exec(verbatim.trim())` block carrying the
`// TODO(SP2-Task5)` comment). Diagnose why `DEFLIST_RE` can fail to match the
verbatim slice while matching the flattened `text` (whitespace/indent shape
after `verbatimSlice` normalization). Fix so the single-item term and definition
are ALWAYS the verbatim substrings:

- Derive term/definition from the verbatim slice deterministically (e.g. split
  the verbatim slice on the first `\n:` then trim per §3.4.4 — mirror exactly
  what `render` (`renderDefinitionList`) expects so the round-trip is
  byte-exact), NOT via a regex that can miss.
- Remove the flattened-fallback branch and the `// TODO(SP2-Task5)` comment (the
  fallback is now unreachable for the single-item canonical form).
- Do NOT expand to multi-item (still one `DefinitionListNode` per paragraph —
  already round-trips `OK`, out of scope).

Make both tests pass with byte-exact round-trip.

- [ ] **Step 4: Run to verify pass**

Run both filters separately. Expected: PASS (2).

- [ ] **Step 5: No-regression**

Run:
`cd <worktree> && deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/core/ast/ tests/e2e/ast_equivalence_test.ts`
Expected: PASS (existing deflist gate cases unbroken).

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/ast/build.ts packages/markspec/core/ast/build_test.ts
git commit --no-verify -m "wip(core): close SP2 deflist verbatim-split fallback"
```

---

## Task 5: Guard swap + `normalizeBodyAst` wiring in `emitBodyViaAst`

Replace the byte-identical guard with `astEquivalent`; route the body through
`normalizeBodyAst`; remove the pre-parse body modal string pass; rewire
`changed`; add the diagnosed never-firing fallback.

**Files:**

- Modify: `packages/markspec/core/formatter/mod.ts`
- Test: `packages/markspec/core/formatter/mod_test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/markspec/core/formatter/mod_test.ts` (READ the file's existing
imports/`format` usage and match them):

```typescript
Deno.test("format: body modal keyword canonicalized via the AST", async () => {
  const { format } = await import("./mod.ts");
  const doc =
    "- [TST_FM_0001] Probe\n\n  The driver SHALL debounce inputs.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const out = format(doc, { file: "t.md" }).output;
  // §3.4.1 applied — through the AST now, not the pre-parse string pass.
  assert(out.includes("The driver shall debounce inputs."));
  assertFalse(out.includes("SHALL"));
});

Deno.test("format: idempotent on non-canonical body (modal + blank runs)", async () => {
  const { format } = await import("./mod.ts");
  const doc =
    "- [TST_FM_0002] Probe\n\n  The system MUST stop.\n\n\n\n  More prose.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const once = format(doc, { file: "t.md" }).output;
  const twice = format(once, { file: "t.md" }).output;
  assertEquals(twice, once);
});

Deno.test("format: same-line-marker note canonicalized + idempotent", async () => {
  const { format } = await import("./mod.ts");
  const doc =
    "- [TST_FM_0003] Probe\n\n  > [!NOTE] inline body.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const once = format(doc, { file: "t.md" }).output;
  assertEquals(format(once, { file: "t.md" }).output, once);
});
```

(Ensure `assert`, `assertEquals`, `assertFalse` imported from `@std/assert` in
`mod_test.ts`; add if missing.)

- [ ] **Step 2: Run to verify status**

Run the three filters separately. `format: body modal keyword canonicalized`
likely PASSES already (the pre-parse `normalizeModalKeywords` string pass still
does it). The idempotence tests should PASS too. These are **characterization
guards** for Step 3 — Step 3 must keep them green while moving the mechanism
onto the AST.

- [ ] **Step 3: Rewire `emitBodyViaAst` + remove the pre-parse body pass**

READ `packages/markspec/core/formatter/mod.ts` `format()` (~lines 309-430) and
`emitBodyViaAst` (~lines 206-279).

(a) In `emitBodyViaAst`, replace the byte-guarded emit. Current:

```typescript
const emittedBody = renderBodyAst(buildBodyAst(entry.body));
if (emittedBody !== entry.body) { /* keep original */ continue; }
/* …splice emittedBody… */
```

with the normalize + astEquivalent guard:

```typescript
import { normalizeBodyAst } from "../ast/normalize.ts";
import { astEquivalent } from "../ast/equivalence.ts";
// …
const ast0 = buildBodyAst(entry.body);
const canonical = normalizeBodyAst(ast0);
const emittedBody = renderBodyAst(canonical);
if (!astEquivalent(buildBodyAst(emittedBody), canonical)) {
  // Defensive residual — must never fire over the corpus/real docs.
  // Loudly diagnosed (not silent); keep the original body (anti-corruption).
  diagnostics.push({
    code: "MSL-F900",
    severity: "error",
    message:
      `${entry.displayId}: body not AST-equivalent after canonicalization ` +
      `(SP3 residual — formatter kept the original body)`,
    location: entry.location,
  });
  continue;
}
/* …splice emittedBody (now the §5.2-canonical body)… */
```

`emitBodyViaAst` currently has no `diagnostics` parameter — thread the
`diagnostics: Diagnostic[]` array from `format()` into `emitBodyViaAst` (add a
parameter; update the single call site at ~line 427). Pick the diagnostic code
by reading the existing `MSL-F…` namespace usage in the file (`MSL-F001` exists
for Id assignment); use the next free `MSL-F` code for the residual and keep
severity `error`. The splice logic that re-indents and preserves blank
delimiters is UNCHANGED — only the guarded value and the fallback branch change.

(b) Remove the pre-parse body modal string pass. In `format()`, change
`const body = normalizeModalKeywords(rawBody);` to `const body = rawBody;`
(modal §3.4.1 now happens via `normalizeBodyAst` inside `emitBodyViaAst`). Keep
`normalizeModalKeywords` exported (other callers/tests may use it; do not delete
the function) — only stop calling it in the `format()` body path. Rewire
`changed`: `let changed = body !== rawBody;` becomes `let changed = false;` and
the post-`emitBodyViaAst` `changed` detection must catch body rewrites — set
`changed = true` when `emitBodyViaAst` splices a body whose emitted form differs
from the original segment. The simplest correct wiring: have `emitBodyViaAst`
return a boolean "did it change any body" and OR it into `changed`; or compare
`collapsedLines` before/after the call. Implement whichever keeps
`format().changed` accurate (a regression here breaks `--check` mode). Pin with:
`format` of an uppercase-modal doc reports `changed === true`.

(c) Leave `collapseBlankLines` as-is. Body blank-run collapse is now emergent
via the AST render; `collapseBlankLines` remains for the document scaffold
(between entries / around front matter) and is idempotent over the
now-AST-canonical body — composing the two collapses is safe. (The spec's
"remove body collapseBlankLines" intent is satisfied emergently; removing the
whole-doc pass is out of scope and would regress non-body spacing.) Add a test
asserting inter-entry blank runs are still collapsed.

- [ ] **Step 4: Run to verify pass**

Run the three new filters separately + add/keep a `changed === true` pin.
Expected: PASS.

- [ ] **Step 5: Critical no-regression + real-doc safety**

Run, from `<worktree>`:

```
deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/ast_equivalence_test.ts tests/e2e/format_test.ts packages/markspec/core/
deno run --allow-read --allow-write packages/markspec/main.ts format docs/product/software-architecture.md docs/product/stakeholder-requirements.md
git -C <worktree> status --porcelain docs/product/ | cat
```

Expected: all tests PASS; `format` over the two entry docs reports `unchanged`;
**zero diff** in `docs/product/` (they are already SP2- canonical). ANY
`docs/product` reformat ⇒ STOP / BLOCKED (surface to owner — real-doc behaviour
change). `format_test.ts` must stay green and **unmodified** (its safe-fallback
pins now exercise the AST path but output stays idempotent/preserved).

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/formatter/mod.ts packages/markspec/core/formatter/mod_test.ts
git commit --no-verify -m "wip(core): §5.2-via-AST — normalizeBodyAst + astEquivalent guard"
```

---

## Task 6: Validator-safety pins (formatter-only normalization)

`validate` must NOT normalize — MSL-M060 et al. still fire on un-normalized
input. Pin it.

**Files:**

- Test: `packages/markspec/core/validator/modal_keywords_test.ts`,
  `packages/markspec/core/validator/body_blocks_test.ts`

- [ ] **Step 1: Write the pins**

Add to `packages/markspec/core/validator/modal_keywords_test.ts` (match the
file's existing `parseFile`/`validateModalKeywords` dynamic-import pattern from
SP2):

```typescript
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
```

(Confirm exact exported identifiers by reading the modules first; adjust
plumbing only, not the assertion intent. `assertEquals` import: add if missing.)

- [ ] **Step 2: Run**

Run:
`cd <worktree> && deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/core/validator/`
Expected: PASS — `parseFile`/`validate` never call `normalizeBodyAst`
(formatter-only), so MSL-M060 still fires on `SHALL`. If it FAILS, the
normalization leaked into the parse/validate path — STOP / BLOCKED.

- [ ] **Step 3: Commit**

```bash
git add packages/markspec/core/validator/modal_keywords_test.ts packages/markspec/core/validator/body_blocks_test.ts
git commit --no-verify -m "wip(core): pin validate path unaffected by formatter normalization"
```

---

## Task 7: Evolve the SP1 classifier (build/render → build/render/format)

**Files:**

- Modify: `tests/e2e/ast_fidelity.ts`, `tests/e2e/ast_fidelity_test.ts`
- Regenerate: `docs/product/ast-fidelity-matrix.md`
- Modify if needed: `scripts/check_ast_fidelity_matrix.sh`

- [ ] **Step 1: Update the classifier**

READ `tests/e2e/ast_fidelity.ts` `classifySample` / `runMatrix` /
`renderCatalogue` / the `FidelityClass` union / `strFmtAgrees` /
`allUnknownVerbatim`. Evolve:

- `FidelityClass` becomes `"OK" | "UNOWNED" | "RESIDUAL"` (drop
  `NORMALIZE`/`LOSS`/`UNREPRESENTABLE`; keep them only if other code references
  them — grep first and update all references).
- `classifySample`: compute `cf` = the formatter-canonical body via the existing
  `strFmtAgrees` machinery (wrap `s` in an entry, `format()`, re-parse, take
  `entry.body`). Import `normalizeBodyAst` + `buildBodyAst` + production
  `astEquivalent`. New classification:
  - `UNOWNED` if `allUnknownVerbatim(buildBodyAst(s))` (excluded construct
    preserved verbatim) — unchanged predicate.
  - else `OK` if (a) `format` is idempotent on the wrapped entry
    (`format(format(doc)) === format(doc)`) AND (b)
    `astEquivalent(buildBodyAst(cf), normalizeBodyAst(buildBodyAst(s)))`.
  - else `RESIDUAL`.
- `runMatrix`: counts over the new classes; `surface = counts.RESIDUAL`.
- `renderCatalogue`: headline
  `surface = RESIDUAL = ${matrix.surface} of ${n} corpus samples`; columns →
  `Construct | Class | format-idempotent | roundtrips | delta`; drop the
  "measurement only — no production behaviour depends on this file" preamble
  line (the relation is now production-consumed; replace with a one-line note
  that the relation lives in `core/ast/equivalence.ts` and the classifier
  measures the SP3 format contract).

- [ ] **Step 2: Update the SP1 unit tests**

In `tests/e2e/ast_fidelity_test.ts`, update every assertion that referenced the
old classes/headline/columns to the evolved ones (the
`runMatrix: covers the whole corpus…`, `renderCatalogue: …shape`, and the two
flipped SP2 tripwires). Keep the tripwires' INTENT (emphasis/heading faithfully
preserved) — assert they now classify `OK`. Grep the file for
`NORMALIZE`/`LOSS`/`UNREPRESENTABLE`/`surface =` and update each.

- [ ] **Step 3: Run the SP1 suite**

Run:
`cd <worktree> && deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/ast_fidelity_test.ts`
Expected: PASS (evolved assertions).

- [ ] **Step 4: Regenerate + inspect the catalogue**

Run:
`cd <worktree> && just ast-fidelity-matrix && grep -n "Headline\|^- OK\|^- UNOWNED\|^- RESIDUAL" docs/product/ast-fidelity-matrix.md | cat`
Expected: `OK + UNOWNED = 58`, **`RESIDUAL = 0`**. If `RESIDUAL > 0`, identify
the offending sample(s) + delta and STOP / report DONE_WITH_CONCERNS (an
explicit residual — never silently accept; the spec mandates zero).

- [ ] **Step 5: Staleness gate**

Run:
`cd <worktree> && git add docs/product/ast-fidelity-matrix.md && bash scripts/check_ast_fidelity_matrix.sh; echo "exit=$?"`
Expected: `exit=0`. (If `check_ast_fidelity_matrix.sh`'s message text references
"LOSS/NORMALIZE", update that comment line to the new vocabulary — the gate
logic itself, a `git diff --quiet`, is unchanged.)

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/ast_fidelity.ts tests/e2e/ast_fidelity_test.ts docs/product/ast-fidelity-matrix.md scripts/check_ast_fidelity_matrix.sh
git commit --no-verify -m "wip(repo): evolve fidelity matrix to the build/render/format contract"
```

---

## Task 8: Spec §5 + ADR-015 + ADR-014 cross-ref + AGENTS.md

**Files:**

- Modify: `docs/specs/markspec-core-data-model.md`
- Create: `docs/architecture/adr-015-ast-equivalence-formatting-contract.md`
- Modify: `docs/architecture/adr-014-canonical-body-ast.md`, `AGENTS.md`

- [ ] **Step 1: §5 spec update**

READ `docs/specs/markspec-core-data-model.md` §5 (Round-Trip Invariants). Add a
subsection recording the formal AST-equivalence relation as the normative
round-trip contract: the relation is strict `BodyBlock[]` structural
deep-equality ignoring `range` (implemented in `core/ast/equivalence.ts`); the
formatter contract is `build(format(x)) ≈ normalizeBodyAst(build(x))`; the §5.2
body-internal rewrites are applied via the AST (`normalizeBodyAst`), not
pre-parse string passes. Do not contradict existing §5.1–§5.4; cross-reference
ADR-015.

- [ ] **Step 2: Create ADR-015**

Create `docs/architecture/adr-015-ast-equivalence-formatting-contract.md`
following the existing ADR format (read `adr-014-canonical-body-ast.md` for
structure: Context / Decision / Consequences / Dependencies / Acceptance
criteria / Out of scope). Record: SP3 supersedes ADR-014 Decision-2's
non-total-inverse / safe-conditional-fallback caveat; the byte guard is replaced
by `astEquivalent`; `astEquivalent` is SP1's relation, promoted unchanged, in
`core/ast/equivalence.ts`; the §5.2 body rewrites apply via `normalizeBodyAst`;
the string-keep fallback is retained as a defensive, diagnosed (`MSL-F9xx`),
never-firing path; matrix end-state OK/UNOWNED only; M050/M051 +
multi-item-deflist remain deferred.

- [ ] **Step 3: ADR-014 cross-ref + AGENTS.md index**

In `adr-014-canonical-body-ast.md`, add ONE note under its Decision-2 (or a
"Superseded by" line): "Decision-2's non-total-inverse caveat is retired by
ADR-015 (SP3)." Do not rewrite ADR-014's text otherwise (ADRs are immutable;
this is a forward pointer only). In `AGENTS.md`, add
`- adr-015-ast-equivalence-formatting-contract.md — …` to the ADR index list
(match the existing bullet format).

- [ ] **Step 4: Format-check the docs**

Run:
`cd <worktree> && dprint check docs/specs/markspec-core-data-model.md docs/architecture/adr-015-ast-equivalence-formatting-contract.md docs/architecture/adr-014-canonical-body-ast.md AGENTS.md`
(run `dprint fmt` on any that fail, then re-check). Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add docs/specs/markspec-core-data-model.md docs/architecture/adr-015-ast-equivalence-formatting-contract.md docs/architecture/adr-014-canonical-body-ast.md AGENTS.md
git commit --no-verify -m "wip(spec): §5 contract + ADR-015 (supersedes ADR-014 Decision-2)"
```

---

## Task 9: Strengthen gates, full verify, squash, PR, merge

**Files:** test additions + git/GitHub.

- [ ] **Step 1: Strengthen the equivalence gate (append-only)**

In `tests/e2e/ast_equivalence_test.ts`, append (do not modify existing cases)
edge cases proving canonical forms round-trip: a same-line-marker note, an
inline-markup deflist, a body that was non-canonical pre-format (uppercase
modal) wrapped so the test formats then checks `render(bodyAst) === entry.body`.
Match the file's existing `[label, body]` shape.

- [ ] **Step 2: Strengthen the idempotence corpus**

Add to `packages/markspec/core/formatter/mod_test.ts` an idempotence sweep over
non-canonical inputs (uppercase modals, blank-line runs, same-line marker notes,
deflist with inline markup): for each, assert
`format(format(doc)) === format(doc)` AND the second pass is `changed:false`.

- [ ] **Step 3: Full project gate**

Run, from `<worktree>`: `just check` Expected: exit 0 (deno lint + dprint + full
test suite + type-check, zero warnings). Then
`bash scripts/check_ast_fidelity_matrix.sh; echo exit=$?` → `exit=0`. Then the
docs/product zero-diff check from Task 5 Step 5 again. Any failure that is not a
trivial fix in new code ⇒ STOP / BLOCKED.

- [ ] **Step 4: Commit the strengthening**

```bash
git add tests/e2e/ast_equivalence_test.ts packages/markspec/core/formatter/mod_test.ts
git commit --no-verify -m "wip(repo): strengthen equivalence + idempotence corpora"
```

- [ ] **Step 5: Squash to one Conventional Commit**

```bash
cd <worktree>
git status --porcelain   # expect empty
just check               # expect green
BASE=$(git merge-base origin/main HEAD)
git reset --soft "$BASE"
git commit -F - <<'EOF'
feat(core): AST-equivalence formatting contract — §5.2 via the AST (SP3)

The formatter applies §5.2 body-internal normalizations through the AST:
emitBodyViaAst now emits render(normalizeBodyAst(buildBodyAst(body))),
gated by astEquivalent(buildBodyAst(emitted), canonical) with a loud
diagnosed (MSL-F9xx) never-firing string-keep fallback. The pre-parse
body modal string pass is removed. astEquivalent is ratified into
core/ast/equivalence.ts (SP1's relation, unchanged) and is now the
single source of truth for the formatter guard and the SP1 harness. The
SP2 residuals are closed (renderNote same-line marker; deflist
verbatim-split). The SP1 matrix evolves from build/render to
build/render/format: end-state OK/UNOWNED only, RESIDUAL 0. format
stays idempotent + total; validate path unaffected (MSL-M060 pinned).
§5 records the formal relation; ADR-015 supersedes ADR-014 Decision-2.
M050/M051 + multi-item-deflist remain deferred.

Spec: docs/superpowers/specs/2026-05-18-formatting-fidelity-sp3-design.md
Plan: docs/superpowers/plans/2026-05-18-formatting-fidelity-sp3.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
```

(Use `feat(core)`; `feat(repo)` is also acceptable if the reviewer prefers given
the SP1-asset + docs span. The real squash commit runs the pre-commit hook —
fix + re-squash if the commit-msg lint or any gate rejects.)

- [ ] **Step 6: Push + PR**

```bash
git push -u origin worktree-formatting-fidelity-sp3
gh pr create --title "feat(core): SP3 — AST-equivalence formatting contract (Formatting Fidelity)" --body-file - <<'EOF'
## Summary

SP3 (final Formatting Fidelity sub-project). The formatter applies §5.2
body-internal normalizations through the AST; the byte-identical
`emitBodyViaAst` guard is replaced by the ratified `astEquivalent`
relation (`core/ast/equivalence.ts`, SP1's relation unchanged) with a
loud diagnosed never-firing fallback. SP2 residuals closed (renderNote
same-line marker; deflist verbatim-split). The SP1 matrix evolves to
build/render/**format**: end-state OK/UNOWNED only, RESIDUAL 0.

## Invariants

- `format` idempotent + total; idempotence corpus strengthened.
- `ast_equivalence_test.ts` strengthened, not weakened;
  `format_test.ts` unmodified + green.
- validate path unaffected (MSL-M060 pinned); `normalizeBodyAst` is
  formatter-only.
- `docs/product` entry docs format-idempotent zero-diff.
- M050/M051 + multi-item-deflist deferred (ADR-014 Decision-4).
- ADR-015 supersedes ADR-014 Decision-2 (ADRs immutable — new ADR).

Spec: `docs/superpowers/specs/2026-05-18-formatting-fidelity-sp3-design.md`
Plan: `docs/superpowers/plans/2026-05-18-formatting-fidelity-sp3.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 7: Watch CI to full green, merge**

Run: `gh pr checks <N> --watch --interval 20` (replace `<N>` with the PR
number). Expected: all green incl. CodeQL + the `AST fidelity matrix` staleness
job + Conventional commits. On full green:
`gh pr merge <N> --squash --delete-branch`. If CI fails: fix forward with WIP
commits, re-squash (Step 5), do not weaken any gate.

- [ ] **Step 8: Report + memory**

Report the regenerated matrix headline (RESIDUAL 0), the merge commit, and
confirmation nothing was weakened. Update project memory
(`project_formatting_fidelity_sp1.md` or a new SP3 note): SP3 shipped, the epic
is **complete** (matrix OK/UNOWNED only, surface 0), ADR-015 records the
contract.

---

## Self-Review

**Spec coverage:**

- §2 success (Full §5.2-via-AST, zero residual, bounded) → Tasks 5
  (normalize+guard), 3/4 (residual fixes), 7 (matrix end-state), with
  M050/M051 + multi-item-deflist explicitly out of scope in every task.
- §3 Formalization A (contract
  `build(format(x)) ≈ normalizeBodyAst(
  build(x))`, relation unchanged) → Task
  1 (relation promoted unchanged) + Task 7 Step 1 (classifier OK condition is
  exactly that contract).
- §4 `normalizeBodyAst` (modal §3.4.1 on AST; caption no-op; blank/trim
  emergent; remove pre-AST body modal pass; body-only) → Task 2 + Task 5 Step
  3(b)/(c).
- §5 guard replacement (astEquivalent; SP2 byte-guard invariant lifted; fallback
  retained + diagnosed; idempotence safety net) → Task 5.
- §6 zero-residual fixes (renderNote, deflist) → Tasks 3 + 4.
- §7 ratify + classifier evolution → Tasks 1 + 7.
- §8 §5 spec + new ADR-015 + ADR-014 xref + AGENTS index → Task 8.
- §9 invariants (idempotent+total, gate not weakened, fallback retained,
  relation unchanged, validate unaffected, docs/product zero-diff) → Tasks 5/6/9
  verification steps.
- §10 testing/CI → every task is TDD; Task 9 full gate.
- §11 risks → mitigations embedded as STOP/BLOCKED gates in Tasks 3/5/7.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N".
Integration-heavy steps (renderNote, deflist, emitBodyViaAst, classifier) give
complete failing tests + exact target transformations + an explicit "READ the
current code at <path>" instruction — concrete, not placeholder (same pattern as
the accepted SP2 plan). `MSL-F900` is a concrete proposed code with an explicit
"pick the next free `MSL-F` code by reading the file" instruction.

**Type consistency:** `astEquivalent(a, b)` signature consistent across Tasks
1/5/7. `normalizeBodyAst(blocks): BodyBlock[]` consistent across Tasks 2/5/7.
`NoteNode.markerInline?: boolean` defined in Task 3, consumed by `renderNote` in
the same task. The classifier's evolved `FidelityClass` (`OK|UNOWNED|RESIDUAL`)
defined + consumed within Task 7; Task 9's PR/commit text matches (RESIDUAL 0).
Formatter `diagnostics` threading into `emitBodyViaAst` defined in Task 5 Step
3(a).
