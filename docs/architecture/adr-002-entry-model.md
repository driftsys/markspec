# ADR-002: Entry Model — Spec and Reference Families

Status: Accepted\
Date: 2026-04-17\
Scope: MarkSpec

## Context

### Requirements need to be traceable

MarkSpec documents must support requirements that are:

- **Traceable** — linked to source code, tests, architecture, and external
  standards
- **Structured** — carrying metadata (priority, status, traceability links)
  without forcing external databases
- **Bidirectional** — upstream links (what a requirement depends on) and
  downstream links (what it verifies, implements, or allocates to) both
  discoverable
- **Versionable** — surviving renumbering, migration between systems, and git
  history

The initial design (ADR-001) hardcoded an automotive V-model vocabulary (STK,
SYS, SRS, SAD, ICD, VAL, SIT, SWT) into the core format, which limits adoption
in aerospace (DO-178C), medical (IEC 62304), railway (EN 50128), and other
safety-critical domains.

### Core must separate format from vocabulary

This ADR separates the **entry format** (how to write traceable blocks) from the
**domain vocabulary** (what types of entries exist). The core defines a
universal entry model with two formal families — **spec entries** and
**reference entries** — each with precise format, minimal required attributes,
and well-defined validation rules.

Concrete type vocabularies (automotive V-model, DO-178C, IEC 62304) move out of
the core into profiles. This allows MarkSpec to serve multiple industries
without compromising either the core format or domain-specific needs.

---

## Part 1 — Entry (Common Base)

All entry families share a common syntactic form and a common set of universal
properties. `Entry` is an abstract concept — every concrete entry is either a
spec or a reference.

### Syntactic form

```
- [DISPLAY_ID] Title

  Body paragraphs.

  Key: Value\
  Key: Value
```

An entry block is a Markdown list item whose content between `[` and `]` is a
display ID, followed by a non-empty title on the same line, followed by indented
body content, optionally terminated by `Key: Value` trailers following the
git-trailers convention.

### Required structural properties

| Property       | Rule                                                           |
| -------------- | -------------------------------------------------------------- |
| **Display ID** | Non-empty, format defined by specialization                    |
| **Title**      | Non-empty text on the bullet line after `]`                    |
| **Body**       | At least one indented paragraph (exception: reference entries) |

A bullet without an indented body is a normal list item, not an entry.

### Core universal attributes

| Attribute | Description                                    |
| --------- | ---------------------------------------------- |
| `Labels`  | Free-form classification tags, comma-separated |

`Labels` is the only attribute universally available on all entry families. All
other attributes are specific to a family or declared by a profile.

---

## Part 2 — Spec Entries

### Intent

A spec entry is a **canonical declaration of a numbered object of reasoning**
produced by the project: requirements, tests, architecture descriptions,
hazards, ADRs, and similar traceable artifacts. The project is the authority on
the content.

### Display ID format

```
^[A-Z]{2,6}_[A-Z][A-Z0-9]{2,7}(_[A-Z][A-Z0-9]{2,7})?_\d{3,6}$
```

| Segment       | Constraint                                                   | Role                                        |
| ------------- | ------------------------------------------------------------ | ------------------------------------------- |
| **TYPE**      | 2 to 6 uppercase letters                                     | Entry category (STK, SYS, SRS, HAZ, SYREQ…) |
| **DOMAIN**    | 3 to 8 characters, first letter, rest alphanumeric uppercase | Subsystem abbreviation (BRK, NAV, PWR…)     |
| **SUBDOMAIN** | Optional, same format as DOMAIN                              | Subdivision of a domain (CTRL, SENSOR…)     |
| **NNNN**      | 3 to 6 digits, number ≥ 1                                    | Sequential number within scope              |

**Scope** for uniqueness and numbering is the full `TYPE_DOMAIN[_SUBDOMAIN]`
prefix. Maximum of 999,999 entries per scope.

Concrete TYPE values (STK, SYS, SRS, VAL, SIT, SWT…) are not defined by the
core. They come from a profile loaded by the project.

### Examples

Valid:

