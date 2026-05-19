# Annex B — Profile manifest schema

A profile is a versioned, distributable directory that extends the core type
taxonomy with domain-specific vocabulary. Its normative specification lives in
this annex; the [Profiles and extensions](profiles.md) chapter explains how to
author and activate profiles.

## B.1 Directory layout

```text
<profile-id>/
├── markspec.yaml        ← manifest + declarative content (required)
└── README.md            ← recommended
```

The `markspec.yaml` file has two regions: **manifest fields** (identity,
versioning, distribution) and the **`profile:` content subtree** (types,
attributes, relations, labels).

## B.2 Top-level manifest fields

| Field             | Required | Type   | Notes                                                   |
| ----------------- | -------- | ------ | ------------------------------------------------------- |
| `id`              | Yes      | string | Scoped identifier: `@org/name` or `name`                |
| `version`         | Yes      | string | Semantic version (`MAJOR.MINOR.PATCH`)                  |
| `description`     | No       | string | Human-readable summary; recommended for publishing      |
| `license`         | No       | string | SPDX identifier (e.g. `MIT`, `Apache-2.0`); recommended |
| `extends`         | No       | string | Parent profile specifier — local path or scoped ID      |
| `markspec-schema` | No       | string | Core schema version pin (e.g. `"1"`); see §B.7          |

Complete example:

```yaml
id: "@myorg/safety"
version: 1.2.0
description: "ISO 26262 safety vocabulary"
license: MIT
extends: "@markspec/default"
markspec-schema: "1"

profile:
  types: { ... }
  attributes: []
  relations: []
  labels: []
```

## B.3 Types (`profile.types`)

Each entry under `profile.types` declares one concrete profile type:

```yaml
profile:
  types:
    software-requirement:
      extends: Requirement
      display-id-pattern: "SRS_{n:4d}"
      description: "Software-level normative statement"
    hazard:
      extends: Risk
      display-id-pattern: "HAZ_{n:4d}"
    safety-requirement:
      extends: software-requirement   # profile-declared parent
      display-id-pattern: "SAF_{n:4d}"
```

### Type fields

| Field                | Required | Notes                                                                    |
| -------------------- | -------- | ------------------------------------------------------------------------ |
| `extends`            | Yes      | Core type name (PascalCase) or another profile type in the same chain    |
| `display-id-pattern` | No       | Pattern string; `{n:Nd}` is the numeric placeholder (N = minimum digits) |
| `description`        | No       | Human-readable purpose shown by `markspec profile describe`              |

### Rules

- **`extends:` is required.** Every profile type must name a parent. Omitting it
  is a profile-load error (`PROFILE-TYPE-001`).
- **Target must resolve.** The parent must be one of the 19 core type names (4
  abstract + 15 concrete) or another profile type in the same effective profile.
  An unresolved target is `PROFILE-TYPE-002`.
- **No cycles.** The inheritance graph must be acyclic and must root at a core
  type (`PROFILE-TYPE-003`).
- **No shadowing.** Profile type names must not duplicate any of the 19 core
  type names (`MSL-A040` / `PROFILE-TYPE-004`).
- **Convention.** Profile type names use lowercase-with-hyphens; core names use
  PascalCase. This makes origin unambiguous.

### display-id-pattern syntax

| Placeholder | Meaning                                  | Example pattern | Example output |
| ----------- | ---------------------------------------- | --------------- | -------------- |
| `{n:4d}`    | Auto-increment, minimum 4 digits, padded | `SRS_{n:4d}`    | `SRS_0042`     |
| `{n:3d}`    | Auto-increment, minimum 3 digits, padded | `HAZ_{n:3d}`    | `HAZ_003`      |
| `{scope}`   | Project-scope tag (reserved, future)     | —               | —              |

`markspec format` assigns the next available number. `markspec next-id <type>`
prints it without writing.

## B.4 Attributes (`profile.attributes`)

```yaml
profile:
  attributes:
    - key: ASIL
      applies-to: [software-requirement, hazard, test]
      cardinality: single
      values: [QM, ASIL-A, ASIL-B, ASIL-C, ASIL-D]
      description: "Automotive Safety Integrity Level"
    - key: Test-level
      applies-to: [test]
      cardinality: single
      values: [unit, integration, system, acceptance]
    - key: Priority
      applies-to: []       # empty = applies to all profile types
      cardinality: single
      values: [low, medium, high, critical]
```

### Attribute fields

| Field         | Required | Notes                                                                  |
| ------------- | -------- | ---------------------------------------------------------------------- |
| `key`         | Yes      | Trailer key name; PascalCase or Hyphen-case; must not shadow core keys |
| `applies-to`  | Yes      | List of profile type names; empty list means all profile types         |
| `cardinality` | No       | `single` (default) or `multi`; `multi` allows repeated `Key:` lines    |
| `values`      | No       | Closed enumeration; open if omitted                                    |
| `description` | No       | Human-readable purpose                                                 |
| `required`    | No       | Boolean; `true` makes the attribute mandatory for the listed types     |

### Constraints

- Attribute keys must not conflict with the core universal set (`Id`, `Type`,
  `Labels`, `References`, `External-id`, `Supersedes`, `Superseded-by`,
  `Deprecated`). Shadowing a core key is `MSL-A040`.
