# MarkSpec Skills Bundle Design

**Date:** 2026-05-19 **Status:** Draft

---

## Overview

This spec defines how AI-assistance content (rules, skills) is authored,
distributed, and extended for MarkSpec consumer projects using the **upskill**
toolchain. It answers two questions:

1. What skills and rules should ship with MarkSpec for teams authoring traceable
   docs?
2. How does the skill set extend automatically when a project extends a profile?

**Scope:** consumer-facing only. Skills for teams using MarkSpec to author
compliance documentation, not for developing the MarkSpec toolchain itself.

---

## Architecture & Artifact Layout

Three artifact families, one binding rule.

### `markspec-core` bundle

Profile-agnostic MarkSpec literacy. Lives as an upskill SSOT in the markspec
repo, which doubles as an upskill source registry (`skills/REGISTRY.md` declares
the registry identity per upskill format-spec §3.8). Every profile bundle
`requires:` it (directly or transitively).

```text
markspec/
└── skills/
    ├── REGISTRY.md
    ├── markspec-core-rules/
    │   └── RULE.md                      ← id-integrity + format-before-commit + prose-quality
    ├── markspec-entry-authoring/
    │   └── SKILL.md
    ├── markspec-write-loop/
    │   └── SKILL.md
    ├── markspec-diagnostics/
    │   └── SKILL.md
    ├── markspec-requirement-style/
    │   └── SKILL.md
    ├── markspec-ears/
    │   └── SKILL.md
    ├── markspec-gherkin/
    │   └── SKILL.md
    ├── markspec-profile-bundle-authoring/
    │   └── SKILL.md
    └── markspec-core.bundle.md
```

### Per-profile bundle

Co-located in the profile package, in a `skills/` slot sibling to ADR-008 §10's
reserved `hooks/`:

```text
<profile-id>/
├── markspec.yaml                        ← extends: "npm:@markspec/profile-default@^1.0"
├── hooks/                               ← ADR-008 §10 (deferred)
├── skills/
│   ├── <profile-id>.bundle.md           ← requires: derived from extends:
│   ├── <profile-id>-rules/
│   │   └── RULE.md                      ← profile-specific always-on rules
│   └── <skill-name>/
│       └── SKILL.md
└── README.md
```

### The binding rule

> A profile's bundle `requires:` entry mirrors the profile's `extends:` field.
> `extends: X` → the bundle `requires:` X's bundle. The default profile's bundle
> `requires: [markspec-core]`. Every profile bundle transitively pulls
> `markspec-core`.

The bundle `requires:` chain is a structural shadow of the profile `extends:`
chain:

```
public-domain (e.g. aspice-4)
  requires: profile-default
    requires: markspec-core
```

mirrors:

```
aspice-4 markspec.yaml
  extends: profile-default
    extends: (none — root)
```

A consumer runs `upskill add <registry>:<id>.bundle.md`. upskill's transitive
`requires:` resolution (format-spec §3.7) walks the chain and unions every
tier's skills — the same closure markspec's loader computes for profile
vocabulary.

**SSOT vs consumer split is preserved.** Profile repos hold SSOT (`skills/`
items). Consumer projects only ever get generated `.claude/` `.github/`
`.agents/` outputs via `upskill add`, recorded in `.upskill-lock.json`.

---

## Binding Mechanism

No code generates the bundle skeleton. The binding is enforced by a skill, a
template, and a recipe — not by the markspec CLI.

### Template

A `skills/_template.bundle.md` committed alongside the default profile:

```yaml
---
schema: 1
name: <profile-id>        # match markspec.yaml `id:`, strip @scope/ prefix
description: <one line>
license: <SPDX>

items:
  rules:
    # - <rule-name>       # one entry per skills/<rule-name>/RULE.md
  skills:
    # - <skill-name>      # one entry per skills/<skill-name>/SKILL.md
  agents: []

requires:
  # Mirror your profile's `extends:` — one entry per parent profile's bundle.
  # Example:
  #   markspec.yaml has:   extends: "npm:@markspec/profile-default@^1.0"
  #   Bundle requires:     - { name: "profile-default" }
  #
  # The default profile's bundle already requires markspec-core, so the full
  # literacy chain is inherited without listing it explicitly.
  - { name: "<parent-profile-bundle-name>" }

metadata:
  markspec-profile: "<profile-id>"
---
```