- `SRS_BRK_0107` — software requirement, braking domain, entry 107
- `SRS_BRK_001` — same scope, entry 1 in 3-digit padding
- `SRS_BRK_CTRL_0042` — with subdomain CTRL
- `SYREQ_BRK_100` — 5-letter type
- `HAZ_PWR_99999` — 5-digit padding

Invalid:

- `srs_brk_0001` — lowercase not allowed
- `SRS_BRK_12` — NNNN too short (minimum 3 digits)
- `SRS_BRK_000` — number zero not allowed
- `S_BRK_001` — TYPE too short (minimum 2 letters)
- `SRS_B_001` — DOMAIN too short (minimum 3 characters)

### ULID

Every spec entry carries a mandatory `Id` attribute containing a ULID prefixed
with the entry type.

```
Id: SRS_01HGW2Q8MNP3RSTVWXYZABCDE
```

**Format**: `^[A-Z]{2,6}_[0-9A-Z]{26}$`

The TYPE prefix must match the TYPE prefix of the display ID. The ULID itself is
a standard 26-character Crockford base32 ULID.

**Rules**:

- The ULID is assigned by `markspec format` (typically via pre-commit hook). It
  is never hand-authored.
- Once assigned, the ULID is immutable. It survives display ID renumbering.
- The ULID is globally unique in the repository.

### Core attributes

| Attribute      | Required | Description                                                      |
| -------------- | -------- | ---------------------------------------------------------------- |
| `Id`           | yes      | Prefixed ULID, assigned by tooling                               |
| `Satisfies`    | no       | Upstream link to parent spec entry/entries                       |
| `Derived-from` | no       | Upstream link to a reference entry with optional section locator |
| `References`   | no       | Comma-separated reference IDs this entry cites                   |
| `Allocated-to` | no       | Allocation to system element(s) or component(s)                  |
| `Labels`       | no       | Free-form tags (inherited from Entry base)                       |

Additional relations (`Verifies`, `Implements`, etc.) are declared by profiles,
not by the core. The validation rule "the target must exist" applies to all
relations at the core level; direction rules come from the loaded profile.

### Test Entries (Spec Family)

Test entries are spec entries with TYPE values in the verification category:
**VAL**, **SIT**, **SWT**. They follow the same display ID and ULID format as
other spec entries.

| TYPE    | Full name               | Verifies level |
| ------- | ----------------------- | -------------- |
| **VAL** | Acceptance Test         | STK            |
| **SIT** | System Integration Test | SYS            |
| **SWT** | Software Unit Test      | SRS            |

Test entries are no different from requirement or architecture entries at the
core level — they are spec entries with a specific TYPE. The direction rule (VAL
verifies STK, SIT verifies SYS/ICD, SWT verifies SRS) is a profile concern, not
a core concern. Test entries may carry `Verifies` and `Implements` links
(declared by profiles), alongside the core attributes (`Satisfies`,
`Derived-from`, `References`, `Allocated-to`).

### Validation rules (errors)

1. Display ID matches the spec regex.
2. `Id` attribute is present and well-formed.
3. TYPE of `Id` matches TYPE of display ID.
4. Display ID is unique within the project.
5. ULID is unique within the repository.
6. Subdomain presence is consistent within a `TYPE_DOMAIN` scope: either all
   entries in the scope use a subdomain or none do.
7. NNNN is a positive integer (no `000`, `0000`, etc.).
8. `Satisfies`, `Derived-from`, `References`, and `Allocated-to` targets exist
   in the resolution scope.

### Creation and autocompletion rule

When tooling generates a new display ID in a given scope:

```
N_max   = largest number currently in scope (0 if empty)
padding = max(3, len(str(N_max)))
new_id  = TYPE_DOMAIN[_SUBDOMAIN]_<N_next zero-padded to `padding` digits>
```

Existing entries are never automatically renumbered.

Examples:

- Empty scope → `SRS_BRK_001`
- Scope `{001, 042}` → next is `SRS_BRK_043`
- Scope `{001, 999}` → next is `SRS_BRK_1000`
- Scope `{001, 042, 1000}` → next is `SRS_BRK_1001` (existing 001 and 042 left
  as-is)

A scope may contain a mix of padding widths. No error, no warning.

---

## Part 3 — Reference Entries

### Intent

