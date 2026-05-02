# Entry Model Type-Safety Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove transitional optionals and clarify the dual-view relationship
in the Entry model.

**Architecture:** Three independent type-level changes to `Entry` and
`CompileResult`. No behavioral changes — purely mechanical rename and optional
removal. `deno check` guides all changes (compiler errors show exactly what to
fix).

**Tech Stack:** Deno/TypeScript, no new dependencies.

**Worktree:** `/Users/sebastientasson/Workspace/driftsys/markspec-entry-model`
**Branch:** `refactor/entry-model-type-safety` **Base SHA:** `b6cb772` (main)

---

### Task 1: Make `typedAttributes` required

**Files:**

- Modify: `packages/markspec/core/model/mod.ts` (line ~253)
- Modify: `packages/markspec/core/validator/attributes.ts` (line ~142)
- Modify: `packages/markspec/core/validator/traceability.ts` (line ~101)
- Modify: `packages/markspec/core/validator/normalize.ts` (lines ~29, ~35)
- Modify: `packages/markspec/core/compiler/inverses.ts` (lines ~69, ~77, ~111,
  ~117)

- [ ] **Step 1: Change the type in model/mod.ts**

In `packages/markspec/core/model/mod.ts`, change the `typedAttributes` field
from optional to required:

```typescript
// Before
readonly typedAttributes?: TypedAttributes;

// After
readonly typedAttributes: TypedAttributes;
```

- [ ] **Step 2: Run `deno check` to find all errors**

Run:
`deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts`

Expected: Compile errors at sites using `?? new Map()` on `typedAttributes`
(since TypeScript now knows it's always defined, the fallback is unnecessary but
not an error) and possibly at test files constructing Entry objects without the
field. The actual errors will be in test files that construct partial Entry
literals without `typedAttributes`.

- [ ] **Step 3: Fix validator/attributes.ts**

In `packages/markspec/core/validator/attributes.ts`, find:

```typescript
const typed = entry.typedAttributes ?? new Map();
```

Replace with:

```typescript
const typed = entry.typedAttributes;
```

- [ ] **Step 4: Fix validator/traceability.ts**

In `packages/markspec/core/validator/traceability.ts`, find:

```typescript
const typed = entry.typedAttributes ?? new Map();
```

Replace with:

```typescript
const typed = entry.typedAttributes;
```

- [ ] **Step 5: Fix validator/normalize.ts**

In `packages/markspec/core/validator/normalize.ts`, find any `?? new Map()`
guard on `typedAttributes` and remove the fallback. Also remove any
`if (entry.typedAttributes === undefined)` early return — instead, check
`.size === 0` if the guard is needed.

- [ ] **Step 6: Fix compiler/inverses.ts**

In `packages/markspec/core/compiler/inverses.ts`, find all
`entry.typedAttributes ?? new Map()` or optional chaining on `typedAttributes`
and simplify to direct access.

- [ ] **Step 7: Fix test Entry literals**

Search all test files for Entry literal objects that omit `typedAttributes`. Add
`typedAttributes: new Map()` to each. Use `deno check` output to find them.

Common locations:

- `packages/markspec/core/validator/mod_test.ts`
- `packages/markspec/core/validator/attributes_test.ts`
- `packages/markspec/core/validator/traceability_test.ts`
- `packages/markspec/core/validator/normalize_test.ts`
- `packages/markspec/core/compiler/inverses_test.ts` (if exists)
- `packages/markspec/lsp/workspace_test.ts`

- [ ] **Step 8: Run `deno check` — verify no type errors**

Run:
`deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts`

Expected: Clean (0 errors).

- [ ] **Step 9: Run tests**

Run: `deno test --allow-read --allow-write --allow-run`

