# Trace relations

A **relation** is a typed, directed edge between two entries in the trace graph.
Relations are written as trailer attributes in the source entry; the toolchain
generates the inverse edge automatically in the compiled output.

## Writing a relation

Relations look like any other trailer attribute —
`RelationName:
TARGET_DISPLAY_ID`. Multiple targets are written as one line per
target (or CSV, normalized by `markspec format`):

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

| Relation         | Inverse        | Typical source type | Typical target type         |
| ---------------- | -------------- | ------------------- | --------------------------- |
| `Satisfies`      | `Satisfied-by` | `Requirement`       | `Requirement`, `Objective`  |
| `Derived-from`   | `Derived-by`   | `Requirement`       | `Requirement`               |
| `Verifies`       | `Verified-by`  | `Test`              | `Requirement`, `Contract`   |
| `Tests`          | `Tested-by`    | `Test`              | `SoftwareUnit`, `Component` |
| `Depends-on`     | `Required-by`  | `Component`, `Unit` | `Component`                 |
| `Part-of`        | `Has-part`     | `Component`, `Unit` | `Component`                 |
| `Allocated-to`   | `Allocates`    | `Requirement`       | `Component`                 |
| `Realizes`       | `Realized-by`  | `Component`, `Unit` | `Contract`, `Requirement`   |
| `Generated-from` | (none)         | any                 | any                         |
| `Addresses`      | `Addressed-by` | `Requirement`       | `Change`                    |

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

## Reference-target locators

When a relation targets a Reference-shape entry, the target can include a
locator in square brackets to point to a specific section or element:

```markdown
References: ISO-26262-6 [§4.3] Satisfies: STK_SAFETY_0001
[acceptance-criterion-3]
```

Locators are free text — they are preserved verbatim in the compiled output but
not parsed or validated further. Their meaning is determined by the consuming
tool or reviewer.

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
