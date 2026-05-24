# ADR-017: Discipline Classification of Requirements via Allocation Graph

**Status:** Proposed

## Context

MarkSpec profiles differ in how they model the SW/HW split at the requirement
layer:

- **Tiered profiles** (ASPICE, ISO 26262 SW-E / HW-E) declare distinct
  requirement subtypes — `SoftwareRequirement`, `HardwareRequirement`,
  `SystemRequirement` — each with its own display-ID prefix and its own set of
  cross-checks (SW-test coverage, HW V&V, etc.).
- **Flat profiles** (the immediate motivation for this ADR, and likely any
  profile aimed at non-automotive embedded systems or general-purpose software)
  declare a single `SystemRequirement` (or even bare `Requirement`) layer. A
  requirement is _implicitly_ "a software requirement" once `Allocated-to`
  resolves to a `SoftwareComponent`, and "a hardware requirement" once it
  resolves to a `HardwareComponent`.

In flat profiles two facts are orthogonal:

1. **Type** — the entry's MarkSpec type, e.g. `SystemRequirement`. Set either by
   an explicit `Type:` attribute or, more commonly in these profiles, resolved
   from the display-ID prefix via the type-resolution chain in
   [`packages/markspec/core/validator/type_resolution.ts`](../../packages/markspec/core/validator/type_resolution.ts).
   Authors do not write `Type:`.
2. **Discipline** — a derived classifier (SW / HW / system / mixed) computed by
   walking `Allocated-to` to its target and reading the target's resolved type.
   Authors never write the discipline; the compiled graph already carries the
   data because
   [`core/validator/trace_types.ts:34`](../../packages/markspec/core/validator/trace_types.ts)
   constrains `Allocated-to` targets to `Component` (and any subtype).

Today MarkSpec ships SW/HW vocabulary only on `Component`, `Interface`, and
`Unit` (see [ADR-003 §Part 1](adr-003-diagram-authoring.md) and
[`core/model/mod.ts:132-149`](../../packages/markspec/core/model/mod.ts)):

```text
Component
├── SoftwareComponent
├── HardwareComponent
├── SoftwareInterface
└── HardwareInterface

Unit
├── SoftwareUnit
└── HardwareUnit
```

`Requirement` is undifferentiated. That is the right shape for both tiered and
flat profiles — tiered profiles add their own requirement subtypes; flat
profiles stay on bare `Requirement` (or a profile alias `SystemRequirement`
extending it). The open question this ADR resolves is whether the _Component_
SW/HW split should also remain in core, or whether it should move down into
profiles that need it, leaving core with only `Component` / `Interface` /
`Unit`.

Two paths are evaluated below. Both deliver the same author-facing UX and the
same downstream classification surface; they differ only in where the SW/HW
vocabulary lives.

## Invariants (true in both paths)

These constraints hold regardless of which path is chosen. They form the design
context for the comparison.

1. **Discipline is resolved via four channels in precedence order, never
   directly authored as a kind name.** The author's only direct inputs are the
   display-ID prefix (which determines the Type) and the `Allocated-to` value.
   The classifier resolves discipline by trying, in order:
   1. **Override** (`Discipline: <kind>` attribute) — author asserts a specific
      kind. Takes precedence; validators flag conflicts with channels 3 and 4.
   2. **Freeze** (`Discipline-frozen: <kind> @ <date>` attribute) — cached
      snapshot of a past derivation. Wins when no override is set; validator
      warns if current derivation diverges.
   3. **Type-based** — the entry's Type, looked up in the discipline registry.
      Used when no override and no freeze. Covers _tiered profiles_ where types
      like `SoftwareRequirement` are registered as discipline-bearing.
   4. **Allocation-based** — walk `Allocated-to` to a discipline-bearing target
      whose Type is registered. Covers _flat profiles_ where the requirement
      Type is not discipline-bearing but the allocation target is.

   When none of the four channels yields a kind, the discipline defaults to
   `system`.
