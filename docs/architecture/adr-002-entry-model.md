# ADR-002: Entry Model — Identified and Referenced Entries

Status: Proposed\
Date: 2026-04-17 (revised 2026-04-20 for ADR-009 alignment)\
Scope: MarkSpec\
Depends on: [ADR-001 — Markdown Format](./adr-001-markdown-format.md),
[ADR-009 — Core / Profile Boundary](./adr-009-core-profile-boundary.md)

## Context

ADR-001 introduced entry blocks as MarkSpec's mechanism for authoring traceable
artifacts alongside prose. Its initial formulation hardcoded an automotive
V-model vocabulary (STK, SYS, SRS, SAD, ICD, VAL, SIT, SWT) directly into the
core, which would have tied MarkSpec to a single domain.

This ADR separates the **entry format** from the **domain vocabulary**. The core
defines a minimal universal entry model anchored on two semantics-free
**shapes**:

- **Identified** — content units the project authors and owns, carrying a stable
  ULID identity and a human-readable display-ID alias.
- **Referenced** — citations of external artifacts, identified by a URI and
  labelled with a slug-style display ID (pandoc/BibTeX cite-key convention).

Concrete type vocabularies — `requirement`, `test`, `unit`, `standard`,
`dependency`, `hazard`, etc. — move out of the core into profiles per
[ADR-008 — Profile System](./adr-008-profile-system.md) and
[ADR-009 — Core / Profile Boundary](./adr-009-core-profile-boundary.md).

The two-shape model replaces an earlier four-family model (Spec, Test, Element,
Reference) that baked compliance scaffolding into core. ADR-009 §1–§2 documents
the rationale; this ADR realizes it in the entry-model specification.

### Key design decision: shape-by-identity-value-format

The shape of an entry is determined by the **value format** of its `Id:`
attribute. A **ULID** (26-char Crockford base32) identifies an identified entry;
a **URI** (RFC 3986, any scheme — `urn:`, `doi:`, `pkg:`, `https:`, …)
identifies a referenced entry. The two formats are visually disjoint: a URI must
carry a scheme followed by `:`, and a ULID is pure base32 with no scheme.
Discrimination is a one-step format check.

This replaces the earlier four-attribute discrimination (`Spec-id`, `Test-id`,
`Element-id`, `Reference-id` as separate attributes). The motivation and
rebuttal of alternatives are in ADR-009 §2 and §12.

---

## Part 1 — Entry (Common Base)

Both shapes share a common syntactic form and a common set of universal
properties. `Entry` is the abstract concept; every concrete entry is either
identified or referenced.

### Syntactic form

```text
- [DISPLAY_ID] Title

  Body paragraphs.

  Key: Value \
  Key: Value
```

An entry block is a Markdown list item whose content between `[` and `]` is a
display ID, followed by a non-empty title on the same line, followed by indented
body content, optionally terminated by `Key: Value` trailers following the
git-trailers convention.

### Required structural properties

| Property       | Rule                                                              |
| -------------- | ----------------------------------------------------------------- |
| **display_id** | Non-empty string; format depends on shape and active profile      |
| **title**      | Non-empty string on the same line as the `[DISPLAY_ID]` marker    |
| **body**       | At least one paragraph (referenced entries excepted — see Part 3) |
| **identity**   | Exactly one `Id:` attribute with a well-formed value              |

### Attribute origin

Every attribute has an **origin** describing how its value arrives in the model:

- **Authored** — written by the author in the source file.
- **Inferred** — pre-filled by `markspec format` from a heuristic (source
  context, namespace hierarchy, profile mapping). Committed to the source file,
  author-overridable when the heuristic misfires.
