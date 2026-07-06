# ADR-034 — uxil: UX Interaction DSL

**Status:** Accepted **Date:** 2026-07-06 **Supersedes:** — **Related:** ADR-019
(typl: Type Specification DSL), ADR-009 (Core / Profile Boundary)

Shipped in epic #717 across ten stories (#719–#728); story #729 (S11, payload
bridge) deferred/parked.

## Context

Automotive HMI teams already have a deployed `screenId/elementId[:itemKey]`
identity convention, shared by UI Automator / Compose / Espresso selectors and
OTel-aligned analytics. Nothing in that convention _declares_ which ids exist or
what each element affords, so specs, tests, journeys, and telemetry cannot be
validated against the actual UI surface. typl (ADR-019) proved the declaration +
registry + diagnostics pattern for typed data identifiers; uxil is its sibling
for UI/HMI interaction surfaces.

## Decision

Introduce **uxil**, a small Markdown-embedded DSL for declaring UI/HMI
interaction surfaces and validating references to them.

### 1. Reference grammar

A uxil reference is a `ux:` URI, scheme-optional: the bare wire form
`media.home/play` parses identically to `ux:media.home/play`, differing only in
the `hasScheme` flag on the parsed node. This scheme-optional equivalence is a
wire-compatibility contract — analytics events and test selectors that carry the
bare form resolve the same as an explicitly-scoped `ux:` citation. The grammar
module is `core/uxil/grammar.ts` (`parseUxRef`).

### 2. Three declaration forms

`core/uxil/ast.ts` defines three authored declaration shapes:

- **Root** — `` `ux:surface : kind @state, state, …` ``. Exactly one root
  declaration per declaring entry, enforced at assembly time.
- **Element bullet** —
  `` `/element : verb[, verb…] [: {key}] [@state, …] [-> nav-ref]` ``, followed
  by a trailing prose event dictionary — the paragraph text after the leading
  code span.
- **Child-surface bullet** — `` `.path @state` ``. Its nested bullets are its
  elements.

### 3. Two closed, core-owned vocabularies

`core/uxil/vocab.ts` fixes both vocabularies. Extension is a markspec release
decision, per ADR-009 — not a profile concern.

Three surface kinds:

| Kind     | Navigable | Stateful | Visual |
| -------- | --------- | -------- | ------ |
| `screen` | yes       | yes      | yes    |
| `panel`  | no        | no       | yes    |
| `agent`  | no        | yes      | no     |

Eleven interaction verbs:

| Verb       | Requires nav target | Exclusive |
| ---------- | ------------------- | --------- |
| `activate` | no                  | no        |
| `toggle`   | no                  | no        |
| `select`   | no                  | no        |
| `adjust`   | no                  | no        |
| `input`    | no                  | no        |
| `scroll`   | no                  | no        |
| `drag`     | no                  | no        |
| `navigate` | yes                 | no        |
| `dismiss`  | no                  | no        |
| `ask`      | no                  | no        |
| `observe`  | no                  | yes       |

`navigate` is the only verb requiring a nav target; `observe` is exclusive — it
cannot combine with other verbs on the same element.

### 4. Base resolution

uxil reuses the shared, DSL-agnostic `core/decl/resolve.ts` engine
(innermost-base-wins) that also backs typl's published tier. uxil's
child-surface joins are always relative — there is no absolute internal path
form — which is simpler than typl's absolute/relative duality.

### 5. Corpus registry + machine projection

`buildUxRegistry` (`core/uxil/registry.ts`) indexes every declared surface by
absolute path. Duplicates are NOT collapsed — they are surfaced via UXIL-015.
`projectUxRegistry` (`core/uxil/projection.ts`) produces a deterministic,
JSON-serialisable `UxProjection`: surfaces sorted by id, elements sorted by
name, states sorted, verbs kept in declaration order.

### 6. Diagnostics

The 26-code `UXIL-0xx` family (`core/uxil/diagnostics.ts`) is documented in full
in the spec chapter. This ADR does not repeat the catalogue table — see
[Language reference: uxil](../spec/extensions/uxil.md).

### 7. Activation

uxil is profile-gated via `declares: ux-surface` on a type. Absent from the
active profile chain, uxil-looking content stays inert and opaque, drawing no
diagnostics — the Tier-1 stability guarantee (S1 #719).

### 8. LSP

Hover, completion, and go-to-declaration operate over the registry (S10 #728).

## Consequences

- New standalone module `core/uxil/` mirroring `core/typl/` module-for-module:
  `ast.ts`, `lexer.ts`, `grammar.ts`, `recognize.ts`, `diagnostics.ts`,
  `surfaces.ts`, `assemble.ts`, `registry.ts`, `citations.ts`, `validator.ts`,
  `projection.ts`, `mod.ts`.
- **No `Entry` model change.** This is a deliberate contrast with typl, which
  added `Entry.types`: uxil declarations are parsed fresh from code
  spans/bullets on every `assembleUxSurface` call, never persisted on the
  `Entry`. No `CORE_SCHEMA_VERSION` bump.
- `core/validator/uxil_family.ts` wires the diagnostics family into
  `check`/`compile`/LSP, gated on the same `declares: ux-surface` profile
  designation.

## Alternatives considered

- _Reuse typl's DSL for uxil_ — rejected: different concern (typed data
  identifiers vs. UI/HMI interaction surfaces) and a different vocabulary shape
  (kind+verb+state vs. kind+shape) that doesn't map cleanly onto typl's grammar.
- _Add uxil declarations as an `Entry` field_ (typl's approach) — rejected: no
  consumer needs entry-level typed access to a surface tree; the corpus
  registry/projection built at compile/LSP time is sufficient, and staying off
  the `Entry` model avoids a schema bump.

## Deferred

S11 payload bridge (#729, parked 2026-07-06). Zero code was written. Settled
syntax, if/when built: an optional `$dotted.name` clause inside the element code
span, e.g. `` `/favorite_toggle : toggle : {track_id} $media.favorite_event` ``.

Revisit triggers (verbatim from #729's parking rationale):

1. A concrete downstream surface needs a published-typl payload beyond its
   verb's canonical shape.
2. The log-validator/codegen/analytics-manifest consumer lands.
3. Canonical verb payload shapes (a `payload` column on `VerbInfo`) get
   implemented.

## Implementation status

All ten shipped stories:

- S1 #719 — PR #734
- S2 #720 — PR #736
- S3 #721 — PR #738
- S4 #722 — PR #737
- S5 #723 — PR #749
- S6 #724 — PR #772
- S7 #725 — PR #779
- S8 #726 — PR #803
- S9 #727 — PR #808
- S10 #728 — PR #810

S11 (#729) deferred — no PR.

## See also

- [ADR-019 — typl: Type Specification DSL](adr-019-typl-type-dsl.md)
- [ADR-009 — Core / Profile Boundary](adr-009-core-profile-boundary.md)
- [Language reference: uxil](../spec/extensions/uxil.md)
- [Guide: Using uxil in your entries](../guide/uxil.md)
