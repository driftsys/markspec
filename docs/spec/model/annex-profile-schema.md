# Annex B — Profile manifest schema

A profile is a versioned, distributable directory that extends the core type
taxonomy with domain-specific vocabulary, attributes, labels, and rules. Its
normative specification lives in this annex; the
[Profiles and extensions](profiles.md) chapter explains how to author, activate,
and publish profiles.

## B.1 Directory layout

```text
<profile-id>/
├── markspec.yaml        ← manifest + declarative content (required)
├── package.json         ← required only when publishing to npm (see §B.14)
└── README.md            ← recommended
```

`markspec.yaml` is authoritative — it is the only file the profile system reads.
When the profile is published to npm, `markspec.yaml` MUST sit at the package
root: the resolver runs `npm pack` and reads the manifest from the tarball root.

The `markspec.yaml` file has two regions: **manifest fields** (identity,
versioning, distribution) and the **`profile:` content subtree** (types,
attributes, labels, colors, conventions, prose, discipline declarations, and
document types).

## B.2 Top-level manifest fields

| Field             | Required | Type   | Notes                                                              |
| ----------------- | -------- | ------ | ------------------------------------------------------------------ |
| `id`              | Yes      | string | Scoped identifier: `@org/name` or `name`                           |
| `version`         | Yes      | string | Semantic version (`MAJOR.MINOR.PATCH`)                             |
| `description`     | No       | string | Human-readable summary; recommended for publishing                 |
| `license`         | No       | string | SPDX identifier (e.g. `MIT`, `Apache-2.0`); recommended            |
| `extends`         | No       | string | Parent-profile **specifier** (see §B.11) — local, git, or npm form |
| `markspec-schema` | No       | string | Core schema version pin (e.g. `"1"`); see §B.13                    |
| `profile`         | No       | map    | The declarative content subtree (§B.3 onward)                      |

Any unrecognised top-level key is a `PROFILE-LOAD-003` error.

Complete example:

```yaml
id: "@myorg/safety"
version: 1.2.0
description: "ISO 26262 safety vocabulary"
license: MIT
extends: "npm:@markspec/profile-default@^1"
markspec-schema: "1"

profile:
  attributes: []
  labels: []
  types: {}
  documents:
    types: []
    frontMatter: []
```

> **`extends:` is a specifier, not a bare profile id.** It must be one of the
> three specifier forms in §B.11 (`./path`, `git+…#tag`, or `npm:…@range`). A
> bare `@org/name` without a scheme is rejected. When `extends:` is omitted the
> bundled default profile is spliced in as the implicit chain root (unless the
> consuming project sets `default-profile: false`).

The `profile:` block accepts these keys; any other is a `PROFILE-LOAD-003`
error:

| Block             | Section | Purpose                                          |
| ----------------- | ------- | ------------------------------------------------ |
| `attributes`      | §B.4    | Universal attributes (apply to every type)       |
| `types`           | §B.3    | Profile-declared entry types                     |
| `labels`          | §B.6    | Label concerns (flag / enum / set)               |
| `colors`          | §B.7    | Semantic-name → palette-hue map                  |
| `conventions`     | §B.8    | Tunable engine conventions (e.g. modal-keywords) |
| `prose`           | §B.9    | Prose-analysis lexicons                          |
| `kinds`           | §B.10   | Discipline kinds                                 |
| `discipline-mode` | §B.10   | `flat` / `tiered` / `none`                       |
| `documents`       | §B.12   | Document types + front-matter attributes         |
| `delivers`        | §B.15   | Delivered documents (corpus + docs-only files)   |

## B.3 Types (`profile.types`)

Each entry under `profile.types` declares one profile type. The key is the type
name (lowercase-with-hyphens by convention):

```yaml
profile:
  types:
    software-requirement:
      extends: Requirement
      display-id-pattern: "SRS_{n:4d}"
      description: "Software-level normative statement"
      discipline: software
    hazard:
      extends: Risk
      display-id-pattern: "HAZ_{n:3d}"
      display-id-pattern-enforcement: error
      required: [Mitigated-by]
      color: hazard-red
      traceability:
        Mitigated-by:
          target: [software-requirement]
          cardinality: "1..N"
          required: true
```

