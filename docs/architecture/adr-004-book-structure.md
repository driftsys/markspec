# ADR-004: Book structure

Status: Accepted\
Date: 2026-03-01\
Scope: MarkSpec

## Context

Project documentation needs to be rendered as a navigable book for auditors,
stakeholders, and developers. The book structure must be defined explicitly by
authors, not generated from the file tree.

## Decision

### Rendering

Project documentation is rendered as a navigable book. The book structure is
defined by a `SUMMARY.md` file at the root of the documentation source
directory. The output is a self-contained site suitable for local browsing,
internal hosting, or auditor delivery.

### SUMMARY.md format

- **Prefix chapters** — unnested links before any numbered content. Not numbered
  in the sidebar.
- **Part titles** — level 1 headings (`# Title`). Rendered as unclickable
  section dividers.
- **Numbered chapters** — list items with links (`- [Title](path.md)`). Nesting
  creates sub-chapters.
- **Suffix chapters** — unnested links after all numbered content.
- **Draft chapters** — list items without a path (`- [Title]()`). Rendered as
  disabled links, signaling planned content.
- **Separators** — a line of `---` between sections.

### Structure rules

- **Front matter** — `OVERVIEW.md` is a prefix chapter. It introduces the
  project and appears at the top of the sidebar without numbering.
- **Back matter** — `GLOSSARY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, and
  `LICENSE.md` are suffix chapters. Reference material and administrative
  content belong at the end.
- **Four parts:**
  - **Product** — what the system shall do. Stakeholder, system, and software
    requirements. Follows the V-model hierarchy.
  - **Architecture** — how the system is built. System and software
    architecture, interface contracts, and ADRs.
  - **Guide** — how to use the system. Getting started, configuration,
    operational guidance.
  - **Verification** — evidence that the system meets its requirements. Contains
    generated artifacts such as the traceability matrix.
- **Numbered chapters** within each part are ordered by scope: broad to narrow,
  parent to child.
- **Sub-chapters** are used when a chapter has natural subdivisions.
- **Draft chapters** signal planned documentation that does not yet exist.

### Authoring

The `SUMMARY.md` is authored manually. It is a deliberate table of contents, not
a generated file tree. The author decides what appears in the book and in what
order. Tooling may validate that every file referenced in `SUMMARY.md` exists.

### Glossary

The glossary is a suffix chapter using heading levels as its organizing
structure:

- **Level 1** — Glossary (document title)
- **Level 2** — Letter (alphabetical grouping)
- **Level 3** — Term (one heading per term)

```markdown
# Glossary

## A

### ASIL

Automotive Safety Integrity Level. Risk classification defined by [ISO 26262]
ranging from QM (quality managed, no safety relevance) to D (highest
criticality).

## H

### HARA

Hazard Analysis and Risk Assessment. Systematic process defined in [ISO 26262]
Part 3 for identifying hazards, classifying risks, and assigning [ASIL] levels
to safety goals.
```

Terms reference other glossary entries and external standards using Markdown
link references. All link references are placed at the end of the file —
internal cross-links first, then external references.

## Consequences

- The documentation renders as a navigable book with explicit structure.
- `SUMMARY.md` is human-authored and committed — it is a deliberate table of
  contents.
- The glossary is a plain Markdown file with heading-based structure — no YAML,
  no database, same format as everything else.
- Draft chapters communicate intent and track completeness.