A reference entry is a **bibliographic notice citing a document or publication
external to MarkSpec**. The cited work exists independently — published by a
standards organization, an authority, a corporate entity, or an academic venue.
The reference entry is the record that identifies the work and allows the
project to cite it. The project is **not** the authority on the content of the
cited work.

Examples: ISO 26262-6, DO-178C, RFC 2119, UNECE R155, MISRA C:2012, academic
papers, corporate specifications.

### Display ID format (slug)

```
^[A-Za-z][A-Za-z0-9]*([.-][A-Za-z0-9]+)*$
```

Rules:

- Starts with a letter (uppercase or lowercase).
- Contains alphanumerics, with hyphens and dots as internal separators.
- Punctuation must be **internal**: never at the start, never at the end, never
  repeated consecutively.

This regex aligns with the Pandoc citation key convention, a de facto standard
in the Markdown ecosystem.

### Style guide conventions (non-normative)

| Use case                            | Convention             | Examples                                                           |
| ----------------------------------- | ---------------------- | ------------------------------------------------------------------ |
| Technical standards and regulations | Uppercase with hyphens | `ISO-26262-6`, `DO-178C`, `RFC-2119`, `UNECE-R155`, `MISRA-C-2012` |
| Academic citations and DOI-derived  | Lowercase              | `smith2021`, `knuth1984`, `patashnik-bibtexing`                    |
| Standard versions with dots         | Either dots or hyphens | `ASPICE.4.0` or `ASPICE-4-0`                                       |

Within a single `references` document, consistency is recommended.

### Discrimination from spec entries

Spec and reference regexes are disjoint by construction:

- Spec IDs always contain underscores.
- Reference slugs never contain underscores.

The parser discriminates in O(1) on the presence of an underscore.

### Recognition

A reference entry is recognized only inside a document of type `references`,
detected by filename (`references.md` or a file inside a `references/`
directory) or by the `<!-- markspec:references -->` document directive.

Outside of this context, a bullet with a slug in brackets is not parsed as a
reference entry.

### ULID

Reference entries have **no ULID**. The slug is the canonical identifier and is
stable by construction — cited works have canonical names assigned by their
publishing authority. The `Id` attribute is forbidden on a reference entry.

### Core attributes

| Attribute       | Required  | Description                                                        |
| --------------- | --------- | ------------------------------------------------------------------ |
| `URI`           | see below | Canonical resource identifier (URN, DOI, ISBN…)                    |
| `URL`           | see below | Web locator (HTTP/HTTPS)                                           |
| `Document`      | no        | Full formal bibliographic citation. Falls back to title if absent. |
| `Superseded-by` | no        | Slug of the reference that replaces this one                       |
| `Labels`        | no        | Free-form tags (inherited from Entry base)                         |

**At least one of `URI` or `URL` must be present.** A reference entry without
any external identifier is not usable and is rejected.

**Model fallback**: the `entry.uri` field exposed to consumers is computed as
`raw.URI ?? raw.URL`. When only `URL` is provided, the model exposes it as `uri`
because a URL is technically a URI per RFC 3986. This ensures that every valid
reference entry has an identifier, simplifying cross-registry tooling.

**Document fallback**: when `Document` is absent, the title serves as the formal
citation. Authors use `Document` only when the title diverges from the formal
citation (for example, a short human-readable title plus a formal citation with
edition and year).

### Examples

Standard with URN and URL:

```markdown
- [ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety — Part 6: Product development at the
  software level. Defines requirements for software unit design, implementation,
  and verification across ASIL levels A through D.

  URI: urn:iso:std:iso:26262:-6:ed-2\
  URL: https://www.iso.org/standard/68383.html
```

Regulation with URL only (no official URN exists):

```markdown
- [UNECE-R155] UNECE Regulation No. 155

  Cybersecurity and cybersecurity management system approval.

  URL:
  https://unece.org/transport/documents/2021/03/standards/un-regulation-no-155
```

Book with ISBN URN:

```markdown
- [KNUTH-TAOCP-1] The Art of Computer Programming, Vol. 1

  Fundamental algorithms. Classic reference on computer science algorithms by
  Donald Knuth.

  URI: urn:isbn:978-0-201-89683-4
```

