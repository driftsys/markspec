# ADR-032: Process Metadata and Profile Activation Are Orthogonal

## Status

Accepted (2026-07-05). Closes #747. Settles open question §9 #2 of the
federated-upstream resolution design
(`docs/archive/specs/2026-07-04-federated-upstream-resolution-design.md`, epic
#741; recorded as [ADR-031](./adr-031-federated-upstream-resolution.md)), which
deliberately left this out of scope.

## Context

Two mechanisms in a MarkSpec project appear to answer the same question — "what
rules, vocabulary, and types does this project follow?" — but do so from
different layers and are owned by different systems:

- **`process:`** is a field in the organisation SSOT contract
  (`driftsys/schemas` `project/v1.json`). It lists `projectRef`s naming the
  process and compliance frameworks a project claims to follow (ASPICE, ISO
  26262). It is a governance declaration, read by org-level tooling and audits
  across many repositories.
- **`.markspec.yaml` `profiles:`** is MarkSpec's activation model
  ([ADR-008](./adr-008-profile-system.md)). It resolves an `extends:` chain of
  profile packages that define the concrete type vocabulary, attributes, trace
  relations, and diagnostic rules the tool enforces.

Left unaddressed, the two can silently diverge: a project can declare ASPICE in
`process:` while its `.markspec.yaml` extends an unrelated profile — or no
profile at all — and nothing today catches the mismatch. For a traceability tool
aimed at compliance workflows, that gap is worth an explicit decision rather
than an accident.

The tempting couplings are (a) make `process:` entries **resolve to** profile
packages via a naming or URL convention, or (b) have `check` **validate**
`process:` against the active profile chain and emit a mismatch diagnostic.

## Decision

### D1 — The two fields are orthogonal by design; neither validates the other

`process:` is org-level governance metadata; `profiles:` is tool-level
activation. They sit at different altitudes and have different owners (the org
SSOT contract versus MarkSpec's profile system). MarkSpec does not resolve,
cross-check, or otherwise couple them. `process:` remains opaque org metadata to
every MarkSpec surface, exactly as the federated-upstream design already treats
it.

### D2 — `markspec check` emits no `process:`↔`profiles:` diagnostic

`check` does not compare the org contract's `process:` list against the active
profile chain. Detecting a divergence would require a canonical "process
framework → profile package" mapping, which **does not exist**: ASPICE does not
map one-to-one to any single profile package, and inventing such a registry is a
maintenance burden MarkSpec would own without authority over either side of the
map. Worse, teaching `check` to interpret process-framework semantics drags
process vocabulary into core, directly against the core/profile boundary that
[ADR-009](./adr-009-core-profile-boundary.md) and
[ADR-010](./adr-010-default-profile.md) draw — core defines no vocabulary,
process frameworks least of all. Divergence detection, where it is wanted, is a
cross-repository governance concern for an org-level dashboard that already
consumes `process:`, not a per-project `check` responsibility.

### D3 — The future bridge, if ever needed, is a profile-manifest declaration

Should reconciliation become genuinely necessary, the mapping belongs on the
**profile manifest** — a profile package declaring which process framework(s) it
realises (e.g. a `realizes-process:` field), asserted by the profile author who
owns that knowledge. An org-level dashboard could then join a project's
`process:` list against the frameworks its active profiles realise. This keeps
the mapping in the profile layer, where vocabulary is permitted to live, and
never requires MarkSpec core to learn process semantics. It is **not built now**
(YAGNI) and is named here only so the boundary in D1/D2 reads as a deliberate
seam rather than an omission.

## Non-features (out of scope, deliberately)

- No `process:`↔`profiles:` consistency diagnostic in `check` or the LSP.
- No "process framework → profile package" registry, convention, or resolver.
- No `process:` field in `.markspec.yaml`; process declaration stays in the org
  SSOT contract.
- No implementation of the D3 profile-manifest bridge — it is a documented
  future option, not a committed feature.

## Consequences

- The core/profile boundary ([ADR-009](./adr-009-core-profile-boundary.md),
  [ADR-010](./adr-010-default-profile.md)) is preserved: no process-framework
  vocabulary enters core.
- A project's compliance claim (`process:`) and its enforced ruleset
  (`profiles:`) can diverge without a MarkSpec diagnostic. This is accepted: the
  reconciliation, if any, is an org-dashboard concern with access to the
  cross-repository picture MarkSpec's per-project `check` lacks.
- No follow-up story is filed. #747's acceptance is conditional — a follow-up
  story is required only _if reconciliation is chosen_, and it is not. Should
  the D3 bridge later be wanted, that is a new profile-manifest story against
  [ADR-008](./adr-008-profile-system.md), not a continuation of this decision.

## Alternatives rejected

### `process:` entries resolve to profile packages (a naming/URL convention)

Rejected. It invents a mapping MarkSpec neither owns nor can keep authoritative,
couples the org SSOT's evolution to MarkSpec's package naming, and makes profile
activation hostage to org-schema vocabulary.

### `check` validates `process:` against the active profile chain

Rejected. It requires the same nonexistent canonical framework→profile map as
the resolve option, and additionally drags process-framework semantics into
core, weakening the [ADR-009](./adr-009-core-profile-boundary.md) boundary. The
divergence it would catch is a cross-repository governance question better
answered by a tool that reads many repos' `process:` fields at once.

## References

- [ADR-008 — Profile System](./adr-008-profile-system.md) — the `.markspec.yaml`
  `profiles:` activation model this decision holds separate from `process:`.
- [ADR-009 — Core / Profile Boundary](./adr-009-core-profile-boundary.md),
  [ADR-010 — Default Profile](./adr-010-default-profile.md) — the boundary D2
  protects.
- Issue #747 — this decision's tracking issue.
- Epic #741 — federated-upstream resolution; its design doc §9 #2 surfaced and
  scoped out this question.
- `driftsys/schemas` `project/v1.json` — the org SSOT contract defining
  `process:`.
