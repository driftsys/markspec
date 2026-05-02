# Entry Model Type-Safety Cleanup

**Date:** 2026-05-02
**Issue:** #215 (partial — type-safety / API hygiene items)
**Scope:** Three mechanical changes to remove transitional optionals and clarify
the Entry model.

## Context

After the ADR-002 v2 rewrite (#198) and the profile system completion (#243),
the Entry model carries two transitional artifacts:

1. `typedAttributes` is marked optional (`?`) even though the parser always
   populates it. Consumers defensively guard with `?? new Map()`.
2. `attributes` and `typedAttributes` are a dual-view of the same data but the
   relationship is undocumented and the naming is ambiguous.
3. `CompileResult.documents` is optional with a comment "Optional during the v2
   migration" — the migration is done.

## Changes

### 1. Make `typedAttributes` required

```typescript
// model/mod.ts — Entry interface
// Before
readonly typedAttributes?: TypedAttributes;

// After
readonly typedAttributes: TypedAttributes;
```

**Consumer impact:** ~4 sites drop `?? new Map()` fallbacks:

- `core/validator/attributes.ts`
- `core/validator/traceability.ts`
- `core/validator/normalize.ts`
- `core/compiler/inverses.ts`

### 2. Rename `attributes` → `rawAttributes`

```typescript
// model/mod.ts — Entry interface
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

**Consumer impact:** rename `.attributes` → `.rawAttributes` in:

| File | Sites |
|------|-------|
| `core/validator/mod.ts` | 4 |
| `core/compiler/mod.ts` | 1 |
| `core/formatter/mod.ts` | 1 |
| `render/typst/template.ts` | 2 |
| `render/includes/mod.ts` | 1 |
| `book/site/mod.ts` | 2 |
| `main.ts` | 1 |
| Test files constructing Entry literals | ~15-20 |

### 3. Make `CompileResult.documents` required

```typescript
// compiler/mod.ts — CompileResult interface
// Before
readonly documents?: ReadonlyMap<string, Document>;

// After
readonly documents: ReadonlyMap<string, Document>;
```

**Consumer impact:** ~9 test literals add `documents: new Map()`.

## Out of scope

- **Split `Entry.id` into typed fields** — YAGNI. Nobody discriminates ULID vs
  URI on `.id` directly; they use `.shape`. The raw string + shape enum is
  already clean.
- **Behavioral changes** — This PR is purely type-level. No assertion changes,
  no new diagnostics, no runtime behavior differences.

## Verification

- `deno check` passes (type errors → compile errors guide the rename)
- `deno test --allow-read --allow-write --allow-run` passes with same results
  as before (659 pass, 2 pre-existing render/typst failures)
- `deno lint` clean

## Estimated size

~150-200 LOC diff across ~25 files. Mechanical rename + optional removal.
