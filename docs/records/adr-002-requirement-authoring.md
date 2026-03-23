# ADR-002: Requirement authoring

Status: Accepted\
Date: 2026-03-01\
Scope: MarkSpec

## Context

MarkSpec needs a requirement authoring format that integrates naturally with
Markdown documents and source code. Requirements must be traceable, carry
structured attributes, and support bidirectional linking — while keeping source
files pure Markdown that renders correctly without tooling.

## Decision

### Requirement types

Three primary types of requirements are defined:

- **STK** — Stakeholder requirements
- **SYS** — System requirements
- **SWE** — Software requirements

### Requirement identifiers

Each requirement has two identifiers:

- **Display ID** — human-readable, formatted as `TYPE_XYZ_NNNN` where `TYPE` is
  STK, SYS, or SWE, `XYZ` is a project or domain abbreviation, and `NNNN` is an
  increasing number starting at 1, unique within the project. Examples:
  `STK_BRK_0001`, `SYS_BRK_0042`, `SWE_BRK_0107`.
- **ULID** — universally unique, formatted as `TYPE_ULID` where `TYPE` is STK,
  SYS, or SWE. Examples: `STK_01HGW2NBX6E3`, `SWE_01HGW2P4KFR7`. The ULID
  ensures global uniqueness across projects and survives renumbering.

The `Id` attribute (ULID) is mandatory for every requirement. It is assigned by
a tooling pass and committed to the repository. Once assigned, it never changes.

### Requirement attributes

Attributes follow the git trailers convention (`Key: Value`) at the end of a
requirement block. They are split into two categories:

**Authored attributes** — written by the author, committed to the repository:

| Attribute        | Description                                                      |
| ---------------- | ---------------------------------------------------------------- |
| **Id**           | ULID, mandatory, assigned by tooling pass                        |
| **Satisfies**    | Upstream link to parent requirement(s)                           |
| **Derived-from** | Upstream link to external source (standard, regulation, HARA)    |
| **Labels**       | Classification tags (ASIL-B, CAL-3, security, performance, etc.) |

**Generated attributes** — computed by tooling from the repository, never
committed:

| Attribute          | Description                                                        |
| ------------------ | ------------------------------------------------------------------ |
| **Verified-by**    | Downstream link to test(s) that verify this requirement            |
| **Implemented-by** | Downstream link to code/component that implements this requirement |

The upstream direction is natural at authoring time — the author knows what the
requirement satisfies or is derived from. Downstream links are discovered later
when tests and code are added.

### Requirement format

Requirements are declared directly in Markdown as list items:

```markdown
- [DISPLAY_ID] Requirement title

  Body paragraphs describing the requirement.

  Key: Value\
  Key: Value
```

The structure is:

- A list item starting with `- [DISPLAY_ID]` marks a requirement boundary
- The first line after the ID is the title
- Subsequent paragraphs are the body text
- Trailing `Key: Value` lines (git trailers convention) are structured
  attributes

### Example

```markdown
- [STK_BRK_0001] Brake response time

  The braking system shall achieve full braking force within 150ms of driver
  input under all operating conditions.

  Id: STK_01HGW2NBX6E3\
  Labels: ASIL-B

- [SYS_BRK_0042] Sensor noise filtering

  The braking system shall filter sensor noise to prevent spurious brake
  activation.

  Id: SYS_01HGW2P4KFR7\
  Satisfies: STK_BRK_0001\
  Labels: ASIL-B

- [SWE_BRK_0107] Sensor input debouncing

  The sensor driver shall debounce raw inputs to eliminate electrical noise
  before processing.

  The debounce window shall be configurable per sensor type.

  Id: SWE_01HGW2Q8MNP3\
  Satisfies: SYS_BRK_0042\
  Labels: ASIL-B
```

### Test types

Three test types mirror the requirement hierarchy, following the V-model:

| Requirement | Test    | Full name                        |
| ----------- | ------- | -------------------------------- |
| **STK**     | **VAL** | Acceptance Test                  |
| **SYS**     | **SIT** | System Integration Test          |
| **SWE**     | **SWT** | Software Unit Qualification Test |

### In-code requirements

When following ATDD, BDD, or Specification by Example practices, the requirement
and its verification can colocate in the same source file. The doc comment on a
test function _is_ the software requirement. The test function below it _is_ the
verification.

