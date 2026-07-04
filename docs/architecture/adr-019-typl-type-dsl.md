# ADR-019 — typl: Type Specification DSL

**Status:** Accepted **Date:** 2026-05-25 **Supersedes:** — **Related:** ADR-016
(body-token AST)

## Context

MarkSpec entries reference `$Name` identifiers via ADR-016's body-token
extractor, but the language has no way to declare their kind or shape. This
blocks LSP affordances, cross-entry collision detection, and downstream codegen
(the planned RIDL bridge).

## Decision

Introduce **typl**, a small Markdown-embedded DSL with two statement forms:

- `$X : [kind] shape` — binding (kind defaults to `value`)
- `type X = shape` — typedef

Closed kind vocabulary (9): `value`, `event`, `signal`, `command`, `state`,
`const`, `config`, `document`, `stream`.

Three Markdown surfaces (fence, bullet glossary, inline backtick) all parse to
the same Schema AST. Entry-local scope for v1; profile / file scope deferred to
v2.

## Consequences

- New module `packages/markspec/core/typl/` with self-contained parser and AST.
- `Entry` model gains `types?: { bindings, typedefs }` field (added in PR 3).
- Compile output gains per-entry `types` + corpus-level `typeRegistry` (PRs 3
  and 6).
- 8 new diagnostic codes `TYPL-001..008`.
- LSP layers hover / completion / diagnostics over the registry (PR 7).
- Downstream RIDL emitters consume the corpus registry.

## Alternatives considered

- Inline-only declaration at first mention — rejected for prose readability
  hazard.
- GFM bindings table as a primary surface — rejected because literal `|` in
  unions breaks tables and dprint cannot preserve def-list line structure.
- Required named types (RIDL-style) — deferred to a strict-mode profile setting
  in v2.

## Implementation status

All eight implementation slices are merged:

- Parser (`core/typl/`) — lexer, grammar, AST, diagnostics, validator
- Three Markdown surfaces (fence, bullet glossary, inline) populating
  `Entry.types`
- Cross-entry validation and corpus `typeRegistry` in compile output
- LSP hover, completion, and diagnostic reporting over the registry
- Language reference, user guide, and example showcase in `docs/`

## See also

- Design history: brainstorming output (not in repo — local design folder).
- [Language reference: typl](../spec/language/typl.md)
- [Guide: Using typl in your entries](../guide/typl.md)

## Addendum: published tier (#723, 2026-07-04)

S5 of the uxil epic (#717) added a **published** tier beside the entry-local
tier this ADR defines. Dots discriminate: `$name` stays entry-local (unchanged);
`$a.b`-style dotted names (≥ 2 segments) are **published** — declared exactly
once corpus-wide, citable from any entry. An explicit `: namespace` kind clause
establishes a base; a namespace declaration is scaffolding, not a symbol, so it
is exempt from the declared-once rule and the same namespace may serve as root
in more than one entry (e.g. a large contract split across files) — only leaf
bindings are declared exactly once. Relative refs keep the sigil with a leading
dot (`$.name`) and resolve through the entry-local base-resolution engine
(`core/decl/resolve.ts`, innermost base wins; at most one root namespace per
entry). Citations — bare published-shaped code spans — are validated against the
corpus registry. New diagnostics: TYPL-009 (duplicate published declaration),
TYPL-010 (relative ref without base), TYPL-011 (undeclared citation), TYPL-012
(multiple roots). TYPL-002/003 are **retired** (deprecated, never emitted):
plain names are entry-local, so cross-entry pairwise consistency no longer
applies. `CORE_SCHEMA_VERSION` unchanged.

Full design record: `docs/wip/2026-07-04-typl-published-tier-design.md`
(gardened to `docs/archive/` when this branch lands). The complete namespacing
rewrite of this ADR plus guide chapter is story #730.

## Addendum: table surface (#724, 2026-07-05)

S6 of the uxil epic (#717) adds a **fourth** Markdown surface: a GFM table. Each
data row `$name | kind shape | description` is one binding — the first two cells
are read positionally (the description column and any further columns are
documentation), rows whose first cell is not a `$Name` are skipped, and only
bindings (not typedefs) are expressed this way. Like its siblings it is a thin
adapter (`core/typl/table.ts`) over the shared declaration machinery
(`core/decl/table.ts`, S3): the row recognizer reconstructs a
`$name : kind
shape` source that `parseTyplBlock` parses, so a table row yields
the identical `Binding` as the fence, bullet, or inline form.

A table's `Table:` caption may carry a published base (an absolute `$a.b` name);
the table's relative rows (`$.x`) resolve against that caption base first, then
the entry root, through the entry-local base-resolution engine (#722 rule 3).
The caption base is not a root declaration and never sets `rootNamespace`.

This revisits the "GFM bindings table … rejected" alternative above. Two things
changed since 2026-05-25: a shape carrying `|` (a union or enum) is authored
with the standard GFM `\|` escape — the cell un-escapes before typl parses it —
and ADR-029's whole-document dprint pass preserves table line structure. The
table is therefore offered as an _additional_ surface, not the primary one;
dense or `|`-heavy declarations still read best in a fence.
`CORE_SCHEMA_VERSION` unchanged.
