# Type taxonomy

MarkSpec's type system has two layers: a **core layer** built into the
toolchain, and a **profile layer** that extends it with domain-specific
subtypes. Core types are available in every project; profile subtypes require
the declaring profile to be active.

## Full type hierarchy

```text
Item  (abstract — root)
├── Specification  (abstract)
│   ├── Requirement
│   ├── Test
│   ├── Contract
│   ├── Record
│   └── Risk
├── Component  (abstract)
│   ├── SoftwareComponent
│   ├── HardwareComponent
│   ├── SoftwareInterface
│   └── HardwareInterface
├── Unit  (abstract)
│   ├── SoftwareUnit
│   └── HardwareUnit
├── Definition
├── Objective
├── Standard
└── Change
```

## Abstract types

Four abstract types structure the taxonomy. They **cannot** be used directly as
`Type:` values — they exist as extension targets for the concrete types below
them and for profile-declared subtypes.

| Abstract type   | Purpose                                         | Extended by                                                                        |
| --------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `Item`          | Root; ultimate fallback for all type resolution | All 15 concrete types; any profile subtype                                         |
| `Specification` | Normative statements; things that must or shall | `Requirement`, `Test`, `Contract`, `Record`, `Risk`                                |
| `Component`     | System-level building blocks with identity      | `SoftwareComponent`, `HardwareComponent`, `SoftwareInterface`, `HardwareInterface` |
| `Unit`          | Fine-grained implementation-level elements      | `SoftwareUnit`, `HardwareUnit`                                                     |

## Concrete types — Specification subtypes

### Requirement

Normative statement of what the system shall do. The primary entry type in most
traceable documentation projects.

- **Typical relations:** `Satisfies` (→ upstream `Requirement` or `Objective`),
  `Derived-from` (→ other `Requirement`). Verified by `Test` entries via
  `Verified-by` (generated inverse of `Verifies`).
- **Typical profile attributes:** `ASIL`, `Priority`, `Safety-goal`

```markdown
- [SRS_BRK_0107] Sensor debouncing

  The sensor driver shall debounce raw inputs to eliminate noise.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
      Satisfies: SYS_BRK_0042
      Labels: ASIL-B
```

### Test

A test case, test procedure, or test result. Records what was checked and how.

- **Typical relations:** `Verifies` (→ `Requirement`), `Tests` (→ `SoftwareUnit`
  or `Component`).
- **Typical profile attributes:** `Test-level`, `Test-type`, `Test-result`

```markdown
- [SWT_BRK_0030] Debounce unit test

  The debounce function shall reject inputs shorter than the configured
  threshold duration.

      Id: 01HGW3R9QNP4ABCDEFGHJKMNPQ
      Type: test
      Verifies: SRS_BRK_0107
      Labels: ASIL-B
```

### Contract

An interface or API contract. Defines the boundary between two components or
layers.

- **Typical relations:** `Satisfies` (→ `Requirement`), `Realized-by` (generated
  inverse of `Realizes` from a `Component`).

### Record

An immutable audit record, decision log, or meeting minute. Typically stands
alone — not part of a `Satisfies` chain.

- Records are append-only by convention. Do not edit the body of a published
  record; supersede it instead.

### Risk

A hazard or FMEA entry. Profiles typically add safety-classification attributes.

- **Typical relations:** `Mitigated-by` (generated inverse of `Mitigates` from a
  `Requirement`).
- **Typical profile attributes:** `ASIL`, `Severity`, `Probability`

```markdown
- [HAZ_BRK_0003] Loss of braking under wheel-lock condition

  If the braking actuator saturates, the wheel may lock, leading to loss of
  vehicle directional control.

      Id: 01HGW5F7GHJ8KLMNPQRSTVWXYZ
      Type: Risk
      Labels: ASIL-D
```

## Concrete types — Component subtypes

### SoftwareComponent

A software module, service, or subsystem.

- **Typical relations:** `Part-of` (→ `SoftwareComponent`), `Depends-on` (→
  `SoftwareComponent`), `Allocates` (generated inverse when a `Requirement` uses
  `Allocated-to`).

### HardwareComponent

An ECU, sensor, actuator, or other physical hardware element.

- **Typical relations:** `Part-of` (→ `HardwareComponent`), `Realizes` (→
  `Contract`).
- **Typical profile attributes:** `Supplier`, `Part-number`

### SoftwareInterface

An API, IPC channel, or protocol definition — the contract between two software
components.

- **Typical relations:** `Part-of` (→ `SoftwareComponent`), `Realized-by`
  (generated inverse of `Realizes`).

### HardwareInterface