Tooling recognizes a doc comment as a MarkSpec requirement when it starts with
`[TYPE_XYZ_NNNN]`, with or without a leading `-`.

**Rust:**

```rust
/// [SWE_BRK_0107] Sensor input debouncing
///
/// The sensor driver shall reject transient noise shorter than
/// the configured debounce window.
///
/// Id: SWE_01HGW2R9QLP4 \
/// Satisfies: SYS_BRK_0042 \
/// Labels: ASIL-B
#[test]
fn swt_brk_0107_debounce_filters_noise() {
    // test implementation
}
```

**Kotlin:**

```kotlin
/**
 * [SWE_BRK_0107] Sensor input debouncing
 *
 * The sensor driver shall reject transient noise shorter than
 * the configured debounce window.
 *
 * Id: SWE_01HGW2R9QLP4 \
 * Satisfies: SYS_BRK_0042 \
 * Labels: ASIL-B
 */
@Test
fun `swt_brk_0107 debounce filters noise`() {
    // test implementation
}
```

**C (Doxygen):**

```c
/**
 * [SWE_BRK_0107] Sensor input debouncing
 *
 * The sensor driver shall reject transient noise shorter than
 * the configured debounce window.
 *
 * Id: SWE_01HGW2R9QLP4 \
 * Satisfies: SYS_BRK_0042 \
 * Labels: ASIL-B
 */
void debounce_input(uint16_t* raw);
```

**C++ (Doxygen):**

```cpp
/// [SWE_BRK_0107] Sensor input debouncing
///
/// The sensor driver shall reject transient noise shorter than
/// the configured debounce window.
///
/// Id: SWE_01HGW2R9QLP4 \
/// Satisfies: SYS_BRK_0042 \
/// Labels: ASIL-B
auto debounce_input(uint16_t raw) -> uint16_t;
```

**Java (JDK 23+):**

```java
/// [SWE_BRK_0107] Sensor input debouncing
///
/// The sensor driver shall reject transient noise shorter than
/// the configured debounce window.
///
/// Id: SWE_01HGW2R9QLP4 \
/// Satisfies: SYS_BRK_0042 \
/// Labels: ASIL-B
@Test
void swt_brk_0107_debounce_filters_noise() {
    // test implementation
}
```

**Language support summary:**

| Language      | Doc syntax       | Markdown native? |
| ------------- | ---------------- | ---------------- |
| Rust          | `///`            | Yes              |
| Kotlin        | `/** */` KDoc    | Yes              |
| C++           | `///` Doxygen    | Yes (since 1.8)  |
| C             | `/** */` Doxygen | Yes (since 1.8)  |
| Java 23+      | `///`            | Yes (JEP 467)    |
| Java (legacy) | `/** */` Javadoc | No (HTML)        |

### Traceability matrix

The traceability matrix is a generated Markdown table included in the book as a
chapter. It is never committed — it is a build artifact produced by tooling from
the upstream declarations in requirements, tests, and code.

### Tool interoperability

The repository is the source of truth. External ALM tools are downstream
consumers. Requirements are authored in MarkSpec and exported to whatever format
the counterpart needs.

**Reconciliation key:** The MarkSpec ULID (`Id` attribute) is the reconciliation
key across all external systems. It travels as a custom attribute in every
export format.

**Two integration lanes:**

1. **ReqIF (formal exchange)** — OMG Requirements Interchange Format for formal
   requirement exchange between organizations. Tooling exports MarkSpec
   requirements to ReqIF with ULID as the `markspec.id` custom attribute.
2. **REST API (continuous sync)** — For teams that want live synchronization
   with an ALM tool. Push tracker items directly via the platform's API, map
   `markspec.id` to a custom field, reconcile on sync.

Compatibility is an output of MarkSpec, not a constraint on it.

## Consequences

- Requirements are authored in the same Markdown files as design documentation —
  no separate tool, no spreadsheet, no external database.
- Authored attributes capture upstream intent. Downstream traceability is
  generated, never manually maintained.
- Git history stays clean — only human-authored content is committed. Generated
  outputs are build artifacts.
- Requirements interchange with external ALM tools is supported via ReqIF export
  and REST API sync.
- The ULID is the reconciliation key across all systems.
