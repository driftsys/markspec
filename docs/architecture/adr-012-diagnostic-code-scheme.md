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

6. **Amendment (2026-05-16, see [ADR-014](./adr-014-canonical-body-ast.md)) —
   bounded exception for the AST-gated codes.** §Decision-3 named `MSL-B044`,
   `MSL-M050`, `MSL-M051`, `MSL-C072` as structurally impossible without the
   body-AST refactor. That refactor has now landed (PRs #336–#341). The bounded
   exception: **`MSL-B044` and `MSL-C072` ship _with_ the body-AST refactor**,
   ahead of the broader `MSL-P/I/M/F` scheme migration, because they have no
   current-scheme equivalent and are exactly the AST-gated codes this ADR
   anticipated. **`MSL-M050` / `MSL-M051` remain unshipped —
   deferred-by-dependency**, not deferred-by-policy: their resolution chain is
   normative-per-nextgen-content-model-ADR-§Part-2, which is not landed on
   `main`, so they cannot be implemented without inventing the entity-resolution
   model. The broader scheme migration (Decisions 2–4) is unaffected and still
   pending its gates.

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

## Amendment (ADR-022): MSL-L and MSL-S diagnostic families

ADR-022 (lockfile + external sync) introduces two new code families that extend
the `language.md` §8 scheme without conflicting with existing families. They are
recorded here as a bounded addition — the same pattern as the bounded exception
for `MSL-B044`/`MSL-C072` in §Decision-6. The families follow the existing
naming convention and are stable from their first emission.

### Family overview (ADR-022 additions)

| Family     | Concern                                                                | Authority |
| ---------- | ---------------------------------------------------------------------- | --------- |
| `MSL-L###` | Lockfile (parse / resolution / drift)                                  | ADR-022   |
| `MSL-S###` | External sync (mapping schema / locked-attr lint / cross-system / I/O) | ADR-022   |

### MSL-L (Lockfile, ADR-022)

| Sub-range | Concern                                                        |
| --------- | -------------------------------------------------------------- |
| L0xx      | Lockfile parse + schema                                        |
| L1xx      | Upstream resolution (fetch failures, identity-only References) |
| L2xx      | Drift detection (locked vs current)                            |

Individual codes shipped to `main`:

| Code     | Severity | Concern                                                 |
| -------- | -------- | ------------------------------------------------------- |
| MSL-L001 | error    | Malformed lockfile / missing required scalar            |
| MSL-L002 | error    | Lockfile schema newer than supported                    |
| MSL-L003 | error    | Lockfile schema unrecognised (< 1)                      |
| MSL-L010 | info     | Reference without `Reference-url:` (identity-only lock) |
| MSL-L011 | info     | Stale-pin warning (lockfile > 60 days old)              |
| MSL-L101 | warning  | Fetch failure (registry manifest / Reference-url)       |
| MSL-L102 | warning  | Profile manifest read failure                           |
| MSL-L201 | error    | `markspec.lock` missing under `--check` / `--frozen`    |
| MSL-L202 | error    | Upstream present in resolved but missing from lockfile  |
| MSL-L203 | error    | Upstream present in lockfile but missing from resolved  |
| MSL-L210 | error    | Hash mismatch (same identity, different bytes)          |
| MSL-L211 | error    | Profile resolved-version drift                          |
| MSL-L212 | error    | Canonical edge hash drift                               |

### MSL-S (External sync, ADR-022)

| Sub-range | Concern                           |
| --------- | --------------------------------- |
| S0xx      | mapping.yaml schema + load errors |
| S01x      | Locked-attribute lints            |
| S02x      | Cross-system validation           |
| S03x      | NDJSON log I/O                    |

Individual codes shipped to `main`:

| Code     | Severity       | Concern                                                              |
| -------- | -------------- | -------------------------------------------------------------------- |
| MSL-S001 | error          | Malformed mapping.yaml / unsupported schema / missing required field |
| MSL-S002 | error          | `locked: true` + outbound direction contradiction                    |
| MSL-S003 | error          | Unknown conflict policy (`newest-wins` removed pre-1.0)              |
| MSL-S004 | error          | `system` ≠ `identity.external-id-scheme`                             |
| MSL-S005 | error          | Unparseable `cache.ttl`                                              |
| MSL-S010 | info / warning | Locked attribute edited locally (interactive)                        |
| MSL-S011 | error          | Locked attribute edited locally (CI)                                 |
| MSL-S020 | error          | Multi-system local-write conflict on same attribute                  |
| MSL-S021 | error          | External-id scheme has no matching mapping.yaml                      |

## Amendment (ADR-027): MSL-F formatting-drift family

[ADR-027](./adr-027-cli-smoother-defaults.md) makes `markspec check` a composite
CI/pre-push gate that, project-wide, reports when a file is not what
`markspec fmt` would produce. This introduces the `MSL-F###` family — a
**bounded early adoption** of the nextgen `MSL-F` ("format reports") family
named in §Context, recorded here as a bounded addition on the same footing as
the `MSL-B044` / `MSL-C072` exception in §Decision-6 and the `MSL-L` / `MSL-S`
families in the ADR-022 amendment. `MSL-F###` has no current-scheme equivalent
(the legacy scheme had no format-report family), so no code is renamed and no
suppression comment breaks. The codes are stable from first emission.

### Family overview (ADR-027 addition)

| Family     | Concern                                                 | Authority |
| ---------- | ------------------------------------------------------- | --------- |
| `MSL-F###` | Formatting drift reported by the composite `check` gate | ADR-027   |

### MSL-F (Formatting drift, ADR-027 + ADR-029)

`MSL-F010` and `MSL-F011` fire only in the project-wide composite
`markspec check` gate and mirror `markspec fmt` / `markspec fmt --check` from
the same corpus; a file-local `markspec check <file>` never emits them.
`MSL-F012` ([ADR-029](./adr-029-whole-document-markdown-formatting.md)) is
emitted directly by `fmt` itself (and format-on-save) when the whole-document
Markdown pass falls back on an entry, so — unlike `MSL-F010` / `MSL-F011` — it
also fires for a file-local `markspec fmt <file>`.

| Code     | Severity | Concern                                                                                                                                           |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| MSL-F010 | error    | Formatter drift — on-disk form differs from `markspec fmt` output (whitespace, attribute order, casing, …)                                        |
| MSL-F011 | error    | Reference-canonicalization drift — a trace value is a ULID or stale display ID `markspec fmt` would rewrite to its canonical display ID (ADR-026) |
| MSL-F012 | info     | Markdown-pass fallback — the whole-document formatter's output was rejected by the CommonMark-semantic gate; the original text was kept           |

Published in the language spec at
[`docs/spec/language/language.md` §8.9](../spec/language/language.md).
