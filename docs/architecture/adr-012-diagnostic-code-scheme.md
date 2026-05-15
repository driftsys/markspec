# ADR-012: Diagnostic-Code Scheme — Phased Adoption of the Nextgen Catalogue

## Context

A two-reviewer audit of the Prompt-1 slice reported the validator as "spec
half-implemented": ~26 of ~50 diagnostic codes present, organised under "legacy"
prefixes (`MSL-R*`, `MSL-T*`) rather than the categories the reviewers expected
(`MSL-P` parse, `MSL-I` identity, `MSL-M` markers, `MSL-F` format reports).

That finding rests on a spec mismatch, not a code defect:

- **What `main` ships.**
  [`docs/spec/language/language.md` §8](../spec/language/language.md) is the
  authoritative diagnostic contract for every released binary. It defines the
  `MSL-R` (entry format), `MSL-T` (traceability), `MSL-M` (Mustache), `MSL-D`
  (document), `MSL-G` (glossary), `MSL-S` (summary) scheme and **explicitly
  enumerates** `MSL-R003`–`R006`, `MSL-T001/T004/T005/T012`, and the rest as the
  canonical codes. The validator on `main` conforms to this spec. These are not
  "legacy, not-in-spec" codes — they _are_ the spec.
- **What the reviewers graded against.** The `MSL-P/I/M/F` ~50-code catalogue is
  part of the **nextgen** information-and-traceability redesign (ADR-003 on the
  `nextgen` planning branch). It is a _future_ contract, not the one `main`
  ships.
- **Why the distinction has teeth.** Code names are a public interface:
  in-document suppression comments (`<!-- markspec:disable MSL-R011 -->`), CI
  configuration, snapshot tests, and downstream consumers (e.g. `refhub`) all
  reference codes by name. Renaming them is a breaking change — the reviewers
  said as much.

The decision required: which scheme is authoritative for `main`, and when does
the nextgen scheme land. Until this is recorded, every new validator slice
accretes ambiguity about which code namespace it should emit into, and the
review's largest section cannot be closed.

## Decision

1. **The current scheme remains authoritative for `main`.** The `language.md` §8
   scheme (`MSL-R/T/M/D/G/S`) is the diagnostic contract for `main` and all
   releases. The validator continues to emit it unchanged. No renumbering
   happens as part of Prompt-1 or any slice that precedes the migration phase
   defined below.

2. **The nextgen catalogue is the committed destination.** The `MSL-P/I/M/F`
   scheme from the nextgen ADR-003 information & traceability model is the
   long-term target. This is a commitment, not an open option — `main` _will_
   migrate to it.

3. **Migration is a dedicated, sequenced future phase.** The renumbering is out
   of scope for Prompt-1. It is gated behind, and sequenced after: (a) the
   nextgen core model landing on `main`, and (b) the body-AST refactor (several
   target codes — `MSL-B044`, `MSL-M050/M051`, `MSL-C072` — are structurally
   impossible without it). A follow-up ADR will specify the migration when those
   gates clear.

4. **Forward-compatibility is reserved, not yet specified.** The migration ADR
   will ship a code alias/mapping table (old → new) and a dual-emit deprecation
   window so suppression comments, CI rules, and downstream consumers migrate
   without breakage. The _direction_ (current → nextgen) is fixed here; the
   exact mapping is deferred to that ADR to avoid re-litigating it.

5. **Review findings reclassified.** The Prompt-1 audit findings "spec-code
   coverage MSL-P/I/M/F (26/50)" and "legacy lint-code policy undecided" are
   **deferred-by-policy**, not Prompt-1 defects. The validator conforms to the
   spec `main` ships. This ADR closes the review's lint-code gate.

## Consequences

### What this ADR enables

- The Prompt-1 review's largest section is correctly resolved: the validator is
  spec-conformant; the broader catalogue is planned, not missing.
- New validator slices have an unambiguous rule: emit into the `language.md` §8
  scheme. No code accretes into a half-defined namespace.
- The breaking migration is acknowledged and sequenced rather than done ad hoc
  under review pressure.

### What shifts for existing code (not yet implemented)

- Nothing changes in shipped code. This is a recorded decision with zero code
  delta.
- The future migration phase inherits a defined obligation: an alias table, a
  dual-emit deprecation window, and downstream-consumer migration notes.

### Trade-offs accepted

- `main` and the nextgen design carry **different** code schemes until the
  migration phase. Contributors must consult `language.md` §8 — not the nextgen
  ADRs — for the codes `main` emits today.
- Closing the gate by decision (not by implementing the 24 absent codes now)
  means the reviewers' raw "26/50" number stands until migration — but it is
  correctly framed as deferred scope, not debt.

## Dependencies

- [`docs/spec/language/language.md` §8](../spec/language/language.md) — the
  authoritative scheme this ADR ratifies for `main`.
- Nextgen ADR-003 (information & traceability model, `nextgen` branch) — defines
  the destination catalogue.
- Body-AST refactor (Prompt-1 review "Path A") — a gate for the migration phase;
  several target codes depend on it.
- A future migration ADR — will specify the alias table, dual-emit window, and
  cutover.

## Acceptance criteria

- This ADR is merged to `main`.
- The Prompt-1 review's lint-code-policy gate is recorded as closed by decision;
  its MSL-P/I/M/F coverage findings are annotated deferred-by-policy.
- No validator/code change accompanies this ADR.
- The AGENTS.md ADR index lists ADR-012.

## Out of scope (future work)

- The actual code renumbering / migration implementation.
- The contents of the old → new alias/mapping table.
- The dual-emit deprecation-window mechanism and its duration.
- Downstream-consumer (suppression comments, CI, `refhub`) migration tooling.
