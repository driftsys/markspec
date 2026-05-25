# ADR-018: Single Source of Truth for SW/HW Discipline Classification in Core

**Status:** Accepted (2026-05-25) — R3 (Path A++) selected

## Context

[ADR-017](adr-017-discipline-classification.md) compared two paths for
MarkSpec's `SoftwareComponent` / `HardwareComponent` / `SoftwareInterface` /
`HardwareInterface` (and `Unit` subtypes) — keeping them in core (Path A) or
moving them into a profile (Path B) — and recommended Path A on cost and
recoverability. The recommendation was left **Proposed** pending a
criteria-weighting review.

This ADR re-opens the comparison through a different lens: **Single Source of
Truth (SSOT)**. The question is not just "what does each path cost?" but "what
becomes the canonical source for the SW/HW signal, and what conflicts arise
between candidate sources?". The SSOT lens surfaces _structural_ design
properties — permanent costs that outlive any migration — and a third option
neither path discussed.

This ADR does not recommend a single direction. It presents three options (R1,
R2, R3) for the same criteria-weighting review that ADR-017 is awaiting, so the
review weighs the taxonomy choice and the SSOT shape together as one decision
package.

## Required use cases

Both of the following must be supported by whichever option lands. The cost
comparison below treats failure to support either as a disqualifier, not a
trade-off.

### Use case A — Tiered profile (discipline-encoded prefixes)

A profile declares discipline-bearing requirement subtypes with prefix-encoded
disciplines:

- `SystemRequirement` with prefix `SYS_NNNN`
- `SoftwareRequirement` with prefix `SWE_NNNN`
- `HardwareRequirement` with prefix `HWE_NNNN`

The author selects discipline implicitly by choosing the prefix. The classifier
sees the resolved Type and reads its discipline from the registry. Discipline is
encoded in the Type itself; no allocation walk is needed (though one would yield
the same answer when allocation is present).

### Use case B — Flat profile (the most-used profile shape)

A profile declares only `Requirement` (or a single `SystemRequirement` alias).
The author writes a requirement and an `Allocated-to` value. The classifier
walks `Allocated-to` to a discipline-bearing target (typically a core
`SoftwareComponent` or `HardwareComponent`) and reads its discipline.

### Use case C — Extensible kinds (non-automotive domains)

Domains beyond automotive (medical, aerospace, industrial control, …) need
discipline categories beyond `software / hardware / system` — for example
`firmware`, `mechanical`, `electrical`, `avionics`, `clinical`. Profiles must be
able to register new kinds and bind their own types to them without core
changes.

### Cross-cutting constraint

The author never types a kind name directly. Their inputs are the display-ID
prefix and the `Allocated-to` value. (An optional `Discipline:` override
attribute exists as an escape hatch — see ADR-017 Invariant 1 — but
discipline-by-derivation is the dominant path.)

## The SSOT-in-Path-B Problem

Path B (move SW/HW subtypes out of core) introduces three structural problems
that don't exist today. They are **permanent design costs**, not migration-time
costs: each is a class of bug that the system gains and never loses for as long
as Path B's architecture stands.

### 1. Multi-step lookup chains

Today the SW/HW signal is one lookup. `extension → SoftwareComponent` is a
single resolution against a single table:

```text
package.json  →  SoftwareComponent           (1 step, 1 SSOT)
```

In Path B the same signal becomes two:

```text
package.json  →  "software" (abstract)        (step 1: core extension table)
"software"    →  SoftwareComponent (concrete) (step 2: profile subtype declaration)
```

Each step is its own SSOT. The two can drift independently — a core update that
changes the extension table's category names won't reach profiles that haven't
been updated; a profile rename of the subtype won't reach the extension table.
Today this drift is impossible because the table contains the concrete name
directly.

### 2. Profile load order becomes semantic

Today a `package.json` always infers `SoftwareComponent` regardless of which
profile is loaded — the inference is a property of the file. In Path B the
inferred type depends on which profile is active:

- Profile X declares `software_components: SoftwareComponent extends Component`.
- Profile Y declares `software_components: SaaSModule extends Component`.
- Both are loaded. Which one wins for `package.json`?

The profile load-order question — irrelevant today for type inference — becomes
semantic. Two profiles loaded in different orders could yield different types
for the same file, which makes deterministic-output guarantees (per the
[MarkSpec CLI rule on deterministic output](../../AGENTS.md)) harder to
maintain.

