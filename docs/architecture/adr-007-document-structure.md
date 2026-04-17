# ADR-007: Document Structure — Front Matter, Title, and Body

Status: Proposed\
Date: 2026-04-17\
Scope: MarkSpec\
Depends on: [ADR-002 — Entry Model](./adr-002-entry-model.md)

## Context

ADR-002 defines the model for entries inside a document: four families, each
with identity, attributes, and properties. It does not specify what a
**document** itself is, how it is identified, or what metadata it carries.

In practice, many organizations need document-level identity and metadata that
is distinct from the entries the document contains:

- A Software Requirements Specification has its own identifier for change
  control, review, and external referencing — separate from the SRS entries
  inside it.
- Compliance artifacts (ISO 26262 work products, DO-178C data items, IEC 62304
  documents) are tracked as document-level deliverables.
- ALM tools (Jira, DOORS, Jama, Codebeamer) often assign identifiers to
  documents, not just to requirements.
- Static-site generators (Hugo, Jekyll, Docusaurus, MkDocs) expect
  document-level metadata to drive layout, routing, and taxonomy.

MarkSpec needs a mechanism for document identity and metadata that:

- Renders cleanly on GitHub and GitLab (both support front matter natively).
- Interoperates with existing SSG ecosystems without adapter layers.
- Stays minimal at the core and extensible by profile.
- Does not duplicate concepts already expressed in Markdown.

## Decision

### Front matter as the canonical document-metadata carrier