- **Assigned** — generated fresh by `markspec format` at creation time (the ULID
  inside an identified entry's `Id:`). Never derived from other data, never
  changes after assignment.
- **Generated** — computed at build time by inverting other entries' authored
  relations. Never committed to source.

### Universal attributes

The following attributes apply to every entry, with identical semantics and
value types:

| Attribute         | Type               | Origin        | Description                                            |
| ----------------- | ------------------ | ------------- | ------------------------------------------------------ |
| **Id**            | `id` (ULID or URI) | see §Identity | Identity attribute, required                           |
| **Labels**        | `tag-list`         | authored      | Free-form classification tags                          |
| **References**    | `citation`         | authored      | Citations of referenced entries, with optional locator |
| **External-id**   | `external-id`      | authored      | Identifier(s) in an external system                    |
| **Supersedes**    | `id`               | authored      | `Id:` value of a same-shape entry this one replaces    |
| **Superseded-by** | `id`               | generated     | Inverse of `Supersedes`                                |
| **Deprecated**    | `string`           | authored      | Retirement reason when no successor exists             |

Profiles may declare additional attributes per shape or per type. They may not
shadow `Id:`, which is the one core-reserved attribute name (ADR-009 §6).

### Identity

Every entry carries exactly one `Id:` attribute. Its value is either:

- a **ULID**: 26 characters of Crockford base32, pattern
  `^[0-9A-HJKMNP-TV-Z]{26}$`. Identifies an **identified** entry.
- a **URI**: any valid RFC 3986 URI with a scheme (`urn:`, `doi:`, `pkg:`,
  `https:`, `isbn:`, etc.). Identifies a **referenced** entry.

```text
Id: 01HGW2P4KFR7ABCDEFGHJKMNPQ        # ULID → identified
Id: urn:iso:std:iso:26262:-6:ed-2     # URI → referenced
Id: pkg:cargo/serde@1.0.0             # URI (purl) → referenced
Id: doi:10.1109/IEEESTD.2008.4610935  # URI → referenced
```

A bare slug (no scheme, not a ULID) is rejected as an `Id:` value. Slugs live in
the display ID for referenced entries; they are not duplicated in `Id:`.

**Assignment.** For identified entries, `markspec format` generates the ULID on
creation and commits it to source. Once assigned, it never changes.

**For referenced entries**, the URI is author-provided. MarkSpec does not invent
URIs — it records the canonical external identifier the author knows the
referenced work by.

### Retirement semantics

Entries can be **retired** — taken out of active use — in one of two
structurally distinct ways:

**Replacement-based retirement** — a successor entry carries
`Supersedes: <predecessor-id-value>`. The predecessor automatically gains the
generated inverse `Superseded-by: <successor-id-value>`. The presence of
`Superseded-by:` on an entry is the structural signal that it has been replaced.

**Non-replacement retirement** — the entry carries
`Deprecated: "<free-text reason>"`, e.g., "Feature cut from scope in v3.0" or
"Standard retracted; see ADR-042 for context". This covers cases where no single
successor exists (obsolete, scope cut, standard retracted).

An entry is considered **retired** when either signal is present:

- `Superseded-by:` is set (generated), OR
- `Deprecated:` is authored.

The two are complementary, not mutually exclusive — a replacement may still
carry a `Deprecated:` reason for additional context. Tooling treats any retired
entry as a warning target for incoming links.

**`Supersedes` operates within a shape**: an identified entry supersedes an
identified entry; a referenced entry supersedes a referenced entry. The relation
is intra-shape only. A successor may in turn be superseded, forming a chain.

### Draft state

The `DRAFT` label is a plain universal tag that marks an entry as "not yet
authoritative". It does not belong to an exclusive group — it is a free-form
label that carries a well-known semantic when set:

```text
Labels: DRAFT
```

Entries without `DRAFT` and without any retirement signal are treated as
**active and authoritative** (the implicit default). `DRAFT` exists to let
authors merge work-in-progress entries that should not yet be treated as
canonical.

### Link-resolution severity

Tooling emits severity-tiered diagnostics when a link attribute targets a
non-active entry:

| Target state                                        | Severity |
| --------------------------------------------------- | -------- |
| Active (no marker)                                  | OK       |
| `Labels: DRAFT`                                     | info     |
| Retired (`Superseded-by:` set OR `Deprecated:` set) | warning  |
| Unresolved (entry does not exist)                   | error    |

Retirement is expressed structurally through `Supersedes` or `Deprecated`; there
is no separate `DEPRECATED` / `WITHDRAWN` label.

### Entry properties (observed)

A **property** is a model-level observation about an entry that is not part of
the markup language. Properties are never authored in source, never round-trip
through `markspec format`, and do not appear in git diffs. They are captured by
the tooling from observable sources:

| Category | Source                 | Example properties                                      |
| -------- | ---------------------- | ------------------------------------------------------- |
| `file`   | The repository itself  | `path`, `line`, `column`                                |
| `git`    | `git log`, `git blame` | `created_at`, `modified_at`, `contributors`, `revision` |
| `sync`   | External connectors    | `last_synced_at`, `remote_state`, `external_source`     |
| `build`  | The compilation step   | `resolution_source`, `registry_origin`                  |
| `source` | Entry-source adapter   | `type`, `adapter`, `language`, `rule`, `extracted_at`   |

The model exposes properties as a separate namespace alongside attributes —
`entry.attributes` vs `entry.properties`. The full property model — observation
contracts, sync connector design, caching strategy, build-time provenance,
entry-source provenance — is specified in
[ADR-006 — Property Model](./adr-006-property-model.md) (as revised alongside
ADR-009).

**Design rule**: observed facts are properties; declared facts are attributes.
Identity lives in attributes; path, line, module name, and adapter metadata live
in properties (see ADR-009 §4).

### Attribute value types

Every attribute has a declared **value type** that determines which forms the
parser accepts and which form the formatter produces.

| Type          | Cardinality | Multi-line repeat | CSV on one line | Description                                                 |
| ------------- | ----------- | ----------------- | --------------- | ----------------------------------------------------------- |
| `id`          | single      | —                 | —               | Identity value (ULID) or URI, used by `Id:` and link attrs  |
| `id-list`     | repeatable  | ✓                 | ✓               | Multiple identifiers                                        |
| `uri`         | single      | —                 | —               | URI per RFC 3986 (URN, DOI, HTTPS URL, purl)                |
| `url`         | single      | —                 | —               | HTTPS navigation link                                       |
| `path`        | single      | —                 | —               | Filesystem path                                             |
| `path-or-id`  | single      | —                 | —               | Filesystem path or identity value                           |
| `enum`        | single      | —                 | —               | One value from a closed vocabulary                          |
| `tag-list`    | repeatable  | ✓                 | ✓               | Free-form tags                                              |
| `text`        | single      | —                 | —               | Free-form single-line text                                  |
| `citation`    | repeatable  | ✓                 | ✗               | Slug + optional free-text locator (locator may contain `,`) |
| `external-id` | repeatable  | ✓                 | ✓               | `scheme:value` qualified identifier                         |
| `integer`     | single      | —                 | —               | Whole number                                                |
| `date`        | single      | —                 | —               | ISO 8601 date (`YYYY-MM-DD`)                                |
| `boolean`     | single      | —                 | —               | `true` or `false`                                           |

#### Repeatable attributes

For types marked repeatable, authors may use either form.

**Multi-line repeat** follows the git-trailers convention:

```text
Derived-from: 01HGW2R0NPQR4STVWXYZABCDEF
Derived-from: 01HGW2S1PQRS5TVWXYZABCDEFG
Labels: ASIL-B
Labels: safety
```

**CSV on one line** is accepted when no value contains a comma:

```text
Derived-from: 01HGW2R0NPQR4STVWXYZABCDEF, 01HGW2S1PQRS5TVWXYZABCDEFG
Labels: ASIL-B, safety
```

The formatter always rewrites repeatable values to **multi-line** form for
diff-friendliness, grep-friendliness, and strict alignment with git trailers.
CSV is an accepted input but never a canonical output.

#### CSV restriction

CSV is forbidden for types whose values may contain commas. The `citation` type
(used by `References:`) permits free-text locators like `§9.4, Table 7`, which
would be ambiguous in CSV form. Citations must use multi-line:

```text
References: ISO-26262-6 §9.4.5
References: ISO-26262-6 Table 12
References: UNECE-R155
```

#### Future types

The following types are anticipated for profile use but are not defined by the
core today: `purl` (Package URL, specialized `external-id` / `uri`), `quantity`
(number with unit), `version` (semver), `duration`, `email`, `percentage`,
`range`. Profiles may introduce these types.

---

## Part 2 — Identified Entries

An identified entry is a content unit the project authors and owns: a
requirement, a test, a rule, a hazard, a component, a hardware part, a
configuration key, a glossary term. Its identity is project-local and
machine-generated (a ULID); its display ID is a human-readable alias chosen by
the author (subject to profile constraints).

### Identity

Every identified entry carries `Id:` whose value is a bare ULID:

```text
Id: 01HGW2P4KFR7ABCDEFGHJKMNPQ
```

The value is 26 characters in Crockford base32, pattern
`^[0-9A-HJKMNP-TV-Z]{26}$`. The ULID is:

- **Assigned** by `markspec format` at creation; never hand-authored.
- **Immutable** — once assigned, never changes.
- **Unique** — globally unique across the project and its imported registries.

The ULID is the stable identity. Display IDs are aliases (see §Display ID).

### Display ID

An identified entry's display ID is a human-readable alias appearing in the
`[DISPLAY_ID]` bracket. The core accepts any non-empty, project-unique string.
Profiles may tighten by declaring **display-ID patterns** per type (ADR-009 §5,
ADR-008 §6):

```yaml
# Profile declaration
types:
  requirement:
    display-id-pattern: "SPEC-{n:03d}" # SPEC-001, SPEC-042
  test:
    display-id-pattern: "TEST-{n:03d}"
  unit:
    display-id-pattern-enforcement: off # free-form symbolic IDs
```

Display IDs may be renumbered by tooling without changing the ULID. Refactoring
a module, moving an entry between files, or renaming the display ID must never
break a cross-reference — references resolve against the ULID.

### Shape-specific universal attributes

Identified entries carry the universal attributes from Part 1 (`Id`, `Labels`,
`References`, `External-id`, `Supersedes`, `Superseded-by`, `Deprecated`).

### Profile-declared type (usually inferred)

Every identified entry has an effective **type** — a name drawn from the active
profile's `types:` vocabulary. Type is normally **inferred by the profile from
the display-ID prefix** via a declared pattern
(`display-id-pattern: "SRS_{scope}_{n:04d}"` maps `SRS_BRK_0107` →
`type: software-requirement`). Authors do not write `type:` in source when
inference succeeds.

An explicit `type:` attribute **overrides inference** and is used when:

- The display ID does not match any declared pattern — free-form slugs, symbolic
  element paths (`braking_core::controller::debounce`), glossary terms.
- Pattern matching is ambiguous (multiple declared patterns match the same ID).
- The author wants the type visible in source without consulting the profile.

Compliance profiles populate the type vocabulary richly:

- An automotive ASPICE profile declares `type: requirement`,
  `type: software-requirement`, `type: unit-test`,
  `type: architectural-element`.
- A medical-device IEC 62304 profile declares `type: risk`,
  `type: software-item`, `type: verification-activity`.
- A generic-document profile declares `type: requirement`, `type: note`,
  `type: term` (see [ADR-010 — Default Profile](./adr-010-default-profile.md)).

### Profile-declared attributes

Traceability links, compliance attributes, kind enumerations, and any other
domain-specific facts are declared by profiles on top of the identified shape.
The core does not define `Derived-from`, `Verifies`, `Tests`, `Realizes`,
`Allocated-to`, `Depends-on`, `Element-kind`, `Test-level`, or any similar
attribute; they belong in the profile layer (ADR-008 §4 and §7).

### Example — inferred type (default profile)

Under the default profile's `requirement: display-id-pattern: "REQ-{n:03d}"`:

```markdown
- [REQ-107] Sensor input debouncing

  The sensor driver SHALL debounce raw inputs to eliminate electrical noise
  before processing. The debounce window SHALL be configurable per sensor type.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\
  Labels: sensor
```

The profile infers `type: requirement` from the `REQ-` prefix. No `type:`
attribute in source.

### Example — inferred type (ASPICE profile)

Under an ASPICE profile's
`software-requirement: display-id-pattern: "SRS_{scope}_{n:04d}"`:

```markdown
- [SRS_BRK_0107] Sensor input debouncing

  The sensor driver shall debounce raw inputs to eliminate electrical noise
  before processing. The debounce window shall be configurable per sensor type.

  > [!WARNING]
  > Failure to debounce may lead to spurious brake activation.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\
  Derived-from: 01HGW2R0NPQR4STVWXYZABCDEF\
  Labels: ASIL-B
```

The profile infers `type: software-requirement` from the `SRS_` prefix.

### Example — explicit `type:` override

When the display ID is a symbolic path with no declared prefix pattern:

```markdown
- [braking_core::controller::debounce_input] Debounce function

  Rejects transient noise on raw sensor readings.

  Id: 01HGW3D6QRST7IJKLMNOPQRSTUV\
  type: unit\
  Realizes: 01HGW2Q8MNP3RSTVWXYZABCDEF
```

The author writes `type: unit` because no `display-id-pattern` matches a
namespaced symbolic path.

The three examples illustrate the same identified entry shape viewed under
different profiles and authoring conditions. The core entry model is identical;
only the display-ID pattern, `type:` vocabulary (inferred or explicit), and
profile-declared attributes (`Derived-from:`, `Realizes:`) differ.

---

## Part 3 — Referenced Entries

A referenced entry is a bibliographic citation of an external artifact: a
standard, a regulation, a paper, a specification, a package (dependency), a
hardware part. It names a work that exists outside the project.

### Slug (display ID)

The display ID of a referenced entry is a **slug** — a stable project-local
handle suitable for inline citation, matching pandoc/BibTeX cite-key convention:

```text
^[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?$
```

The slug starts with a letter, contains alphanumerics, `.`, `/`, `-`, and `_`,
and ends with an alphanumeric character. Mixed case is accepted.

This format is a **disciplined subset** of the Pandoc citation key convention.
MarkSpec excludes the wider range of Pandoc-allowed characters (`:`, `#`, `$`,
etc.) to keep slugs readable and avoid collisions with other Markdown syntaxes.

**Style recommendation:**

- Technical standards: uppercase with hyphens (`ISO-26262-6`, `DO-178C`).
- Academic citations: lowercase with year suffix (`smith2021`).
- Standards with hierarchical organization: slash-separated (`ISO/IEC-25010`,
  `ISO/IEC/IEEE-29148`).
- Dependency packages: language/ecosystem convention (`serde`, `lodash`,
  `commons-lang3`).

**Pandoc `@` compatibility.** The leading `@` in a bracketed citation key is
accepted syntactic sugar and stripped at parse time. These declarations are
equivalent:

```markdown
- [@ISO-26262-6] ISO 26262 Part 6
- [ISO-26262-6] ISO 26262 Part 6
```

Inline prose citations `[@key]` resolve to the matching referenced entry.

### Identity

Every referenced entry carries `Id:` whose value is a **URI** (RFC 3986, scheme
required):

```text
Id: urn:iso:std:iso:26262:-6:ed-2
Id: doi:10.1109/IEEESTD.2008.4610935
Id: https://www.rfc-editor.org/rfc/rfc2119
Id: pkg:cargo/serde@1.0.0
Id: isbn:9780132350884
```

Unlike identified entries, the URI is **author-provided**, not
tooling-generated. It is the canonical identifier of the external work in its
most stable form.

Preferred forms, in descending order of stability:

- **URN** — `urn:iso:std:iso:26262:-6:ed-2`, `urn:ietf:rfc:2119`
- **DOI** — `doi:10.1109/IEEESTD.2008.4610935`
- **purl** (for packages) — `pkg:cargo/serde@1.0.0`
- **ISBN** — `isbn:9780132350884`
- **HTTPS URL** — when no authoritative identifier exists

All are valid URIs per RFC 3986.

### No ULID for referenced entries

Referenced entries do not carry ULIDs. The slug (display ID) is the
project-local stable identifier, and the `Id:` URI is the canonical external
identifier. Attempting to use a ULID as a referenced entry's `Id:` is a
validation error — format discrimination would classify the entry as identified
instead.

### Body is optional

Unlike identified entries, a referenced entry's body is optional. A minimal
referenced entry contains only a display ID, a title, and the `Id:` URI.

### Shape-specific universal attributes

Referenced entries carry the universal attributes from Part 1 (`Id`, `Labels`,
`External-id`, `Supersedes`, `Superseded-by`, `Deprecated`). `References:` is
**not applicable** to referenced entries — a referenced entry does not itself
cite other referenced entries via the `References:` attribute. (Profiles may
declare relation attributes that cross between referenced entries if needed, but
the universal `References:` attribute is for entries citing external works, not
for external works citing each other.)

### Navigation and document metadata

Two profile-declaring-friendly attributes are conventionally carried by
referenced entries:

- `Reference-url:` (optional) — HTTPS navigation link when different from the
  canonical `Id:` URI. A `urn:` or `doi:` value is authoritative but may not be
  directly clickable.
- `Reference-document:` (optional) — canonical document identifier used for
  display when the title is not enough (e.g., `ISO 26262-6:2018`).

These are not core-reserved; the default profile (ADR-010) declares them.

### Section locators in citations

When an entry cites a referenced entry via the `References:` attribute, the
value may include a free-text locator after the slug:

```text
References: ISO-26262-6 §9.4.5
References: IEC-61508-3 Table A.5
```

The tooling extracts the leading token as the reference slug; the trailing
locator is preserved verbatim for display and is not validated.

### Example — normative standard

```markdown
- [@ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety — Part 6: Software level. Defines
  requirements for software unit design, implementation, and verification across
  ASIL levels A through D.

  Id: urn:iso:std:iso:26262:-6:ed-2\
  Reference-url: https://www.iso.org/standard/68383.html\
  Reference-document: ISO 26262-6:2018\
  Labels: functional-safety, automotive
```

### Example — dependency (purl)

```markdown
- [serde] serde Rust serialization framework

  Id: pkg:cargo/serde@1.0.0\
  License: Apache-2.0 OR MIT
```

A dependency entry is a referenced entry whose `Id:` is a Package URL (purl).
Compliance profiles (medical device, automotive) can additionally attach SOUP /
risk / verification attributes to dependency entries; see ADR-011.

### Example — RFC

```markdown
- [RFC-2119] Key words for use in RFCs

  Id: doi:10.17487/RFC2119\
  Reference-url: https://www.rfc-editor.org/rfc/rfc2119
```

---

## Part 4 — Shape Discrimination

The shape of an entry is determined by the **value format** of its `Id:`
attribute. An entry has exactly one `Id:`.

### Discrimination rule

```text
if Id matches ULID regex (^[0-9A-HJKMNP-TV-Z]{26}$)  → identified
if Id is a scheme-qualified URI (RFC 3986)            → referenced
otherwise                                             → validation error
```

Properties:

- **Disjoint**: ULIDs and URIs do not overlap. A ULID has no scheme; a URI
  requires a scheme. No value matches both.
- **Complete**: every well-formed `Id:` value is either a ULID or a URI; the two
  exhaust the accepted formats.
- **Independent of display ID**: shape is decided by the `Id:` value, not by the
  display-ID format.
- **Independent of document context**: shape is intrinsic to the entry, not
  dependent on which document it appears in.
- **Independent of profile**: shape resolution completes without consulting any
  profile. Core-only mode (ADR-009 §10) operates on this rule alone.

### Classification rule for new entries

When an author writes a new entry without yet specifying `Id:`,
`markspec format` uses a heuristic to decide whether to mint a ULID or prompt
for a URI:

1. If the display ID matches the slug pattern and the enclosing document's
   `contains:` profile metadata lists only referenced types → prompt for a URI
   and assign `Id:` once provided.
2. Otherwise → mint a ULID and assign `Id:` (identified entry by default).

The heuristic is used only for **initial classification**. Once `Id:` is
assigned, the shape is fixed by the value's format.

### Post-assignment consistency

After `Id:` is assigned, the linter verifies:

- The `Id:` value is well-formed (ULID or URI).
- The display ID matches the shape's format (slug for referenced, free-form for
  identified unless constrained by profile).
