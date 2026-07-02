# MarkSpec — Markdown Flavor Specification

## Introduction

MarkSpec is a Markdown flavor for traceable industrial documentation. It targets
safety-critical and high-availability systems where requirements, traceability,
and compliance documentation must live alongside code in version control.

MarkSpec is a three-layer stack:

1. **[CommonMark]** — the parsing baseline.
2. **[GFM] / [GLFM] shared subset** — platform extensions portable across GitHub
   and GitLab.
3. **MarkSpec extensions** — entry authoring, captions, inline references,
   directives, and book structure.

Source files are pure, readable Markdown. They render correctly on GitHub and
GitLab without any build step. PDF generation, traceability matrices, and
reference resolution are build concerns — not format concerns.

### Core vs. profile

MarkSpec splits responsibility between a **core** — this specification — and a
**profile** — an external vocabulary pack that names concrete entry types and
declares their attributes, relation names, and rules.

- The core defines **two entry shapes** (Authored and Reference), the syntax for
  authoring entries, a single identity attribute (`Id:`), a small universal
  attribute set, and the rules for discriminating shape from `Id:` value format.
  It contains no type vocabulary.
- A profile declares concrete types (`requirement`, `test`, `unit`, `standard`,
  `dependency`, …) within the two shapes, per-type attributes, traceability
  relations, and validation rules.

A bundled **default profile** ships with MarkSpec and loads by default (it can
be opted out of in `.markspec.yaml`). Compliance profiles (ASPICE, ISO 26262,
DO-178C, IEC 62304, MISRA-C) stack on top via an `extends:` chain.

This specification is the normative reference for the MarkSpec core. Profile
schemas are specified by each profile's `markspec.yaml` manifest; the default
profile's manifest is the reference for the out-of-box type vocabulary.

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
First line ends here,\
and the next line continues.
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

| Feature          | CommonMark                               | MarkSpec restriction                                                                                |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Headings         | ATX and setext                           | ATX only.                                                                                           |
| Code blocks      | Fenced (backtick and tilde) and indented | Backtick-fenced only.                                                                               |
| Emphasis         | `*text*` and `_text_`                    | `_text_` only.                                                                                      |
| Strong           | `**text**` and `__text__`                | `**text**` only.                                                                                    |
| List markers     | `-`, `*`, `+`                            | `-` only.                                                                                           |
| Horizontal rules | `---`, `***`, `___`                      | `---` only.                                                                                         |
| Hard line breaks | Trailing `\` and trailing double-space   | Trailing `\` only.                                                                                  |
| Inline HTML      | Any HTML element                         | Comments only (`<!-- -->`). No HTML elements.                                                       |
| Front matter     | YAML `---` blocks (not CommonMark)       | YAML (`---`) and TOML (`+++`) allowed at the top of the file; schema defined in §1.3 §6 and Part 6. |

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

      Key: Value
      Key: Value
```

A `- [DISPLAY_ID]` with no indented body is a normal list item — not an entry
block.

**Example 1 — entry block:**

```markdown
- [SRS_BRK_0107] Sensor input debouncing

  The sensor driver shall debounce raw inputs to eliminate electrical noise
  before processing.

  The debounce window shall be configurable per sensor type:

  | Sensor type | Window (ms) | Sample rate (Hz) |
  | ----------- | ----------- | ---------------- |
  | Pressure    | 10          | 100              |
  | Speed       | 5           | 200              |
  | Temperature | 50          | 20               |

      Id: 01HGW2Q8MNP3RSTVWXYZABCDE
      type: software-requirement
      Satisfies: SYS_BRK_0042
      Labels: ASIL-B
```

**Example 2 — not an entry block:**

```markdown
- [See documentation] for details on configuration.
```

No indented body. Normal list item.

Emphasis (`_text_`) must not appear inside entry blocks. Strong (`**text**`) and
inline code are allowed.

Part 2 defines the two entry shapes (Authored, Reference), the rule that
discriminates them, the universal attributes that apply to both, and the
profile-declared extensions layered on top.

Rendering of entry blocks (admonition-style left border, type coloring, label
pills, cross-reference links) is specified in the [Typography](typography.md)
chapter, §"Entry rendering".

#### §2 Attribute blocks

An attribute block is the **trailing indented code block** of an entry. Each
content line is a single `Key: Value` pair. No trailing line-continuation
characters.

The block is indented 4 spaces relative to the entry body indent (CommonMark
indented-code-block rule). Inside a Markdown list item, that means **6 spaces of
indentation** before the `Key`; inside a source-file doc comment (no enclosing
list), 4 spaces of indentation relative to the comment content column.

**Example 3 — attribute block:**

```markdown
- [SRS_BRK_0001] Sensor debouncing

  Sensor driver shall debounce raw inputs.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDE
      Satisfies: SYS_BRK_0042
      Labels: ASIL-B
```

The set of valid attributes is the universal set (Part 2 §2.1) plus whatever the
active profile declares for the entry's shape and inferred type.

**Generated attributes** (build-time inverses of authored relations such as
`Verified-by` from `Verifies`, `Cited-by` from `References`) are computed by
tooling and never appear in source. The exact set is profile-declared.

**Disambiguation from body code blocks.** The trailing indented code block
qualifies as an attribute block only when every one of its content lines matches
the pattern `^[A-Z][A-Za-z-]*:` (followed by a space). Otherwise it remains a
regular code block and the entry is treated as having no attribute block. Fenced
code blocks (triple-backtick fences) anywhere in the entry are body content and
never confused with the attribute block — different syntactic shape.

**Trailing position is required.** If body prose appears after an indented
`Key: Value` block, that block is not trailing — it is treated as a regular code
block with no attribute meaning. Authors must place attributes at the very end
of the entry.

**Backward compatibility.** During the transition, the parser also accepts the
legacy paragraph-with-trailing-`\` shape. Running `markspec fmt` rewrites legacy
blocks to the canonical indented form. The legacy shape emits a deprecation
diagnostic (`MSL-DEPRECATED-ATTR-001`) and will be removed in a future major
release.

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

#### §4 Figure captions and diagrams

Diagrams are embedded using standard Markdown image syntax with **relative paths
only**:

```markdown
![Unlock sequence](./diagrams/unlock-sequence.plantuml.svg)
```

Absolute URLs (`https://…`), repo-root links (`/docs/…`), and paths that escape
the document folder via repeated `../../` are not permitted. Relative paths keep
the document self-contained — when a folder is moved or reorganized, the diagram
travels with the document. Non-relative image references are flagged by
MSL-D008.