2. **Kinds are extensible by profiles.** Core ships the built-in kind set
   (`system`, `software`, `hardware`) and the built-in type-to-kind mappings for
   core SW/HW Component / Interface / Unit subtypes. Profiles can extend the
   discipline registry with new kinds (e.g. `firmware`, `mechanical`,
   `electrical`, `avionics`, `clinical`) and with their own discipline-bearing
   type subtypes (e.g. `SoftwareRequirement → software`).
3. **`Type:` is not author-written for requirements in flat profiles.** The type
   is resolved by the display-ID prefix (`SYS_NNNN` → `SystemRequirement`)
   through the existing type-resolution chain. The prefix is the author-visible
   identity of the layer.
4. **No change to `Requirement` semantics or to the `Allocated-to` attribute.**
   Both paths preserve the current entry model, the trace target-type rule, and
   the compiled-graph edge format.

## Path A — Keep core SW/HW Component subtypes

The current shape. Core retains `SoftwareComponent`, `HardwareComponent`,
`SoftwareInterface`, `HardwareInterface` (and the `Unit` subtypes). Flat
profiles use bare `Component` / `Interface` if they prefer; the SW/HW subtypes
are opt-in vocabulary that profiles never have to surface to authors.

**Classification mechanism.** The four-channel classifier from Invariant 1 runs
against the discipline registry, which under Path A is seeded with the core
SW/HW Component / Interface / Unit subtypes and the built-in kinds (`system`,
`software`, `hardware`). The type-based channel (channel 3) reads discipline
directly off the core type name; the allocation-based channel (channel 4) walks
`Allocated-to` to a core SW/HW target and reads its registered discipline.
Override and freeze (channels 1 and 2) work uniformly on top, independent of
Path A's specifics. Output: a derived `Entry.derivedDiscipline` field in the
compiled JSON.

**What stays "free" in this path.** Four core mechanisms keep working without
redesign because they currently dispatch on the four type names:

| Mechanism                 | Module                                                                                             | Behaviour                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Source introspection      | [`core/model/source_introspection.ts`](../../packages/markspec/core/model/source_introspection.ts) | `package.json`, `Cargo.toml` → `SoftwareComponent`; `.dbc`, `.ldf` → `HardwareInterface`; `.openapi.yaml` → `SoftwareInterface`.     |
| PURL scheme map           | [`core/model/uri_scheme_map.ts`](../../packages/markspec/core/model/uri_scheme_map.ts)             | `pkg:npm/…`, `pkg:cargo/…` → `SoftwareComponent`; `pkg:hw/…`, `urn:can-bus:` → hardware variants.                                    |
| Discriminating attributes | [`core/model/discriminating_attr.ts`](../../packages/markspec/core/model/discriminating_attr.ts)   | `License`, `Build-manifest`, `Package-manager` infer `SoftwareComponent`; `Bus-protocol`, `Voltage-level` infer `HardwareInterface`. |
| Trace target rules        | [`core/validator/trace_types.ts:41-46`](../../packages/markspec/core/validator/trace_types.ts)     | `Provides:` / `Requires:` target `SoftwareInterface \| HardwareInterface`.                                                           |

A flat profile that ingests its software repositories as Component entries gets
SW classification for free via source introspection — the profile never has to
mention "software" in its own vocabulary.

**Profile authoring.** A flat profile (e.g. the immediate motivating profile)
declares one new concrete subtype, e.g. `SystemRequirement extends Requirement`,
with prefix `SYS_NNNN`. It does **not** list `SoftwareComponent` /
`HardwareComponent` / `SoftwareInterface` / `HardwareInterface` as accepted
types — authors never see them in completions or scaffolds. Auto-introspected
components still classify correctly silently.

## Path B — Simplify core to bare `Component` / `Interface` / `Unit`

Move all six SW/HW subtypes (`SoftwareComponent`, `HardwareComponent`,
`SoftwareInterface`, `HardwareInterface`, `SoftwareUnit`, `HardwareUnit`) out of
core into a bundled profile (default profile, or a new `discipline-aware`
profile). Core ships only the parent types.

**Classification mechanism.** Discipline can no longer be read off the target's
type — bare `Component` carries no SW/HW signal. Recovery requires one of three
additions:

