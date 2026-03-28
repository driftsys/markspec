# MarkSpec — Markdown Flavor Specification

## Introduction

MarkSpec is a Markdown flavor for traceable industrial documentation. It targets
safety-critical and high-availability systems where requirements, traceability,
and compliance documentation must live alongside code in version control.

MarkSpec is a three-layer stack:

1. **[CommonMark]** — the parsing baseline.
2. **[GFM] / [GLFM] shared subset** — platform extensions portable across GitHub
   and GitLab.
3. **MarkSpec extensions** — requirement authoring, captions, inline references,
   directives, and book structure.

Source files are pure, readable Markdown. They render correctly on GitHub and
GitLab without any build step. PDF generation, traceability matrices, and
reference resolution are build concerns — not format concerns.

This specification is the normative reference for MarkSpec tooling.

---

## Part 1 — Markdown Flavor

### 1.1 CommonMark

MarkSpec accepts all [CommonMark] syntax. The following features are supported
without modification:

**Headings:**

```markdown
# Document Title

## Section

### Subsection
```

**Paragraphs and inline formatting:**

```markdown
The braking system shall achieve full braking force within 150ms of driver
input. The _debounce window_ is configurable. Use **bold** for emphasis and
`debounce_input()` for code.
```

**Block quotes:**

```markdown
> The system shall meet all requirements specified in ISO 26262-6 §9.4 for
> software unit testing.
```

**Lists:**

```markdown
- Pressure sensor
- Speed sensor
- Temperature sensor

1. Capture raw input
2. Apply debounce filter
3. Validate plausible range
```

**Fenced code blocks** (language required):

````markdown
```rust
fn debounce_input(raw: u16) -> u16 {
    // implementation
}
```
````

**Inline links:**

```markdown
See [ISO 26262-6](https://www.iso.org/standard/68388.html) for software-level
requirements.
```

**Reference links:**

```markdown
See [ISO 26262-6] for software-level requirements.

[ISO 26262-6]: https://www.iso.org/standard/68388.html
```

**Images** (alt text required):

```markdown
![Braking system architecture](diagrams/braking-overview.svg)
```

**Hard line breaks** (trailing `\`):

```markdown
Id: SRS_01HGW2Q8MNP3\
Satisfies: SYS_BRK_0042\
Labels: ASIL-B
```

**Horizontal rules:**

```markdown
---
```

**HTML comments** (used for directives):

```markdown
<!-- markspec:ignore -->
```

MarkSpec **restricts** the following CommonMark features:

| Feature          | CommonMark                               | MarkSpec restriction                          |
| ---------------- | ---------------------------------------- | --------------------------------------------- |
| Headings         | ATX and setext                           | ATX only.                                     |
| Code blocks      | Fenced (backtick and tilde) and indented | Backtick-fenced only.                         |
| Emphasis         | `*text*` and `_text_`                    | `_text_` only.                                |
| Strong           | `**text**` and `__text__`                | `**text**` only.                              |
| List markers     | `-`, `*`, `+`                            | `-` only.                                     |
| Horizontal rules | `---`, `***`, `___`                      | `---` only.                                   |
| Hard line breaks | Trailing `\` and trailing double-space   | Trailing `\` only.                            |
| Inline HTML      | Any HTML element                         | Comments only (`<!-- -->`). No HTML elements. |
| Front matter     | YAML `---` blocks (not CommonMark)       | Not allowed.                                  |

MarkSpec **requires** beyond CommonMark minimums:

| Requirement         | Rule                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------- |
| First line          | Must be an H1 heading.                                                                    |
| H1 count            | Exactly one H1 per file. Summary documents are exempt — additional H1s are part headings. |
| Heading levels      | Must not skip (H2 → H4 is invalid).                                                       |
| Code fence language | Required. Use `text` for plain output.                                                    |
| Image alt text      | Required on every image.                                                                  |

### 1.2 GFM / GLFM shared subset

Only features supported by **both** [GFM] and [GLFM] are used. Platform-specific
extensions are not part of the flavor.

#### Tables

Pipe syntax. Rows are exempt from line width limits.

```markdown
| Sensor   | Min | Max  | Unit |
| -------- | --- | ---- | ---- |
| Pressure | 0   | 1023 | kPa  |
| Speed    | 0   | 255  | km/h |
```

#### Strikethrough

```markdown
~~deprecated requirement~~
```

#### Task lists

```markdown
- [x] Define sensor thresholds
- [ ] Validate against hardware spec
- [ ] Update traceability matrix
```

#### Footnotes

Supplementary context only — not for traceability.

```markdown
The debounce window[^1] shall be configurable per sensor type.

[^1]: Debouncing eliminates transient electrical noise from raw sensor readings.
```

#### Syntax highlighting

Language identifier is required on all fenced code blocks.

````markdown
```rust
fn debounce_input(raw: u16, window_ms: u32) -> u16 {
    // implementation
}
```
````

#### Math

Inline and block math expressions:

```markdown
The response time is $t = 150\text{ms}$ under nominal conditions.

$$
d = v \cdot t
$$
```

#### Alerts

```markdown
> [!NOTE]
> This requirement derives from ISO 26262-6 §9.4.

> [!WARNING]
> Failure to debounce may lead to spurious brake activation.

> [!CAUTION]
> **ASIL-B constraint** — changes require impact analysis.
```

Supported types: `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`. Custom title
via bold text on the first line.

### 1.3 MarkSpec extensions

All extensions use valid CommonMark syntax — they render on GitHub and GitLab
without tooling.

#### §1 Entry blocks

A list item starting with `- [DISPLAY_ID]` followed by a title on the same line,
and indented body content on subsequent lines. The display ID is the entry's
human-readable identifier. The title is the rest of the first line after the
closing `]`.

```markdown
- [DISPLAY_ID] Title

  Body paragraphs.

  Key: Value\
  Key: Value