### Recipe

A recipe page (`docs/guide/recipes/profile-skills.md`) explains the single
invariant:

> **The bundle `requires:` mirrors the profile `extends:` field.** For every
> `extends:` target in `markspec.yaml`, add a matching `requires:` entry in the
> bundle manifest. Use the parent profile's bundle `name` — the same `id` from
> its `markspec.yaml` with the `@scope/` stripped. The extends-chain and the
> requires-chain stay in lock-step by convention; auditing the pair is a
> one-line diff.

The recipe also covers:

- where to create `skills/` relative to `markspec.yaml`
- naming convention: bundle `name` = profile `id` with `@scope/` stripped
- how to register new `RULE.md` / `SKILL.md` items and add their names to
  `items.*`
- the CI grep check (see Verification below)

### `markspec-profile-bundle-authoring` skill

Lives in `markspec-core`. Teaches AI agents (and human authors) the full
authoring flow:

1. Locate the profile's `markspec.yaml` and read `extends:`
2. Create `skills/<profile-id>.bundle.md` from the template
3. Derive `requires:` from `extends:` (the only field markspec semantics
   determine)
4. Create item directories under `skills/` for each rule/skill to author
5. Write RULE.md / SKILL.md bodies following upskill format-spec §2/§3
6. Add item names to `items.rules` / `items.skills` in the bundle manifest
7. Review checklist: bundle name = profile id (sans scope), requires mirrors
   extends, every item in `items.*` has a corresponding directory

---

## Skill Inventory

### `markspec-core.bundle.md`

```yaml
items:
  rules:
    - markspec-core-rules
  skills:
    - markspec-entry-authoring
    - markspec-write-loop
    - markspec-diagnostics
    - markspec-requirement-style
    - markspec-ears
    - markspec-gherkin
    - markspec-profile-bundle-authoring
requires: []
```

| Kind  | Name                                | Activation hint                                                                                                                                                                                                                                            |
| ----- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rule  | `markspec-core-rules`               | Three always-on authoring invariants: Id integrity (never hand-stamp Id: or forge a ULID), format before commit (run markspec format or hook before committing), prose quality (single-responsibility, active voice, measurable, no compound requirements) |
| skill | `markspec-entry-authoring`          | Use when writing, editing, or reviewing a MarkSpec entry block — the `- [TYPE_NNNN] Title` format, body, trailer attributes (Id, Type, Satisfies, Labels…)                                                                                                 |
| skill | `markspec-write-loop`               | Use when writing entries to files — teaches the `markspec insert → markspec format → markspec validate` canonical agent write path                                                                                                                         |
| skill | `markspec-diagnostics`              | Use when `markspec validate` output contains MSL- codes — covers code families (P0xx parse, I0xx identity, M0xx modal, A0xx attribute, T0xx type, B0xx body, C0xx caption), severity, and common fixes                                                     |
| skill | `markspec-requirement-style`        | Use first when choosing how to write requirement body text — overview of EARS vs Gherkin vs plain prose, selection criteria, pointers to `markspec-ears` and `markspec-gherkin`                                                                            |
| skill | `markspec-ears`                     | Use when writing EARS-style requirements — all five patterns (ubiquitous / event-driven / state-driven / optional / unwanted) with do/don't examples in MarkSpec entry format                                                                              |
| skill | `markspec-gherkin`                  | Use when writing Gherkin acceptance criteria — Given/When/Then structure, Scenario Outline, Background, do/don't examples, and how scenarios map to MarkSpec Verified-by attributes                                                                        |
| skill | `markspec-profile-bundle-authoring` | Use when creating or extending a MarkSpec profile's upskill bundle — teaches the `skills/` slot layout, deriving `requires:` from `extends:`, and registering SKILL.md/RULE.md items                                                                       |

### `profile-default.bundle.md` (illustrative)

```yaml
items:
  rules:
    - profile-default-rules
  skills:
    - markspec-modal-language
requires:
  # profile-default has no extends: in markspec.yaml (it is the chain root),
  # so there is no parent to derive requires: from. This is the one entry in
  # the system that is hand-authored rather than derived from extends:.
  - { name: "markspec-core" }
```