### 3. Trace validation loses autonomy

Today `core/validator/trace_types.ts:30–47` is self-contained — it knows the
allowed target list for every trace attribute:

```typescript
{ attr: "Provides", allowedTargetTypes: ["SoftwareInterface", "HardwareInterface"] }
```

The validator can answer "is this Provides target valid?" without consulting any
profile. In Path B the rule must widen to `["Interface"]`, and validation must
then query _which subtypes a profile has declared to inherit from Interface_
before it can answer. The rule no longer owns its own constraint — it depends on
a profile registry it doesn't manage. This breaks the read-only, self-contained
validation model that ADR-009 (core/profile boundary) implicitly relies on.

## Per-mechanism SSOT analysis

The four mechanisms that currently encode SW/HW knowledge in core each carry a
distinct SSOT today. Path B requires re-homing every one.

### Source pattern introspection

[`packages/markspec/core/model/source_introspection.ts:22-69`](../../packages/markspec/core/model/source_introspection.ts)

```typescript
{ pattern: /(?:^|\/)package\.json$/, type: "SoftwareComponent" },
{ pattern: /(?:^|\/)Cargo\.toml$/,   type: "SoftwareComponent" },
{ pattern: /\.openapi\.(?:yaml|yml|json)$/, type: "SoftwareInterface" },
{ pattern: /\.dbc$/, type: "HardwareInterface" },
{ pattern: /\.rs$/,  type: "SoftwareUnit" },
```

**SSOT today.** The `SOURCE_PATTERNS` table is the SSOT for "this file extension
maps to this component type." The type assignment is a value of the table — not
derived from any other fact. Step 3 of the type-resolution chain runs this
lookup directly.

**Path B conflict.** The table's RHS must change from concrete type names to
either (a) abstract categories (`"software"`, `"hardware"`) that profiles then
resolve to concrete subtypes, or (b) bare parent types (`Component`,
`Interface`) with no discipline signal at all. Option (a) creates a two-table
chain (the multi-step problem above); option (b) loses the discipline signal
entirely and forces consumers to recover it elsewhere.

### URI scheme map (PURL + URN)

[`packages/markspec/core/model/uri_scheme_map.ts:25-71`](../../packages/markspec/core/model/uri_scheme_map.ts)

```typescript
{ pattern: /^pkg:cargo\//, type: "SoftwareComponent" },
{ pattern: /^pkg:npm\//,   type: "SoftwareComponent" },
{ pattern: /^pkg:hw\//,    type: "HardwareComponent" },
{ pattern: /^urn:can-bus:/, type: "HardwareInterface" },
```

**SSOT today.** The `URI_SCHEME_RULES` table is the SSOT for purl/URN scheme →
type. Step 5 of the type-resolution chain runs a pure lookup. A
`pkg:cargo/serde` reference's type is determined _solely_ by this table.

**Path B conflict.** Profiles can already extend this table (the comment at
lines 9–11 acknowledges it). Today both core and profile-extended rules target
the same concrete types, so they merge cleanly. In Path B, core rules would map
to abstract categories and profile rules would map categories to subtypes. Two
independent profiles could declare incompatible category→subtype mappings for
the same purl scheme, causing the same URI to infer different types depending on
profile load order.

### Discriminating attributes

[`packages/markspec/core/model/discriminating_attr.ts:27-56`](../../packages/markspec/core/model/discriminating_attr.ts)

```typescript
["License",         "SoftwareComponent"],
["Build-manifest",  "SoftwareComponent"],
["Package-manager", "SoftwareComponent"],
["Bus-protocol",    "HardwareInterface"],
["Connector-type",  "HardwareInterface"],
```

**SSOT today.** The `DISCRIMINATING_ATTRIBUTES` map is the SSOT for "this
attribute key uniquely identifies this type." Step 6 of the type-resolution
chain runs this lookup: if an entry carries `License:`, it infers type
`SoftwareComponent` regardless of any other context.

**Path B conflict.** Removing `SoftwareComponent` from core forces the
attribute-to-type mappings to either (a) remove the discrimination (losing the
inference) or (b) map to placeholder/abstract types and delegate resolution to a
profile. If a profile is absent or inactive, entries with `License:` become
untyped — breaking the "core works without a profile" property. If two profiles
claim these attributes, a conflict emerges with no in-core arbitration
mechanism.

### Trace target rules