- The entry satisfies its type's required attributes (if `type:` is declared and
  the profile makes them required).

---

## Part 5 — Document Type Directives

Document directives are **optional hints** used by `markspec format` to classify
new entries that do not yet have an `Id:` attribute, and by the linter to warn
about organizational conventions.

### Directives

Directives are HTML comments at the top of a Markdown file. The core does not
bake in a fixed directive set; profiles declare which directives map to which
entry types. Common conventions:

- `<!-- markspec:requirements -->` — suggests identified entries of type
  `requirement` (or similar normative type in the active profile).
- `<!-- markspec:tests -->` — suggests identified entries of type `test`.
- `<!-- markspec:references -->` — suggests referenced entries.
- `<!-- markspec:glossary -->` — suggests identified entries of type `term`.

### Filename conventions

Filenames may also act as directives when a profile declares them to do so. The
default profile (ADR-010) ships these conventions out of the box:

- `references.md` at any path → equivalent to `markspec:references`.
- `glossary.md` at any path → equivalent to `markspec:glossary`.
- Any other filename → no directive.

An explicit directive overrides the filename convention.

### Linter warnings

The linter may emit style warnings when entries of a shape or type appear in a
document whose directive suggests a different type. These are style warnings,
not errors — the shape of an entry is decided by its `Id:` value, not by the
document it lives in.

