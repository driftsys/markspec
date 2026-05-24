# ADR-018: Single Source of Truth for SW/HW Discipline Classification in Core

**Status:** Proposed

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

## Option R3 — Path A++ (consolidated core registry)

Keep the four SW/HW Component / Interface / Unit subtypes in core. Introduce a
**single internal registry** that maps type names to their discipline
classification:

```typescript
// hypothetical
const CORE_DISCIPLINE_REGISTRY = new Map([
  ["SoftwareComponent", "software"],
  ["HardwareComponent", "hardware"],
  ["SoftwareInterface", "software"],
  ["HardwareInterface", "hardware"],
  ["SoftwareUnit",      "software"],
  ["HardwareUnit",      "hardware"],
]);
```

The four mechanisms keep their tables, but the tables don't need to encode
discipline directly — they emit type names, and any consumer that wants
discipline calls the registry. Discipline derivation (per ADR-017's "ships
regardless" backlog) becomes a pure registry lookup.

**SSOT shape.** Two SSOTs: the four mechanism tables own _type assignment_; the
registry owns _type → discipline classification_. They're orthogonal — neither
has authority over the other's domain.

**Pros.**

- Addresses the latent coordination issue in Path A: the discipline classifier
  for a type name is now declared exactly once.
- All three structural problems (multi-step chains, load order, validation
  autonomy) remain absent — the registry is internal to core and immutable per
  release.
- Path A's free auto-classification, free trace-rule constraints, and
  `core works without a profile` property all preserved.
- The classifier (`derivedDiscipline`) ADR-017 puts on the "ships regardless"
  list becomes a one-line lookup against the registry.

**Cons.**

- Small refactor (~10–30 lines) to introduce the registry and migrate the four
  mechanisms' consumers to use it.
- The registry must be maintained when a new core SW/HW subtype is added — but
  this is the single place, not four.
- Doesn't help profiles that want to declare _their own_ SW/HW vocabulary (R2
  territory). For those profiles, the registry stays a core-only fact.

## Comparison

| Criterion                                         | R1 — Path A as-is       | R3 — Path A++           | R2 — Path B (single SSOT)              |
| ------------------------------------------------- | ----------------------- | ----------------------- | -------------------------------------- |
| Code surface change                               | None                    | Small (~10–30 lines)    | Large (~230 refs across 26 files)      |
| SSOTs for SW/HW classification                    | 4 implicit              | 2 explicit, orthogonal  | 1 explicit, distributed                |
| Multi-step lookup chains                          | Absent                  | Absent                  | Present (permanent)                    |
| Profile load-order sensitivity for type inference | Absent                  | Absent                  | Present (permanent)                    |
| Trace-validation autonomy                         | Preserved               | Preserved               | Lost (validation queries profile)      |
| Core works without a profile                      | Yes                     | Yes                     | Degraded (auto-classify needs profile) |
| ADR-009 boundary strictness                       | Loose (opinion in core) | Loose (opinion in core) | Strict (opinion in profile)            |
| ASPICE/26262 vocabulary alignment in core         | Direct                  | Direct                  | Via profile                            |
| Test churn                                        | None                    | Small                   | ~70 assertions to rewrite              |
| Future flexibility (new disciplines)              | Requires core change    | Requires core change    | Profile-only                           |
| Coordination across the 4 mechanisms              | Manual                  | Automatic via registry  | N/A (mechanisms become abstract)       |

## Open for criteria-weighting review (joint with ADR-017)

This ADR's three options feed into the same criteria-weighting review that
ADR-017 is awaiting. The two ADRs together form one decision package: the review
picks exactly one of R1, R2, R3, and that pick simultaneously decides ADR-017's
Path A / Path B question.

The mapping is not orthogonal — each option bundles a taxonomy choice with an
SSOT shape:

- **R1 = Path A unchanged.** Status quo. Defer all consolidation.
- **R3 = Path A with internal SSOT consolidation.** Keep the core types; tighten
  internal coordination via the discipline registry. The lowest-cost incremental
  improvement.
- **R2 = Path B with single-SSOT mechanism.** Pay the migration and structural
  costs to achieve a strict ADR-009 boundary.

The reviewer should weigh:

1. **Code-surface change** — willingness to pay refactor cost now.
2. **Structural design cost** — willingness to carry the three permanent costs
   of Path B.
3. **ADR-009 boundary strictness** — how strictly the core/profile boundary
   should be drawn.
4. **Future flexibility** — how often new discipline categories are expected
   (firmware, mechanical, FPGA, …).
5. **Manual vs automated coordination** — preference for a single internal
   registry vs. four hand-coordinated tables.

## Dependencies

- [ADR-003 — Diagram Authoring & Item Taxonomy](adr-003-diagram-authoring.md)
  defines the type hierarchy this ADR debates.
- [ADR-009 — Core / Profile Boundary](adr-009-core-profile-boundary.md) is the
  principle each option interprets differently.
- [ADR-017 — Discipline Classification of Requirements via Allocation
  Graph](adr-017-discipline-classification.md) is the companion ADR; the two
  enter the criteria-weighting review together.

## Status

Proposed.