MarkSpec adopts **YAML front matter** as the syntactic home for document
attributes. This supersedes the previous MSL-D001 rule ("no front matter,
auto-fixed"), which was originally motivated by format purity but ignored
ecosystem reality.

```yaml
---
document-id: 01HGW2D0DOCPQ4FGHIJKLMNOPQR
document-type: requirements
status: approved
labels: [requirements, ASIL-B]
external-id: doors:VHC:SRS-BRK
---

# Braking Software Requirements

## Introduction
...
```

Front matter is delimited by `---` at the start and end, placed at the very top
of the file, before the H1.

**Rendering compatibility** — GitHub renders YAML front matter as a table at the
top of `.md` files in the web UI; GitLab displays it in a box above the document
body. Neither platform requires special configuration.

**TOML parity** — GitLab's GLFM accepts `+++`-delimited TOML front matter. The
core language **may accept TOML** as an alternative input syntax; the formatter
normalizes to YAML. JSON front matter (`;;;`) is not required.

### Markdown-native concepts stay in Markdown

Front matter **must not** carry concepts that Markdown already expresses
natively. Specifically:

| Concept           | Native Markdown home                      | Forbidden in front matter |
| ----------------- | ----------------------------------------- | ------------------------- |
| Title             | H1 heading (`# Title`)                    | no `title:` key           |
| Description       | First paragraph of body                   | no `description:` key     |
| Table of contents | Derived from headings                     | no `toc:` key             |
| Sections          | H2/H3 headings                            | no `sections:` key        |
| Images            | Inline `![alt](path)` or figure captions  | no `cover:` / `images:`   |
| Authors           | Git history (see ADR-002 properties)      | no `authors:` / `author:` |
| Dates             | Git history (`created_at`, `modified_at`) | no `date:` / `created:`   |

**Rationale**: duplicating Markdown concepts in front matter creates two sources
of truth and invites drift. `title:` in front matter can disagree with the H1;
`author:` can be weeks out of date relative to git blame. The authoritative
source is always the Markdown body or git history — front matter is strictly for
**metadata Markdown cannot express natively**.

Tooling that integrates MarkSpec with SSGs (Hugo, Jekyll, Docusaurus) must
synthesize these values from Markdown + git at build time, not read them from
front matter.

### Three-tier key categories

Front matter keys fall into three categories:

1. **Core / profile keys** — defined by this ADR (core) or by the loaded
   profile. Normative, type-validated.
2. **Reserved `metadata:` map** — free-form map for org-specific metadata. Never
   validated, always preserved.
3. **Allowlisted ecosystem keys** — declared in `.markspec.yaml`, typically for
   SSG interop (Hugo `layout:`, Jekyll `permalink:`, Docusaurus
   `sidebar_position:`). Preserved verbatim, not validated.

Any key not in one of these three categories is an error (MSL-D001 —
repurposed).

### Core front matter schema

| Key             | Type          | Scope            | Purpose                                           |
| --------------- | ------------- | ---------------- | ------------------------------------------------- |
| `document-id`   | `id`          | core (identity)  | Document ULID; bare 26-char Crockford base32      |
| `document-type` | `enum`        | core (identity)  | Overrides filename/directive-based type detection |
| `labels`        | `tag-list`    | core (universal) | Classification tags                               |
| `status`        | `enum`        | core (universal) | Lifecycle state, default `approved`               |
| `external-id`   | `external-id` | core (universal) | Cross-system identifier                           |
| `supersedes`    | `id`          | core (universal) | Replacement link to another document              |
| `references`    | `citation`    | core (universal) | External reference citations                      |
| `metadata`      | `map`         | core (reserved)  | Org free-form metadata                            |

Core keys mirror the universal attribute set from ADR-002 Part 1, plus two
document-specific identity keys (`document-id`, `document-type`). Attribute
value types follow the same 14-type system defined in ADR-002.

### Profile extensibility

Profiles declare additional front matter keys, their types, and whether they are
required or optional. Profile keys are type-validated like core keys.

Example — an automotive profile adding ASIL:

```yaml
---
document-id: 01HGW...
document-type: requirements
asil: B              # profile key
safety-goal: SG-BRK-001  # profile key
---
```

The profile declares `asil: enum [A, B, C, D, QM]` and `safety-goal: id`;
MarkSpec validates these during `markspec format` and `markspec validate`.

### The `metadata:` map

`metadata:` is a reserved top-level key that accepts any YAML structure —
scalar, list, nested map. MarkSpec never validates, never renames, and always
preserves its contents verbatim.

```yaml
metadata:
  owner: safety-team
  cost-center: ENG-042
  reviewer: alice@example.com
  jira-epic: PROJ-123
  approved-by-board: 2026-02-15
```

Accessible at render time via `{{document.metadata.<path>}}`.

**Why a dedicated `metadata:` key instead of top-level free-form**: it gives
orgs a blessed, namespaced location that won't collide with future core or
profile keys. A future ADR adding `retention-policy` as a core key cannot
conflict with `metadata.retention-policy`.

### Allowlisted ecosystem keys

Projects using MarkSpec alongside a static-site generator declare the
ecosystem's top-level keys in `.markspec.yaml`:

```yaml
# .markspec.yaml
frontMatter:
  allowedKeys:
    - layout
    - permalink
    - sidebar_position
    - draft
    - aliases
```

These keys are **preserved verbatim** during format, but not validated. Any
top-level key not in core, profile, `metadata`, or the allowlist is an error.
Default allowlist is empty — projects opt in.

### Casing conventions

Front matter keys use **kebab-case** (`document-id`, not `Document-id`). This
matches YAML-ecosystem convention across Hugo, Jekyll, Docusaurus, Kubernetes,
Helm, and dozens of other YAML-consuming tools.

Entry attribute trailers continue to use **Title-Case** (`Spec-id:`,
`Derived-from:`) because they follow git-trailers convention.

Each syntax follows its own ecosystem's convention; the parser normalizes both
forms to the same internal key.

### Markdown extensions still apply

Everything else in ADR-002 (entry blocks, attribute blocks, directives, inline
references, tables, figures) works identically inside a document with front
matter. Front matter is additive.

The document-type directive (`<!-- markspec:references -->`,
`<!-- markspec:tests -->`, …) and the `document-type` front-matter key are
equivalent in meaning. When both are present, front matter takes precedence.
Tooling warns on conflict.

## Consequences

### Integration with SSGs becomes frictionless

A MarkSpec document drops into Hugo, Jekyll, Docusaurus, or MkDocs without
conversion. The SSG reads the front matter fields it knows (allowlisted in
`.markspec.yaml`); MarkSpec reads the fields it knows (core + profile +
`metadata`). No adapter layer needed.

### Document-level compliance tracking becomes first-class

Work-product identifiers (ISO 26262 §6.5, DO-178C §12.2, IEC 62304 §5.8.4) have
a canonical home — `document-id` plus `external-id` plus `document-type`.
Tooling can build document-level traceability matrices (SRS ↔ SDD ↔ STP)
alongside the existing entry-level ones.

### Duplication is structurally prevented

By forbidding `title:`, `author:`, `date:` in front matter, MarkSpec keeps
single-source-of-truth semantics. Git history is authoritative for dates and
authorship; the H1 is authoritative for title; front matter is strictly for
metadata that has no Markdown-native equivalent.

### Profile authors gain a new extension point

Profiles now extend both entries (via profile-declared attributes and TYPE
vocabularies) and documents (via profile-declared front-matter keys). This
symmetrizes the extension model.

### MSL-D001 is repurposed

Old rule: "No front matter. Auto-fixed."\
New rule: "Front matter keys must be one of: core, profile, `metadata`,
allowlisted. Unknown keys are errors. Forbidden keys (`title`, `author`, `date`,
etc.) are errors with auto-fix to remove."

## Open questions (deferred)

- **Profile document format** — how profiles declare their front-matter keys,
  types, and validation rules. Deferred to the profile-format ADR.
- **TOML support details** — exact normalization behavior, whether TOML is
  first-class input or conversion-only. Leaning YAML-canonical.
- **Front-matter inline references** — whether `{{document.document-id}}` syntax
  resolves within front matter values, or only in body prose.
- **Document-level generated attributes** — inverse relations at document level
  (e.g., `Contained-in` from entries to their document, `Referenced-by` between
  documents).
- **Document-level `Supersedes` semantics** — whether a superseded document's
  entries are also considered superseded.
- **Summary / introduction extraction** — whether tooling should synthesize
  `description` / `summary` from the first body paragraph at build time (for SSG
  consumption), without that being a front-matter field.
