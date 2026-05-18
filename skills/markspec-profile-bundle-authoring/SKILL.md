---
schema: 1
name: markspec-profile-bundle-authoring
description: >
  Use when creating or extending a MarkSpec profile's upskill bundle — teaches
  the `skills/` slot layout, deriving `requires:` from the profile's `extends:`
  field, and registering SKILL.md / RULE.md items in the bundle manifest.
---

# markspec-profile-bundle-authoring

## Overview

Every MarkSpec profile that ships AI-assistance content needs a `skills/` slot
and a bundle manifest. The bundle `requires:` chain must structurally mirror the
profile `extends:` chain — one `requires:` entry per parent profile bundle.

**Core invariant:**

> `extends: X` in `markspec.yaml` → `requires: [{name: "X-without-scope"}]` in
> the bundle manifest.

## Directory layout

```text
<profile-dir>/
├── markspec.yaml              ← profile manifest (extends:, types:, etc.)
├── skills/
│   ├── <profile-id>.bundle.md ← bundle manifest
│   ├── <profile-id>-rules/
│   │   └── RULE.md            ← always-on authoring rules
│   └── <skill-name>/
│       └── SKILL.md           ← one skill per concept
└── README.md
```

The `skills/` slot is a sibling of `hooks/`. It contains only source items;
consumers never write to it — they get generated outputs via `upskill add`.

## Step-by-step authoring flow

### 1. Read the profile's `extends:`

```bash
grep '^extends:' markspec.yaml
# e.g.: extends: "npm:@markspec/profile-default@^1.0"
```

### 2. Derive the bundle name and `requires:`

Strip the `@scope/` prefix and the version range from the parent specifier:

| `extends:` value                       | `requires:` name                                       |
| -------------------------------------- | ------------------------------------------------------ |
| `"npm:@markspec/profile-default@^1.0"` | `"profile-default"`                                    |
| `"npm:@acme/aspice-4@^2"`              | `"aspice-4"`                                           |
| `"./path/to/parent"`                   | `"parent-bundle-name"` _(from parent's `name:` field)_ |
| _(no extends — chain root)_            | `"markspec-core"` _(hand-authored)_                    |

The bundle's own `name:` = the profile's `id:` with `@scope/` stripped.

### 3. Create the bundle manifest

```yaml
---
schema: 1
name: <profile-id>          # profile id with @scope/ stripped
description: <one line>
license: <SPDX>

items:
  rules:
    # - <rule-name>         # one entry per skills/<rule-name>/RULE.md
  skills:
    # - <skill-name>        # one entry per skills/<skill-name>/SKILL.md
  agents: []

requires:
  - { name: "<parent-bundle-name>" }   # derived from extends: above

metadata:
  markspec-profile: "<profile-id>"
---
```

### 4. Author RULE.md items

Create `skills/<rule-name>/RULE.md`:

```markdown
---
schema: 1
name: <rule-name>
description: Always-on authoring invariant for <profile> projects
---

## Rule title

Rule body — be specific about what authors must/must not do and why.
```

Then add `- <rule-name>` under `items.rules` in the bundle manifest.

### 5. Author SKILL.md items

Create `skills/<skill-name>/SKILL.md`. Follow `markspec-core` skill conventions:

- `description:` starts with "Use when…", describes triggering conditions only.
- Body ≤ 500 lines.
- No time-sensitive content (versions, PR numbers).

Then add `- <skill-name>` under `items.skills` in the bundle manifest.

### 6. Review checklist

- [ ] Bundle `name:` matches profile `id:` with `@scope/` stripped.
- [ ] `requires:` mirrors `extends:` — one entry per parent.
- [ ] Every name listed in `items.rules` has a `skills/<name>/RULE.md`.
- [ ] Every name listed in `items.skills` has a `skills/<name>/SKILL.md`.
- [ ] `description:` fields are ≤ 1024 characters.

## Example — illustrative profile

`markspec.yaml`:

```yaml
id: "aspice-4"
version: "0.1.0"
extends: "npm:@markspec/profile-default@^1.0"
```

`skills/aspice-4.bundle.md`:

```yaml
---
schema: 1
name: aspice-4
description: ASPICE 4.0 authoring rules and skills for MarkSpec projects
license: MIT

items:
  rules:
    - aspice-4-rules
  skills:
    - aspice-type-vocabulary
    - aspice-traceability-topology

requires:
  - { name: "profile-default" }   # derived from extends: @markspec/profile-default

metadata:
  markspec-profile: "aspice-4"
---
```

## Chain resolution

A consumer running `upskill add <registry>:aspice-4.bundle.md` gets all three
tiers of skills automatically via transitive `requires:` resolution:

```
aspice-4
  → profile-default
      → markspec-core
```

This mirrors the profile `extends:` chain exactly.

## CI verification

A one-liner asserts the mirror invariant for npm/git specifiers:

```bash
EXTENDS=$(grep '^extends:' markspec.yaml \
  | sed 's/.*@\([^@/]*\)\/.*/\1/; s/.*\///; s/@.*//')
grep -q "name: \"$EXTENDS\"" skills/*.bundle.md || exit 1
```

Add this to your profile package's CI pipeline.