- `cardinality: multi` allows repeating the attribute on separate trailer lines
  or as CSV on a single line. `markspec format` normalises CSV to one-per-line.

## B.5 Relations (`profile.relations`)

```yaml
profile:
  relations:
    - key: Mitigated-by
      inverse: Mitigates
      source-types: [hazard]
      target-types: [software-requirement]
      cardinality: many-to-many
      description: "Links a hazard to requirements that address it"
    - key: Addresses
      inverse: Addressed-by
      source-types: [software-requirement]
      target-types: [change]
      cardinality: many-to-one
```

### Relation fields

| Field          | Required | Notes                                                                     |
| -------------- | -------- | ------------------------------------------------------------------------- |
| `key`          | Yes      | Trailer attribute name used by authors (`Mitigated-by: HAZ_001`)          |
| `inverse`      | No       | Name of the generated reverse edge; MarkSpec writes it in compiled output |
| `source-types` | No       | Profile types that may carry this relation; empty = any                   |
| `target-types` | No       | Profile types that may be targeted; empty = any                           |
| `cardinality`  | No       | `many-to-many` (default), `many-to-one`, `one-to-many`, `one-to-one`      |
| `description`  | No       | Human-readable purpose                                                    |

Relations declared in a profile are validated by `markspec validate`. A relation
attribute on an entry not in `source-types` is `MSL-R085`. A target not in
`target-types` is `MSL-R086`.

## B.6 Labels (`profile.labels`)

```yaml
profile:
  labels:
    - name: DRAFT
      description: "Work in progress; not reviewed"
    - name: RELEASED
      description: "Approved and baselined"
    - name: ASIL-B
      description: "Automotive Safety Integrity Level B"
      applies-to: [software-requirement, hazard]
```

| Field         | Required | Notes                                          |
| ------------- | -------- | ---------------------------------------------- |
| `name`        | Yes      | Label value as it appears in `Labels:` trailer |
| `description` | No       | Human-readable meaning                         |
| `applies-to`  | No       | Restrict to listed profile types; empty = any  |

Labels not declared in the active profile produce `MSL-L010` (unknown label
concern).

## B.7 Versioning and compatibility

### Core schema pin (`markspec-schema`)

`markspec-schema: "1"` pins the profile against version 1 of the core schema
contract. The toolchain rejects a profile whose `markspec-schema` value is
higher than the running binary's `CORE_SCHEMA_VERSION`.

```yaml
markspec-schema: "1"   # integer string; "1" is the current value
```

### Profile `version` and semver rules

| Change kind                              | Version bump |
| ---------------------------------------- | ------------ |
| Add new optional attribute / label       | minor        |
| Add new type (new `extends:` entry)      | minor        |
| Add new relation with `inverse`          | minor        |
| Make attribute `required: true`          | major        |
| Remove a type, attribute, or relation    | major        |
| Rename a key                             | major        |
| Change `cardinality` to more restrictive | major        |

### Compatibility window

A consumer project pins profile versions in `.markspec.yaml`. The toolchain
supports the declared version only — no implicit upgrade, no downgrade. Run
`markspec profile add <spec>@<version>` to pin explicitly.

## B.8 Distribution and specifiers

Profiles are referenced in `.markspec.yaml` using a specifier string:

| Specifier form       | Resolves to                                           |
| -------------------- | ----------------------------------------------------- |
| `@org/name`          | Latest vendored copy in `profiles/@org/name/`         |
| `@org/name@1.2.0`    | Specific version; pinned in `.markspec.yaml`          |
| `./path/to/profile`  | Local directory relative to project root              |
| `npm:@org/name@^1.0` | npm registry (resolved and vendored on `profile add`) |

Vendoring: `markspec profile add <spec>` downloads the profile and writes it
into `profiles/` under the project root. Vendored profiles are committed to
version control — the project owns a reproducible copy.

## B.9 Extends chain and conflict resolution

When multiple profiles are active (the `.markspec.yaml` `profiles:` list), they
are merged into a single **effective profile**. Resolution order: later entries
in the list take precedence over earlier ones.

```yaml
# .markspec.yaml
profiles:
  - "@markspec/default"          # lowest precedence
  - "@markspec/compliance-iso26262"
  - "./profiles/myorg"           # highest precedence
```

Within a single profile's `extends:` inheritance chain, child declarations
override parent declarations for the same key.

Conflict rules:

| Element    | Conflict resolution                                      |
| ---------- | -------------------------------------------------------- |
| Types      | Child type overrides parent type of same name            |
| Attributes | Child attribute overrides parent attribute of same `key` |
| Relations  | Child relation overrides parent relation of same `key`   |
| Labels     | Union; duplicate `name` keeps child `description`        |

## B.10 Validation and publishing

Validate a profile manifest before distributing it:

```bash
markspec profile publish --dir ./my-profile
```

This checks:

- All required fields present (`id`, `version`)
- All `extends:` targets resolve
- No shadowing of core type names (`MSL-A040`)
- No shadowing of core attribute keys
- `markspec-schema` is present and ≤ current `CORE_SCHEMA_VERSION`
- `description` and `license` present (warnings if absent)

A zero-error exit indicates the profile is safe to distribute.
