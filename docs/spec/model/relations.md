# Trace relations

A **relation** is a typed, directed edge between two entries in the trace graph.
Relations are written as trailer attributes in the source entry; the toolchain
generates the inverse edge automatically in the compiled output.

## Writing a relation

Relations look like any other trailer attribute —
`RelationName:
TARGET_DISPLAY_ID`. Multiple targets are written as one line per
target (or CSV, normalized by `markspec fmt`):

```markdown
- [SRS_BRK_0107] Sensor debouncing

  The sensor driver shall debounce raw inputs.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
      Satisfies: SYS_BRK_0042
      Derived-from: STK_BRK_0003
      Labels: ASIL-B
```

This declares two forward edges:

- `SRS_BRK_0107 --[Satisfies]--> SYS_BRK_0042`
- `SRS_BRK_0107 --[Derived-from]--> STK_BRK_0003`

Multiple targets for the same relation:

```markdown
Satisfies: SYS_BRK_0042 Satisfies: SYS_BRK_0043
```

## Generated inverses

When MarkSpec compiles the graph it writes the reverse edge for every forward
relation. The author **never** writes the inverse — it appears only in the
compiled output:

```text
SRS_BRK_0107  --[Satisfies]-->    SYS_BRK_0042
SYS_BRK_0042  <--[Satisfied-by]-- SRS_BRK_0107   ← generated
```

In `edges.ndjson` (or in `compiled.json`), generated edges are marked with
`"generated": true`. This flag allows consumers to distinguish authorial intent
from toolchain bookkeeping.

## Core relations

The following relations are declared by the `@markspec/default` profile and are
available in any project that uses it. In core-only mode (no profile
configured), these relation keys are treated as unknown attributes (`MSL-A020`).

| Relation         | Inverse          | Typical source type | Typical target type         |
| ---------------- | ---------------- | ------------------- | --------------------------- |
| `Satisfies`      | `Satisfied-by`   | `Requirement`       | `Requirement`, `Objective`  |
| `Derived-from`   | `Derived-by`     | `Requirement`       | `Requirement`               |
| `Verifies`       | `Verified-by`    | `Test`              | `Requirement`, `Contract`   |
| `Tests`          | `Tested-by`      | `Test`              | `SoftwareUnit`, `Component` |
| `Depends-on`     | `Depended-on-by` | `Component`, `Unit` | `Component`                 |
| `Part-of`        | `Has-part`       | `Component`, `Unit` | `Component`                 |
| `Provides`       | `Provided-by`    | `Component`         | `Contract`                  |
| `Requires`       | `Required-by`    | `Component`         | `Contract`                  |
| `Allocated-to`   | `Allocates`      | `Requirement`       | `Component`                 |
| `Realizes`       | `Realized-by`    | `Component`, `Unit` | `Contract`, `Requirement`   |
| `Generated-from` | (none)           | any                 | any                         |
| `Addresses`      | `Addressed-by`   | `Requirement`       | `Change`                    |

`Provides` / `Requires` are the symmetric provider/consumer relations between a
component and a `Contract` (including `SoftwareInterface` /
`HardwareInterface`): a provider `Provides` the contract, a consumer `Requires`
it. `Allocated-to` is **not** reused for provider-hosting — it keeps its single
requirement-allocation meaning.

Note: `Supersedes` / `Superseded-by` are **universal attributes** (not relation
attributes) — they are part of core and are available without any profile. See
the [Attributes](attributes.md) chapter.

**`Allocated-to` drives discipline classification.** Per
[ADR-017](../../architecture/adr-017-discipline-classification.md) the toolchain
walks `Allocated-to` edges from a requirement to the components it is allocated
to and tags the requirement with each reached discipline. The result lands on
`Entry.derivedDiscipline?` in compile output. Authors override the derived value
with the `Discipline:` trailer attribute and freeze it with
`Discipline-frozen:`.

## Cross-shape relations

Both Authored and Reference entries can appear as relation sources or targets. A
requirement can cite a standard, and a component can depend on an open-source
package:

```markdown
# A requirement cites a normative section of an external standard

- [SRS_BRK_0107] Sensor debouncing

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
      References: ISO-26262-6 [§4.3]

# A software component depends on an external package

- [BRK_SW_001] Braking software component

      Id: 01HGW4A5BCD6EFGHJKMNPQRSTUV
      Type: SoftwareComponent
      Depends-on: serde-1-0
```

Here `ISO-26262-6` and `serde-1-0` are the display IDs of Reference-shape
entries elsewhere in the project (or in a federated upstream).

## The trace graph

The following diagram illustrates a typical V-model traceability chain:

```text
STK_BRK_0003          (Objective)
     |
     |  Satisfies ↑  Satisfied-by ↓ (generated)
     ▼
SYS_BRK_0042          (Requirement)
     |
     |  Satisfies ↑  Satisfied-by ↓ (generated)
     ▼
SRS_BRK_0107          (Requirement)  ──── Allocated-to ──► BRK_SW_001
     |                                                          (SoftwareComponent)
     |  Verified-by ↑  Verifies ↓                                   |
     ▼   (generated)                                                 |  Has-part ↓
SWT_BRK_0030          (Test)                               BRK_DEB_001
                                                                (SoftwareUnit)
                                                                     |
                                                                     └── Realizes ──► SRS_BRK_0107
```

Walking the graph upward (via `Satisfied-by`) traces requirements to their
stakeholder objectives. Walking downward (via `Verifies` and `Tests`) traces
requirements to their test coverage.

The `markspec context` command walks the `Satisfies` chain upward from any
entry. The `markspec dependents` command lists all entries that reference a
given entry.