### Recommended style

Single-shape documents are the recommended style. Group references in dedicated
reference documents, group authored content by type where practical. A mixed
document (notes, requirements, references all side by side) is valid but harder
to navigate.

---

## Consequences

### Core stays minimal; profiles carry vocabulary

Collapsing the four-family model into two shapes simplifies the core
specification. The core defines:

- Entry syntactic form (shared between shapes).
- Two shapes (identified, referenced) discriminated by `Id:` value format.
- A single identity attribute (`Id:`) and a short universal attribute set.
- Retirement semantics, draft state, link-resolution severity.
- A value-type catalog shared with profiles.
- Properties (observed facts) as a separate namespace.

Everything else — type vocabularies (`requirement`, `test`, `unit`, `standard`,
`dependency`, …), relation names (`Derived-from`, `Verifies`, `Allocated-to`,
`Depends-on`, …), traceability rules, display-ID patterns, element kinds, test
levels — lives in profiles.

### Profiles describe the domain

A profile defines:

- Type vocabulary within each shape (`requirement`, `test`, `unit` as identified
  types; `standard`, `dependency` as referenced types).
- Per-type attributes and required fields.
- Display-ID patterns per type (template form, enforced per profile choice).
- Traceability rules (relation names, target shape/type constraints,
  cardinality, required flag).