### Type fields

| Field                            | Required | Notes                                                             |
| -------------------------------- | -------- | ----------------------------------------------------------------- |
| `extends`                        | Yes      | A **core type name** (PascalCase, §B.3.1)                         |
| `display-id-pattern`             | No       | Pattern string; `{n:Nd}` is the numeric placeholder (§B.3.2)      |
| `display-id-pattern-enforcement` | No       | `off` (default), `warn`, or `error`                               |
| `description`                    | No       | Human-readable purpose shown by `markspec profile describe`       |
| `required`                       | No       | List of attribute/relation keys that MUST be present on this type |
| `attributes`                     | No       | Per-type attribute declarations (same shape as §B.4)              |
| `traceability`                   | No       | Per-type relation rules, keyed by link name (§B.5)                |
| `color`                          | No       | Semantic color name declared in `profile.colors` (§B.7)           |
| `discipline`                     | No       | Non-empty string naming a kind in core ∪ chain kinds (§B.10)      |

Any unrecognised type key is a `PROFILE-TYPE-005` error.

### Rules

- **`extends:` is required.** Every profile type names a core-type parent.
  Omitting it is `PROFILE-TYPE-001`.
- **The parent must be a core type.** `extends:` must resolve to one of the core
  type names in §B.3.1; an unrecognised value is `PROFILE-TYPE-002`.
- **No shadowing.** A profile type name must not duplicate a core type name
  (`MSL-A040`).
- **Convention.** Profile type names use lowercase-with-hyphens; core names use
  PascalCase. This keeps a name's origin unambiguous.

### B.3.1 Core type names

There are **16 core type names** — 4 abstract roots plus 12 concrete subtypes.
Fifteen are instantiable (every name except the purely abstract `Item`).
`extends:` on a profile type must name one of these:

| Group                    | Names                                               |
| ------------------------ | --------------------------------------------------- |
| Abstract roots (4)       | `Item`, `Specification`, `Component`, `Unit`        |
| `Specification` subtypes | `Requirement`, `Test`, `Contract`, `Record`, `Risk` |
| `Contract` subtypes      | `SoftwareInterface`, `HardwareInterface`            |
| `Component` subtypes     | `SoftwareComponent`, `HardwareComponent`            |
| `Unit` subtypes          | `SoftwareUnit`, `HardwareUnit`                      |
| `Item` subtype           | `Definition`                                        |

`Specification`, `Component`, and `Unit` are abstract roots that are also
directly instantiable (usable as fallbacks when no concrete subtype fits);
`Item` is the only non-instantiable name.

### B.3.2 `display-id-pattern` syntax

| Placeholder | Meaning                                   | Example pattern   | Example output   |
| ----------- | ----------------------------------------- | ----------------- | ---------------- |
| `{n:4d}`    | Auto-increment, minimum 4 digits, padded  | `SRS_{n:4d}`      | `SRS_0042`       |
| `{n:3d}`    | Auto-increment, minimum 3 digits, padded  | `HAZ_{n:3d}`      | `HAZ_003`        |
| `{n:04d}`   | Leading-zero form, equivalent to `{n:4d}` | `STK_AEB_{n:04d}` | `STK_AEB_0007`   |
| `{name}`    | Named segment (no counter) — see below    | `SWC_{name}`      | `SWC_LIGHT_CTRL` |

The text before the placeholder is the literal prefix; the text after is the
literal suffix (e.g. `REQ-{n:3d}-draft` → `REQ-012-draft`). Width is a minimum,
not a maximum — numbers wider than the pad are left intact. `markspec fmt`
assigns the next available number; `markspec next-id <type>` prints it without
writing; `markspec create` / `insert` scaffold a full block.