Minimal stub (valid but discouraged):

```markdown
- [RFC-2119] RFC 2119

  URL: https://www.rfc-editor.org/rfc/rfc2119
```

### Validation rules (errors)

1. Display ID matches the reference slug regex.
2. Title is present and non-empty.
3. At least one of `URI` or `URL` is present.
4. `URI` and `URL` are syntactically well-formed (RFC 3986 minimal check).
5. Slug is unique within the resolution scope (local project plus registry
   chain).
6. `Superseded-by` points to a reference entry that exists in the resolution
   scope.

Reference entries are an explicit exception to the Entry base rule that requires
a body paragraph. A minimal reference entry may consist of only a display ID, a
title, and a `URI` or `URL`.

---

## Part 4 — Element Entries (Anticipated)

A fourth family for system elements (components, units, interfaces, hardware
items) is anticipated. Element entries represent the architecture and system
decomposition — the "things" that implement spec entries.

Examples: ECU, sensor module, communication bus, CAN interface, software
component, hardware subsystem.

Element entries are **not** specified in this ADR. They are deferred to a
subsequent architectural decision record. When defined, they will follow the
same principles: a precise format, minimal required attributes, and well-defined
validation rules independent of any domain vocabulary.

---

## Part 5 — In-Code Entries

Requirements can be authored in doc comments in source files. A doc comment
starting with `[TYPE_XYZ_NNNN]` is recognized as a MarkSpec requirement. The
leading `-` bullet is optional in doc comments — the `[DISPLAY_ID]` pattern
alone is sufficient.

**Supported languages:**

- Rust (`///`)
- Kotlin (`/** */` KDoc)
- C++ (`///` Doxygen)
- C (`/** */` Doxygen)
- Java 23+ (`///` per JEP 467)
- Java legacy (`/** */` Javadoc, with caveats)

The doc comment is the requirement specification. The function decorated is the
implementation. The test function is the verification. Tooling discovers these
implicit relationships and outputs them as traceability links.

---

## Consequences

### Core stays minimal

The core specification defines:

- The entry block grammar (shared across families).
- The `Labels` universal attribute.
- The spec display ID regex and the ULID format.
- The reference slug regex and bibliographic attributes.
- The validation rules listed above.

It does **not** define concrete type vocabularies, traceability graph
constraints, or domain-specific attributes. These are the responsibility of
profiles.

### Profiles become the vocabulary layer

The automotive V-model vocabulary (STK, SYS, SRS, SAD, ICD, VAL, SIT, SWT) and
its traceability rules move from the core specification to a profile document.
Existing Fast Track projects continue to work by declaring this profile. New
projects targeting other domains (DO-178C, IEC 62304, EN 50128) declare their
own profile. See future ADR on profile format.

### Format is domain-agnostic

MarkSpec can now serve aerospace, medical, railway, and other safety-critical
industries without core changes. Each domain declares its own profile with its
own vocabulary and traceability rules.

### Source files are pure Markdown

Authored entries render correctly on GitHub and GitLab without any build step.
Git history remains clean — only human-authored content is committed. Generated
outputs (traceability matrices, resolved references, compiled documentation) are
build artifacts.

### Registry chain applies uniformly

Both spec and reference entries can be imported from an external project via the
registry chain. The import mechanism is the same for both families. The
distinction between the families is about their **role** (canonical declaration
vs. bibliographic notice), not about whether they are local or external.

### Tool interoperability is simplified

The ULID is the reconciliation key across all external systems. Requirements can
be exported to ReqIF, synchronized with external ALM tools via REST APIs, and
imported back without losing identity. Compatibility is an output of MarkSpec,
not a constraint on it.

---

## Open points

- **Profile document format** is deferred to a subsequent ADR. Profiles will
  declare concrete TYPE vocabularies, traceability direction rules, and
  domain-specific attributes.
- **Element entry family** specification is deferred. When defined, elements
  will be recognized by a distinct display ID format and supported as a fourth
  family.
- **Test procedure formats** (IEEE 829, Gherkin, Robot Framework in test entry
  bodies) and **Verifies/Implements LinkKind** are deferred to ADR-003.