- Extensions to the attribute value-type catalog.

The same MarkSpec core supports automotive, aerospace, medical, railway,
industrial, and pure tech-writing projects without modification, by swapping the
active profile chain.

### Discrimination is a one-step check

Shape resolution does not consult a profile, a document, or a display-ID prefix.
It inspects `Id:` and decides. This property is what makes core-only mode
(ADR-009 §10) workable and what keeps error diagnostics precise.

### No migration surface

MarkSpec has not shipped. The core entry model has no backward-compatibility
obligations to earlier drafts. Previous family-specific attributes (`Spec-id`,
`Test-id`, `Element-id`, `Reference-id`) and the pre-family `Id: <TYPE>_<ULID>`
format are not accepted by the parser; any such content in fixtures or examples
is rewritten by hand. No `markspec migrate` subcommand is introduced.

Display IDs are preserved unchanged. Type values are inferred from the
historical family or TYPE prefix and written to an explicit `type:` attribute
when a profile with a matching type is loaded.

### Pandoc compatibility preserved

The `@` prefix in bracketed citation keys is accepted as optional syntax. Inline
Pandoc citations `[@ID]` in prose are recognized as referenced-entry
cross-references.

---

## Annex A — Shape Discrimination Examples

| Entry                                                       | `Id:` value | Shape      |
| ----------------------------------------------------------- | ----------- | ---------- |
| `[SPEC-107]` with `Id: 01HGW2P4KFR7ABCDEFGHJKMNPQ`          | ULID        | identified |
| `[TEST-042]` with `Id: 01HGW3R9QNP4ABCDEFGHJKMNPQ`          | ULID        | identified |
| `[braking::debounce]` with `Id: 01HGW3D6QRST7JKMNPQRSTVWXY` | ULID        | identified |
| `[ISO-26262-6]` with `Id: urn:iso:std:iso:26262:-6:ed-2`    | URI (urn)   | referenced |
| `[@ISO-26262-6]` with `Id: urn:iso:std:iso:26262:-6:ed-2`   | URI (urn)   | referenced |
| `[serde]` with `Id: pkg:cargo/serde@1.0.0`                  | URI (purl)  | referenced |
| `[RFC-2119]` with `Id: doi:10.17487/RFC2119`                | URI (doi)   | referenced |