**Numbered vs named patterns (ADR-025).** A pattern is _numbered_ when it
carries exactly one `{n}` counter (the mintable, auto-incremented forms above)
or _named_ when it carries no counter. A named pattern classifies types whose
IDs are named, not numbered — components such as `SWC_LIGHT_CTRL` or `HWC_PIU`.
It requires a non-empty literal prefix plus a trailing named placeholder (e.g.
`SWC_{name}`); the named placeholder captures the rest of the display ID,
underscores included. A bare `{name}` with no literal prefix is rejected — it
would match every ID. Named patterns are classification-only: there is no
counter to mint, so pair them with `display-id-pattern-enforcement: off` and
author the identifier by hand. `markspec next-id` / `create` / `insert` do not
auto-number a named type — they emit an upper-case placeholder template (e.g.
`SWC_NAME`, slug-valid so the scaffold still passes `markspec check`) to fill
in, and the LSP offers a matching `${1:NAME}` scaffold completion.

A malformed pattern — more than one counter, an invalid or zero-width padding
specifier, a counter-less pattern with no literal prefix, or a duplicate named
placeholder — is a `PROFILE-TYPE-008` error reported when the profile loads, not
an uncaught failure during validation.

`display-id-pattern-enforcement` controls whether an entry whose display ID does
not match the pattern is ignored (`off`), warned (`warn`), or rejected
(`error`).

## B.4 Attributes (`profile.attributes` and per-type `attributes`)

`profile.attributes` declares **universal** attributes (valid on every type);
the identical shape under a type's `attributes:` field declares **type-scoped**
attributes.

```yaml
profile:
  attributes:
    - name: ASIL
      type: enum
      values: [QM, ASIL-A, ASIL-B, ASIL-C, ASIL-D]
      required: false
      description: "Automotive Safety Integrity Level"
    - name: Mitigated-by
      type: id-list
      cardinality: "1..N"
      inverse:
        name: Mitigates
        category: relation
```

### Attribute fields

| Field         | Required | Notes                                                                        |
| ------------- | -------- | ---------------------------------------------------------------------------- |
| `name`        | Yes      | Trailer key name (e.g. `ASIL`, `Mitigated-by`)                               |
| `type`        | Yes      | A value type from the table below                                            |
| `required`    | No       | Boolean; `true` makes the attribute mandatory (default `false`)              |
| `cardinality` | No       | `"lower..upper"`, e.g. `"0..1"`, `"1..1"`, `"1..N"`. Defaults per value type |
| `values`      | enum     | Required for `type: enum`; the closed value list (see grouping note)         |
| `inverse`     | No       | Only for `id` / `id-list`: `{name, category}` — the generated reverse edge   |
| `description` | No       | Human-readable purpose                                                       |

Any unrecognised attribute key is a `PROFILE-LOAD-003` error.

### Value types (`type:`)

`id`, `id-list`, `uri`, `url`, `path`, `path-or-id`, `enum`, `tag-list`, `text`,
`citation`, `external-id`, `integer`, `date`, `boolean`.

Default cardinality is `0..N` for the list types (`id-list`, `tag-list`) and
`0..1` for every other type. A `cardinality:` string overrides the default; its
upper bound must be `N` (unbounded) or an integer ≥ the lower bound.

### `enum` value grouping

An `enum`'s `values:` list may be bare strings, `{name, description?}` mappings,
or `{group, description?, values: [...]}` group objects (recursed). Group labels
and descriptions are documentation-only — validation matches against the leaf
value names.

## B.5 Relations (per-type `traceability` + attribute `inverse`)

> There is **no** top-level `profile.relations` block. Relations are expressed
> two ways: per-type **traceability rules**, and per-attribute **inverses**.

### Per-type `traceability`

A type's `traceability:` field maps a trace-link key (e.g. `Satisfies`,
`Mitigated-by`) to a rule constraining its targets:

```yaml
profile:
  types:
    software-requirement:
      extends: Requirement
      traceability:
        Satisfies:
          target: [system-requirement]
          cardinality: "1..N"
          required: true
          description: "Each SRS satisfies at least one system requirement"
```

### Trace-rule fields