- **B1.** A new core attribute, e.g. `Discipline: software | hardware`, scoped
  to `Component` / `Interface` / `Unit`. Author-visible. The classifier then
  walks `Allocated-to` and reads the target's `Discipline:` attribute instead of
  its type.
- **B2.** Profile-declared SW/HW subtypes
  (`SoftwareComponent extends
  Component`, …). The classifier walks the
  inheritance chain, same as Path A — but only profiles that declare these
  subtypes get classification.
- **B3.** A separate sub-classification dimension (e.g. labels with reserved
  semantics, or a new `Kind:` attribute). Equivalent to B1 with a different
  keyword.

**What breaks.** The audit (taken on 2026-05-24) found ~230 references across 26
files. The four mechanisms listed under Path A all lose their SW/HW dispatch and
must be redesigned to consult whichever recovery mechanism the path adopts:

- Source introspection's file-extension → type table reduces to `package.json` →
  `Component`; the SW/HW signal that came for free is gone. Recovery requires
  either inferring `Discipline:` from extension (duplicating the table) or
  punting classification to the consumer.
- PURL scheme map flattens to `pkg:npm/…` → `Component`. Same loss.
- Discriminating-attribute inference loses ten precise mappings; either the
  inference returns coarser results or the table must reference the recovery
  mechanism.
- Trace target rules for `Provides:` / `Requires:` widen from
  `SoftwareInterface | HardwareInterface` to bare `Interface`. The rule can no
  longer constrain at core: "a SW component only provides SW interfaces" becomes
  a profile-level rule (or is dropped).

**What requires new design.** Three questions appear in Path B that don't exist
in Path A:

1. **Interface disambiguation.** If `.openapi.yaml` and `.dbc` both map to
   `Interface`, what mechanism distinguishes them at consumption time? Pick one:
   per-type discipline attribute (B1), profile subtypes (B2), or accept that
   interface discipline isn't inferable.
2. **Component-family attribute split.** Today
   [`core/model/type_hierarchy.ts`](../../packages/markspec/core/model/type_hierarchy.ts)
   scopes `License`, `Build-manifest`, `Package-manager` to `SoftwareComponent`
   and `Manufacturer`, `Part-number`, `Datasheet` to `HardwareComponent`. After
   collapse: are all six attributes valid on any `Component` (loss of
   precision), or does the attribute scope move to the recovery mechanism?
3. **Trace-rule expressiveness.** `Provides:` and `Requires:` lose their SW/HW
   constraint. Decide whether the rule weakens (any interface) or migrates to
   the discipline-aware profile.

**Profile authoring.** The flat profile becomes slightly cleaner — the core
type-completion list shrinks from 16 to 12 entries, removing four names the
profile never uses. Tiered profiles (ASPICE) pay a small declaration tax to
recover what they had.

## Comparison

| Criterion                                                          | Path A — Keep core                         | Path B — Simplify core                                                   |
| ------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------ |
| Code surface change                                                | None                                       | ~230 refs across 26 files                                                |
| Free inference mechanisms (introspection, PURL, attr, trace rules) | Preserved                                  | Lost; recovery requires new mechanism                                    |
| Open design questions                                              | 0                                          | 3 (interface disambiguation, attribute split, trace-rule expressiveness) |
| Tiered profile (ASPICE) authoring                                  | Uses core types directly                   | Declares 4–6 subtypes                                                    |
| Flat profile authoring (this profile)                              | Ignores SW/HW types; uses bare `Component` | Never sees SW/HW; one less type-completion entry                         |
| Type-completion noise for flat profiles                            | 4 unused names visible                     | None                                                                     |
| ADR-009 (core/profile boundary) alignment                          | SW/HW is an opt-in core opinion            | SW/HW becomes a profile opinion (cleaner boundary)                       |
| ASPICE/26262 vocabulary alignment                                  | Matches standards directly in core         | Matches standards via profile                                            |
| Test churn                                                         | None                                       | ~70 hardcoded assertions to rewrite                                      |
| Classification mechanism                                           | Layered addition; pure read of target type | New mechanism (attribute, label, or subtype) needed                      |

## Recommendation