[`packages/markspec/core/validator/trace_types.ts:30-47`](../../packages/markspec/core/validator/trace_types.ts)

```typescript
{ attr: "Provides", allowedTargetTypes: ["SoftwareInterface", "HardwareInterface"] },
{ attr: "Requires", allowedTargetTypes: ["SoftwareInterface", "HardwareInterface"] },
```

**SSOT today.** The `TRACE_RULES` array is the SSOT for "valid target types for
each trace attribute." The rules are prescriptive — they encode ADR-003 §Part
2's intent that `Provides` / `Requires` target Interfaces only. The type
constraint flows _from_ this rule _to_ the type system.

**Path B conflict.** Removing the SW/HW Interface subtypes forces the rule to
widen to bare `["Interface"]`. Validation can no longer enforce "a software
component only provides software interfaces" without querying profile metadata
to determine which subtypes inherit from Interface. The rule's self-contained
nature is lost: validation gains a dependency on the active profile registry,
breaking the read-only validation model.

## SSOT candidates surfaced

Aggregating across the four mechanisms, the distinct SSOT candidates that could
authoritatively own the SW/HW signal are:

- **Core `SOURCE_PATTERNS` table** — owns extension → type mapping.
- **Core `URI_SCHEME_RULES` table** — owns URI scheme → type mapping.
- **Core `DISCRIMINATING_ATTRIBUTES` map** — owns attribute presence → type.
- **Core `TRACE_RULES` array** — owns trace target validity constraints.
- **Profile-declared subtypes** (only meaningful in Path B / R2) — owns the
  abstract-category → concrete-type mapping.
- **Entry-level `Discipline:` attribute** (only meaningful in Path B / R2 if
  adopted) — would owe authoritative per-entry classification, conflicting with
  the four table-based SSOTs by claiming the same fact via a different
  mechanism.

The structural question is whether these candidates remain independent (as
today, internally consistent because all targets are fixed core type names), get
consolidated into a single registry, or get distributed across the core/profile
boundary with explicit category translation.

## Option R1 — Confirm Path A as-is

Keep the four SW/HW Component / Interface / Unit subtypes in core. Treat the
four independent tables as the current SSOTs and accept that they must be
manually kept in sync. No code change.

**SSOT shape.** Four independent SSOTs, one per mechanism, all targeting the
same fixed set of concrete type names. They're internally consistent today
because the type names are immutable; coordination is a manual maintenance
property, not an automated invariant.

**Pros.**

- Zero code change.
- All three structural problems (multi-step chains, load order, validation
  autonomy) remain absent.
- Auto-classification of introspected components stays free across all four
  mechanisms.

**Cons.**

- The four-table coordination is implicit: when a new SW/HW subtype is added,
  developers must remember to update each table. No automation enforces this.
- The latent SSOT issue persists. It hasn't bitten yet, but the design has no
  safeguard against it.

## Option R2 — Path B via single-SSOT mechanism

Move the four SW/HW Component / Interface (and `Unit`) subtypes out of core into
a bundled profile. Designate **profile subtype declarations** as the single SSOT
for "this subtype is software / hardware / etc." Redesign all four core
mechanisms to consult this SSOT at resolution time, either by:

- Mapping their tables' RHS to abstract category strings and resolving via a
  profile-registry call, or
- Removing their SW/HW outputs entirely and exposing the raw signal (extension
  matched, scheme matched, attribute present) for consumers to classify.

**SSOT shape.** One SSOT (profile subtype declarations). The four tables become
derivers — they emit category names and a profile-registry call resolves to
concrete types.

**Pros.**

- Conforms most strictly to ADR-009 (core/profile boundary): core ships generic
  vocabulary; opinions live in profiles.
- One canonical place for SW/HW classification per profile.
- A profile that doesn't want SW/HW vocabulary never encounters it (the goal
  ADR-017's flat profile expressed).

**Cons.**

- Pays all three structural costs (multi-step chains, load order semantics,
  validation autonomy loss) permanently.