A connector, bus, pin definition, or other physical interface.

- **Typical relations:** `Part-of` (→ `HardwareComponent`).

## Concrete types — Unit subtypes

### SoftwareUnit

A function, class, or module — the implementation-level granularity unit. Often
co-located with source code doc comments.

- **Typical relations:** `Part-of` (→ `SoftwareComponent`), `Realizes` (→
  `Contract` or `Requirement`).

```kotlin
/**
 * [BRK_DEB_001] Debounce unit
 *
 * The debounce unit filters out raw sensor pulses shorter than the
 * configured threshold.
 *
 *     Id: 01HGW6B3CDE7FGHJKMNPQRSTUV
 *     Type: SoftwareUnit
 *     Part-of: BRK_SW_001
 *     Realizes: SRS_BRK_0107
 */
class DebounceFilter(private val thresholdMs: Int) { ... }
```

### HardwareUnit

A circuit, sub-assembly, or other fine-grained hardware element.

- **Typical relations:** `Part-of` (→ `HardwareComponent`).

## Concrete types — Item subtypes

### Definition

A glossary term. Used in `GLOSSARY.md` or equivalent. A planned lint rule
(`MSL-Q020`) will flag entries that use a term defined in the glossary without a
`References:` link to the `Definition` entry.

### Objective

A goal, OKR, or strategic objective. The upstream anchor for `Requirement`
`Satisfies` chains. Objectives typically have no upstream targets — they are the
roots of the traceability tree.

- **Typical profile attributes:** `Priority`

### Standard

A normative external document. Always **Reference shape** (`Id:` is a `urn:`,
`doi:`, or `https:` URI). Profile adds `Reference-url`, `Reference-document`,
and `License` attributes (via `@markspec/default`).

```markdown
- [@ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety — Part 6: Product development at the
  software level.

      Id: urn:iso:std:iso:26262:-6:ed-2
      Type: Standard
      Reference-document: ISO 26262-6:2018
      Reference-url: https://www.iso.org/standard/68388.html
      License: ISO-proprietary
```

### Change

A change request, issue, or ticket. Linked to `Requirement` entries via
`Addresses` / `Addressed-by`.

- **Typical profile attributes:** `Priority`, `Status`

## Type resolution chain

When MarkSpec resolves the type of an entry it walks 8 steps, first match wins:

```text
1. Explicit Type: trailer value
   ↓ (absent or unrecognised)
2. Profile display-ID pattern match  (e.g. SRS_BRK_* → requirement)
   ↓ (no pattern matches)
3. Profile file-glob match  (e.g. tests/** → test)
   ↓ (no glob matches)
4. Profile document-level directive  (<!-- markspec:type requirement -->)
   ↓ (not set)
5. Core display-ID prefix heuristic
   ↓ (no match)
6. Core file-name heuristic  (GLOSSARY.md → Definition)
   ↓ (no match)
7. Inherited from parent entry  (nested list item)
   ↓ (no parent)
8. Fallback → Item
```

Steps 2–4 require a profile to be active. In core-only mode (no profile
configured), only steps 1, 5, 6, 7, and 8 apply.

An explicit `Type:` value that names an unknown type raises `MSL-T020`. A
profile can suppress this by declaring the type — the unknown-type check is
relative to the active profile, not to the core type list.

## Two entry shapes

The `Id:` trailer value determines an entry's **shape**, independently of its
type. Type and shape are fully orthogonal:

```text
Id: 01HGW2Q8MNP3RSTVWXYZABCDEF     ← Authored (bare ULID)
Id: urn:iso:std:iso:26262:-6:ed-2  ← Reference (URI with scheme)
```

Shape affects serialization, which attributes are meaningful (e.g., `Supersedes`
only makes sense for Authored entries), and how the entry is displayed in
traceability reports.

## Profile subtypes

Profiles declare additional concrete types via `extends:`. The new type inherits
all rules and relations of its parent core type and can add domain-specific
attributes and display-ID patterns:

```yaml
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "SRS_{n:4d}"
    hazard:
      extends: Risk
      display-id-pattern: "HAZ_{n:4d}"
    feature:
      extends: Requirement
      display-id-pattern: "FEAT_{n:4d}"
```

**Naming convention:** profile type names use `lowercase-with-hyphens`; core
type names use `PascalCase`. This makes the origin unambiguous at a glance —
`requirement` is a profile subtype of `Requirement`.

Profile subtypes appear in the type-resolution chain at step 1 (when used
explicitly as the `Type:` value) and step 2 (when matched by their display-ID
pattern). They cannot shadow core type names — attempting to declare a profile
type named `Requirement` raises `MSL-A040`.