**Path A.** Reasons:

1. **The flat-profile goal is already achievable in Path A.** The profile
   declares `SystemRequirement` only, omits SW/HW types from its accepted-types
   list, and authors never encounter the vocabulary. Auto-introspected
   components still classify correctly because the inference mechanisms preserve
   the SW/HW signal silently.
2. **Path B's cost is concentrated and substantial.** Removing six names from
   `CORE_CONCRETE_TYPES` cascades through four inference mechanisms (~230
   references), opens three new design questions, and forces ~70 test assertions
   to be rewritten. Pre-1.0 we're free to make breaking changes (per the
   no-migration policy), so the work is reversible — but it's a large up-front
   cost for a benefit that Path A already delivers without it.
3. **Classification is an additive layer in Path A.** The compiler can emit
   `derivedDiscipline` in the compiled JSON without touching the type system.
   The reporter can grow a `--group-by discipline` flag without touching the
   type system. The validator can forbid mixed allocation without touching the
   type system. Each piece is a small independent change.
4. **The ADR-009 boundary argument cuts both ways.** Path B's "SW/HW is a domain
   opinion that belongs in profiles" framing is real but weaker once you observe
   that core's source-introspection step (which classifies from extensions, purl
   schemes, and discriminating attributes) is _itself_ a domain opinion that
   already lives in core. Removing the SW/HW types without also removing the
   inference mechanisms leaves the boundary half-drawn; doing both turns this
   into a substantially larger refactor than this ADR contemplates.

## Implementation backlog

These pieces follow from this ADR's invariants and become the implementation
backlog once Accepted. They realise the four-channel classifier (Invariant 1)
and the extensible kinds (Invariant 2). Items marked _(Path A only)_ apply only
if the joint criteria-weighting review with ADR-018 settles on R1 or R3; under
R2 the design space is reshaped (see ADR-018).

1. **Discipline registry in core.** A single data structure mapping types to
   kinds, plus the built-in kind set (`system`, `software`, `hardware`). Loaded
   at compile time. Consumed by the classifier, the reporter, the validator, and
   `markspec doctor`.
2. **Profile extension of the discipline registry.** Profile manifest gains a
   `kinds:` block (declare new kinds — `firmware`, `mechanical`, …) and a
   per-type `discipline:` field on type declarations (assign existing or
   profile-declared kinds to profile-declared types — e.g.
   `SoftwareRequirement: software`).
3. **Four-channel classifier.** Implements Invariant 1's precedence order
   (override → freeze → type-based → allocation-based → default `system`). Emits
   `Entry.derivedDiscipline` in the compiled JSON. Always present.
4. **`Discipline:` override attribute.** Parser + validator support. Author's
   explicit assertion of a kind; takes precedence over derivation. Validator
   rules:
   - Override vs Type-based conflict — warn (e.g. `Discipline: hardware` on a
     `SoftwareRequirement`).
   - Override vs Allocation-based conflict — warn (e.g. `Discipline: hardware`
     on an entry `Allocated-to` a `SoftwareComponent`).
5. **`Discipline-frozen:` freeze attribute.** Parser + validator support. Cached
   derivation with a date stamp (`<kind> @ <date>`). Validator rule: freeze
   divergence — warn when current derivation differs from the frozen value.
6. **Mixed-allocation validator rule.** A flat-profile requirement may not
   `Allocated-to` targets of more than one discipline. Error in flat profiles;
   moot in tiered profiles (the Type already disambiguates) and in profiles that
   set an explicit override.
7. **Reporter `--group-by discipline` flag.** Splits coverage and
   traceability-matrix output by the resolved discipline. Default grouping
   behaviour gated by `discipline_mode` (see item 8).