- ~230 references / 26 files migration cost (per ADR-017's audit).
- ~70 test assertions to rewrite.
- New design questions to resolve (interface disambiguation, Component-family
  attribute split, trace-rule expressiveness — all enumerated in ADR-017).
- Auto-classification of introspected components requires running the profile
  registry; "core works without a profile" property weakens.

## Option R3 — Path A++ (extensible discipline registry)

Keep the four SW/HW Component / Interface / Unit subtypes in core. Introduce a
**single discipline registry** that maps type names to kinds AND declares the
set of valid kinds. Both core and profiles write into the registry. The registry
powers the four-channel classifier from ADR-017 Invariant 1.

```typescript
// hypothetical core seed
const CORE_KINDS = new Set(["system", "software", "hardware"]);
const CORE_TYPE_TO_KIND = new Map([
  ["SoftwareComponent", "software"],
  ["HardwareComponent", "hardware"],
  ["SoftwareInterface", "software"],
  ["HardwareInterface", "hardware"],
  ["SoftwareUnit",      "software"],
  ["HardwareUnit",      "hardware"],
]);

// profiles extend, e.g. an aerospace profile:
//   kinds:
//     - avionics
//     - structural
//   types:
//     AvionicsRequirement:  { extends: Requirement, discipline: avionics }
//     StructuralRequirement: { extends: Requirement, discipline: structural }
```

The four mechanism tables (source introspection, PURL, discriminating attrs,
trace rules) keep their tables and continue to emit core type names. Any
consumer that wants discipline calls the registry. Profiles registering their
own types extend the registry via the profile manifest schema.

**How the required use cases land in R3:**

- **Use case A (tiered profile)** — profile registers
  `SoftwareRequirement: software`, `HardwareRequirement: hardware`,
  `SystemRequirement: system` in its manifest. Channel 3 (type-based) of the
  classifier resolves directly.
- **Use case B (flat profile)** — profile registers nothing; classifier falls
  through to channel 4 (allocation-based), walking `Allocated-to` to a core
  SW/HW Component target and reading its registered discipline.
- **Use case C (extensible kinds)** — profile adds kinds to its `kinds:` block
  and binds its own types via the `discipline:` field. New kinds appear in
  `Entry.derivedDiscipline`, reporter grouping, and `markspec doctor` without
  core changes.

**SSOT shape.** One SSOT for type → kind (the registry, with core and profile
contributions in a defined merge order); one SSOT for kind validity (the union
of `CORE_KINDS` and profile-declared `kinds:`). Both the override and freeze
channels (ADR-017 backlog items 4 and 5) reference the registry to validate that
the asserted kind is registered.

**Pros.**

- Addresses the latent coordination issue in Path A: the discipline classifier
  for a type name is declared exactly once per source (core or profile).
- All three structural problems (multi-step chains, load order, validation
  autonomy) remain absent — profile contributions are merged into a single
  registry at load time, not consulted dynamically during validation.
- Supports all three required use cases with one mechanism.
- Path A's free auto-classification, free trace-rule constraints, and
  `core works without a profile` property all preserved.
- The four-channel classifier (ADR-017 backlog item 3) reduces to a small
  function over the registry.
- Profiles that want their own discipline vocabulary (tiered profiles,
  domain-specific profiles) extend the registry instead of re-implementing
  classification logic.

**Cons.**

- Registry + profile-manifest-schema change is bigger than the original "10–30
  line" estimate of the consolidated-registry-without-extensibility variant.
  Realistic scope: ~100–200 lines plus schema work plus tests.
- Profile manifest schema gains `kinds:` and per-type `discipline:`. Profiles
  that don't need either pay zero cost; profiles that do need a one-time
  registration step.
- Load-time merge order matters when multiple profiles register the same type
  (last write wins, errors on conflict, or both? — to be settled at
  implementation).

## Comparison

| Criterion                                         | R1 — Path A as-is                             | R3 — Path A++                                | R2 — Path B (single SSOT)                          |
| ------------------------------------------------- | --------------------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| Code surface change                               | None                                          | Small (~10–30 lines)                         | Large (~230 refs across 26 files)                  |
| SSOTs for SW/HW classification                    | 4 implicit                                    | 1 explicit registry                          | 1 explicit, distributed                            |
| Multi-step lookup chains                          | Absent                                        | Absent                                       | Present (permanent)                                |
| Profile load-order sensitivity for type inference | Absent                                        | Absent                                       | Present (permanent)                                |
| Trace-validation autonomy                         | Preserved                                     | Preserved                                    | Lost (validation queries profile)                  |
| Core works without a profile                      | Yes                                           | Yes                                          | Degraded (auto-classify needs profile)             |
| **Use case A (tiered profile)**                   | Partial — manual coordination across 4 tables | Direct — profile registers types in registry | Forced — profile re-declares core SW/HW vocabulary |
| **Use case B (flat profile)**                     | Free                                          | Free                                         | Requires profile to opt into SW/HW vocabulary      |
| **Use case C (extensible kinds)**                 | Requires core change for every new kind       | Profile-declared via `kinds:` block          | Profile-declared (the path's main affordance)      |
| Author work to add new requirement                | Pick prefix or allocate                       | Pick prefix or allocate                      | Pick prefix or allocate                            |
| Profile work for tiered profile                   | Declare types in 4 tables manually            | Declare types + bind kind in manifest        | Declare types + component subtypes + bind kind     |
| Profile work for flat profile                     | Zero                                          | Zero                                         | Substantial (opt into SW/HW)                       |
| ADR-009 boundary strictness                       | Loose (opinion in core)                       | Loose (opinion in core)                      | Strict (opinion in profile)                        |
| ASPICE/26262 vocabulary alignment in core         | Direct                                        | Direct                                       | Via profile                                        |
| Test churn                                        | None                                          | Moderate (~100–200 lines + tests)            | ~70 assertions to rewrite                          |
| Future flexibility (new disciplines)              | Requires core change                          | Profile extends registry                     | Profile-only                                       |
| Coordination across the 4 mechanisms              | Manual                                        | Automatic via registry                       | N/A (mechanisms become abstract)                   |

## Resolution

The joint criteria-weighting review with
[ADR-017](adr-017-discipline-classification.md) concluded on 2026-05-25 with
**R3 — Path A++ (extensible discipline registry)** selected.

### Why R3 over R2

R2 (Path B) was ruled out by the required-use-cases analysis. The "minimal
profile-side work" constraint disqualifies it on two counts:

- **Use case A (tiered profile)** — Path B forces every tiered profile to
  redeclare core SW/HW Component / Interface vocabulary it currently inherits
  for free.
- **Use case B (flat profile)** — Path B forces flat profiles to opt into the
  SW/HW vocabulary they currently never encounter. Flat profiles get
  classification for free today via core types; Path B removes that.

In addition, the three structural costs (multi-step lookup chains, profile
load-order sensitivity for type inference, validation-autonomy loss) are
permanent — not migration-time costs that can be amortised.

### Why R3 over R1

R1 (Path A unchanged) was viable when the unified model was three-channel (Type
→ Allocation → default). After ADR-017's amendment adopted a four-channel
classifier with extensible kinds (Invariants 1 and 2), R1 became inconsistent
with the model it was meant to support:

- The four-channel classifier needs a `disciplineOfType(typeName) → kind`
  lookup. R1 has nowhere central for this lookup, leaving it ad-hoc per profile
  and per consumer.
- **Use case C (extensible kinds for non-automotive domains)** is blocked in R1:
  every new kind requires a core release.
- Override and freeze validation (ADR-017 backlog items 4 and 5) need a central
  kind set to validate authored values against. R1 has none.

R3 factors the lookup out as a registry that profiles can extend. The
implementation cost (~100–200 LOC + manifest-schema work + tests) is bounded and
additive; the alternative (build the same lookup inline in R1, then backfill
extensibility later) costs at least as much over time.

### Risks accepted with R3

- **Profile-manifest schema becomes a stable API.** Once `kinds:` and per-type
  `discipline:` ship, breaking changes are expensive. To be designed
  conservatively.
- **Profile-conflict merge rules need a defined semantics** when multiple
  profiles register the same type. Implementation question to settle in
  writing-plans: last-write-wins, error-on-conflict, or namespace-per-profile.
- **Registry maintenance** when new core SW/HW types are added — but this
  becomes a single-file edit instead of four-file coordination.

## Dependencies

- [ADR-003 — Diagram Authoring & Item Taxonomy](adr-003-diagram-authoring.md)
  defines the type hierarchy this ADR debates.
- [ADR-009 — Core / Profile Boundary](adr-009-core-profile-boundary.md) is the
  principle each option interprets differently.
- [ADR-017 — Discipline Classification of Requirements via Allocation
  Graph](adr-017-discipline-classification.md) is the companion ADR; the two
  enter the criteria-weighting review together.

## Status

Accepted (2026-05-25) — R3 (Path A++) selected. See the Resolution section above
for the joint criteria-weighting review outcome with
[ADR-017](adr-017-discipline-classification.md).
