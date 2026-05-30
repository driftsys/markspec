# MarkSpec skill registry

Core AI-assistance content for MarkSpec consumer projects, managed via
[upskill](https://driftsys.github.io/upskill/). Profile-agnostic — works with
any profile chain. Every profile bundle should `requires:` this bundle
(directly, or transitively via the default profile).

## Install

Install the full core bundle:

```bash
upskill add driftsys/markspec:skills/markspec-core.bundle.yaml
```

Or, from a local checkout treating this directory as a source registry:

```bash
upskill add ./skills/markspec-core.bundle.yaml
```

To install one item without the rest, pass the item name as a filter:

```bash
upskill add ./skills markspec-entry-authoring
```

## Layout

```text
skills/
├── README.md                                  this file
├── markspec-core.bundle.yaml                  one-shot install of the bundle
├── markspec-core-rules/RULE.md                always-on authoring invariants
├── markspec-entry-authoring/SKILL.md          entry-block format
├── markspec-write-loop/SKILL.md               insert → fmt → check
├── markspec-diagnostics/SKILL.md              MSL- diagnostic codes
├── markspec-requirement-style/SKILL.md        EARS vs Gherkin vs prose
├── markspec-ears/SKILL.md                     EARS patterns deep dive
├── markspec-gherkin/SKILL.md                  Gherkin scenarios deep dive
├── markspec-prose-review/SKILL.md             prose-quality checklist
├── markspec-profile-bundle-authoring/SKILL.md authoring profile bundles
├── markspec-scaffold-profile-bundle/AGENT.md  scaffold a profile bundle
└── markspec-traceability-review/AGENT.md      audit traceability gaps
```

## Items

### Rule

| Item                  | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `markspec-core-rules` | Always-on invariants: Id integrity, format before commit, prose quality |

### Skills

| Item                                | Triggers when…                                                      |
| ----------------------------------- | ------------------------------------------------------------------- |
| `markspec-entry-authoring`          | Writing or reviewing a MarkSpec entry block — format and trailers   |
| `markspec-write-loop`               | Adding a new entry — canonical `insert → fmt → check` sequence      |
| `markspec-diagnostics`              | Validator output contains MSL- codes — covers every family and fix  |
| `markspec-requirement-style`        | Choosing how to write a requirement body — EARS vs Gherkin vs prose |
| `markspec-ears`                     | Writing EARS-style requirements — all five patterns with do/don't   |
| `markspec-gherkin`                  | Writing Gherkin acceptance criteria — Given/When/Then with examples |
| `markspec-prose-review`             | Reviewing entry bodies for prose quality against the core checklist |
| `markspec-profile-bundle-authoring` | Creating or extending a MarkSpec profile's upskill bundle           |

### Agents

| Item                               | Purpose                                                                |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `markspec-scaffold-profile-bundle` | Reads `markspec.yaml` and scaffolds the `skills/` bundle manifest      |
| `markspec-traceability-review`     | Audits the corpus for missing derivations, untested requirements, gaps |

## Format

This directory conforms to the
[upskill format specification](https://driftsys.github.io/upskill/format-spec.html)
(schema 1). Bundle manifests are pure YAML (`.bundle.yaml`); rules / skills /
agents are Markdown files with YAML frontmatter.

Validate with:

```bash
upskill lint skills/
```