Expected: 659+ pass, only 2 pre-existing render/typst failures.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(core): make Entry.typedAttributes required"
```

Commit scope: `core`. Message explains that the parser always populates it and
the optional was a transitional artifact.

---

### Task 2: Make `CompileResult.documents` required

**Files:**

- Modify: `packages/markspec/core/compiler/mod.ts` (line ~44)
- Modify: `packages/markspec/core/mod_test.ts` (lines ~148, ~160)
- Modify: `packages/markspec/core/compiler/schema_test.ts` (lines ~37, ~64, ~91,
  ~109)
- Modify: `packages/markspec/render/styles/mod_test.ts` (line ~26)
- Modify: `packages/markspec/render/includes/mod_test.ts` (line ~30)
- Modify: `packages/markspec/render/mustache/mod_test.ts` (line ~46)
- Modify: `packages/markspec/render/mod_test.ts` (line ~6)

- [ ] **Step 1: Change the type in compiler/mod.ts**

In `packages/markspec/core/compiler/mod.ts`, find the `CompileResult` interface.
Change `documents` from optional to required:

```typescript
// Before
readonly documents?: ReadonlyMap<string, Document>;

// After
readonly documents: ReadonlyMap<string, Document>;
```

Also remove any "Optional during the v2 migration" comment.

- [ ] **Step 2: Run `deno check` to find all errors**

Run:
`deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts`

Expected: Errors in test files constructing `CompileResult` literals without
`documents`.

- [ ] **Step 3: Fix all test literals**

Add `documents: new Map()` to every `CompileResult` literal that omits it. Use
the `deno check` error output as the authoritative list. Expected ~9 sites
across 6 test files.

Example fix:

```typescript
// Before
const result: CompileResult = {
  entries: new Map(),
  links: [],
  forward: new Map(),
  reverse: new Map(),
  diagnostics: [],
};

// After
const result: CompileResult = {
  entries: new Map(),
  links: [],
  forward: new Map(),
  reverse: new Map(),
  documents: new Map(),
  diagnostics: [],
};
```

- [ ] **Step 4: Also fix any consumer that guards with `?.` or `?? new Map()`**

Search for `result.documents?.` or `result.documents ??` in the codebase and
simplify to direct access.

- [ ] **Step 5: Run `deno check` — verify no type errors**

Run:
`deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts`

Expected: Clean (0 errors).

- [ ] **Step 6: Run tests**

Run: `deno test --allow-read --allow-write --allow-run`

Expected: Same pass/fail count as Task 1.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): make CompileResult.documents required"
```

---

### Task 3: Rename `attributes` → `rawAttributes`

**Files:**

- Modify: `packages/markspec/core/model/mod.ts` (Entry interface, line ~244)
- Modify: `packages/markspec/core/parser/markdown.ts` (entry construction,
  ~line 248)
- Modify: `packages/markspec/core/parser/source.ts` (entry construction)
- Modify: `packages/markspec/core/validator/mod.ts` (~4 sites)
- Modify: `packages/markspec/core/compiler/mod.ts` (~1 site)
- Modify: `packages/markspec/core/formatter/mod.ts` (~1 site)
- Modify: `packages/markspec/render/typst/template.ts` (~2 sites)
- Modify: `packages/markspec/render/includes/mod.ts` (~1 site)
- Modify: `packages/markspec/book/site/mod.ts` (~2 sites)
- Modify: `packages/markspec/main.ts` (~1 site)
- Modify: All test files constructing Entry objects (~15-20 files)

- [ ] **Step 1: Rename in model/mod.ts with doc comment**

In `packages/markspec/core/model/mod.ts`, find the `attributes` field in the
`Entry` interface:

```typescript
// Before
readonly attributes: readonly Attribute[];

// After
/**
 * Source-order raw attribute array. Used by the formatter for round-trip
 * fidelity (preserving key casing, line order, and trailing backslashes).
 * For lookup-oriented access, use `typedAttributes` — the collated,
 * CSV-split Map view of the same data.
 */
readonly rawAttributes: readonly Attribute[];
```

- [ ] **Step 2: Run `deno check` to get the full error list**

Run:
`deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts`

Expected: Many errors — every `.attributes` access on an Entry object will fail.
Use this output as the exhaustive TODO list.

- [ ] **Step 3: Fix parser/markdown.ts**

In the entry construction literal (around line 248), rename:

```typescript
// Before
attributes,

// After
rawAttributes: attributes,
```

(The local variable `attributes` can keep its name — it's the field name on
Entry that changes.)