| Field         | Required | Notes                                                                                |
| ------------- | -------- | ------------------------------------------------------------------------------------ |
| `target`      | Yes      | Non-empty list of matchers: a type-name string, or `{shape: identified\|referenced}` |
| `cardinality` | No       | `"lower..upper"`; defaults to `0..N`                                                 |
| `required`    | No       | Boolean (default `false`)                                                            |
| `description` | No       | Human-readable purpose                                                               |

Any unrecognised trace-rule key is a `PROFILE-LOAD-003` error.
`markspec profile
show` and `markspec profile describe relation <key>` surface
the resolved relations.

### Attribute `inverse`

An `id` / `id-list` attribute may declare an `inverse:` (`{name, category}`).
MarkSpec materialises the reverse edge in compiled output, so a forward
`Mitigated-by` produces an inverse `Mitigates` on the target. `inverse` on a
non-id attribute is a `PROFILE-LOAD-003` error.

## B.6 Labels (`profile.labels`)

`profile.labels` may take two forms.

**Form A — a list of names** (each becomes a `flag` concern):

```yaml
profile:
  labels:
    - DRAFT
    - RELEASED
```

**Form B — a mapping** keyed by concern name, for `enum` / `set` concerns or to
attach descriptions:

```yaml
profile:
  labels:
    DRAFT: "Work in progress; not reviewed"   # string shorthand → flag
    asil:
      kind: enum
      description: "Automotive Safety Integrity Level"
      values:
        QM: "Quality-managed"
        ASIL-A: null
        ASIL-B: { description: "Integrity level B" }
```

### Label-concern fields (Form B)

| Field         | Required | Notes                                                                           |
| ------------- | -------- | ------------------------------------------------------------------------------- |
| `kind`        | No       | `flag` (default), `enum`, or `set`                                              |
| `description` | No       | Human-readable meaning                                                          |
| `values`      | No       | Mapping of value name → null \| string \| `{description}`. Not valid for `flag` |

List entries in Form A may also be grouped objects (`{group, values: [...]}`);
groups are flattened to their leaf names.

## B.7 Colors (`profile.colors`)

`profile.colors` maps a semantic color name to a palette hue. Type declarations
reference a semantic name via their `color:` field (§B.3).

```yaml
profile:
  colors:
    requirement-blue: blue
    hazard-red: red
```

- Each key must match `^[a-z][a-z0-9-]*$` (`MSL-PROFILE-COLOR-004` otherwise).
- Each value must be a palette hue name; an unknown hue is
  `MSL-PROFILE-COLOR-002`.

## B.8 Conventions (`profile.conventions`)

`profile.conventions` tunes engine conventions. Each key is a convention name
mapping to a settings object (plus an optional `description`).

```yaml
profile:
  conventions:
    modal-keywords:
      casing: rfc2119   # rfc2119 | iso | preserve
      description: "Require lowercase shall/should/may"
```

The only recognised convention is `modal-keywords`; unknown convention names are
accepted with a `PROFILE-LOAD-003` warning (forward compatibility). For
`modal-keywords`, the `casing` setting must be `rfc2119`, `iso`, or `preserve`.

## B.9 Prose lexicons (`profile.prose`)

`profile.prose.lexicons` supplies project vocabulary to the prose-analysis
rules:

```yaml
profile:
  prose:
    lexicons:
      capitalized-allow: [API, ECU, LiDAR]       # allowed mid-sentence capitals
      sentence-abbrev: ["e.g.", "i.e.", "etc."]  # non-terminal abbreviations
```

Both lists default to empty when absent.

## B.10 Discipline kinds and mode

### `profile.kinds` (map)

The optional `profile.kinds` map declares engineering disciplines that types may
be assigned to via their `discipline:` field. See
[ADR-017 — Discipline Classification](../../architecture/adr-017-discipline-classification.md).

| Property | Required | Type                       | Notes                                                           |
| -------- | -------- | -------------------------- | --------------------------------------------------------------- |
| (key)    | —        | `^[a-z][a-z0-9-]*$`        | Kind name; must not be `mixed`                                  |
| (value)  | —        | null \| string \| KindDecl | `null` (declare only), string (description), or `{description}` |