| Kind  | Name                      | Activation hint                                                                                                                                                   |
| ----- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rule  | `profile-default-rules`   | RFC 2119 modal keywords (shall, should, may, must, will) must appear lowercase — enforces MSL-M060                                                                |
| skill | `markspec-modal-language` | Use when writing requirement body text — teaches RFC 2119 shall/should/may/must/will distinctions, anti-patterns, and how the validator flags MSL-M0xx violations |

### `profile-aspice-4.bundle.md` (illustrative)

```yaml
items:
  rules:
    - aspice-4-rules
  skills:
    - aspice-type-vocabulary
    - aspice-traceability-topology
requires:
  - { name: "profile-default" }    # derived from extends: "npm:@markspec/profile-default@^1"
```

| Kind  | Name                           | Activation hint                                                                                                                                                                                 |
| ----- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rule  | `aspice-4-rules`               | Every identified entry must carry exactly one ASIL label (ASIL-A through ASIL-D, or QM); mixing levels in one entry is an error                                                                 |
| skill | `aspice-type-vocabulary`       | Use when creating or classifying entries — teaches the ASPICE 4.0 type hierarchy (STK, SYS, SWE, SIT, SWT), when to use each, and display-ID patterns                                           |
| skill | `aspice-traceability-topology` | Use when linking requirements or reading coverage — teaches the V-model chain (STK→SYS→SWE via Satisfies, SWE→SIT→SWT via Verified-by) and how to interpret `markspec report traceability` gaps |

---

## Data Flow

```
Profile author
  1. Creates profile package: markspec.yaml + skills/ slot
  2. Invokes markspec-profile-bundle-authoring skill
       → scaffolds <id>.bundle.md from template
       → derives requires: from markspec.yaml extends:
  3. Hand-authors RULE.md / SKILL.md bodies under skills/
  4. Adds item names to items.rules / items.skills in the bundle manifest
  5. Runs markspec profile publish → profile available via npm/git

Consumer project
  6. upskill add <registry>:<id>.bundle.md
  7. upskill resolves requires: transitively across the chain:
       aspice-4 → profile-default → markspec-core
  8. upskill generates client outputs:
       .claude/rules/markspec-core-rules.md
       .claude/skills/markspec-entry-authoring.md
       .claude/skills/markspec-ears.md
       ... (full closure, all tiers)
       .github/ and .agents/ equivalents
  9. Consumer commits .upskill-lock.json — locks refs and hashes
```

Step 2 is the only place where the `extends:` → `requires:` mirror is applied.
The skill body is the single source of truth for that convention.

---

## Edge Cases

| Case                                                           | Handling                                                                                                                                                                                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile in chain has no `skills/` slot                         | upskill reports unresolved `requires:` entry. Recipe doc states: every profile in the chain must ship a bundle; hook-only profiles (no `profile:` content section) are the exception — document in the profile's README that no bundle is provided. |
| Bundle `name` doesn't match profile `id`                       | Convention: strip `@scope/` from the profile `id`. Documented in template and recipe. Caught in code review, not by tooling.                                                                                                                        |
| `extends:` uses a semver range, `requires:` has no version pin | Intentional. `requires:` names the parent bundle without a version constraint, letting upskill resolve to whatever the consumer has installed. Recipe advises this default; pinning is opt-in for stricter environments.                            |
| Consumer project uses no profile (markspec-core only)          | `upskill add markspec:markspec-core.bundle.md`. Valid — no requires chain needed.                                                                                                                                                                   |

---

## Verification

No code to unit-test. Verification is:

- `upskill lint --strict` on every bundle manifest and item body (format-spec
  conformance, description length, required fields). Run in CI for `skills/` in
  the markspec repo and for `skills/` in each profile package.
- A one-liner CI grep asserts the extends→requires mirror for each profile
  package:

  ```bash
  # Illustrative — handles npm: and git: specifiers. Local specifiers (./path)
  # require different parsing; see recipe doc for the complete check.
  EXTENDS=$(grep '^extends:' markspec.yaml \
    | sed 's/.*@\([^@/]*\)\/.*/\1/; s/.*\///; s/@.*//')
  grep -q "name: \"$EXTENDS\"" skills/*.bundle.md || exit 1
  ```

- **Acceptance criterion:** a profile author following the recipe and the
  `markspec-profile-bundle-authoring` skill can produce a
  `upskill add`-installable bundle in one session, with the full chain resolving
  correctly.
