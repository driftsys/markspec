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

Closed kind vocabulary (10): `value`, `event`, `signal`, `command`, `state`,
`const`, `config`, `document`, `stream`, `namespace`. `namespace` is
scaffolding, not a symbol: it carries no shape and declares a base path that
relative references resolve against. It is exempt from the declared-once rule —
the same namespace may serve as root in more than one entry (e.g. a contract
split across files).

Two scopes. **Entry-local** (a bare `$Name`) stays scoped to its own entry — two
entries each declaring `$Speed` are independent symbols. **Published** (a dotted
`$a.b.c` binding, ≥2 segments) is a corpus-wide symbol, declared exactly once
and citable from any entry. A `: namespace` declaration establishes the base a
relative `$.name` reference resolves against (innermost enclosing namespace
wins, falling back to the entry's root namespace) via the shared
`core/decl/resolve.ts` engine. An entry may have at most one root namespace.
Profile / file scope beyond these two remains deferred to v2.

Four Markdown surfaces (fence, bullet glossary, inline backtick, GFM table) all
parse to the same Schema AST. The table surface reads a GFM table row
`$name | kind shape | description` as one binding: the row recognizer
reconstructs a `$name : kind shape` source string that the same `parseTyplBlock`
parses. A shape containing `|` must escape each pipe as `\|`. A `Table:` caption
may carry a published base that scopes the table's relative rows.

## Consequences

- New module `packages/markspec/core/typl/` with self-contained parser and AST.
- `Entry` model gains `types?: { bindings, typedefs }` field (added in PR 3).
- Compile output gains per-entry `types` + corpus-level `typeRegistry` (PRs 3
  and 6).
- 12 diagnostic codes `TYPL-001..012`: `TYPL-009` (duplicate published
  declaration), `TYPL-010` (relative reference with no base), `TYPL-011`
  (citation of an undeclared published symbol), `TYPL-012` (multiple root
  namespaces).
- LSP layers hover / completion / diagnostics over the registry (PR 7).
- Downstream RIDL emitters consume the corpus registry.

## Alternatives considered

- Inline-only declaration at first mention — rejected for prose readability
  hazard.
- GFM bindings table as a primary surface — rejected because literal `|` in
  unions breaks tables and dprint cannot preserve def-list line structure.
  **Reversed** by the table surface (#724): two things changed since this
  2026-05-25 decision — a shape carrying `|` is now authored with the standard
  GFM `\|` escape (the cell un-escapes before typl parses it), and ADR-029's
  whole-document dprint pass now preserves table line structure. The table is
  offered as an _additional_ surface, not the primary one.
- Required named types (RIDL-style) — deferred to a strict-mode profile setting
  in v2.

## Implementation status

All implementation slices are merged, spanning both tiers (entry-local,
published) and all four Markdown surfaces (fence, bullet glossary, inline
backtick, GFM table):

- Parser (`core/typl/`) — lexer, grammar, AST, diagnostics, validator
- Four Markdown surfaces (fence, bullet glossary, inline, table) populating
  `Entry.types`
- Cross-entry validation and corpus `typeRegistry` in compile output
- LSP hover, completion, and diagnostic reporting over the registry
- Language reference, user guide, and example showcase in `docs/`

`TYPL-002`/`TYPL-003` are retired — deprecated, never emitted. Under the
published tier, two entries declaring the same plain `$Name` are independent
entry-local symbols, so there is no cross-entry consistency rule for plain
names; corpus-wide agreement is enforced only for published (dotted) symbols,
via `TYPL-009`.

## See also

- Design history: brainstorming output (not in repo — local design folder).
- [Language reference: typl](../spec/language/typl.md)
- [Guide: Using typl in your entries](../guide/typl.md)