**Invalid entries:**

| Entry                                        | Issue                                 |
| -------------------------------------------- | ------------------------------------- |
| `[SPEC-107]` with no `Id:` attribute         | Missing identity                      |
| `[SPEC-107]` with `Id: SPEC-107`             | `Id:` value is neither ULID nor URI   |
| `[X]` with `Id: 01HGW2...` AND `Id: urn:...` | Multiple identity values              |
| `[X]` with `Id: foo/bar`                     | Slug-without-scheme in `Id:` rejected |

---

## Annex B — Format Regexes

**ULID** (identified-entry `Id:` value):

```text
^[0-9A-HJKMNP-TV-Z]{26}$
```

**URI** (referenced-entry `Id:` value): any valid URI per RFC 3986, must begin
with a scheme followed by `:`.

**Slug** (referenced-entry display ID, after stripping optional `@`):

```text
^[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?$
```

**Identified-entry display ID**: free-form non-empty string in the core; pattern
may be tightened by profile declaration (ADR-009 §5, ADR-008 §6).

---

## Annex C — Universal Attributes Recap

Complete catalog of attributes defined by the core. Origin legend: `assigned`
(tool-generated at creation), `authored` (written by the author), `inferred`
(pre-filled by tooling, author-overridable), `generated` (computed at build time
from inverse relations, never committed).

