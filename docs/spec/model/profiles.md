# Profiles and extensions

A **profile** is a `markspec.yaml` manifest that extends the core type taxonomy
with domain-specific vocabulary. Profiles are composable and chainable — a
project selects a list of profiles that are merged into an **effective profile**
that governs validation and tooling.

## What a profile declares

| Element            | Purpose                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------- |
| **Subtypes**       | Domain-specific entry types with display-ID patterns (`requirement extends Requirement`) |
| **Attributes**     | Extra trailer keys beyond the core universal set (`ASIL`, `Priority`, `License`)         |
| **Relations**      | Trace edges with cardinality and inverse rules (`Mitigated-by`, `Addresses`)             |
| **Label concerns** | Structured label vocabulary (`DRAFT`, `RELEASED`, `ASIL-B`)                              |
| **Conventions**    | Document-level formatting rules (caption position, prose wrap)                           |

## Profile manifest structure

A profile manifest is a `markspec.yaml` file in a profile directory:

```yaml
id: "@markspec/compliance-iso26262"
version: 1.0.0
description: "ISO 26262 compliance vocabulary"
extends: "@markspec/default"

profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "SRS_{n:4d}"
    hazard:
      extends: Risk
      display-id-pattern: "HAZ_{n:4d}"

  attributes:
    - key: ASIL
      applies-to: [requirement, hazard, test]
      cardinality: single
      values: [ASIL-A, ASIL-B, ASIL-C, ASIL-D, QM]

  relations:
    - key: Mitigated-by
      inverse: Mitigates
      source-types: [hazard]
      target-types: [requirement]

  labels:
    - name: functional-safety
    - name: DRAFT
    - name: RELEASED
```

Top-level manifest fields:

| Field         | Required | Notes                                               |
| ------------- | -------- | --------------------------------------------------- |
| `id`          | Yes      | Scoped identifier, e.g. `@org/name` or `name`       |
| `version`     | Yes      | Semantic version string                             |
| `description` | No       | Human-readable summary (recommended for publishing) |
| `extends`     | No       | Parent profile specifier (local path or scoped ID)  |
| `license`     | No       | SPDX identifier (recommended for publishing)        |

## The extends chain

Profiles form an inheritance chain; each tier inherits all declarations from its
parent and can add or override them (closest tier wins on conflicts):

```text
@markspec/default
       ↓  extends
@markspec/compliance-iso26262
       ↓  extends
@myorg/safety-profile
       ↓  extends (project selects in .markspec.yaml)
project vocabulary
```

The **effective profile** is the merged result of all active tiers. The
project's `.markspec.yaml` activates profiles:

```yaml
# .markspec.yaml  (at project root)
profiles:
  - "@markspec/default"
  - "@markspec/compliance-iso26262"
  - "./profiles/myorg"
```

Profiles are resolved in order; later entries in the list take precedence over
earlier ones for conflicting declarations.

## Effective profile

Run `markspec profile show` to inspect the active chain and its effective
vocabulary:

```text
Active profile: @markspec/compliance-iso26262@1.0.0

Entry types (2):
  - requirement: Stakeholder, system, or software requirement (SRS_{n:4d})
  - hazard: Hazard or FMEA entry (HAZ_{n:4d})

Attributes (1):
  - ASIL: ASIL classification (ASIL-A | ASIL-B | ASIL-C | ASIL-D | QM)

Relations (1):
  - Mitigated-by: inverse Mitigates; hazard → requirement
```

Use `markspec profile describe type requirement` for full detail on any profile
element.

## Core-only mode

A project with no `.markspec.yaml` (or an empty profiles list) runs in
**core-only mode**:

- Only the 4 abstract and 15 core concrete types are recognised.
- Unknown `Type:` values produce `MSL-T020`.
- Unknown trailer keys produce `MSL-A020`.
- No display-ID patterns, no domain relations, no domain attributes.
- The type-resolution chain uses only steps 1, 5, 6, 7, and 8 (profile steps 2–4
  do not apply).

Core-only mode is useful for generic documentation where full traceability
tooling is not needed.

## What profiles cannot change

Profiles extend core — they cannot weaken or redefine it:

- Cannot redefine `Id`, `Type`, or `Title` — these are reserved core attribute
  keys.
- Cannot shadow any of the 15 core concrete type names (`MSL-A040` is raised for
  reserved-name conflicts). A profile type named `Requirement` is forbidden; use
  `requirement` (lowercase) as a distinct subtype.
- Cannot remove core-defined attributes or demote core errors to warnings.
- Cannot alter shape discrimination — shape is determined by the `Id:` format
  alone; no profile rule can change it.
- Cannot add cardinality constraints to universal attributes (`Id`, `Type`,
  `Labels`, `References`, …).

## Bundled profiles

| Profile                         | Purpose                                                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@markspec/default`             | RFC 2119 modal keywords, `Reference-url`/`Reference-document`/`License` attributes, core relations (`Satisfies`, `Verifies`, …), `DRAFT`/`RELEASED` labels |
| `@markspec/compliance-iso26262` | `ASIL` labels, functional-safety relations, Part 6 reference entries                                                                                       |
| `@markspec/compliance-aspice`   | ASPICE process attributes, traceability relations                                                                                                          |

## Profile commands

| Command                                   | Purpose                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `markspec profile show`                   | Display the active chain and effective vocabulary                                     |
| `markspec profile new <id>`               | Scaffold a new profile directory with `markspec.yaml`                                 |
| `markspec profile add <spec>`             | Add a profile specifier to `.markspec.yaml`                                           |
| `markspec profile describe <kind> <name>` | Show full detail for a profile element (type, attribute, relation, label, convention) |
| `markspec profile publish [--dir <dir>]`  | Validate a profile manifest for publishability                                        |

## Scaffolding a new profile

```bash
# Create a new profile directory with a skeleton manifest
markspec profile new @myorg/my-profile

# Add it to the project
markspec profile add ./my-profile
```

The scaffold creates:

```text
my-profile/
├── markspec.yaml   ← manifest (id, version, extends, profile: …)
└── README.md       ← human-readable description
```

Edit `markspec.yaml` to declare types, attributes, and relations. Run
`markspec profile publish` to validate the manifest before distributing it.