```

A `- [DISPLAY_ID]` with no indented body is a normal list item — not an entry
block.

**Example 1 — entry block:**

```markdown
- [SRS_BRK_0107] Sensor input debouncing

  The sensor driver shall debounce raw inputs to eliminate electrical noise
  before processing.

  The debounce window shall be configurable per sensor type.

  > [!WARNING]
  > Failure to debounce may lead to spurious activation.

  Id: SRS_01HGW2Q8MNP3\
  Satisfies: SYS_BRK_0042\
  Labels: ASIL-B
```

**Example 2 — not an entry block:**

```markdown
- [See documentation] for details on configuration.
```

No indented body. Normal list item.

Emphasis (`_text_`) must not appear inside entry blocks. Strong (`**text**`) and
inline code are allowed.

Part 2 defines the two families of entries (typed entries and reference
entries), their ID formats, and their attributes.

#### §2 Attribute blocks

`Key: Value` lines at the end of an entry block. Separated by trailing `\`
except the last line.

**Example 3 — attribute block:**

```markdown
Id: SRS_01HGW2Q8MNP3\
Satisfies: SYS_BRK_0042\
Labels: ASIL-B
```

Which attributes are valid depends on the entry type. Part 2 defines the builtin
attributes.

Generated attributes (`Verified-by`, `Implemented-by`) are computed by tooling
and never appear in source.

#### §3 Table captions

Emphasized paragraph starting with `Table:` immediately above a pipe table.

**Example 4 — table with caption:**

```markdown
_Table: Sensor thresholds_

| Sensor   | Min | Max  |
| -------- | --- | ---- |
| Pressure | 0   | 1023 |
```

Slug: `tbl.sensor-thresholds`. Derived by stripping the `Table:` prefix, then
applying the GFM anchor algorithm (lowercase, spaces to hyphens, punctuation
stripped).

**Example 5 — not a caption:**

```markdown
_This is just italic text._

| Column A | Column B |
| -------- | -------- |
```

Does not start with `Table:`.

#### §4 Figure captions

Emphasized paragraph starting with `Figure:` immediately below an image.
Alternatively, the image alt text is the caption.

**Example 6 — explicit caption:**

```markdown
![System overview](overview.svg)

_Figure: High-level architecture of the braking system_
```

Slug: `fig.high-level-architecture-of-the-braking-system`. Derived by stripping
the `Figure:` prefix, then applying the GFM anchor algorithm.

**Example 7 — alt text as caption:**

```markdown
![System overview](overview.svg)
```

Slug: `fig.system-overview`. Explicit caption takes precedence.

#### §5 In-code entries

Requirements can be authored in doc comments in source files. A doc comment
starting with `[TYPE_XYZ_NNNN]` is recognized as a MarkSpec requirement. The
leading `-` bullet is optional in doc comments — the `[DISPLAY_ID]` pattern
alone is sufficient.

**Example 8 — Rust doc comment requirement:**

```rust
/// [SRS_BRK_0107] Sensor input debouncing
///
/// The sensor driver shall reject transient noise shorter
/// than the configured debounce window.
///
/// Id: SRS_01HGW2R9QLP4 \
/// Satisfies: SYS_BRK_0042 \
/// Labels: ASIL-B
#[test]
fn swt_brk_0107_debounce_filters_noise() {
    // test implementation
}
```

The doc comment is the requirement. The test function is the verification. The
`Verified-by` link is implicit — tooling discovers that the test carrying this
doc comment is the SWT.

Code annotations declare upstream links:

```rust
/// Verifies: SRS_BRK_0107
#[test]
fn swt_brk_0107_debounce_filters_noise() { ... }

