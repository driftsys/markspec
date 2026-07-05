# S10 — uxil LSP: hover, completion, go-to-declaration

Story: [#728](https://github.com/driftsys/markspec/issues/728) · Epic: #717 §B ·
Depends on: S8 (#726, merged), sequenced after S9 (#727, PR #808, merged as
`a2a1240`).

## Goal

LSP affordances over `uxRegistry` for `ux:` references, mirroring the existing
typl LSP surface (`lsp/typl.ts`):

- **hover** on any `ux:` ref → declaration card (kind, verb set, states, owning
  entry, description);
- **completion** after `ux:` → known surface paths;
- **go-to-declaration** from a citation to its declaration.

## Context

S9 (merged) wired the `UXIL-0xx` diagnostics family into `core/mod.ts` (`uxil`
barrel, `uxilDeclaringTypes`, `validateUxilFamily`) and into
`WorkspaceIndex.validateAll`. That family is deliberately **inert** unless a
profile designates a type with `declares: ux-surface` (epic Tier-1 opacity
guarantee — an unrelated `ux:`-looking code span must never draw a diagnostic in
a non-uxil project). This story extends the same inertness contract to the
editor-affordance surface: hover/completion/definition must be silent no-ops
when no declaring type is designated, even though the sibling typl LSP features
never gate on profile state.

Key data model facts (from `core/uxil/registry.ts`, `assemble.ts`,
`grammar.ts`):

- `UxRegistry.surfaces: Map<path, readonly SurfaceRecord[]>` — first declaration
  wins on collision (duplicates are a validator concern, UXIL-015).
- `SurfaceRecord`: `path`, `kind`, `states`, `owningEntryDisplayId`,
  `owningEntryFile`, `elements: UxElement[]`, `location`.
- `UxElement`: `name`, `verbs`, `keyTemplate?`, `navTarget?`, `states`,
  `eventDictionary` (the element bullet's mandatory trailing prose — the closest
  thing to a "description" anywhere in the model; surfaces themselves have no
  description field).
- A `ux:`-prefixed citation is recognized purely by the `ux:` prefix
  (`isUxCitationText`); `parseUxRef` (already exported from `core/uxil`) parses
  a raw string into a `UxRef` (`surface`, `state?`, `element?`, `key?`,
  `verb?`).
- `uxil_family.ts`'s gating pattern: `emittableEntries(entries)` (drops upstream
  — #771 partition) then split by resolved type
  (`entry.type ?? classifyEntry(entry, profile).type`) into declaring/other.
  `buildUxRegistry` is fed **only** the declaring subset.

## Architecture

**New file `packages/markspec/lsp/uxil.ts`** (parallel to `lsp/typl.ts`). Pure,
profile-free functions — take a `UxRegistry` + raw text, never a profile or
`EffectiveProfile`, so they're unit-testable against a hand-built fixture
registry with no parser/profile involved:

- `uxRefTokenAtPosition(line, column): string | undefined` — raw-token scanner
  for the `ux:`-prefixed token under the cursor. Needs its own character class
  (`:/!@{}` in addition to the identifier chars) since the existing
  `ID_CHAR_RE`/`DISPLAY_ID_TOKEN_RE` scanners (hover.ts, rename.ts) don't cover
  those. Returns the cursor's _whole_ token regardless of where inside it the
  cursor sits (mirrors `dollarNameAtPosition`'s full-token scan).
- `isUxRefTrigger(textBefore): boolean` — completion trigger: text before the
  cursor ends in `ux:` or a partial surface path after it, anchored so it can't
  misfire mid-identifier or against unrelated colon contexts (`Type:`,
  `Satisfies:`). Mirrors `isDollarNameTrigger`.
- `resolveUxRef(ref: UxRef, registry: UxRegistry): SurfaceRecord | undefined` —
  looks up `ref.surface.join(".")`, first-declaration-wins.
- `formatUxHoverContent(ref, registry): string | undefined` — Markdown card.
  With `ref.element` set, leads with that element's verb set and
  `eventDictionary` description; always includes the surface's kind, states, and
  owning entry. Returns `undefined` (no hover, not a wrong one) when the
  surface, or a named element/state, isn't found.
- `buildUxCompletionItems(registry, partial): CompletionItemData[]` — flat list
  of known surface paths, server-side prefix-filtered (same pattern as the
  existing `Satisfies:`-style ID-reference completion). No progressive
  completion for `/element`, `@state`, `!verb` segments in this story — scope is
  surface-path-only, matching the issue's "completion after `ux:`" wording and
  typl's single-tier precedent.

**Changed `packages/markspec/lsp/workspace.ts`** — new method:

```ts
getUxRegistry(profile: EffectiveProfile | null): UxRegistry | undefined
```

Returns `undefined` when `uxilDeclaringTypes(profile).size === 0` (the single
gate check, in one place). Otherwise filters
`emittableEntries(this.getAllEntries())` to declaring-type entries (same
partition as `uxil_family.ts`) and calls `buildUxRegistry`. Rebuilt on every
call — no caching — matching the existing `getTypeRegistry()` precedent and its
stated rationale (no stale-cache bugs; fast enough at this scale).

**Changed `packages/markspec/lsp/definition.ts`** — extract
`sourceLocationToLspLocation(loc: SourceLocation): LspLocation` out of the
existing `entryToLspLocation` (which becomes a thin wrapper around it). Reused
for `SurfaceRecord.location` in uxil go-to-declaration. In-place refactor;
`entryToLspLocation`'s behavior is unchanged.

**Changed `packages/markspec/lsp/server.ts`** — one new branch inside each of
the three existing handlers, after the existing source-file doc-comment guard
(so "source-file doc-comment context guarded like typl" is inherited for free,
not re-implemented):

- `onHover`: try `uxRefTokenAtPosition` (after the typl `$Name` and display-ID
  checks). Parse with `parseUxRef`; on a clean parse, resolve against
  `index.getUxRegistry(profile)` and render via `formatUxHoverContent`. A
  registry of `undefined`, a parse failure, or an unresolved ref all fall
  through to `null` — never a raw error surfaced as a tooltip.
- `onCompletion`: new trigger tried among the existing six (`isUxRefTrigger`);
  items from `buildUxCompletionItems`. Empty list (not an error) when the gate
  is closed.
- `onDefinition`: same token/parse/resolve path as hover; on a match, convert
  `SurfaceRecord.location` via `sourceLocationToLspLocation`. No find-references
  or rename for uxil in this story — out of scope per the issue's acceptance
  criteria.

## Edge cases

- **Duplicate surface declarations** (UXIL-015): first-declaration-wins, same
  convention as the validator — hover/definition land on the first declared
  site.
- **Ref names a nonexistent element/state**: no hover, not a partially-filled
  card.
- **Corpus/upstream-owned surfaces**: `getUxRegistry` builds from
  `emittableEntries` (upstream already excluded), so every `SurfaceRecord`
  reachable here is locally navigable — no `hasNavigableLocation`-style guard is
  needed for the uxil definition path, unlike the general Entry-based one.
- **Trigger collisions**: `isUxRefTrigger` and `uxRefTokenAtPosition` are
  anchored on the literal `ux:` prefix, so they cannot fire on unrelated colon
  contexts or mid-identifier.

## Testing

New `lsp/uxil_test.ts`, hand-built `UxRegistry` fixtures, no parser/profile
involved:

- `uxRefTokenAtPosition`: cursor at start/middle/end of a token, adjacent prose,
  bare `ux:`.
- `isUxRefTrigger`: positive and negative cases (mid-word, `Type:`-style false
  positives).
- `formatUxHoverContent`: surface-only ref, element ref, unknown surface,
  unknown element/state, duplicate-declaration first-wins.
- `buildUxCompletionItems`: prefix filtering, empty registry.

Extended existing tests:

- `lsp/workspace_test.ts`: `getUxRegistry` returns `undefined` with no declaring
  type, returns a populated registry when the gate is open, excludes upstream
  entries.
- `lsp/definition_test.ts` (or wherever `entryToLspLocation` lives): the
  extracted `sourceLocationToLspLocation` helper, plus confirming
  `entryToLspLocation`'s existing behavior is unchanged.

No e2e/blackbox test — this story doesn't touch the CLI; unit coverage matches
the established typl LSP precedent.

## Alternatives considered

- **Registry/gate integration point** — considered inlining the filter-and-build
  logic at each of the three `server.ts` call sites (rejected: triplicates ~8
  lines and leaks core internals into server.ts), and caching the registry on
  `WorkspaceIndex` with invalidation on file/profile change (rejected:
  `getTypeRegistry()`'s own doc comment explicitly argues against this for typl
  at the current scale — no evidence uxil needs it either, and it adds
  invalidation surface for no measured gain). Chose a single
  `getUxRegistry(profile)` method, matching the `getTypeRegistry()` shape.
- **LSP profile gating** — considered leaving hover/completion/ definition
  always-active like typl's `$Name` handling (rejected: a `ux:`-looking token in
  a non-uxil project would get spurious LSP treatment, breaking the epic's
  stated Tier-1 opacity guarantee that S9 already established for diagnostics).
- **Completion scope** — considered progressive, segment-aware completion
  (triggering after `/`, `@`, `!` for element/state/verb suggestions) (deferred:
  meaningfully larger surface — more trigger regexes, more edge cases — than the
  issue's "completion after `ux:`" wording calls for; can be a follow-up story
  if wanted).
- **Sequencing vs. #808** — considered branching S10 off the
  `story/727-uxil-diagnostics` branch before it merged, or building
  independently against `main` with a duplicated gate check (rejected both:
  waited for #808 to merge to `main` first, avoiding a rebase and avoiding
  duplicating `uxilDeclaringTypes`/the `core/mod.ts` barrel export). #808 merged
  as `a2a1240` before this story's worktree was created.