## Relation cardinality

Core relations are many-to-many by default. Profiles can restrict cardinality:

```yaml
relations:
  - key: Superseded-by
    cardinality: single   # only one successor
```

If a single-cardinality relation appears more than once on the same entry, the
validator raises `MSL-A013`.

## Profile-declared relations

Profiles can add new relations beyond the core set:

```yaml
profile:
  relations:
    - key: Mitigated-by
      inverse: Mitigates
      source-types: [hazard]
      target-types: [requirement]
      cardinality: many-to-many

    - key: Addresses
      inverse: Addressed-by
      source-types: [requirement]
      target-types: [change]
```

The `source-types` and `target-types` constraints are advisory — the validator
warns (`MSL-R010`) when a relation is used between types that the profile did
not intend. They are not hard errors because cross-type relations are sometimes
legitimate in practice.

## Locators

A trace value can carry a locator in square brackets after its target. The
locator points at a part of the target: a section of a standard, or a scenario
of a requirement.

```text
References: ISO-26262-6 [§4.3]
Derived-from: ISO-26262-8 [§9.2]
Verifies: REQ_BRK_0010 [Brake at 20 m]
```

### Grammar

A value is the target, optionally followed by whitespace and a locator:

```text
value   = target [ 1*WSP "[" locator "]" ]
```

- The `[` must follow whitespace after the target. `REQ_BRK_0010[x]` has no
  locator.
- Inside the brackets, `\]` stands for a literal `]` and `\\` for a literal
  backslash. Any other backslash sequence is kept as written. The escapes are
  valid inside a locator only.
- A locator can contain commas. Values on one line are split on commas outside
  brackets.
- A locator is normalized for comparison: Unicode NFC, trimmed, and each run of
  whitespace collapsed to one space.
- A value with a `[` after whitespace that no `]` closes has no locator.
  `MSL-L009` reports it. An unclosed `[` never protects commas: the commas after
  it always separate values, also when another value on the line has a closed
  locator. `A [x], B [z, C` gives the values `A [x]`, `B [z` and `C`, and
  `MSL-L009` reports `B [z`. A value without a closed locator is read as before
  locators existed.
- An empty locator (`REQ_BRK_0010 []`) is a locator with an empty name. It names
  no scenario, so on `Satisfies` or `Verifies` it raises `MSL-L007` when the
  target carries scenarios.
- When no value on the line has a closed locator, the line is split on every
  comma, as before locators existed.

### Which relations accept a locator

Whether a relation accepts a locator, and in which mode, is a property of the
core relation. Profile-declared relations have no locator mode.

| Relation       | Locator mode | Meaning of the locator                         |
| -------------- | ------------ | ---------------------------------------------- |
| `Satisfies`    | criterion    | Names a scenario of the target entry.          |
| `Verifies`     | criterion    | Names a scenario of the target entry.          |
| `Derived-from` | free         | Free text (a section, a page). Not checked.    |
| `References`   | free         | Free text (a section, a page). Not checked.    |
| other          | none         | A locator raises `MSL-L008`. The link is kept. |

A value without a closed locator is read as before locators existed: on
`Derived-from` and `References` it links to its first whitespace-separated
token; on every other relation, `Satisfies` and `Verifies` included, it links to
the whole value.

### Resolution

A locator never changes the link target: the link goes to the entry before the
brackets whether or not the locator resolves. `MSL-L006` checks the target only.

A locator in `criterion` mode resolves when the target is a Requirement or
Contract entry and one of its scenarios has that normalized name. Scenarios come
from the top-level fenced `feature` (or `gherkin`) blocks of the target body; a
fence nested in a list item or a block quote is not indexed. A scenario name is
addressable when it is not empty and occurs once in the entry.

- A locator that names no addressable scenario raises `MSL-L007`.
- A locator on a target that does not resolve raises `MSL-L006` only.
- The target may be written as a display ID or as a ULID.
- An upstream (federated) entry carries no criteria. A locator on an upstream
  target raises no `MSL-L007`, the coverage report does not list the target, and
  on an upstream Requirement or Contract the link has `locatorResolved: false`.
- A locator on a target that is not a Requirement or Contract entry (or is a
  Reference entry) is free text and raises no `MSL-L007`.

### Compiled output

Each compiled link keeps the normalized locator in `Link.locator`. It is absent
when the value has no locator. For a locator in `criterion` mode on a target
that is a Requirement or Contract entry, the link also carries
`Link.locatorResolved`: `true` when the locator names an addressable scenario,
`false` otherwise. The field is absent in every other case.

A generated inverse link (for example `Verified-by` for `Verifies`) copies the
locator and `locatorResolved` of the authored link.

```json
{
  "from": "TST_BRK_0012",
  "to": "REQ_BRK_0010",
  "kind": "verifies",
  "locator": "Brake at 20 m",
  "locatorResolved": true
}
```

The lockfile records a locator on its `[[edge]]` rows; see the
[lockfile specification](../internal/markspec-lockfile.md). The coverage report
counts resolved `Verifies` locators per scenario; see
[Scenario locators](../../guide/scenario-locators.md).

## Validation

The validator checks relations in two passes:

1. **Parse pass** — each `RelationName: VALUE` line is parsed. Unknown relation
   keys raise `MSL-A020` (unknown attribute) unless the key is declared by the
   active profile.

2. **Cross-file pass** — after all files are parsed, unresolved references
   (display IDs that do not correspond to any entry in the project or federated
   upstreams) raise `MSL-R001`.

Circular relations (a `Satisfies` chain that returns to its source) are detected
and reported as `MSL-R020`.