**Diagrams are always stored as SVG files** — never embedded as inline fenced
code blocks (e.g., `` ```mermaid ``). SVG renders consistently across GitHub,
GitLab, PDF, and presentation output.

**Authoring recommendations by use case**:

- **PlantUML** — simple structured diagrams: sequences, state machines, class
  diagrams with ~13 classes or fewer.
- **draw.io** (or Inkscape, Excalidraw) — advanced authoring with free-form
  shapes, swimlanes, complex layouts.
- **Raw SVG** — AI-assisted authoring, scripts, or hand-authored.

**Storage conventions**:

- Source embedded in the SVG → `<name>.<source>.svg` (e.g.
  `architecture.drawio.svg`, `unlock-sequence.plantuml.svg`).
- Source not embedded → source and SVG side by side (e.g. `architecture.dot` +
  `architecture.svg`).

**PNG** is acceptable when SVG does not make sense — photographs, screenshots,
heatmaps, dense bitmap data. Use a descriptive filename with no source-format
suffix (`dashboard-screenshot.png`).

For sizing, visual style, and tooling details (PlantUML viewport, draw.io
embedding, color palettes, stroke weights), see the [Typography](typography.md)
chapter.

**Captions**: an emphasized paragraph starting with `Figure:` immediately below
an image. Alternatively, the image alt text is the caption.

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

Entries can be authored in doc comments in source files. A doc comment beginning
with `[DISPLAY_ID]` is recognized as a MarkSpec entry. The leading `-` bullet is
optional in doc comments — the bracket pattern alone is sufficient.

**Example 8 — Rust doc comment test entry:**

```rust
/// [SWT_BRK_0107] Debounce unit test
///
/// Given a debounce window of 10ms, a transient spike shorter
/// than the window must not alter the stable output.
///
///     Id: 01HGW3R9QLP4ABCDEFGHJKMNPQ
///     Verifies: SRS_BRK_0107
///     Tests: braking_core::controller::debounce_input
///     Labels: ASIL-B
#[test]
fn swt_brk_0107_debounce_filters_noise() {
    // test implementation
}
```

The doc comment declares the entry; the function body is the executable
artifact. The `SWT_` prefix triggers the active profile's type inference (e.g.,
`type: unit-test` under an ASPICE profile). Authors do not write `type:` in
source. The file path is observable as the `file.path` property (see Part 6).

A production unit declares what it realizes via its own doc comment. Because the
display ID is a symbolic namespace path with no declared prefix pattern, the
author writes `type:` explicitly:

```rust
/// [braking_core::controller::debounce_input] Debounce function
///
/// Rejects transient noise on raw sensor readings.
///
///     Id: 01HGW3D6QRST7IJKLMNOPQRSTUV
///     type: unit
///     Realizes: 01HGW2Q8MNP3RSTVWXYZABCDEF
fn debounce_input(raw: u16) -> u16 { ... }
```

Tooling extracts these doc comments to produce the same traceability output as
Markdown-authored entries.

#### §6 Front matter

Document-level metadata is authored in **YAML front matter** — a `---`-delimited
block at the very top of the file, before the H1.

**Example 8b — document with front matter:**

```markdown
---
document-id: 01HGW2D0DOCPQ4FGHIJKLMNOPQR
document-type: requirements
labels: [requirements, ASIL-B]
external-id: doors:VHC:SRS-BRK
---

# Braking Software Requirements

## Introduction

...
```

Front matter carries:

- **Document identity** (`document-id`, `document-type`).
- **Universal attributes** (`labels`, `external-id`, `supersedes`, `deprecated`,
  `references`) — same set and semantics as entry-level universal attributes.
  Draft state via `DRAFT` label; retirement via `supersedes:` or `deprecated:`.
- A reserved **`metadata:` map** for org-specific free-form fields.
- Optional **profile-declared keys** (e.g., automotive `asil:`).
- Optional **allowlisted ecosystem keys** declared in `.markspec.yaml` (for Hugo
  / Jekyll / Docusaurus interop).

**Forbidden keys** (Markdown-native concepts; duplication creates drift):
`title`, `description`, `toc`, `sections`, `authors`, `author`, `date`,
`created`, `modified`, `cover`, `images`. These live in H1, body paragraphs, or
git history — never in front matter.

**Casing convention**: front matter keys use **kebab-case** (`document-id`),
matching YAML ecosystem convention. Entry trailers keep Title-Case (`Id:`,
`Satisfies:`, `Labels:`), matching git-trailers convention.

**TOML tolerance**: `+++`-delimited TOML front matter is accepted as input (for
GitLab-flavored Markdown parity); the formatter normalizes to YAML.

Full document-structure specification: see Part 6 — Document Model.

---

## Part 2 — Entry Shapes

Part 1 defines the format — how to write entry blocks and attribute blocks. This
part defines the core entry model: the two **shapes** the core recognizes, the
single `Id:` identity attribute, the value-format rule that discriminates shape,
the universal attributes shared between shapes, and the relationship between the
core and profile-declared type vocabulary.

MarkSpec recognizes two shapes:

| Shape         | Intent                                | `Id:` value                  | Display ID role               |
| ------------- | ------------------------------------- | ---------------------------- | ----------------------------- |
| **Authored**  | Content the project authors and owns  | ULID (26-char Crockford b32) | Human-readable alias          |
| **Reference** | Citation pointing to an external work | URI (RFC 3986, scheme req.)  | Slug (pandoc/BibTeX cite-key) |

Every entry carries exactly one `Id:` attribute. Its **value format** determines
the shape:

```text
Id: 01HGW2P4KFR7ABCDEFGHJKMNPQ        # ULID → Authored
Id: urn:iso:std:iso:26262:-6:ed-2     # URI → Reference
Id: pkg:cargo/serde@1.0.0             # URI (purl) → Reference
Id: doi:10.1109/IEEESTD.2008.4610935  # URI → Reference
```

The two value formats are visually disjoint — a ULID has no scheme; a URI must
carry a scheme followed by `:`. A bare slug (no scheme, not a ULID) is rejected
as an `Id:` value.

Concrete **types** (`requirement`, `test`, `unit`, `standard`, `dependency`,
`hazard`, …) are declared by the active profile, not by the core. The core has
no TYPE vocabulary and no family enum.

### 2.1 Universal attributes

The following attributes apply to every family:

| Attribute           | Type          | Required | Description                                                                                                                                                                  |
| ------------------- | ------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Labels`            | `tag-list`    | no       | Classification tags (includes `DRAFT` marker)                                                                                                                                |
| `Discipline`        | `text`        | no       | ADR-017 Slice 3 — author-asserted discipline kind. Value matches `/^[a-z][a-z0-9-]*$/`. Takes precedence over the classifier's type/allocation channels. Single-cardinality. |
| `Discipline-frozen` | `text`        | no       | ADR-017 Slice 3 — cached snapshot of a past derivation: `<kind>` or `<kind> @ <YYYY-MM-DD>`. The formatter stamps today's UTC date when written bare. Single-cardinality.    |
| `References`        | `citation`    | no       | External reference citations with locator                                                                                                                                    |
| `External-id`       | `external-id` | no       | Cross-system identifier(s)                                                                                                                                                   |
| `Supersedes`        | `id`          | no       | Same-shape entry this one replaces                                                                                                                                           |
| `Superseded-by`     | `id`          | —        | Generated inverse of `Supersedes`                                                                                                                                            |
| `Deprecated`        | `string`      | no       | Retirement reason (non-replacement case)                                                                                                                                     |

**Draft state** is carried by the `DRAFT` label — a plain universal tag with no
exclusive-group semantics. Authors set `Labels: DRAFT` on entries that are
merged but not yet authoritative.

**Retirement** is structural, expressed two ways:

- **Replacement** — successor entry authors `Supersedes: <predecessor-id>`; the
  predecessor automatically gains the generated `Superseded-by:` inverse.
- **Non-replacement** — entry authors `Deprecated: "<free-text reason>"` (e.g.,
  "Feature cut from scope in v3.0").

An entry is **retired** when either signal is present. The two are complementary
(a replacement may still carry a `Deprecated:` reason for additional context).
Tooling emits severity-tiered diagnostics when a relation target is retired or
draft: `DRAFT` target → info, retired target → warning, unresolved target →
error. There is no `DEPRECATED` / `WITHDRAWN` label — retirement lives in
`Supersedes` and `Deprecated`. `Supersedes` operates within a shape: an Authored
entry supersedes an Authored entry; a Reference entry supersedes a Reference
entry.

See §2.5 for attribute value types (multi-line repeat vs CSV, canonical form).

### 2.2 Authored entries

An Authored entry is a content unit the project authors and owns: a requirement,
a test, a rule, a component, a code unit, a hardware part, a glossary term, a
hazard, a design decision. Its identity is project-local and machine-generated.

**Display ID:** any non-empty, project-unique string. The core does not
constrain format. Profiles tighten by declaring per-type `display-id-pattern:`
templates; the active profile determines what shape Authored-entry display IDs
take in a given project. Common conventions:

```text
SRS_BRK_0107                              ← typed prefix + scope + number
braking_core::controller::debounce_input  ← symbolic namespace path
REQ-042, NOTE-007                         ← simple typed prefix + number
```

**Identity:** `Id:` carries a bare 26-character ULID
(`^[0-9A-HJKMNP-TV-Z]{26}$`). Assigned by `markspec fmt`, never hand-authored,
immutable once assigned. The ULID is the stable identity; the display ID is a
renumberable alias that resolves through the ULID for cross-references.

**Type:** profile-declared. Normally inferred by the active profile from the
display-ID prefix (`SRS_BRK_0107` → `type: software-requirement` under an ASPICE
profile that declares
`software-requirement: display-id-pattern: "SRS_{scope}_{n:04d}"`). An explicit
`type:` attribute in source overrides inference and is required when the display
ID matches no declared pattern. Types whose IDs are named, not numbered — e.g.
components `SWC_LIGHT_CTRL`, `HWC_PIU` — declare a counter-less pattern
(`sw-component: display-id-pattern: "SWC_{name}"`) so they are classified by
prefix without an explicit `type:` (see annex §B.3.2).

**Profile-declared attributes:** every attribute beyond the universal set (§2.1)
is declared by the active profile. Examples — declared by an automotive ASPICE
profile, not by the core:

- `Derived-from`, `Satisfies`, `Allocated-to` on requirements
- `Verifies`, `Tests`, `Test-level` on tests
- `Realizes`, `Depends-on`, `Part-of`, `Element-kind` on units / artifacts
- `ASIL`, `Safety-goal`, `Risk-class` on hazards / safety-relevant entries

The core does not define any of these names. They live in the profile manifest
and are validated against the profile's `attributes:` / `traceability:`
declarations.

**Example 9 — inferred type (SRS prefix):**

```markdown
- [SRS_BRK_0107] Sensor input debouncing

  The sensor driver shall debounce raw inputs to eliminate electrical noise
  before processing.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDE
      Derived-from: SYS_BRK_0042
      Labels: ASIL-B
```

**Example 10 — explicit type override (symbolic path):**

```markdown
- [braking_core::controller::debounce_input] Debounce function

  Rejects transient noise on raw sensor readings using a configurable window.

      Id: 01HGW3D6QRST7IJKLMNOPQRSTUV
      type: unit
      Realizes: 01HGW2Q8MNP3RSTVWXYZABCDE
```

The author writes `type: unit` because no `display-id-pattern` matches a
symbolic namespace path. `Realizes:` references the upstream entry by its ULID
identity (the stable handle), not by display ID.

### 2.3 Reference entries

A Reference entry is a bibliographic citation of an external artifact: a
standard, a regulation, a paper, an RFC, a corporate specification, a package
dependency, a hardware part from an external catalog.

**Display ID (slug):** matches `^[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?$`
(pandoc/BibTeX-style cite-key, restricted to a portable character set). Common
conventions:

```text
ISO-26262-6        ← ISO 26262-6:2018
ISO/IEC-15504      ← ISO/IEC 15504
DO-178C            ← RTCA DO-178C
RFC-2119           ← IETF RFC
serde              ← Rust crate (dependency)
smith2021          ← academic citation
```

Both `[@ISO-26262-6]` and `[ISO-26262-6]` are accepted in the entry header; the
leading `@` is pandoc-citation sugar and is stripped during parsing. Inline
pandoc citations `[@ISO-26262-6]` in prose resolve to the matching Reference
entry.

**Identity:** `Id:` carries a URI per RFC 3986 — any scheme, but the scheme is
**required** (`urn:`, `doi:`, `pkg:`, `https:`, `isbn:`, …):

```text
Id: urn:iso:std:iso:26262:-6:ed-2     ← URN (preferred for standards)
Id: doi:10.1109/IEEESTD.2008.4610935  ← DOI (preferred for papers)
Id: pkg:cargo/serde@1.0.0             ← purl (Package URL, for dependencies)
Id: isbn:9780132350884                ← ISBN
Id: https://www.rfc-editor.org/rfc/rfc2119
```

Author-provided, not tooling-generated. A bare slug (no scheme) is rejected as
an `Id:` value — the slug lives in the display ID, not in `Id:`.

**Type:** profile-declared. Normally inferred by the active profile from the URI
scheme or the display ID (`Id: pkg:cargo/...` → `type: dependency`;
`Id: urn:iso:...` → `type: standard`). An explicit `type:` overrides inference.

**Body is optional** for Reference entries — a minimal entry may consist of
display ID, title, and `Id:` only.

**Universal attributes** (§2.1) apply, except that `References:` is **not
applicable** to Reference entries (a Reference entry does not itself cite other
Reference entries via `References:`; the replacement relation is expressed via
the universal `Supersedes`).

**Universal attributes on Reference entries (core):**

In addition to the universal attributes in §2.1, Reference entries accept
`Reference-url:` as a **core** attribute — an HTTPS navigation link used by
tooling (notably `markspec lock`) to fetch and hash the cited bytes for
trace-audit reproducibility. The attribute is optional; absent `Reference-url:`,
the lockfile records identity only (no hash, no drift detection for that row).

**Profile-declared attributes:** profiles may declare convenience attributes for
Reference entries — `Reference-document:` (canonical citation string),
`License:` (SPDX license expression for dependencies), etc.

**Example 11 — normative standard:**

```markdown
- [@ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety — Part 6: Software level.

      Id: urn:iso:std:iso:26262:-6:ed-2
      Reference-url: https://www.iso.org/standard/68383.html
      Reference-document: ISO 26262-6:2018
      Labels: functional-safety, automotive
```

**Example 12 — dependency (purl):**

```markdown
- [serde] serde Rust serialization framework

      Id: pkg:cargo/serde@1.0.0
      License: Apache-2.0 OR MIT
```

### 2.4 Shape discrimination

The shape of an entry is determined by the **value format** of its `Id:`
attribute. An entry has exactly one `Id:`.

```text
if Id matches ULID regex (^[0-9A-HJKMNP-TV-Z]{26}$)  → Authored
if Id is a scheme-qualified URI (RFC 3986)            → Reference
otherwise                                             → validation error
```

Properties of this rule:

- **Disjoint** — ULIDs and URIs do not overlap. A ULID has no scheme; a URI
  requires a scheme followed by `:`. No value matches both.
- **Complete** — every well-formed `Id:` value is either a ULID or a URI; the
  two exhaust the accepted formats.
- **Independent of display ID** — shape is decided by the `Id:` value, not by
  the display-ID format.
- **Independent of document context** — shape is intrinsic to the entry, not
  dependent on which document it appears in.
- **Independent of profile** — shape resolution completes without consulting any
  profile.

When a new entry is authored without an `Id:` attribute, `markspec fmt`
classifies it using a heuristic on the display ID and the document directive
(see Part 3), then either mints a fresh ULID (Authored) or prompts for a URI
(Reference). Once `Id:` is assigned, the shape is fixed by the value's format.

### 2.5 Attribute value types

Every attribute declares a **value type** that determines which input forms the
parser accepts and which form the formatter produces.

| Type          | Cardinality | Multi-line repeat | CSV on one line | Description                                                 |
| ------------- | ----------- | ----------------- | --------------- | ----------------------------------------------------------- |
| `id`          | single      | —                 | —               | Display ID or slug                                          |
| `id-list`     | repeatable  | ✓                 | ✓               | Multiple identifiers                                        |
| `uri`         | single      | —                 | —               | URI per RFC 3986 (URN, DOI, HTTPS URL)                      |
| `url`         | single      | —                 | —               | HTTPS navigation link                                       |
| `path`        | single      | —                 | —               | Filesystem path                                             |
| `path-or-id`  | single      | —                 | —               | Filesystem path or element display ID                       |
| `enum`        | single      | —                 | —               | One value from a closed vocabulary                          |
| `tag-list`    | repeatable  | ✓                 | ✓               | Free-form tags                                              |
| `text`        | single      | —                 | —               | Free-form single-line text                                  |
| `citation`    | repeatable  | ✓                 | ✗               | Slug + optional free-text locator (locator may contain `,`) |
| `external-id` | repeatable  | ✓                 | ✓               | `scheme:value` qualified identifier                         |
| `integer`     | single      | —                 | —               | Whole number                                                |
| `date`        | single      | —                 | —               | ISO 8601 date (`YYYY-MM-DD`)                                |
| `boolean`     | single      | —                 | —               | `true` or `false`                                           |

**Multi-line repeat** (git-trailers canonical form):

```text
Derived-from: SYS_BRK_0042
Derived-from: SYS_BRK_0043
Labels: ASIL-B
Labels: safety
```

**CSV on one line** (accepted when no value contains a comma):

```text
Derived-from: SYS_BRK_0042, SYS_BRK_0043
Labels: ASIL-B, safety
```

The formatter rewrites every repeatable attribute to **multi-line** form. CSV is
an accepted input but never a canonical output.

CSV is **forbidden** for the `citation` type. `References` values may carry
free-text locators like `§9.4, Table 7` that would be ambiguous in CSV.

The `id` and `id-list` types accept a 26-char ULID, a scheme-qualified URI, or a
display ID. A display ID is resolved to its target by existence; an unresolved
display ID is reported by `MSL-L006`, not by the value-format gate.

Display IDs are the canonical form across the full toolchain surface.
`markspec
fmt` canonicalises a raw ULID trace value to the target's current
display ID and heals a renamed reference via the `markspec.lock` ledger (see the
`fmt` command reference for details). The LSP ID-reference completion inserts
display IDs directly, and the MCP read tools (`entry_show`, `entry_list`,
`entry_neighborhood`, `entry_context`) present all trace targets as display IDs
— authors and agents never see raw ULIDs in cross-references.

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
markspec:references https://safety.company.io/registry
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

| Directive             | Payload      | Context |
| --------------------- | ------------ | ------- |
| `markspec:glossary`   | none         | doc     |
| `markspec:summary`    | none         | doc     |
| `markspec:deck`       | none         | deck    |
| `markspec:specs`      | none         | doc     |
| `markspec:tests`      | none         | doc     |
| `markspec:elements`   | none         | doc     |
| `markspec:references` | registry URL | both    |
| `markspec:paginate`   | none         | deck    |

Type directives (`glossary`, `summary`, `deck`) are mutually exclusive.
Family-hint directives (`specs`, `tests`, `elements`, `references` without a
payload) hint at the predominant entry family in the document — used by
`markspec fmt` to classify new entries before they carry an identity attribute.
`references` (with a URL payload) can coexist with any type directive. `doc` is
the default — no directive for it. Multiple `markspec:references` directives
with URL payloads declare multiple upstream registries; order matters, with an
implicit fallback to RefHub.

Document-level retirement uses the `deprecated:` front-matter key (or
`supersedes:` for replacement retirement), not a directive. See §6.2.

`glossary` and `summary` are auto-detected from filename (`GLOSSARY.md`,
`SUMMARY.md`). Family-hint directives are auto-detected from filename:
`tests.md` implies `markspec:tests`, `elements.md` implies `markspec:elements`,
`references.md` implies `markspec:references`. The directive is needed when the
file has a different name. `deck` is never auto-detected — it always requires an
explicit directive.

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
---
document-type: glossary
supersedes: 01HGW2D0GLOSPQ4FGHIJKLMNOPQ # platform-glossary.md document-id
---

# Legacy Terms
```

Or for a glossary with no successor:

```markdown
---
document-type: glossary
deprecated: "Archived after platform migration; content no longer maintained."
---

# Legacy Terms
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

**Example 27 — spec and test references:**

```markdown
This module implements {{spec.SRS_BRK_0107}}. Verified by {{test.SWT_BRK_0107}}.
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

| Namespace | References                        | ID source         |
| --------- | --------------------------------- | ----------------- |
| `spec`    | Spec entries (any TYPE)           | Display ID        |
| `test`    | Test entries                      | Display ID        |
| `element` | Element entries                   | Display ID        |
| `ref`     | Reference entries, registry chain | Slug              |
| `fig`     | Figures                           | Slug from caption |
| `tbl`     | Tables                            | Slug from caption |
| `h`       | Headings                          | GFM anchor        |

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

### 6.2 Document attributes and properties

Per-file metadata splits into two tiers (mirroring the entry model):

- **Attributes** — authored by the author in YAML front matter.
- **Properties** — observed by tooling (filename, git history, filesystem).

#### Document attributes (authored in front matter)

| Attribute       | Type          | Required | Description                                        |
| --------------- | ------------- | -------- | -------------------------------------------------- |
| `document-id`   | `id`          | no       | Document ULID — `01H…` 26-char Crockford base32    |
| `document-type` | `enum`        | no       | Overrides filename/directive detection (see §6.3)  |
| `labels`        | `tag-list`    | no       | Classification tags (includes `DRAFT` marker)      |
| `external-id`   | `external-id` | no       | Cross-system identifier (`scheme:value`)           |
| `supersedes`    | `id`          | no       | `document-id` of a document this one replaces      |
| `deprecated`    | `string`      | no       | Retirement reason (non-replacement case)           |
| `references`    | `citation`    | no       | External reference citations with optional locator |
| `metadata`      | map           | no       | Org free-form metadata, never validated            |

Document lifecycle mirrors entry lifecycle: `DRAFT` label for work in progress;
`supersedes:` for replacement retirement; `deprecated:` for non-replacement
retirement. There is no separate `status:` front-matter key. There is no
`DEPRECATED` / `WITHDRAWN` label.

All attribute value types follow the 14-type system from §2.6. Profiles may
declare additional keys; projects may allowlist SSG-ecosystem keys in
`.markspec.yaml` → `frontMatter.allowedKeys` (see §9.1).

#### Document properties (observed)

| Property     | Source                          | Fallback                      |
| ------------ | ------------------------------- | ----------------------------- |
| **title**    | H1 heading                      | Filename stem                 |
| **revision** | Merge-to-main count             | `0`                           |
| **authors**  | `project.yaml`                  | Git unique commit authors     |
| **created**  | Git first commit timestamp      | File system creation time     |
| **modified** | Git last merge commit timestamp | File system modification time |

These are **never authored in front matter** — `title:`, `author:`, `date:`,
`description:`, `toc:`, `cover:` in front matter are errors (see §8.6 MSL-D001).
The H1, first paragraph, git history, and filesystem are the authoritative
sources.

**revision:** starts at `0`. Increments on each merged PR/MR that modifies the
file. Commits within a branch do not count.

**authors:** `project.yaml` recommended — Git history is fragile across moves
and migrations.

**draft / retirement**: structural signals, not derived. Documents carry `DRAFT`
via `labels:` and/or `deprecated:` via front matter. Replacement is via
`supersedes:`. No branch-derived lifecycle inference.

### 6.3 Document types

| Type         | Detection                    | Description                       |
| ------------ | ---------------------------- | --------------------------------- |
| `doc`        | default                      | Any Markdown file                 |
| `glossary`   | `GLOSSARY.md` or directive   | Heading-based term definitions    |
| `summary`    | `SUMMARY.md` or directive    | Book table of contents            |
| `references` | `references.md` or directive | Reference-entry collection        |
| `deck`       | directive only               | Slide deck (`---` = slide breaks) |
| `code`       | file extension               | Source files with doc comments    |

Profiles may declare additional document types and bind them to per-type
collections (e.g., `requirements.md`, `tests.md` mapped to specific
profile-declared Authored types). The core ships only the generic types above.

**Heading rules by type:**

- **doc** — one H1, no skipped levels.
- **glossary** — one H1 (title), H2 (letter groups), H3 (terms).
- **summary** — first H1 is the book title, additional H1s are part headings.
  Exempt from single-H1.
- **references** and other profile-declared collection types — one H1, standard
  heading rules.
- **deck** — one H1 (deck title). `---` creates slide breaks. H2 headings start
  each slide. Heading hierarchy is per-slide — H3/H4 within a slide are valid
  regardless of other slides.

### 6.4 Content entities

| Entity        | Source                                  | ID         |
| ------------- | --------------------------------------- | ---------- |
| **Authored**  | Authored entry blocks (ULID-valued Id:) | Display ID |
| **Reference** | Reference entry blocks (URI-valued Id:) | Slug       |
| **fig**       | Figure captions, alt text               | Slug       |
| **tbl**       | Table captions                          | Slug       |
| **h**         | Headings                                | GFM anchor |

The active profile classifies Authored and Reference entries into specific types
(`requirement`, `test`, `unit`, `standard`, `dependency`, …). The core
distinguishes only the two shapes; everything finer is profile-declared.

### 6.5 References

References (standards, regulations, external specifications) are resolved
through a resolution chain. Projects declare upstream registries in
`project.yaml` via the `references` field (project-wide) and per-file via
`markspec:references` directives. Resolution order: local project → declared
dependencies (in order) → declared references (in order) → per-file
`markspec:references` directives → RefHub (implicit fallback).

`{{ref.ID}}` inline references and `Derived-from:` attribute values are
validated against the resolution chain at build time.

### 6.6 Rule activation

Entry rules (MSL-R\*) activate on any file containing `- [DISPLAY_ID]` entry
blocks. Traceability rules (MSL-T\*) activate on entries carrying an identity
attribute. Glossary rules (MSL-G\*) activate only on `glossary` documents.
Summary rules (MSL-S\*) activate only on `summary` documents.

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
- **Front matter** — YAML form; keys sorted to canonical order (core keys, then
  profile-declared, then `metadata:`, then allowlisted ecosystem keys);
  forbidden keys removed with an info diagnostic (MSL-D001). See §6.

---

## Part 8 — Lint Rules

### 8.1 Severity

| Severity    | CI behavior             |
| ----------- | ----------------------- |
| **error**   | Fails the build         |
| **warning** | Reported, does not fail |
| **notice**  | Verbose mode only       |

### 8.2 Entry format (MSL-R)

| ID         | Severity | Rule                                                                                                                                         |
| ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSL-R001` | error    | Entry block: `- [DISPLAY_ID]` with indented body (Reference-entry body is optional).                                                         |
| `MSL-R002` | error    | Display ID is non-empty; matches the active profile's `display-id-pattern:` for its inferred type when one applies.                          |
| `MSL-R003` | error    | Exactly one `Id:` attribute per entry.                                                                                                       |
| `MSL-R004` | error    | `Id:` value well-formed: bare ULID (`^[0-9A-HJKMNP-TV-Z]{26}$`) for Authored entries; scheme-qualified URI (RFC 3986) for Reference entries. |
| `MSL-R005` | error    | ULID unique across repository.                                                                                                               |
| `MSL-R006` | error    | Display ID unique within project and registry chain.                                                                                         |
| `MSL-R007` | warning  | When a profile declares a `display-id-pattern:` for the entry's inferred type, the display ID matches it.                                    |
| `MSL-R008` | error    | Slug-shaped display ID (no scheme, not a ULID) on a Reference entry must match the slug regex.                                               |
| `MSL-R009` | warning  | Sequence number > 0 in patterned display IDs.                                                                                                |
| `MSL-R010` | warning  | Unknown attributes (not in core universal set, not declared by active profile). Generated attributes must not appear in source.              |
| `MSL-R011` | error    | No emphasis inside entry blocks.                                                                                                             |
| `MSL-R012` | warning  | Canonical attribute order. Auto-fixed.                                                                                                       |
| `MSL-R013` | warning  | Sequential numbering expected within a scope.                                                                                                |
| `MSL-R014` | error    | Display ID or `Id:` collides with an entry delivered by the active profile's corpus (ADR-030). Rename the project entry.                     |

MSL-R001 and MSL-R011 apply to all entry blocks. MSL-R002–R010 apply to entries
carrying an `Id:` attribute.

### 8.3 Traceability (MSL-T)

| ID         | Severity | Rule                                                                                              |
| ---------- | -------- | ------------------------------------------------------------------------------------------------- |
| `MSL-T001` | error    | `Satisfies:` target must resolve to an existing spec entry.                                       |
| `MSL-T004` | warning  | `Derived-from:` target must resolve to an existing spec entry.                                    |
| `MSL-T005` | error    | `References:` slug must resolve to an existing reference entry.                                   |
| `MSL-T006` | error    | `Allocated-to:` target must resolve to an existing element entry.                                 |
| `MSL-T007` | error    | `Realizes:` target (on elements) must resolve to an existing spec entry.                          |
| `MSL-T008` | error    | `Verifies:` target (on tests) must resolve to an existing spec entry.                             |
| `MSL-T009` | error    | `Tests:` target (on tests) must resolve to an existing element entry.                             |
| `MSL-T010` | error    | `Part-of:` target must resolve to an existing element entry.                                      |
| `MSL-T011` | error    | `Depends-on:` target must resolve to an existing element entry.                                   |
| `MSL-T012` | error    | `Supersedes:` target must resolve to an existing same-family entry.                               |
| `MSL-T013` | tiered   | Link target is non-active: `DRAFT` label=info; `Superseded-by:` set or `Deprecated:` set=warning. |

`MSL-T014` is reserved for a future registry-chain check on `References:`
(warning severity) when reference resolution via upstream registries lands.

Type resolution and per-type attribute validation (spec §1.3, §1.6):

| ID         | Severity | Rule                                                                                                                                                       |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSL-T020` | error    | `Type:` value is neither a core type nor a profile-declared type.                                                                                          |
| `MSL-T021` | warning  | Core type inferred (display-ID prefix, URI scheme, or discriminating attribute); declare `Type:` explicitly to silence.                                    |
| `MSL-T022` | warning  | Attribute is core-known but not valid on the entry's resolved type.                                                                                        |
| `MSL-T023` | error    | `Type:` value looks like a profile-declared type but no profile is loaded (core-only mode).                                                                |
| `MSL-T024` | warning  | Entry carries a type-specific attribute but its core type could not be resolved (no `Type:`, no profile, no inferable signal).                             |
| `MSL-T025` | error    | `Discipline:` value is not a known kind (core or profile-declared) — ADR-017 Slice 3.                                                                      |
| `MSL-T026` | error    | `Discipline-frozen:` value is malformed (expected `<kind>` or `<kind> @ YYYY-MM-DD`, calendar-valid date) — ADR-017 Slice 3.                               |
| `MSL-T027` | error    | `Discipline-frozen:` parses but its kind is not in the effective kind set — ADR-017 Slice 3.                                                               |
| `MSL-T028` | warning  | `Discipline:` override conflicts with the type-based derivation (channel 3) — ADR-017 Slice 3.                                                             |
| `MSL-T029` | warning  | `Discipline:` override conflicts with the allocation-based derivation (channel 4) — ADR-017 Slice 3.                                                       |
| `MSL-T030` | warning  | `Discipline-frozen:` kind differs from the current channels-3/4 derivation. Not suppressed when current derivation defaults to `system` — ADR-017 Slice 3. |
| `MSL-T031` | warning  | `Discipline:` and `Discipline-frozen:` both well-formed and reference known kinds, but disagree — ADR-017 Slice 3.                                         |

Profile-declared enum attributes (e.g., `ASIL`, `Test-level`, `Element-kind`)
are validated against the vocabulary declared in the active profile's manifest.
The core defines no enum vocabularies of its own.

Direction and level-crossing rules (e.g., "acceptance tests verify stakeholder
requirements") are profile concerns, not core concerns.

### 8.4 Link rules (MSL-L)

Existence and cardinality rules for the targets of trace-relation links.

| ID         | Severity | Rule                                                                                                                            |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `MSL-L006` | warning  | Profile trace-relation target does not resolve to any entry (resolved by display ID or ULID). Scheme-qualified URIs are exempt. |

### 8.5 References (MSL-M)

| ID         | Severity | Rule                                                            |
| ---------- | -------- | --------------------------------------------------------------- |
| `MSL-M001` | error    | Every `{{namespace.id}}` must resolve.                          |
| `MSL-M002` | error    | Namespace: `spec`, `test`, `element`, `ref`, `fig`, `tbl`, `h`. |
| `MSL-M003` | error    | No sections, inverted sections, or partials.                    |

### 8.6 Document structure (MSL-D)

| ID         | Severity     | Rule                                                                                                                                                                                                                                                                    |
| ---------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSL-D001` | error        | Front matter keys must be core, profile-declared, `metadata`, or allowlisted in `.markspec.yaml`. Forbidden keys (`title`, `description`, `toc`, `authors`, `author`, `date`, `created`, `modified`, `cover`, `images`, `sections`) are errors with auto-fix to remove. |
| `MSL-D002` | warning      | Footnotes must not contain requirement IDs.                                                                                                                                                                                                                             |
| `MSL-D003` | notice       | Non-standard alert types.                                                                                                                                                                                                                                               |
| `MSL-D004` | warning      | Caption format: `_Table:_` above, `_Figure:_` below.                                                                                                                                                                                                                    |
| `MSL-D005` | warning      | SVGs: `viewBox` required, no fixed `width`/`height`.                                                                                                                                                                                                                    |
| `MSL-D006` | configurable | Inline links vs reference-style links. Controlled by `referenceLinks` config: `none` (no check), `warn` (prefer reference-style), `enforce` (require reference-style).                                                                                                  |
| `MSL-D007` | warning      | Reference definitions at end of document, alphabetical within groups. Auto-fixed.                                                                                                                                                                                       |
| `MSL-D008` | error        | Image paths must be relative and stay within the document folder. Absolute URLs (`https://...`), repo-root links (`/...`), and paths escaping via `../../` are not permitted (ADR-003).                                                                                 |

### 8.7 Glossary (MSL-G)

| ID         | Severity | Rule                                                                                 |
| ---------- | -------- | ------------------------------------------------------------------------------------ |
| `MSL-G001` | error    | H1 title, H2 letter groups, H3 terms.                                                |
| `MSL-G002` | warning  | Terms sorted within letter groups.                                                   |
| `MSL-G003` | warning  | Link references at end of file, alphabetical within groups (internal then external). |
| `MSL-G004` | error    | Cross-links reference existing headings.                                             |

### 8.8 Summary (MSL-S)

| ID         | Severity | Rule                                                              |
| ---------- | -------- | ----------------------------------------------------------------- |
| `MSL-S001` | error    | Every link target must reference an existing file.                |
| `MSL-S002` | error    | No empty links (`- [Title]()`).                                   |
| `MSL-S003` | error    | No duplicate file paths.                                          |
| `MSL-S004` | warning  | Markdown files in the source directory not referenced in summary. |

### 8.9 Formatting (MSL-F)

Drift between a file's on-disk form and what `markspec fmt` would write, plus
one advisory `fmt` raises about itself. `MSL-F010` and `MSL-F011` fire only in
the project-wide composite `markspec check` gate (ADR-027) and mirror
`markspec fmt` / `markspec fmt --check` exactly, from the same `.gitignore`- and
`exclude:`-aware corpus. They are Markdown-only — `markspec fmt` never rewrites
source files.

| ID         | Severity | Rule                                                                                                                                                                                                                                                 |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSL-F010` | error    | Formatter drift: the file's whitespace / attribute form differs from `markspec fmt` output (indentation, backslashes, attribute order, modal-verb casing, …).                                                                                        |
| `MSL-F011` | error    | Reference-canonicalization drift: a trace-relation value is a ULID or stale display ID that `markspec fmt` would rewrite to its current canonical display ID (ADR-026). Kept distinct from `MSL-F010` so the author knows which `fmt` concern fired. |
| `MSL-F012` | info     | Markdown-pass fallback: the whole-document formatter's output was rejected by the CommonMark-semantic gate; the original text was kept (ADR-029).                                                                                                    |

`MSL-F010` and `MSL-F011` are project-wide-only — a file-local
`markspec check
<file>` does not fire them (the canonical agent path runs `fmt`
before `check`). `MSL-F012` is emitted directly by `fmt` (and format-on-save)
when the whole-document Markdown pass (ADR-029) falls back on a single entry, so
it fires file-locally too — it is not gated on the composite `check` corpus. The
`MSL-F` prefix is a bounded early adoption of the nextgen "format reports"
family named in [ADR-012](../../architecture/adr-012-diagnostic-code-scheme.md),
the same pattern as `MSL-B044` / `MSL-C072`; see ADR-012's ADR-027 amendment.

### 8.10 Lockfile and external sync (MSL-L, MSL-S)

The lockfile (`MSL-L###`) and external-sync (`MSL-S###`) diagnostic families are
governed by [ADR-022](../../architecture/adr-022-lockfile-and-external-sync.md)
and catalogued in
[ADR-012](../../architecture/adr-012-diagnostic-code-scheme.md) (ADR-022
amendment). The offline composite `markspec check` gate emits one of them:

| ID         | Severity | Rule                                                                                                                                                                                                                                                               |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MSL-L212` | error    | Canonical edge-hash drift: the project's traceability edges no longer match the hash pinned in `markspec.lock` (run `markspec lock`). Fires only when `markspec.lock` exists; checked offline (no network — upstream resolution stays in `markspec lock --check`). |

> **Prefix overlap (known, pre-existing).** The `MSL-L###` lockfile family
> shares its prefix with §8.4's link rules (`MSL-L006`), and the `MSL-S###`
> external-sync family shares its prefix with §8.8's summary rules
> (`MSL-S001`–`S004`). This overlap predates the composite gate; disambiguation
> is deferred to the sequenced ADR-012 scheme migration, not resolved here (code
> names are a public interface — renumbering is a breaking change).

---

## Part 9 — Configuration

### 9.1 Schema

`.markspec.yaml`:

```yaml
referenceLinks: warn # none | warn | enforce
frontMatter:
  allowedKeys:
    - layout # Hugo
    - permalink # Jekyll
    - sidebar_position # Docusaurus
    - draft
    - aliases
```

`.markspec.toml`:

```toml
referenceLinks = "warn"

[frontMatter]
allowedKeys = ["layout", "permalink", "sidebar_position", "draft", "aliases"]
```

| Property                  | Type     | Default  | Values                                                                                                       |
| ------------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `referenceLinks`          | string   | `"warn"` | `none`, `warn`, `enforce`                                                                                    |
| `frontMatter.allowedKeys` | string[] | `[]`     | Top-level front-matter keys to accept beyond core / profile / `metadata`. Preserved verbatim, not validated. |

All formatting rules are fixed. There is no formatter choice — dprint is the
formatter.

### 9.2 CI

```yaml
lint:
  steps:
    - name: Format check
      run: markspec fmt --check

    - name: Lint
      run: markspec check
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
/// [SWT_BRK_0107] Debounce unit test
///
/// Given a 10ms debounce window, a 5ms noise spike
/// must not alter the stable output.
///
///     Id: 01HGW3R9QLP4ABCDEFGHJKMNPQ
///     Verifies: SRS_BRK_0107
///     Tests: braking_core::controller::debounce_input
///     Labels: ASIL-B
#[test]
fn swt_brk_0107_debounce_filters_noise() {
    // test implementation
}
```

### Kotlin

```kotlin
/**
 * [SWT_BRK_0107] Debounce unit test
 *
 * Given a 10ms debounce window, a 5ms noise spike
 * must not alter the stable output.
 *
 *     Id: 01HGW3R9QLP4ABCDEFGHJKMNPQ
 *     Verifies: SRS_BRK_0107
 *     Tests: braking_core::controller::debounce_input
 *     Labels: ASIL-B
 */
@Test
fun `swt_brk_0107 debounce filters noise`() {
    // test implementation
}
```

### C++ (Doxygen)

```cpp
/// [SWT_BRK_0107] Debounce unit test
///
/// Given a 10ms debounce window, a 5ms noise spike
/// must not alter the stable output.
///
///     Id: 01HGW3R9QLP4ABCDEFGHJKMNPQ
///     Verifies: SRS_BRK_0107
///     Tests: braking_core::controller::debounce_input
///     Labels: ASIL-B
auto debounce_input(uint16_t raw) -> uint16_t;
```

### C (Doxygen)

```c
/**
 * [SWT_BRK_0107] Debounce unit test
 *
 * Given a 10ms debounce window, a 5ms noise spike
 * must not alter the stable output.
 *
 *     Id: 01HGW3R9QLP4ABCDEFGHJKMNPQ
 *     Verifies: SRS_BRK_0107
 *     Tests: braking_core::controller::debounce_input
 *     Labels: ASIL-B
 */
void debounce_input(uint16_t* raw);
```

### Java (JDK 23+)

```java
/// [SWT_BRK_0107] Debounce unit test
///
/// Given a 10ms debounce window, a 5ms noise spike
/// must not alter the stable output.
///
///     Id: 01HGW3R9QLP4ABCDEFGHJKMNPQ
///     Verifies: SRS_BRK_0107
///     Tests: braking_core::controller::debounce_input
///     Labels: ASIL-B
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
 * [SWT_BRK_0107] Debounce unit test
 *
 * Given a 10ms debounce window, a 5ms noise spike
 * must not alter the stable output.
 *
 * Id: 01HGW3R9QLP4ABCDEFGHJKMNPQ
 * Verifies: SRS_BRK_0107
 * Tests: braking_core::controller::debounce_input
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
