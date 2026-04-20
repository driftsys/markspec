# MarkSpec Architecture Overview

This document gives the narrative tour of MarkSpec's architecture. For the
decisions behind it, see the [ADRs](./) in this directory.

## Who MarkSpec is for

MarkSpec serves two distinct personas that share a common core:

- **Technical writers** — authors who want ergonomic Markdown authoring, stable
  cross-references, good typography, and high-quality PDF / book / deck output.
  They care about writing speed, rendering fidelity, and being able to cite
  external sources cleanly.
- **Process / compliance owners** — quality engineers, safety assessors, and
  audit-facing roles who need ASPICE, ISO 26262, DO-178C, IEC 62304
  traceability, coverage checks, and rule enforcement. They care about what the
  tool can _prove_ about a document set.

The two personas diverge sharply in what they want on the surface. They converge
on a shared substrate: Markdown with stable IDs and typed cross-references.
MarkSpec is organized around that convergence — one codebase, one binary,
layered behavior depending on which profile(s) are loaded.

## The three layers

```text
compliance profile  ·  ASPICE / ISO 26262 / DO-178C / IEC 62304 / MISRA / …
                       Type vocabulary, relation names, traceability rules,
                       safety classifications.

default profile     ·  Generic types (requirement, note, term, reference),
                       RFC 2119 hygiene, universal validation rules.

core                ·  Two entry shapes (identified, referenced), single `Id:`
                       with ULID-or-URI format discrimination, typed-edge
                       graph, attribute schema, rule evaluator, entry-source
                       pipeline, tree-sitter runtime, typography pipeline.
```

Each layer is optional relative to the one above it. Core runs standalone.
Default profile loads on top unless opted out. Compliance profiles stack on top
of the default (or replace it) via the `extends:` chain. Organization, team, and
project profiles tune further.

See [ADR-009](./adr-009-core-profile-boundary.md) for the principle,
[ADR-010](./adr-010-default-profile.md) for the default profile, and
[ADR-008](./adr-008-profile-system.md) for the distribution and stacking
mechanics.

## What's in the core

The core is deliberately small and semantics-free. It ships:

- **Markdown authoring** — CommonMark + GFM subset
  ([ADR-001](./adr-001-markdown-format.md)).
- **Two entry shapes** — identified (ULID + display ID) and referenced (URI +
  slug) ([ADR-002](./adr-002-entry-model.md),
  [ADR-009](./adr-009-core-profile-boundary.md)).
- **Typed-edge graph** — cross-references are labelled with relation names
  declared by the active profile; the core resolves and validates them.
- **Attribute-schema machinery** — generic `Key: Value` trailers with value
  types, origin, cardinality; profiles populate the vocabulary.
- **Generic rule evaluator** — predicates over the graph; dormant without
  profile rules.
- **Entry-source pipeline** — adapters for Markdown, code (tree-sitter), SBOM
  tools, etc. ([ADR-011](./adr-011-language-pack-and-dependency-ingestion.md)).
- **Tree-sitter runtime** — for code-block syntax highlighting and for language
  adapters.
- **Typography / rendering** — PDF, book, deck output; same rendering engine
  across output formats ([ADR-004](./adr-004-book-structure.md)).
- **Property namespace** — observed facts (path, git history, extraction
  provenance) separate from authored attributes
  ([ADR-006](./adr-006-property-model.md)).
- **Document structure** — front matter, document identity, reserved keys
  ([ADR-007](./adr-007-document-structure.md)).
- **CLI** — `markspec format`, `validate`, `migrate`, `profile`, `deps`,
  `render`, etc. ([ADR-005](./adr-005-cli-architecture.md)).

The core does **not** ship: type vocabulary, compliance attributes, traceability
rules, in-code doc-comment conventions, dependency manifest parsers, specific
language grammars.

## What the default profile adds

The default profile (loaded automatically unless `default-profile: false`) adds
the minimum vocabulary any structured doc set needs, grounded in RFC 2119 / BCP
14:

- **Types**: `requirement`, `note`, `term`, `reference`.
- **Hygiene rules**: unique IDs, resolvable cross-references, RFC 2119 keyword
  hinting on requirements, glossary-term resolution.
- **Display-ID patterns**: `REQ-{n:03d}`, `NOTE-{n:03d}` (warn-only, not
  enforced).
- **Glossary support**: `type: term` entries with prose resolution via
  `{{term.<slug>}}`.

See [ADR-010](./adr-010-default-profile.md).

## What compliance profiles layer on

A compliance profile expresses the vocabulary and rules of a standard:

- **Type vocabulary** — `software-requirement`, `unit-test`, `integration-test`,
  `safety-goal`, `hazard`, `soup-package`, …
- **Relation names** — `Derived-from`, `Verifies`, `Tests`, `Allocated-to`,
  `Mitigates`, `Implements`, …
- **Required attributes per type** — `ASIL`, `DAL`, `SIL`, `Risk-class`,
  `Verification-evidence`, …
- **Traceability rules** — cardinality, target-type matchers, required
  bidirectional links.

Examples that typically ship as separate profile packages:
`@markspec/profile-aspice-4`, `@markspec/profile-iso-26262`,
`@markspec/profile-do-178c`, `@markspec/profile-iec-62304`,
`@markspec/profile-misra-c`.

See [ADR-008](./adr-008-profile-system.md) for distribution and
[ADR-011 §6](./adr-011-language-pack-and-dependency-ingestion.md) for the
coding-standard rule-profile pattern.

## What the language pack adds

The default language pack ships with the binary (opt out via
`default-language-pack: false`) and covers nine languages: Rust, Kotlin, C, C++,
Java, TypeScript, JavaScript, Python, C#.

Each adapter:

- Extracts identified entries from doc-commented declarations.
- Emits referenced entries for imports / dependencies (purl-identified when
  resolvable).
- Provides a tree-sitter grammar the rendering pipeline uses for code-block
  syntax highlighting.

Dependency ingestion delegates to SBOM tooling (Syft, cdxgen) — MarkSpec does
not re-implement manifest parsers. See
[ADR-011](./adr-011-language-pack-and-dependency-ingestion.md) for the full
design.

## Reading order for new contributors

If you are new to MarkSpec and want the full picture:

1. [ADR-001 — Markdown Format](./adr-001-markdown-format.md) — what MarkSpec
   considers valid input.
2. [ADR-009 — Core / Profile Boundary](./adr-009-core-profile-boundary.md) — the
   principle that organizes everything else.
3. [ADR-002 — Entry Model](./adr-002-entry-model.md) — the two-shape entry model
   the core implements.
4. [ADR-008 — Profile System](./adr-008-profile-system.md) — how vocabulary and
   rules live outside the core.
5. [ADR-010 — Default Profile](./adr-010-default-profile.md) — the out-of-box
   experience.
6. [ADR-011 — Language Pack and Dependency Ingestion](./adr-011-language-pack-and-dependency-ingestion.md)
   — how code and dependencies enter the model.

For document-level structure and rendering, see
[ADR-004](./adr-004-book-structure.md) (book),
[ADR-007](./adr-007-document-structure.md) (front matter),
[ADR-003](./adr-003-diagram-authoring.md) (diagrams),
[ADR-005](./adr-005-cli-architecture.md) (CLI).