### Universal attributes (both shapes)

| Attribute       | Type          | Origin        | Required | Description                                   |
| --------------- | ------------- | ------------- | -------- | --------------------------------------------- |
| `Id`            | `id`          | see §Identity | yes      | Identity value: ULID or URI                   |
| `Labels`        | `tag-list`    | authored      | no       | Classification tags (includes `DRAFT` marker) |
| `References`    | `citation`    | authored      | no       | External reference citations with locator     |
| `External-id`   | `external-id` | authored      | no       | Cross-system identifier(s)                    |
| `Supersedes`    | `id`          | authored      | no       | Same-shape entry this one replaces            |
| `Superseded-by` | `id`          | generated     | —        | Inverse of `Supersedes`                       |
| `Deprecated`    | `string`      | authored      | no       | Retirement reason (non-replacement case)      |

Referenced entries do not carry `References:` (a referenced entry does not
itself cite other referenced entries; the replacement relation is expressed via
the universal `Supersedes` attribute).

### Profile-declared attributes

All other attributes — `type:`, `Derived-from:`, `Verifies:`, `Tests:`,
`Realizes:`, `Allocated-to:`, `Depends-on:`, `Element-kind:`, `Test-level:`,
ASIL / DAL / SIL classifications, etc. — are declared by profiles. See
[ADR-008 — Profile System](./adr-008-profile-system.md) and
[ADR-010 — Default Profile](./adr-010-default-profile.md).

