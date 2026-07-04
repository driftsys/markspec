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

A profile manifest is a `markspec.yaml` file in a profile directory. The example
below uses a fictional `@acme/compliance` profile to illustrate the manifest
shape — MarkSpec does not bundle an ISO 26262 or ASPICE profile; see
[Bundled profiles](#bundled-profiles) for what actually ships:

```yaml
id: "@acme/compliance"
version: 1.0.0
description: "ISO 26262 compliance vocabulary"
extends: "@markspec/profile-default"

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
@markspec/profile-default
       ↓  extends
@acme/compliance
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
  - "@markspec/profile-default"
  - "@acme/compliance"
  - "./profiles/myorg"
```

Profiles are resolved in order; later entries in the list take precedence over
earlier ones for conflicting declarations.

## Effective profile

Run `markspec profile show` to inspect the active chain and its effective
vocabulary:

```text
Active profile: @acme/compliance@1.0.0

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

## Discipline kinds (`profile.kinds`)

A **kind** is a named engineering discipline — such as `software`, `hardware`,
or `mechanical` — used to classify entries for discipline-aware filtering,
reporting, and export. Kinds are declared in the `profile.kinds` map and
referenced from individual type declarations via a `discipline:` field.

See
[ADR-017 — Discipline Classification](../../architecture/adr-017-discipline-classification.md)
for the rationale and the full classification channel algorithm.

### Kind declaration syntax

Each entry in `profile.kinds` maps a kind name to one of three YAML shapes:

```yaml
profile:
  kinds:
    firmware:
      description: Embedded firmware modules
    mechanical: "Mechanical components and assemblies"
    avionics:

  types:
    SoftwareRequirement:
      extends: Requirement
      discipline: software

    FirmwareUnit:
      extends: SoftwareUnit
      # inherits 'software' from SoftwareUnit
```

| Shape                              | Meaning                                               |
| ---------------------------------- | ----------------------------------------------------- |
| `<name>:` (null value)             | Kind exists; no description                           |
| `<name>: "string"`                 | Kind exists; bare string is the description shorthand |
| `<name>:\n  description: "string"` | Kind exists; description as a sub-field               |

### Kind-name lexical rule

Kind names must match `^[a-z][a-z0-9-]*$`: lowercase letters, digits, and
hyphens, starting with a letter. The name `mixed` is reserved by the core engine
and may not be declared in a profile.

### Per-type `discipline:` field

A type declaration may carry a `discipline:` field naming the kind that the type
belongs to:

```yaml
profile:
  types:
    SoftwareRequirement:
      extends: Requirement
      discipline: software
```

The named kind must exist in the union of core-declared kinds and all
chain-declared kinds; referencing an unknown kind is `PROFILE-DISCIPLINE-004`.

**Auto-inheritance.** When a type does not carry `discipline:` explicitly, the
registry is built at compile time from the merged profile chain: the engine
walks the `extends:` chain upward until it finds a type with an explicit
`discipline:` assignment, or reaches a core type. Concretely, a type only needs
`discipline:` when it is either introducing a new kind or reassigning the kind
inherited from its parent.

### Redeclaring core kinds

The core engine ships with three built-in kinds: `system`, `software`, and
`hardware`. Declaring one of these names in a profile does not change their
semantics but produces a `PROFILE-DISCIPLINE-003` warning (the declaration is
idempotent and ignored). Declare a new kind name to introduce additional
disciplines such as `firmware`, `mechanical`, or `avionics`.

### Discipline override and freeze

Profiles that declare additional kinds via `profile.kinds:` extend the
**effective kind set** consulted by the universal `Discipline:` and
`Discipline-frozen:` attributes (see ADR-017 Implementation backlog items 4 and
5). When an author writes `Discipline: firmware` on an entry, the classifier
accepts the value (channel 1, lenient) and the validator
([MSL-T025](../language/language.md#section-8)) succeeds when `firmware` is in
the effective kind set — i.e., declared by the active profile chain or one of
the core `system` / `software` / `hardware` kinds.

The freeze attribute follows the same rule for its kind component; see ADR-017
for the full lexical grammar and validator interaction matrix.

### Discipline mode

The optional `profile.discipline-mode:` field declares whether the profile tiers
requirements by discipline (`tiered`), keeps them flat with discipline derived
via allocation (`flat`), or doesn't use discipline at all (`none`). When
omitted, MarkSpec infers the mode from the profile's type graph, in order:

1. **`tiered`** — any requirement-shaped type declares `discipline:`.
2. **`flat`** — the profile declares extended kinds (`profile.kinds:`), extends
   a core discipline-bearing type (`SoftwareComponent`, `HardwareComponent`,
   `SoftwareInterface`, `HardwareInterface`, `SoftwareUnit`, `HardwareUnit`), or
   declares any requirement-shaped type at all (even without `discipline:`).
3. **`none`** — otherwise; the profile contributes nothing discipline-relevant.

The resolved mode shapes three behaviours today:

- `markspec doctor` reports the mode and per-discipline entry counts.
- The LSP entry-block scaffold completion lists mode-recommended types first.
- `markspec create` prints a hint when the requested type isn't recommended for
  the active mode.

ADR-017 Slice 4 will additionally gate the mixed-allocation validator rule and
the reporter `--group-by discipline` default on this flag.

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

MarkSpec ships one bundled profile:

| Profile                     | Purpose                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@markspec/profile-default` | RFC 2119 modal keywords, `Reference-url`/`Reference-document`/`License` attributes, core relations (`Satisfies`, `Verifies`, …), `DRAFT`/`RELEASED` labels |

There is no bundled ISO 26262 or ASPICE profile. A compliance profile (`ASIL`
labels, functional-safety relations, ASPICE process attributes, …) is something
a project or organization authors itself, either as a local profile directory
(`markspec profile new`) or one it publishes and version-pins via
`markspec.lock` (see
[ADR-022](../../architecture/adr-022-lockfile-and-external-sync.md)). The
`@acme/compliance` example used earlier on this page illustrates that shape; it
is not a real package.

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