When absent, only core-declared kinds are available.

**Diagnostics:**

| Code                     | Severity | Trigger                                                                     |
| ------------------------ | -------- | --------------------------------------------------------------------------- |
| `PROFILE-DISCIPLINE-001` | error    | Kind name does not match `^[a-z][a-z0-9-]*$`                                |
| `PROFILE-DISCIPLINE-002` | error    | Kind name is the reserved word `mixed`                                      |
| `PROFILE-DISCIPLINE-003` | warning  | Kind name duplicates a core-declared kind (idempotent; declaration ignored) |

### Per-type `discipline:`

A type may carry `discipline:` to assign it to a named kind (§B.3). The value
must be a non-empty string (`PROFILE-DISCIPLINE-005`) naming a kind in the union
of core kinds and chain-declared kinds (`PROFILE-DISCIPLINE-004`). When omitted,
the discipline is inherited by walking the `extends:` chain upward.

### `profile.discipline-mode`

A profile may declare `discipline-mode:` to make its tiering intent explicit:

```yaml
profile:
  discipline-mode: tiered   # flat | tiered | none
```

When omitted, the mode is inferred from the type graph: `tiered` when any
requirement-shaped type carries `discipline:`, `flat` when discipline-bearing
types exist without per-type assignment, otherwise `none`.

**Diagnostics:**

| Code                     | Severity | Trigger                                                       |
| ------------------------ | -------- | ------------------------------------------------------------- |
| `PROFILE-DISCIPLINE-006` | error    | Value is not one of `flat`, `tiered`, `none` (case-sensitive) |
| `PROFILE-DISCIPLINE-007` | error    | Value is not a scalar string                                  |

## B.11 Distribution and specifiers

A profile is referenced — in a project's `.markspec.yaml` `profiles:` list and
in a manifest's `extends:` field — using one of three specifier schemes:

| Specifier form                                      | Resolves to                                           |
| --------------------------------------------------- | ----------------------------------------------------- |
| `./path/to/profile`                                 | Local directory relative to the declaring file        |
| `git+<https\|file>://host/repo.git[/subpath]#<tag>` | Git source; shallow + sparse clone, cached globally   |
| `npm:[@scope/]name@<version-range>`                 | npm package; resolved via `npm pack`, cached globally |

Git auth is inherited from the user's git configuration; npm resolution uses the
registry configured in `.npmrc`. The `jsr:` and raw `https:` schemes are
reserved for a future release.

`markspec profile add <spec>` validates the specifier and records it in
`.markspec.yaml`. It does **not** copy the profile into the repository — git and
npm sources are fetched and cached on demand when a profile-aware command runs.

## B.12 Documents (`profile.documents`)

`profile.documents` declares document types and front-matter attributes (per
[ADR-007](../../architecture/adr-007-document-structure.md)):

```yaml
profile:
  documents:
    types:
      - id: srs-document
        contains: [software-requirement]
        description: "Software requirements specification"
    frontMatter:
      - name: classification
        type: enum
        values: [public, internal, confidential]
```

`documents.types[].id` is required; `contains` is a list of type names;
`frontMatter` uses the attribute shape from §B.4.

## B.13 Versioning and compatibility

### Core schema pin (`markspec-schema`)

`markspec-schema: "1"` pins the profile against version 1 of the core schema
contract. A profile whose pin exceeds the running binary's `CORE_SCHEMA_VERSION`
is rejected (`PROFILE-SCHEMA-001`). When the pin is absent the profile loads
with a `PROFILE-SCHEMA-002` warning recommending you add it.

```yaml
markspec-schema: "1"   # integer string; "1" is the current value
```

### Profile `version` and semver rules

| Change kind                           | Version bump |
| ------------------------------------- | ------------ |
| Add new optional attribute / label    | minor        |
| Add new type                          | minor        |
| Add new relation with `inverse`       | minor        |
| Make an attribute `required: true`    | major        |
| Remove a type, attribute, or relation | major        |
| Rename a key                          | major        |
| Tighten `cardinality`                 | major        |

### Composition