---

## Open questions (deferred to later ADRs)

- **Profile document format** — how profiles are authored and distributed —
  specified in [ADR-008 — Profile System](./adr-008-profile-system.md).
- **Core / profile boundary** — the principle that places type vocabulary and
  compliance rules in the profile layer — specified in
  [ADR-009 — Core / Profile Boundary](./adr-009-core-profile-boundary.md).
- **Default profile** — the generic type vocabulary MarkSpec ships with —
  specified in [ADR-010 — Default Profile](./adr-010-default-profile.md).
- **Language pack and dependency ingestion** — extracting entries from source
  code and SBOM output — specified in
  [ADR-011 — Language Pack and Dependency Ingestion](./adr-011-language-pack-and-dependency-ingestion.md).
- **Property model** — git observation contracts, sync connectors, property
  namespace, caching, build-time and extraction provenance — deferred to
  [ADR-006 — Property Model](./adr-006-property-model.md).
- **In-code entries** — conventions for authoring entries in doc comments across
  languages — deferred to
  [ADR-011](./adr-011-language-pack-and-dependency-ingestion.md) follow-ups.
- **Inline references in prose** — Mustache `{{<type>.<slug>}}` /
  `{{<type>.<display-id>}}` syntax, alongside Pandoc `[@ID]` citation syntax.