/// Implements: SRS_BRK_0107
fn debounce_input(raw: u16) -> u16 { ... }
```

Tooling extracts doc comments and `Verifies:` / `Implements:` annotations to
produce the same traceability output as Markdown-authored entries.

---

## Part 2 — Builtin Types and Attributes

Part 1 defines the format — how to write entry blocks and attribute blocks. This
part defines the vocabulary — the builtin types, their attributes, and their
traceability rules.

### 2.1 Typed entries

An entry whose display ID matches `TYPE_XYZ_NNN[N]` (uppercase letters,
underscore, 2–12 uppercase letters, underscore, zero-padded number of 3 or 4
digits starting from `001`) is a typed entry. Typed entries are recognized in
any MarkSpec file.

Typed entries have two identifiers:

- **Display ID** — human-readable, in the `[...]` marker. `TYPE` is the entry
  type. `XYZ` is a 2–12 letter project or domain abbreviation. `NNN[N]` is
  zero-padded from `001` (3 digits) or `0001` (4 digits), unique within the
  project.
- **ULID** — universally unique, in the `Id:` attribute. Formatted as
  `TYPE_ULID` (e.g., `SRS_01HGW2Q8MNP3`). The ULID ensures global uniqueness
  across projects and survives renumbering. Mandatory. Assigned by tooling,
  never hand-authored. Once assigned, it never changes.

**Builtin types:**

| Category     | Type  | Full name                  |
| ------------ | ----- | -------------------------- |
| Requirements | `STK` | Stakeholder requirement    |
|              | `SYS` | System requirement         |
|              | `SRS` | Software requirement       |
| Architecture | `SAD` | Architecture description   |
|              | `ICD` | Interface control document |
| Verification | `VAL` | Acceptance test            |
|              | `SIT` | System integration test    |
|              | `SWT` | Software test              |

Non-builtin types are valid — tooling validates entry format but not
traceability direction or level.

### 2.2 Typed entry attributes

| Attribute      | Required | Format                                  |
| -------------- | -------- | --------------------------------------- |
| `Id`           | yes      | `TYPE_ULID`                             |
| `Satisfies`    | no       | Parent entry display ID(s)              |
| `Derived-from` | no       | Reference ID + optional section locator |
| `Labels`       | no       | Comma-separated tags                    |

**`Derived-from` format:**

```text
Derived-from: ISO-26262-6 §9.4
```

The ID before the space (`ISO-26262-6`) is validated against the registry chain.
The section locator after it (`§9.4`) is free text — tooling warns on unknown
sections when lists are available but does not error.

### 2.3 Reference entries

An entry whose display ID does not match `TYPE_XYZ_NNNN` is a reference entry.
Reference IDs are slugs: letters, digits, and hyphens (`[A-Za-z0-9-]+`).
Reference entries are recognized only in documents of type `references`.

**ID conventions:**

```text
ISO-26262-6        ← ISO 26262-6:2018
ISO-IEC-15504      ← ISO/IEC 15504
DO-178C            ← RTCA DO-178C
ECSS-E-ST-40C      ← ECSS-E-ST-40C
SAE-J3061          ← SAE J3061
MISRA-C-2012       ← MISRA C:2012
AUTOSAR-R22-11     ← AUTOSAR R22-11
```

**Example 9 — reference entries:**

```markdown
- [ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety — Part 6: Product development at the
  software level.

  Document: ISO 26262-6:2018\
  URL: https://www.iso.org/standard/68383.html

- [DO-178C] DO-178C

  Software Considerations in Airborne Systems and Equipment Certification.

  Document: RTCA DO-178C\
  URL: https://www.rtca.org/products/do-178c/
```

**Reference entry attributes:**

| Attribute       | Required | Format                              |
| --------------- | -------- | ----------------------------------- |
| `Document`      | no       | Full document identifier            |
| `URL`           | no       | Canonical URL                       |
| `Status`        | no       | `active`, `withdrawn`, `superseded` |
| `Superseded-by` | no       | Replacement entry ID                |
| `Derived-from`  | no       | Parent standard or regulation       |

Reference IDs are used in `{{ref.ISO-26262-6}}` inline references and in
`Derived-from:` attributes on typed entries.

### 2.4 Requirement types

Three levels following the V-model hierarchy:

- **STK** — stakeholder requirements.
- **SYS** — system requirements.
- **SRS** — software requirements.

Direction is upward: SRS → SYS → STK via `Satisfies:`.

### 2.5 Architecture types

**SAD** — architecture descriptions. Subtypes distinguished by attribute
presence:

- **Decomposition** — defines components. No extra attributes.
- **Allocation** — maps requirements to components. `Allocates:` + `Component:`.
- **Constraint** — defines architectural rules. `Constrains:`.

**Example 10 — SAD decomposition:**

```markdown
- [SAD_BRK_0001] Braking system decomposition

  The braking subsystem consists of three components: sensor-driver, controller,
  and actuator-interface.

  Id: SAD_01HGW3A1BCD2\
  Satisfies: SYS_BRK_0001\
  Labels: ASIL-B
```

**Example 11 — SAD allocation:**

```markdown
- [SAD_BRK_0010] Sensor debouncing allocation

  Sensor input debouncing is allocated to the braking ECU sensor-driver
  partition.

  Id: SAD_01HGW3A2EFG3\
  Allocates: SRS_BRK_0107\
  Component: BRK-ECU-SENSOR\
  Labels: ASIL-B
```

**SAD-specific attributes:**

| Attribute    | Format                              |
| ------------ | ----------------------------------- |
| `Allocates`  | SRS display ID(s)                   |
| `Component`  | Component name or registry entry ID |
| `Constrains` | Component name(s)                   |

**ICD** — interface control documents. System-level contracts between deployment
units, ECUs, or external systems.

**Example 12 — ICD entry:**

```markdown
- [ICD_BRK_0001] Brake pressure CAN interface

  The braking ECU shall publish brake pressure on CAN message 0x142 at 10ms
  cycle time. Payload: 16-bit unsigned, 0.1 bar resolution, big-endian.

  Id: ICD_01HGW4A1BCD2\
  Between: braking-ecu, vehicle-dynamics-ecu\
  Satisfies: SYS_BRK_0035\
  Interface: {{ridl.brake-pressure-can}}\
  Labels: ASIL-B
```

**ICD-specific attributes:**

| Attribute   | Format                                  |
| ----------- | --------------------------------------- |
| `Between`   | Two parties, comma-separated            |
| `Interface` | Optional RIDL reference (`{{ridl.id}}`) |

SAD satisfies SYS. ICD satisfies SYS or SAD.

### 2.6 Verification types

Three test types mirror the requirement hierarchy:

| Requirement | Test    | Full name               |
| ----------- | ------- | ----------------------- |
| **STK**     | **VAL** | Acceptance test         |
| **SYS**     | **SIT** | System integration test |
| **SRS**     | **SWT** | Software test           |

Each test level verifies its corresponding requirement level — cross-level
verification is an error (MSL-T007).

ICD entries are verified by SIT — the test proves both sides implement the
contract. A SIT entry can carry `Verifies: ICD_BRK_0001` alongside
`Verifies: SYS_BRK_0042`. No additional test type is needed.

---

## Part 3 — Directives

Directives are HTML comments starting with `markspec:`. They are invisible on
GitHub and GitLab. A `markspec:` token at the start of a line inside an HTML
comment begins a directive. Everything until the next `markspec:` or `-->` is
the payload.

### 3.1 Syntax

**Example 13 — single directive:**

```markdown
<!-- markspec:glossary -->
```

**Example 14 — multiple directives with multiline payload:**

```markdown
<!--
markspec:deck
markspec:deprecated Superseded by braking-v2.md which
  implements the revised sensor interface defined in
  SYS_BRK_0050.
-->
```

Continuation lines without `markspec:` are part of the previous directive's
payload.

**Parsing rules:**

1. Scan each HTML comment for lines starting with `markspec:`.
2. Token after `markspec:` is the directive name.
3. Remainder of line is the start of the payload.
4. Lines not starting with `markspec:` are payload continuation.
5. A new `markspec:` line or `-->` terminates the payload.
6. Range directives closed by `<!-- markspec:end NAME -->`.

### 3.2 Document directives

Placed in the first HTML comment after the H1 heading.

| Directive             | Payload            | Context |
| --------------------- | ------------------ | ------- |
| `markspec:glossary`   | none               | doc     |
| `markspec:summary`    | none               | doc     |
| `markspec:deck`       | none               | deck    |
| `markspec:references` | registry URL       | both    |
| `markspec:deprecated` | reason (free text) | both    |
| `markspec:paginate`   | none               | deck    |

Type directives (`glossary`, `summary`, `deck`) are mutually exclusive.
`deprecated` and `references` can coexist with a type directive. `doc` is the
default — no directive for it. Multiple `markspec:references` directives declare
multiple upstream registries. Order matters — registries are searched first to
last, with an implicit fallback to RefHub.

`glossary` and `summary` are auto-detected from filename (`GLOSSARY.md`,
`SUMMARY.md`). The directive is needed when the file has a different name (e.g.,
`toc.md` with `markspec:summary`). `deck` is never auto-detected — it always
requires an explicit directive.

**Example 15 — deck with pagination:**

```markdown
# Architecture Review

<!--
markspec:deck
markspec:paginate
-->

---

## System Boundaries

...
```

**Example 16 — deprecated glossary:**

```markdown
# Legacy Terms

<!--
markspec:glossary
markspec:deprecated Replaced by platform-glossary.md as of
  v2.0.0.
-->
```

**Example 17 — upstream registries:**

```markdown
# Braking Controller

<!--
markspec:references https://safety.company.io/registry
markspec:references https://driftsys.github.io/refhub
-->
```

Each `markspec:references` declares one upstream registry. Order matters —
registries are searched first to last. RefHub is the implicit final fallback
even if not declared.

### 3.3 Inline directives

Placed anywhere in the document body.

| Directive                    | Payload          | Closing                | Context |
| ---------------------------- | ---------------- | ---------------------- | ------- |
| `markspec:break`             | `page`, `column` | —                      | both    |
| `markspec:columns`           | count (`2`, `3`) | `markspec:end columns` | both    |
| `markspec:section`           | section name     | —                      | deck    |
| `markspec:notes`             | free text        | inside comment         | deck    |
| `markspec:disable`           | MSL rule ID(s)   | `markspec:end disable` | both    |
| `markspec:disable-next-line` | MSL rule ID(s)   | —                      | both    |
| `markspec:ignore`            | none             | `markspec:end ignore`  | both    |

`markspec:disable` opens a range closed by `markspec:end disable`.
`markspec:disable-next-line` suppresses rules for the next line only.
`markspec:ignore` skips all MarkSpec processing — content inside the range is
treated as plain Markdown with no requirement parsing, reference resolution, or
MSL validation.

**Example 18 — multi-column layout:**

```markdown
<!-- markspec:columns 2 -->

Content in the first column.

<!-- markspec:break column -->

Content in the second column.

<!-- markspec:end columns -->
```

In decks, `markspec:break column` works within a slide without the
`markspec:columns` range — slide boundaries are the implicit region.

**Example 19 — slide section:**

```markdown
---

<!-- markspec:section Architecture -->

## System Boundaries

A high-level view of the braking subsystem

---

## Component Design

...
```

The section name appears in slide footers until the next `markspec:section`.

**Example 20 — speaker notes:**

```markdown
<!--
markspec:notes
Mention the 150ms response time requirement from
STK_BRK_0001. The debounce window was determined
by bench testing with the Bosch sensor module.
-->
```

Notes are entirely inside an HTML comment. The `-->` closes the payload — no
`markspec:end notes` needed.

**Example 21 — page break:**

```markdown
<!-- markspec:break page -->
```

**Example 22 — lint suppression:**

```markdown
<!-- markspec:disable MSL-R011 -->

- [SRS_BRK_0108] Some _legacy_ requirement

<!-- markspec:end disable -->

<!-- markspec:disable-next-line MSL-R011 -->

- [SRS_BRK_0109] Another _legacy_ one
```

---

## Part 4 — Book Structure

A MarkSpec book organizes MarkSpec files into a single navigable document. The
book is defined by a source directory containing a `SUMMARY.md` at its root.

### 4.1 Layout

The book source directory contains the `SUMMARY.md` and all files it references.
Directory structure is free-form — the `SUMMARY.md` defines the navigation, not
the file tree.

**Example 23 — book source directory:**

```text
src/
├── SUMMARY.md
├── GLOSSARY.md
├── overview.md
├── product/
│   ├── stakeholder-requirements.md
│   └── software-requirements/
│       ├── README.md
│       └── braking.md
├── architecture/
│   └── system-architecture.md
└── guide/
    └── getting-started.md
```

### 4.2 Summary

The summary is a `SUMMARY.md` file at the root of the book source directory. It
is a manually authored table of contents — not a generated file tree. The author
decides what appears and in what order.

The core structure is a nested list of links. Each link is a chapter. Nesting
creates sub-chapters.

**Example 24 — SUMMARY.md without parts:**

```markdown
# Braking Controller

- [Overview](overview.md)
- [Requirements](requirements.md)
- [Architecture](architecture.md)
- [Getting Started](getting-started.md)
- [Glossary](GLOSSARY.md)
```

**Optional elements:**

- **Unnested links** — links outside a list. Front matter (before the first
  `---`) and back matter (after the last `---`). Rendered without numbering.
- **Part headings** — H1 headings (`# Part Name`) label groups of chapters.
  Rendered as unclickable section dividers.
- **Separators** — `---` separates front matter, body, and back matter.

**Example 25 — SUMMARY.md with front matter, parts, back matter, and annexes:**

```markdown
# Braking Controller

[Overview](overview.md) [Introduction](introduction.md)

---

# Product

- [Stakeholder Requirements](product/stakeholder-requirements.md)
- [System Requirements](product/system-requirements.md)
- [Software Requirements](product/software-requirements/README.md)
  - [Braking](product/software-requirements/braking.md)
  - [Steering](product/software-requirements/steering.md)
  - [Diagnostics](product/software-requirements/diagnostics.md)

# Architecture

- [System Architecture](architecture/system-architecture.md)
- [Software Architecture](architecture/software-architecture.md)
- [Interface Contracts](architecture/interface-contracts.md)
- [Decisions](architecture/decisions/README.md)
  - [ADR-001: Documentation Format](architecture/decisions/adr-001.md)

# Guide

- [Getting Started](guide/getting-started.md)
- [Configuration](guide/configuration.md)
- [Troubleshooting](guide/troubleshooting.md)

# Verification

- [Traceability Matrix](verification/traceability-matrix.md)
- [Test Reports](verification/test-reports.md)

---

# Annexes

- [Color Palettes](annexes/color-palettes.md)
- [Coding Standards](annexes/coding-standards.md)

---

[Glossary](GLOSSARY.md) [Contributing](CONTRIBUTING.md)
[Changelog](CHANGELOG.md) [License](LICENSE.md)
```

The first H1 is the book title. Subsequent H1s are part headings. Front matter
(unnested links before the first `---`) introduces the book. Back matter
(unnested links after the last `---`) is reference and administrative content.
Both render without numbering.

**Rules:**

- The first H1 is the book title.
- Summary documents are exempt from the single-H1 rule — additional H1s are part
  headings.
- `---` separates front matter, body, and back matter.
- Every file referenced must exist.
- Empty links (`- [Title]()`) are not allowed.
- The summary is committed and human-authored — tooling may validate it but does
  not generate it.

### 4.3 Glossary

The glossary is a `GLOSSARY.md` file (or any file with a `markspec:glossary`
directive). It uses heading-based structure.

**Example 26 — glossary:**

```markdown
# Glossary

## A

### ASIL

Automotive Safety Integrity Level. Risk classification defined by [ISO 26262]
ranging from QM (quality managed, no safety relevance) to D (highest
criticality). The level is determined by the [HARA] process.

### ASPICE

Automotive SPICE. A process assessment model for the automotive industry derived
from [ISO/IEC 15504].

## H

### HARA

Hazard Analysis and Risk Assessment. Systematic process defined in [ISO 26262]
Part 3 for identifying hazards and assigning [ASIL] levels.

<!-- Internal references -->

[ASIL]: #asil
[ASPICE]: #aspice
[HARA]: #hara

<!-- External references -->

[ISO 26262]: https://www.iso.org/standard/68383.html
[ISO/IEC 15504]: https://www.iso.org/standard/60555.html
```

**Structure rules:**

- H1 for the title.
- H2 for letter groupings.
- H3 for terms — alphabetically sorted within each group.
- Link reference definitions at the end of the file — internal cross-links
  first, external references second.

---

## Part 5 — Inline References

Inline references resolve content entities across all documents in the project.
They use double braces: `{{namespace.id}}`.

### 5.1 Syntax

**Example 27 — requirement and test references:**

```markdown
This module implements {{req.SRS_BRK_0107}}. Verified by {{test.SWT_BRK_0107}}.
```

**Example 28 — reference to a standard:**

```markdown
Derived from {{ref.ISO-26262-6}}.
```

**Example 29 — figure, table, and heading references:**

```markdown
See {{fig.system-overview}} and {{tbl.sensor-thresholds}}. Refer to
{{h.requirement-format}} for the full syntax.
```

On GitHub/GitLab: the braces render as plain text — the ID is human-readable. At
build time: resolved to links.

### 5.2 Namespaces

| Namespace | References                   | ID source         |
| --------- | ---------------------------- | ----------------- |
| `req`     | Requirements (STK, SYS, SRS) | Display ID        |
| `arch`    | Architecture (SAD, ICD)      | Display ID        |
| `test`    | Tests (VAL, SIT, SWT)        | Display ID        |
| `ref`     | External references          | Registry entry ID |
| `fig`     | Figures                      | Slug from caption |
| `tbl`     | Tables                       | Slug from caption |
| `h`       | Headings                     | GFM anchor        |

Slugs use the GFM algorithm: lowercase, spaces to hyphens, punctuation stripped.

### 5.3 Rules

- Exactly two braces: `{{` and `}}`.
- The **first** period separates namespace from ID (e.g., `{{ref.ISO-26262-6}}`
  → namespace `ref`, ID `ISO-26262-6`).
- No whitespace inside braces.
- No sections (`{{#}}`), inverted sections (`{{^}}`), or partials (`{{>}}`).
- Every reference must resolve at build time.
- References are never committed in resolved form.
- References inside fenced code blocks are **not** resolved — they render as
  literal text.

---

## Part 6 — Document Model

### 6.1 Project properties

Shared across all documents. Every property always resolves. The `project.yaml`
schema is defined at `https://driftsys.github.io/schemas/project/v1.json`.

| Property       | Source                        | Fallback                    |
| -------------- | ----------------------------- | --------------------------- |
| **project**    | `project.yaml` → `name`       | Repo directory name         |
| **repository** | `project.yaml` → `repository` | `git remote get-url origin` |
| **version**    | `project.yaml` → `version`    | `git describe`              |
| **license**    | `project.yaml` → `license`    | `proprietary`               |

**license:** defaults to `proprietary` — absence of a declared license means all
rights reserved. Use [SPDX identifiers] when specifying a license.

### 6.2 Document properties

Per-file. Nothing stored inside the document. Every property always resolves.

| Property     | Source                          | Fallback                      |
| ------------ | ------------------------------- | ----------------------------- |
| **title**    | H1 heading                      | Filename stem                 |
| **type**     | Filename stem or directive      | `doc`                         |
| **revision** | Merge-to-main count             | `0`                           |
| **authors**  | `project.yaml`                  | Git unique commit authors     |
| **created**  | Git first commit timestamp      | File system creation time     |
| **modified** | Git last merge commit timestamp | File system modification time |
| **status**   | Branch/main/directive           | `approved`                    |

**revision:** starts at `0`. Increments on each merged PR/MR that modifies the
file. Commits within a branch do not count.

**authors:** `project.yaml` recommended — Git history is fragile across moves
and migrations.

**status:** `draft` (in branch), `approved` (on main), `deprecated`
(`markspec:deprecated` directive).

### 6.3 Document types

| Type         | Detection                    | Description                          |
| ------------ | ---------------------------- | ------------------------------------ |
| `doc`        | default                      | Any Markdown file                    |
| `glossary`   | `GLOSSARY.md` or directive   | Heading-based term definitions       |
| `summary`    | `SUMMARY.md` or directive    | Book table of contents               |
| `references` | `references.md` or directive | External standard/regulation entries |
| `deck`       | directive only               | Slide deck (`---` = slide breaks)    |
| `code`       | file extension               | Source files with doc comments       |

**Heading rules by type:**

- **doc** — one H1, no skipped levels.
- **glossary** — one H1 (title), H2 (letter groups), H3 (terms).
- **summary** — first H1 is the book title, additional H1s are part headings.
  Exempt from single-H1.
- **references** — one H1, standard heading rules.
- **deck** — one H1 (deck title). `---` creates slide breaks. H2 headings start
  each slide. Heading hierarchy is per-slide — H3/H4 within a slide are valid
  regardless of other slides.

### 6.4 Content entities

| Entity   | Source                            | ID         |
| -------- | --------------------------------- | ---------- |
| **req**  | STK, SYS, SRS entry blocks        | Display ID |
| **arch** | SAD, ICD entry blocks             | Display ID |
| **test** | VAL, SIT, SWT entry blocks        | Display ID |
| **ref**  | Reference entries, registry chain | Entry ID   |
| **fig**  | Figure captions, alt text         | Slug       |
| **tbl**  | Table captions                    | Slug       |
| **h**    | Headings                          | GFM anchor |

### 6.5 References

References (standards, regulations, external specifications) are resolved
through a registry chain. Each project declares its upstream registries with
`markspec:references` directives. Resolution order: local project → declared
registries (in order) → RefHub (implicit fallback).

`{{ref.ID}}` inline references and `Derived-from:` attribute values are
validated against the registry chain at build time.

### 6.6 Rule activation

Entry rules (MSL-R\*) activate on any file containing `- [DISPLAY_ID]` entry
blocks. Traceability rules (MSL-T\*) activate on typed entries only. Glossary
rules (MSL-G\*) activate only on `glossary` documents. Summary rules (MSL-S\*)
activate only on `summary` documents.

---

## Part 7 — Formatting Rules

**Fixed rules:**

| Rule                  | Value                                           |
| --------------------- | ----------------------------------------------- |
| Line endings          | `lf`                                            |
| Emphasis              | `_text_` (underscores)                          |
| Strong                | `**text**` (asterisks)                          |
| List marker           | `-` (dashes)                                    |
| List indent           | 2 spaces                                        |
| Code fences           | backticks, language required                    |
| Trailing whitespace   | removed                                         |
| Final newline         | single `\n`                                     |
| Table columns         | aligned, padded (tables exempt from line width) |
| Horizontal rules      | `---`                                           |
| Reference definitions | end of file, alphabetical within groups         |

**Configurable rules (with defaults):**

| Rule       | Default  | Options              |
| ---------- | -------- | -------------------- |
| Line width | `80`     | any positive integer |
| Prose wrap | `always` | `always`, `preserve` |

### MarkSpec normalization

- **Attribute blocks** — sorted to canonical order, trailing backslashes
  normalized.
- **Reference definitions** — moved to end of file, sorted alphabetically within
  groups.
- **Alerts** — markers uppercased, spacing normalized.
- **Front matter** — stripped from all files.

---

## Part 8 — Lint Rules

### 8.1 Severity

| Severity    | CI behavior             |
| ----------- | ----------------------- |
| **error**   | Fails the build         |
| **warning** | Reported, does not fail |
| **notice**  | Verbose mode only       |

### 8.2 Entry format (MSL-R)

| ID         | Severity | Rule                                                                |
| ---------- | -------- | ------------------------------------------------------------------- |
| `MSL-R001` | error    | Entry block: `- [DISPLAY_ID]` with indented body.                   |
| `MSL-R002` | error    | Typed entry: display ID matches `[A-Z]{2,}_[A-Z]{2,12}_\d{3,4}`.    |
| `MSL-R003` | error    | Typed entry: `Id:` required, matches `[A-Z]+_[0-9A-Z]{12,13}`.      |
| `MSL-R004` | error    | Typed entry: exactly one `Id:` per entry.                           |
| `MSL-R005` | error    | ULID unique across repository.                                      |
| `MSL-R006` | error    | Display ID unique within project.                                   |
| `MSL-R007` | error    | Display ID type prefix matches ULID type prefix.                    |
| `MSL-R008` | warning  | Sequential numbering expected.                                      |
| `MSL-R009` | warning  | Canonical attribute order. Auto-fixed.                              |
| `MSL-R010` | warning  | Unknown attributes. Generated attributes must not appear in source. |
| `MSL-R011` | error    | No emphasis inside entry blocks.                                    |

MSL-R001 applies to all entry blocks. MSL-R002–R010 apply only to typed entries
(ID matches `TYPE_XYZ_NNNN`). MSL-R011 applies to all entry blocks.

### 8.3 Traceability (MSL-T)

| ID         | Severity | Rule                                                            |
| ---------- | -------- | --------------------------------------------------------------- |
| `MSL-T001` | error    | `Satisfies:` target must exist.                                 |
| `MSL-T002` | error    | Direction upward: SRS → SYS → STK. SAD → SYS. ICD → SYS or SAD. |
| `MSL-T003` | warning  | SYS/SRS without `Satisfies:` — may be derived.                  |
| `MSL-T004` | warning  | `Derived-from:` ID validated against registry chain.            |
| `MSL-T005` | error    | `/// Verifies:` target must exist.                              |
| `MSL-T006` | error    | `/// Implements:` target must exist.                            |
| `MSL-T007` | error    | VAL→STK, SIT→SYS/ICD, SWT→SRS. Cross-level is error.            |
| `MSL-T008` | error    | `Allocates:` target must be an SRS entry.                       |
| `MSL-T009` | error    | `Between:` must list exactly two parties.                       |

### 8.4 References (MSL-M)

| ID         | Severity | Rule                                                        |
| ---------- | -------- | ----------------------------------------------------------- |
| `MSL-M001` | error    | Every `{{namespace.id}}` must resolve.                      |
| `MSL-M002` | error    | Namespace: `req`, `arch`, `test`, `ref`, `fig`, `tbl`, `h`. |
| `MSL-M003` | error    | No sections, inverted sections, or partials.                |

### 8.5 Document structure (MSL-D)

| ID         | Severity     | Rule                                                                                                                                                                   |
| ---------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSL-D001` | error        | No front matter. Auto-fixed.                                                                                                                                           |
| `MSL-D002` | warning      | Footnotes must not contain requirement IDs.                                                                                                                            |
| `MSL-D003` | notice       | Non-standard alert types.                                                                                                                                              |
| `MSL-D004` | warning      | Caption format: `_Table:_` above, `_Figure:_` below.                                                                                                                   |
| `MSL-D005` | warning      | SVGs: `viewBox` required, no fixed `width`/`height`.                                                                                                                   |
| `MSL-D006` | configurable | Inline links vs reference-style links. Controlled by `referenceLinks` config: `none` (no check), `warn` (prefer reference-style), `enforce` (require reference-style). |
| `MSL-D007` | warning      | Reference definitions at end of document, alphabetical within groups. Auto-fixed.                                                                                      |

### 8.6 Glossary (MSL-G)

| ID         | Severity | Rule                                                                                 |
| ---------- | -------- | ------------------------------------------------------------------------------------ |
| `MSL-G001` | error    | H1 title, H2 letter groups, H3 terms.                                                |
| `MSL-G002` | warning  | Terms sorted within letter groups.                                                   |
| `MSL-G003` | warning  | Link references at end of file, alphabetical within groups (internal then external). |
| `MSL-G004` | error    | Cross-links reference existing headings.                                             |

### 8.7 Summary (MSL-S)

| ID         | Severity | Rule                                                              |
| ---------- | -------- | ----------------------------------------------------------------- |
| `MSL-S001` | error    | Every link target must reference an existing file.                |
| `MSL-S002` | error    | No empty links (`- [Title]()`).                                   |
| `MSL-S003` | error    | No duplicate file paths.                                          |
| `MSL-S004` | warning  | Markdown files in the source directory not referenced in summary. |

---

## Part 9 — Configuration

### 9.1 Schema

`.markspec.yaml`:

```yaml
referenceLinks: warn # none | warn | enforce
```

`.markspec.toml`:

```toml
referenceLinks = "warn"
```

| Property         | Type   | Default  | Values                    |
| ---------------- | ------ | -------- | ------------------------- |
| `referenceLinks` | string | `"warn"` | `none`, `warn`, `enforce` |

All formatting rules are fixed. There is no formatter choice — dprint is the
formatter.

### 9.2 CI

```yaml
lint:
  steps:
    - name: Format check
      run: markspec fmt --check

    - name: Lint
      run: markspec lint
```

### 9.3 Editor integration

- **Format-on-save:** dprint (`dprint.vscode`).
- **Diagnostics:** markdownlint (David Anson) for generic rules; MarkSpec LSP
  (`markspec-lsp`) for MSL rules.

---

## Annex A — Formatter Compatibility

dprint is the MarkSpec formatter. This table maps MarkSpec rules to dprint
settings and equivalent Prettier settings for teams migrating from Prettier.

| Behavior            | dprint                      | Prettier (reference)  |
| ------------------- | --------------------------- | --------------------- |
| Emphasis            | `emphasisKind: underscores` | `_text_` (default)    |
| Strong              | `strongKind: asterisks`     | `**text**` (default)  |
| Lists               | `unorderedListKind: dashes` | `-` (default)         |
| Table alignment     | aligned                     | aligned               |
| Trailing whitespace | removed                     | removed               |
| Final newline       | ensured                     | ensured               |
| Line width          | `lineWidth: 80`             | `printWidth: 80`      |
| Prose wrap          | `textWrap: "always"`        | `proseWrap: "always"` |
| Line endings        | `newLineKind: "lf"`         | `endOfLine: "lf"`     |
| Indent              | (global) `2`                | `tabWidth: 2`         |

Prettier's `proseWrap` defaults to `"preserve"`. MarkSpec requires `"always"`.

---

## Annex B — `dprint.json`

```json
{
  "$schema": "https://dprint.dev/schemas/v0.json",
  "incremental": true,
  "markdown": {
    "lineWidth": 80,
    "textWrap": "always",
    "newLineKind": "lf",
    "emphasisKind": "underscores",
    "strongKind": "asterisks",
    "unorderedListKind": "dashes"
  },
  "includes": ["**/*.md"],
  "excludes": [
    "**/node_modules",
    "**/target",
    "**/dist",
    "**/build",
    "CHANGELOG.md"
  ],
  "plugins": [
    "https://plugins.dprint.dev/markdown-0.20.0.wasm"
  ]
}
```

---

## Annex C — `.prettierrc` (migration reference)

Prettier is not the MarkSpec formatter. This config is provided for teams
migrating from Prettier to dprint, to verify equivalent output during
transition.

```json
{
  "$schema": "https://json.schemastore.org/prettierrc",
  "printWidth": 80,
  "proseWrap": "always",
  "tabWidth": 2,
  "useTabs": false,
  "endOfLine": "lf",
  "embeddedLanguageFormatting": "auto",
  "overrides": [
    {
      "files": ["CHANGELOG.md"],
      "options": {
        "proseWrap": "preserve"
      }
    }
  ]
}
```

---

## Annex D — `.markdownlint.yaml` (standalone)

```yaml
heading-increment: true
heading-style: { style: atx }
no-missing-space-atx: true
no-multiple-space-atx: true
blanks-around-headings: true
heading-start-left: true
no-duplicate-heading: { siblings_only: true }
single-title: true # override to false for SUMMARY.md
no-trailing-punctuation: true
first-line-heading: true
ul-style: { style: dash }
list-indent: true
ul-indent: { indent: 2 }
ol-prefix: { style: ordered }
list-marker-space: true
blanks-around-lists: true
no-trailing-spaces: true
no-hard-tabs: true
no-multiple-blanks: true
single-trailing-newline: true
line-length:
  line_length: 80 # from .markspec.yaml lineWidth
  tables: false
  code_blocks: false
  headings: false
blanks-around-fences: true
fenced-code-language: true
code-block-style: { style: fenced }
code-fence-style: { style: backtick }
no-emphasis-as-heading: false
no-space-in-emphasis: true
emphasis-style: { style: underscore }
strong-style: { style: asterisk }
no-bare-urls: true
no-space-in-links: true
no-empty-links: true
no-alt-text: true
link-fragments: true
link-image-reference-definitions: true
link-image-style: true
no-inline-html: true
no-multiple-space-blockquote: true
no-blanks-blockquote: false
hr-style: { style: "---" }
required-headings: false
proper-names: false
```

---

## Annex E — `.markdownlint-dprint.yaml`

Formatting rules disabled (`→ dprint`).

```yaml
heading-increment: true
heading-style: { style: atx }
no-missing-space-atx: true
no-multiple-space-atx: true
blanks-around-headings: false # → dprint
heading-start-left: true
no-duplicate-heading: { siblings_only: true }
single-title: true # override to false for SUMMARY.md
no-trailing-punctuation: true
first-line-heading: true
ul-style: { style: dash }
list-indent: true
ul-indent: { indent: 2 }
ol-prefix: { style: ordered }
list-marker-space: true
blanks-around-lists: false # → dprint
no-trailing-spaces: true # safety net
no-hard-tabs: true
no-multiple-blanks: false # → dprint
single-trailing-newline: false # → dprint
line-length:
  line_length: 80 # from .markspec.yaml lineWidth
  tables: false
  code_blocks: false
  headings: false
blanks-around-fences: false # → dprint
fenced-code-language: true
code-block-style: { style: fenced }
code-fence-style: { style: backtick }
no-emphasis-as-heading: false
no-space-in-emphasis: true
emphasis-style: { style: underscore } # safety net
strong-style: { style: asterisk } # safety net
no-bare-urls: true
no-space-in-links: true
no-empty-links: true
no-alt-text: true
link-fragments: true
link-image-reference-definitions: true
link-image-style: true
no-inline-html: true
no-multiple-space-blockquote: true
no-blanks-blockquote: false
hr-style: { style: "---" }
required-headings: false
proper-names: false
```

---

## Annex F — In-Code Entries by Language

A doc comment starting with `[TYPE_XYZ_NNNN]` (with or without a leading `-`) is
recognized as a MarkSpec entry. The following examples show the same entry in
each supported language.

### Rust

```rust
/// [SRS_BRK_0107] Sensor input debouncing
///
/// The sensor driver shall reject transient noise shorter
/// than the configured debounce window.
///
/// Id: SRS_01HGW2R9QLP4 \
/// Satisfies: SYS_BRK_0042 \
/// Labels: ASIL-B
#[test]
fn swt_brk_0107_debounce_filters_noise() {
    // test implementation
}
```

### Kotlin

```kotlin
/**
 * [SRS_BRK_0107] Sensor input debouncing
 *
 * The sensor driver shall reject transient noise shorter
 * than the configured debounce window.
 *
 * Id: SRS_01HGW2R9QLP4 \
 * Satisfies: SYS_BRK_0042 \
 * Labels: ASIL-B
 */
@Test
fun `swt_brk_0107 debounce filters noise`() {
    // test implementation
}
```

### C++ (Doxygen)

```cpp
/// [SRS_BRK_0107] Sensor input debouncing
///
/// The sensor driver shall reject transient noise shorter
/// than the configured debounce window.
///
/// Id: SRS_01HGW2R9QLP4 \
/// Satisfies: SYS_BRK_0042 \
/// Labels: ASIL-B
auto debounce_input(uint16_t raw) -> uint16_t;
```

### C (Doxygen)

```c
/**
 * [SRS_BRK_0107] Sensor input debouncing
 *
 * The sensor driver shall reject transient noise shorter
 * than the configured debounce window.
 *
 * Id: SRS_01HGW2R9QLP4 \
 * Satisfies: SYS_BRK_0042 \
 * Labels: ASIL-B
 */
void debounce_input(uint16_t* raw);
```

### Java (JDK 23+)

```java
/// [SRS_BRK_0107] Sensor input debouncing
///
/// The sensor driver shall reject transient noise shorter
/// than the configured debounce window.
///
/// Id: SRS_01HGW2R9QLP4 \
/// Satisfies: SYS_BRK_0042 \
/// Labels: ASIL-B
@Test
void swt_brk_0107_debounce_filters_noise() {
    // test implementation
}
```

### Java (legacy Javadoc)

Trailing backslashes are omitted — they render as literal characters in Javadoc.
Attributes are on consecutive lines.

```java
/**
 * [SRS_BRK_0107] Sensor input debouncing
 *
 * The sensor driver shall reject transient noise shorter
 * than the configured debounce window.
 *
 * Id: SRS_01HGW2R9QLP4
 * Satisfies: SYS_BRK_0042
 * Labels: ASIL-B
 */
@Test
void swt_brk_0107_debounce_filters_noise() {
    // test implementation
}
```

### Language support summary

| Language      | Doc syntax       | Markdown native? |
| ------------- | ---------------- | ---------------- |
| Rust          | `///`            | yes              |
| Kotlin        | `/** */` KDoc    | yes              |
| C++           | `///` Doxygen    | yes (since 1.8)  |
| C             | `/** */` Doxygen | yes (since 1.8)  |
| Java 23+      | `///` (JEP 467)  | yes              |
| Java (legacy) | `/** */` Javadoc | no (HTML)        |

<!-- References -->

[CommonMark]: https://spec.commonmark.org/
[GFM]: https://github.github.com/gfm/
[GLFM]: https://docs.gitlab.com/user/markdown/
[SPDX identifiers]: https://spdx.org/licenses/