A project's `.markspec.yaml` accepts **at most one content-bearing profile**;
declaring more than one is a `PROFILE-LOAD-006` error and no chain loads.
Compose standards by publishing a pre-merged profile, or by chaining via a
manifest's single-parent `extends:` field. When `profiles:` is empty the bundled
default profile loads automatically unless the project sets
`default-profile: false`.

## B.14 Validation and publishing

Validate a profile manifest before distributing it:

```bash
markspec profile publish --dir ./my-profile
```

`profile publish` parses the manifest and reports:

- YAML / schema errors (`PROFILE-LOAD-002`, `PROFILE-LOAD-003`, the
  `PROFILE-TYPE-*` and `PROFILE-DISCIPLINE-*` families, …)
- `markspec-schema` mismatch (`PROFILE-SCHEMA-001`) or absence
  (`PROFILE-SCHEMA-002`)
- Missing `description` (`PROFILE-PUB-001`) and `license` (`PROFILE-PUB-002`) as
  warnings

It exits non-zero on any error. **`profile publish` validates only — it does not
upload to a registry.** Distribute the validated directory with git (commit +
tag) or npm (`npm publish` with `markspec.yaml` at the package root and a
`package.json` whose `files` includes it). See
[Authoring and publishing a profile](../../guide/profiles.md#authoring-and-publishing-a-profile)
in the guide for the end-to-end workflow.

## B.15 Delivered documents (`profile.delivers`)

`profile.delivers` lists document files the profile ships to consuming projects
(per [ADR-030](../../architecture/adr-030-profile-delivered-documents.md)). Each
file is flagged per file: a **corpus** file's entries join the consumer's
traceability graph (marked with `Entry.origin` provenance); a
**documentation-only** file is surfaced for reading, never parsed:

```yaml
profile:
  delivers:
    - path: reference/platform-architecture.md
      corpus: true
      description: "Shared platform components and interfaces"
    - path: reference/integration-guide.md
      # corpus defaults to false → documentation-only
```

### Delivers-item fields

| Field         | Required | Type    | Notes                                                            |
| ------------- | -------- | ------- | ---------------------------------------------------------------- |
| `path`        | Yes      | string  | Relative to the profile directory; no `..`, no absolute paths    |
| `corpus`      | No       | boolean | Default `false`; `true` → entries join the graph (Markdown only) |
| `description` | No       | string  | Shown by `profile show` and as the MCP resource description      |

Any unrecognised item key, a non-list `delivers:`, a non-mapping item, or a
missing/empty `path` is a `PROFILE-LOAD-003` error.

### Rules

- **The path must stay inside the profile directory.** An absolute path (POSIX
  or drive-letter) or any `..` segment is `PROFILE-DELIVERS-003`.
- **Only Markdown is corpus-eligible.** `corpus: true` on a non-`.md` path is
  `PROFILE-DELIVERS-004`. Docs-only files may be any readable file.
- **No duplicate paths.** The same `path` twice in one manifest is
  `PROFILE-LOAD-003`.
- **Merge across the chain is additive.** The effective list is the union of
  every tier's declarations, keyed by `(profile-id, path)`, parent-tier first. A
  child cannot remove or override a parent's delivered file; two tiers
  delivering the same relative path do not collide.

### Load-time diagnostics

Existence is checked when the delivered corpus loads (every graph-consuming
command, the LSP, and the MCP server):

| Code                   | Severity | Meaning                                       |
| ---------------------- | -------- | --------------------------------------------- |
| `PROFILE-DELIVERS-001` | error    | Corpus file declared but missing from package |
| `PROFILE-DELIVERS-002` | warning  | Docs-only file declared but missing           |
| `PROFILE-DELIVERS-003` | error    | `path` escapes the profile directory          |
| `PROFILE-DELIVERS-004` | error    | `corpus: true` on a non-Markdown file         |

A project entry re-declaring a display ID or `Id:` owned by a delivered corpus
entry fails validation with `MSL-R014` (language spec §8.2) — the fix is to
rename the project entry; delivered corpus entries are read-only.
