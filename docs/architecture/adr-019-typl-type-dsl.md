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

## See also

- Design history: brainstorming output (not in repo — local design folder).
- Plan: PR series of 8 incremental slices; PR 1 (this) ships the pure parser.
