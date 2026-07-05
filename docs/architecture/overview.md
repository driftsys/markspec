# MarkSpec Architecture Overview

This document gives the narrative tour of MarkSpec's architecture. For the
decisions behind it, see the [ADRs](./) in this directory. Every decision
referenced below links to its ADR; the closing
[reading order](#reading-order-for-new-contributors) threads them into a path.

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
                       pipeline, typography pipeline.
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
  declared by the active profile; the core resolves and validates them. Display
  IDs are the canonical authored form of a trace value
  ([ADR-026](./adr-026-display-id-trace-resolution.md)).
- **Attribute-schema machinery** — generic `Key: Value` trailers with value
  types, origin, cardinality; profiles populate the vocabulary.
- **Generic rule evaluator** — predicates over the graph; dormant without
  profile rules. Diagnostics follow a versioned code scheme
  ([ADR-012](./adr-012-diagnostic-code-scheme.md)).
- **Entry-source pipeline** — adapters for Markdown and code doc comments.
  Future: tree-sitter-based language adapters, SBOM tools
  ([ADR-011](./adr-011-language-pack-and-dependency-ingestion.md)).
- **Typography / rendering** — PDF, book, deck output; same rendering engine
  across output formats ([ADR-004](./adr-004-book-structure.md)).
- **Property namespace** — observed facts (path, git history, extraction
  provenance) separate from authored attributes
  ([ADR-006](./adr-006-property-model.md)).
- **Document structure** — front matter, document identity, reserved keys
  ([ADR-007](./adr-007-document-structure.md)).
- **CLI** — `markspec fmt`, `check`, `compile`, `show`, `report`,
  `profile show`, `doctor`, `doc build`, `book build`
  ([ADR-005](./adr-005-cli-architecture.md)).

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
coding-standard rule-profile pattern. A profile can also **deliver documents** —
ship Markdown files (a traceable corpus or docs-only material) that consumers
inherit through the `extends:` chain
([ADR-030](./adr-030-profile-delivered-documents.md)).

## What the language pack adds

> **Not yet implemented.** The language pack described below is planned but not
> yet built. Currently, source-file doc comment extraction uses a regex-based
> parser. See [ADR-011](./adr-011-language-pack-and-dependency-ingestion.md) for
> the design.

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

## The body model and formatting pipeline

An entry's body is not opaque prose — the core parses it into a canonical model
so analysis and formatting are lossless and deterministic.

- **Canonical body-AST** ([ADR-014](./adr-014-canonical-body-ast.md)) — the
  load-bearing model of an entry body; the formatter falls back to a safe string
  path only where the build/render inverse is not total.
- **AST-equivalence formatting contract**
  ([ADR-015](./adr-015-ast-equivalence-formatting-contract.md)) — `markspec fmt`
  must satisfy `build(format(x)) ≈ normalizeBodyAst(build(x))`; this gate is
  what makes reformatting provably content-preserving.
- **Body-token AST** ([ADR-016](./adr-016-body-token-ast.md)) — a flat
  `bodyTokens` stream is the single extraction layer for modal verbs, EARS
  triggers, Gherkin keywords, `$Identifier` entity refs, and inline code.
- **Whole-document formatting**
  ([ADR-029](./adr-029-whole-document-markdown-formatting.md)) — `markspec fmt`
  formats the entire Markdown document via an embedded dprint plugin, gated by a
  CommonMark-semantic equivalence comparator.
- **Document directive, not a resolution step**
  ([ADR-013](./adr-013-document-directive-not-a-resolution-step.md)) — the
  family-hint document directive is a `fmt` concern, deliberately kept out of
  the validator's type-resolution chain.

## Classification, types, and identifiers

Above the raw graph, the core derives structure and lets profiles constrain it.

- **Discipline classification**
  ([ADR-017](./adr-017-discipline-classification.md),
  [ADR-018](./adr-018-core-discipline-ssot.md)) — SW/HW discipline is derived
  from the `Allocated-to` graph, with a single source of truth in the core that
  profiles extend but never override.
- **typl type DSL** ([ADR-019](./adr-019-typl-type-dsl.md)) — an inline
  constraint/type declaration language for entry attributes, with three
  authoring surfaces and a corpus-wide type registry.
- **Interface as contract** ([ADR-024](./adr-024-interface-as-contract.md)) —
  software/hardware interfaces are re-parented from `Component` to `Contract`
  (an interface is a specification, not a building block), with symmetric
  `Provides`/`Requires` links.
- **Counter-less display IDs**
  ([ADR-025](./adr-025-counter-less-display-id-pattern.md)) — named (not
  numbered) `display-id-pattern`s so component-style IDs like `SWC_LIGHT_CTRL`
  classify by prefix without an explicit `Type:`.
- **Display-ID trace resolution**
  ([ADR-026](./adr-026-display-id-trace-resolution.md)) — display IDs are the
  canonical authored form for trace values; a permissive existence check
  (`MSL-L006`) and a lockfile `[[edge]]` ULID ledger keep renames healable.

## Tooling, indexing, and distribution

The surfaces around the core — CLI ergonomics, prose analysis, indexing,
external sync, and agent integration — are their own line of decisions.

- **Smoother CLI defaults** ([ADR-027](./adr-027-cli-smoother-defaults.md)) —
  bare `check` / `lint` / `fmt` default to whole-project scope via
  gitignore-aware discovery, and `check` becomes the composite gate (structure +
  traceability + fmt drift + lockfile drift + advisory prose lint).
- **Prose-analysis flagship**
  ([ADR-021](./adr-021-prose-analysis-flagship-build.md)) — 16 active `MSL-Q`
  rules plus the flagship `xref-glossary-undefined` check and a band-count score
  roll-up, surfaced by `markspec lint` and `markspec score`.
- **Lockfile and external sync**
  ([ADR-022](./adr-022-lockfile-and-external-sync.md)) — `markspec.lock` pins
  upstream profile/language-pack versions and tracks sync state
  (`markspec lock`, `markspec sync status|log|show`).
- **On-demand SQLite indexing** ([ADR-020](./adr-020-sqlite-indexing-eval.md)) —
  the evaluation scope for Phase 1 of background indexing: no filesystem
  watcher, surgical invalidation, a lockfile-pinned federated cache.
- **MCP agent integration** ([ADR-023](./adr-023-mcp-trigger-language.md),
  [ADR-028](./adr-028-mcp-project-discovery.md)) — the MCP server's agent-facing
  trigger language and soft project-detection gate, plus how `markspec mcp`
  resolves its project root from an ordered candidate list.

## Reading order for new contributors

If you are new to MarkSpec, read the anchoring decisions first, then follow the
line that matches what you are working on.

**Start here — the anchor:**

1. [ADR-001 — Markdown Format](./adr-001-markdown-format.md) — what MarkSpec
   considers valid input.
2. [ADR-009 — Core / Profile Boundary](./adr-009-core-profile-boundary.md) — the
   principle that organizes everything else.
3. [ADR-002 — Entry Model](./adr-002-entry-model.md) — the two-shape entry model
   the core implements.
4. [ADR-008 — Profile System](./adr-008-profile-system.md) and
   [ADR-010 — Default Profile](./adr-010-default-profile.md) — how vocabulary
   and rules live outside the core, and the out-of-box experience.
5. [ADR-011 — Language Pack and Dependency Ingestion](./adr-011-language-pack-and-dependency-ingestion.md)
   — how code and dependencies enter the model.

**Then, by topic:**

- **Documents & rendering:** [ADR-007](./adr-007-document-structure.md) (front
  matter), [ADR-004](./adr-004-book-structure.md) (book),
  [ADR-003](./adr-003-diagram-authoring.md) (diagrams),
  [ADR-006](./adr-006-property-model.md) (observed properties),
  [ADR-005](./adr-005-cli-architecture.md) (CLI architecture).
- **Body model & formatting:** [ADR-014](./adr-014-canonical-body-ast.md),
  [ADR-015](./adr-015-ast-equivalence-formatting-contract.md),
  [ADR-016](./adr-016-body-token-ast.md),
  [ADR-029](./adr-029-whole-document-markdown-formatting.md),
  [ADR-013](./adr-013-document-directive-not-a-resolution-step.md),
  [ADR-012](./adr-012-diagnostic-code-scheme.md).
- **Classification, types & IDs:**
  [ADR-017](./adr-017-discipline-classification.md),
  [ADR-018](./adr-018-core-discipline-ssot.md),
  [ADR-019](./adr-019-typl-type-dsl.md),
  [ADR-024](./adr-024-interface-as-contract.md),
  [ADR-025](./adr-025-counter-less-display-id-pattern.md),
  [ADR-026](./adr-026-display-id-trace-resolution.md).
- **Tooling, sync & agents:** [ADR-027](./adr-027-cli-smoother-defaults.md),
  [ADR-021](./adr-021-prose-analysis-flagship-build.md),
  [ADR-022](./adr-022-lockfile-and-external-sync.md),
  [ADR-020](./adr-020-sqlite-indexing-eval.md),
  [ADR-023](./adr-023-mcp-trigger-language.md),
  [ADR-028](./adr-028-mcp-project-discovery.md),
  [ADR-030](./adr-030-profile-delivered-documents.md),
  [ADR-031](./adr-031-federated-upstream-resolution.md),
  [ADR-032](./adr-032-process-profile-boundary.md).