- [ ] **Step 4: Fix parser/source.ts**

Same pattern as Step 3 — find the entry construction literal and rename the
field.

- [ ] **Step 5: Fix core/validator/mod.ts**

Find all `entry.attributes` references (expect ~4 sites) and rename to
`entry.rawAttributes`. For example:

```typescript
// Before
const idAttrs = entry.attributes.filter((a) => a.key === IDENTITY_KEY);

// After
const idAttrs = entry.rawAttributes.filter((a) => a.key === IDENTITY_KEY);
```

- [ ] **Step 6: Fix core/compiler/mod.ts**

Find `entry.attributes` in `extractLinks()` or similar and rename to
`entry.rawAttributes`.

- [ ] **Step 7: Fix core/formatter/mod.ts**

Find the spread `[...entry.attributes]` and rename to
`[...entry.rawAttributes]`.

- [ ] **Step 8: Fix render/ consumers**

- `render/typst/template.ts`: ~2 sites (`.find()` and `.filter()` for Labels)
- `render/includes/mod.ts`: ~1 site (serialization)

Rename all `.attributes` → `.rawAttributes`.

- [ ] **Step 9: Fix book/site/mod.ts**

~2 sites — `.find()` and `.filter()` patterns. Rename to `.rawAttributes`.

- [ ] **Step 10: Fix main.ts**

~1 site in the `show` command output loop. Rename to `.rawAttributes`.

- [ ] **Step 11: Fix ALL test files**

Use `deno check` output to find every remaining error. These will be Entry
literal constructions in test files. Replace `attributes:` with `rawAttributes:`
in each.

Expected files (non-exhaustive — use `deno check` as authoritative):

- `packages/markspec/core/parser/markdown_test.ts`
- `packages/markspec/core/parser/attributes_test.ts`
- `packages/markspec/core/parser/source_test.ts`
- `packages/markspec/core/validator/mod_test.ts`
- `packages/markspec/core/validator/attributes_test.ts`
- `packages/markspec/core/validator/traceability_test.ts`
- `packages/markspec/core/validator/normalize_test.ts`
- `packages/markspec/core/validator/types_test.ts`
- `packages/markspec/core/compiler/mod_test.ts`
- `packages/markspec/core/compiler/inverses_test.ts`
- `packages/markspec/core/compiler/link_target_test.ts`
- `packages/markspec/core/mod_test.ts`
- `packages/markspec/render/styles/mod_test.ts`
- `packages/markspec/render/includes/mod_test.ts`
- `packages/markspec/render/mustache/mod_test.ts`
- `packages/markspec/render/mod_test.ts`
- `packages/markspec/lsp/workspace_test.ts`
- `tests/e2e/` files (if they construct Entry objects — unlikely since E2E tests
  are blackbox)

- [ ] **Step 12: Run `deno check` — verify zero type errors**

Run:
`deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts`

Expected: Clean (0 errors).

- [ ] **Step 13: Run `deno lint`**

Run: `deno lint`

Expected: Clean (0 warnings).

- [ ] **Step 14: Run tests**

Run: `deno test --allow-read --allow-write --allow-run`

Expected: Same pass/fail count as before. Zero assertion failures — only field
names changed, not values.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "refactor(core): rename Entry.attributes to rawAttributes

Clarifies that rawAttributes is the source-order array used by the formatter
for round-trip fidelity, while typedAttributes is the collated Map for
lookup-oriented access. Both are views of the same data."
```

---

### Task 4: Final verification

- [ ] **Step 1: Run full check + test + lint**

```bash
just build
```

Or if `just` is not available:

```bash
deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts && deno lint && deno test --allow-read --allow-write --allow-run
```

Expected: type-check clean, lint clean, 659+ tests pass (only 2 pre-existing
render/typst failures).

- [ ] **Step 2: Review git log**

```bash
git log --oneline main..HEAD
```

Expected 3 commits:

```
<sha> refactor(core): rename Entry.attributes to rawAttributes
<sha> refactor(core): make CompileResult.documents required
<sha> refactor(core): make Entry.typedAttributes required
```

(Plus the spec commit at the bottom.)