8. **`discipline_mode: flat | tiered | none`** in `markspec.yaml` _(Path A
   only)_. Profile declares whether it tiers requirements by discipline. The
   value drives mode-aware behaviour across the toolchain:
   - **Completions / scaffolds.** A `flat` profile offers a `SystemRequirement`
     scaffold; a `tiered` profile offers `SoftwareRequirement` and
     `HardwareRequirement` scaffolds in parallel. A `none` profile offers bare
     `Requirement`.
   - **Reporter defaults.** `flat` triggers `--group-by discipline` by default
     in coverage and traceability matrices; `tiered` groups by type instead;
     `none` does neither.
   - **Conditional rules.** The mixed-allocation rule (item 6) activates only
     when `discipline_mode: flat`.
   - **Doctor output.** `markspec doctor` reports the resolved mode and the
     count of entries classified per discipline.

   Under R2 (Path B) the flag is moot: discipline mode is implicit in which
   types the profile declares.

## Other follow-up candidates

Candidates surfaced during the brainstorm that don't materially affect the Path
A / Path B decision but are worth tracking. Mentioned here so the second-phase
reviewer sees the full envelope of work Path A enables.

1. **Resolved target type on graph edges.** The compiled graph carries each
   trace edge's target display ID; it should also carry the target's resolved
   type. Eliminates a re-lookup for any classifier that branches on target type
   (not just discipline). Path-independent.
2. **`isSoftwareFamily(entry) / isHardwareFamily(entry)` helpers in
   `core/mod.ts`.** Library helpers exposing the discipline classifier so
   profile-author report scripts get a tested function instead of
   re-implementing the type-hierarchy walk. Path-independent.
3. **Profile-declared type families.** A `families:` block in the profile
   manifest letting profiles group types into named families
   (`software_components: [SoftwareComponent, SoftwareUnit, SoftwareInterface]`)
   and reference families in trace rules or derived-attribute rules. Generalises
   the hardcoded SW/HW logic and lets future profiles declare new disciplines
   (firmware, mechanical, FPGA) without core changes. Path A benefit; in Path B
   this becomes the _primary_ way profiles express discipline, not an optional
   one.
4. **`markspec doctor` discipline summary line.** Beyond the `discipline_mode`
   reporting in backlog item 8, the doctor command could also report a count of
   components and requirements per discipline as a first-run sanity check.
   Path-independent.

None of these are scoped into this ADR; they are recorded for the writing-plans
phase that follows Acceptance.

## Open for second-phase review

The recommendation favours Path A on cost and recoverability, but the weighting
of criteria has not been adversarially reviewed. The second-phase review
(deferred) should:

1. **Establish explicit criteria weights.** Among: code-surface change,
   learnability for a first-time profile author, ASPICE/26262 vocabulary
   fidelity, type-completion noise, ADR-009 boundary purity, reversibility
   before 1.0, test churn. The current recommendation weights cost and
   recoverability above boundary purity; a different weighting could tip toward
   Path B.
2. **Identify trigger conditions that would re-open Path B.** Examples: a
   non-automotive profile (web, microservices, internal tooling) is authored and
   finds the SW/HW vocabulary noisy or misleading; a downstream registry wants
   to publish profiles where the SW/HW split is genuinely meaningless; the
   source-introspection mechanisms get independently re-evaluated and the
   inference layer moves to profiles regardless of the type taxonomy.
3. **Reconsider scope.** This ADR scopes the comparison to `Component`,
   `Interface`, `Unit`. The same argument applies — at different strengths — to
   discriminating-attribute scoping, PURL maps, and source introspection. A
   future ADR could pursue boundary purity across all four mechanisms together;
   that is the cleaner version of Path B and not what this ADR proposes.

## Dependencies

- [ADR-003 — Diagram Authoring & Item Taxonomy](adr-003-diagram-authoring.md)
  defines the current Item type hierarchy. Path A leaves ADR-003 unchanged; Path
  B would require an amendment.
- [ADR-009 — Core / Profile Boundary](adr-009-core-profile-boundary.md) is the
  principle invoked by both paths. Path A interprets it as "core may carry
  opinions that profiles can opt out of"; Path B interprets it more strictly.
- [ADR-013 — Document Directive Is a Formatter Concern, Not a Validator
  Resolution Step](adr-013-document-directive-not-a-resolution-step.md)
  established that type resolution is intrinsic to the entry; this ADR's "type
  from display-ID prefix" authoring shape relies on the type-resolution chain
  that ADR-013 froze.

## Status

Proposed.
