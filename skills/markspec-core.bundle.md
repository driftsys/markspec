---
schema: 1
name: markspec-core
description: >
  Profile-agnostic MarkSpec literacy — entry authoring, write loop, diagnostics,
  requirement writing patterns (EARS/Gherkin), prose review, traceability audit,
  and profile bundle authoring
license: MIT

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
    - markspec-prose-review
  agents:
    - markspec-scaffold-profile-bundle
    - markspec-traceability-review

requires: []

metadata:
  version: "0.2.0"
  author: driftsys
---

# markspec-core

Baseline rules and skills for any project using MarkSpec to author traceable
industrial documentation. Profile-agnostic: works with any profile chain.

Every profile bundle should `requires: [{ name: "markspec-core" }]` (directly or
transitively via the default profile).

## Contents

| Kind  | Name                                | Purpose                                                                                                 |
| ----- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| rule  | `markspec-core-rules`               | Always-on authoring invariants (Id integrity, format before commit, prose quality)                      |
| skill | `markspec-entry-authoring`          | Entry block format and trailer attributes                                                               |
| skill | `markspec-write-loop`               | Canonical insert → format → validate agent write path                                                   |
| skill | `markspec-diagnostics`              | Reading and fixing MSL- diagnostic codes                                                                |
| skill | `markspec-requirement-style`        | EARS vs Gherkin vs plain prose selection guide                                                          |
| skill | `markspec-ears`                     | EARS patterns with do/don't examples                                                                    |
| skill | `markspec-gherkin`                  | Gherkin Given/When/Then with do/don't examples                                                          |
| skill | `markspec-profile-bundle-authoring` | Creating and extending profile skill bundles                                                            |
| skill | `markspec-prose-review`             | Entry-by-entry prose quality checklist (single-responsibility, measurability, EARS/Gherkin correctness) |
| agent | `markspec-scaffold-profile-bundle`  | Reads markspec.yaml and scaffolds the skills/ bundle manifest automatically                             |
| agent | `markspec-traceability-review`      | Audits the corpus for missing derivations, untested requirements, and orphaned entries                  |
