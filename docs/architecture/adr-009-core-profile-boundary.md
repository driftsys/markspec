# ADR-009: Core / Profile Boundary

## Context

ADR-001 through ADR-008 gradually built a data model centered on four entry
**families** — Spec, Test, Element, Reference — with four dedicated identity
attributes (`Spec-id`, `Test-id`, `Element-id`, `Reference-id`), a rich
per-family attribute catalog, and traceability rules baked into the core
specification.

That shape made sense when MarkSpec's identity was "the spec authoring tool for
ASPICE and ISO 26262". Two observations recorded after ADR-008 landed changed
the frame:

- **Two personas, not one.** MarkSpec serves a **technical-writing persona**
  (ergonomic authoring, high-quality PDF/book/deck output, stable
  cross-references) _and_ a **process-enforcement persona** (ASPICE/ISO
  traceability, validation, audit trails). The two share a core model but
  diverge sharply in surface, docs, and success criteria.
- **The four families encode compliance scaffolding, not a universal taxonomy.**
  Outside compliance-heavy contexts, the split between spec/test and
  element/reference is not obvious. The universal distinction — the one a
  tech-writer tool also needs — is **referenced vs. identified**: citation
  pointers outward vs. content units carrying a stable local identity.

MarkSpec has not shipped. The ADR trail _is_ the baseline, not history. Rather
than layer a superseding decision on top of ADR-002/008, this ADR revises the
baseline in place: it names the core/profile boundary, defines the two core
shapes, and documents what moves out of the core into the profile layer. Later
revisions to ADR-002/006/007/008 bring those documents into line.

### Guiding principle

**Mechanism in core; policy in profile.** The core ships generic machinery
(identity, graph, attribute schema, rule evaluator, entry-source pipeline). The
profile layer declares concrete vocabulary, types, relation names, and rules
evaluated by that machinery. Without a profile loaded, the machinery is dormant
but the core still produces a well-formed model.

A single rule settles every "does this belong in core?" question: if a feature
serves only compliance/enforcement, it belongs in a profile; if it is universal
to any structured authoring, it belongs in core.

## Decision

### 1. Two core entry shapes

The core recognizes **two** entry shapes, both semantics-free. The profile layer
declares types within each shape (spec, test, requirement, rule, standard,
glossary term, SOUP package, hardware part, …).

| Shape          | Intent                                    | Identity                  | Display-ID role                     |
| -------------- | ----------------------------------------- | ------------------------- | ----------------------------------- |
| **Identified** | Content unit the project authors and owns | ULID, project-unique      | Human-readable alias                |
| **Referenced** | Citation pointing to an external artifact | URI (any RFC 3986 scheme) | Slug (pandoc/BibTeX-style cite-key) |

The four families from ADR-002 (Spec, Test, Element, Reference) collapse as
follows:

- **Spec**, **Test**, **Element** (when the element is a project-authored
  artifact or unit) → **identified** entries with a profile-declared `type:`
  value (`type: spec`, `type: test`, `type: unit`, …).
- **Element** (when it names a third-party dependency), **Reference** →
  **referenced** entries with a profile-declared `type:` value
  (`type: standard`, `type: glossary`, `type: dependency`, …).

The same external thing (e.g., `zlib`) may be modeled as either shape depending
on intent: if it is cited bibliographically, it is referenced; if it is tracked
as a project graph participant (SOUP, traced component, allocated unit), it is
identified. The author picks.

### 2. Single `Id:` identity attribute with format discrimination

Every entry carries exactly one identity attribute named `Id:`. The **value
format** discriminates the shape:

```text
Id: 01HGW2P4KFR7ABCDEFGHJKMNPQ       # ULID → identified
Id: urn:iso:std:iso:26262:-6:ed-2    # URI → referenced
Id: doi:10.1109/IEEESTD.2008.4610935 # URI → referenced
Id: pkg:cargo/serde@1.0.0            # URI (purl scheme) → referenced
Id: https://www.rfc-editor.org/rfc/rfc2119 # URI → referenced
```

**Discrimination is bulletproof.** The two value shapes are visually and
grammatically disjoint:

- ULID: `^[0-9A-HJKMNP-TV-Z]{26}$` — 26 characters of Crockford base32, no
  scheme, no colon, no slash.
- URI (RFC 3986): MUST begin with a scheme followed by `:`. A bare slug (no
  scheme) is rejected as an `Id:` value — the slug lives in the display ID, not
  in `Id:`.

The one-step rule replaces the four-attribute discrimination of ADR-002 and
dissolves the multi-input cascade ADR-008 §8 was rejecting (see §9 — Rebuttal of
ADR-008 §8).

**Identity is the only thing `Id:` encodes.** Type, category, kind, and any
other classification move to profile-declared `type:` (or equivalent)
attributes. The identity attribute is spelling-stable across profiles; only
values and type attributes vary.

### 3. Display ID and slug

The display ID in an entry's bracket header (`- [DISPLAY_ID] Title`) plays two
roles depending on shape:

- **Identified entry** — display ID is a human-readable alias. Stable within a
  project, can be renumbered via tooling. The ULID underneath preserves identity
  across renames. Format is profile-constrained (see §5).
- **Referenced entry** — display ID _is_ the slug. Matches pandoc/BibTeX
  convention (`[@ISO-26262-6]` or `[ISO-26262-6]` are equivalent). The slug is
  the stable project-local handle; no separate `Slug:` attribute is needed.

The leading `@` in a referenced entry's display ID is accepted syntactic sugar
for pandoc compatibility and is stripped at parse time.

### 4. Identity vs. provenance

Identity is what a cross-reference resolves against. **Provenance** — where an
entry's bytes came from — is separate and never identity.

| Kind                                                               | Stable across                                 | Captured as                 |
| ------------------------------------------------------------------ | --------------------------------------------- | --------------------------- |
| Identity (ULID, slug)                                              | Renames, file moves, refactors, profile swaps | `Id:` attribute, display ID |
| Provenance (path, module, line, commit, extracted-at, source-type) | Change with authoring                         | Properties (per ADR-006)    |

Refactoring a module, renaming a file, or moving an entry between files must
never break a cross-reference. Provenance updates; identity does not. File path
and module name are observable properties, not authored attributes.

### 5. Display-ID patterns drive type inference

The core accepts any non-empty, project-unique display ID string. It does not
constrain format, does not enforce prefixes, and does not derive type from
prefix.

Profiles tighten this by declaring **display-ID patterns** per type, in template
form (not regex), so the same declaration (a) **recognizes** an existing display
ID, (b) **mints** a new one, and (c) **infers the type** of an entry from its
display ID:

```yaml
profile:
  types:
    requirement:
      display-id-pattern: "SRS_{scope}_{n:04d}"
    test:
      display-id-pattern: "SWT_{scope}_{n:04d}"
```

Given `- [SRS_BRK_0107] ...`, the profile matches the `SRS_*` pattern and
classifies the entry as `type: requirement`. The author does not write `type:`
in source.

**Explicit `type:` is an override.** A `type:` attribute on an entry supersedes
pattern-based inference. It is used when:

- The display ID does not match any declared pattern (free-form slugs; glossary
  terms; symbolic element paths).
- Two profiles declare overlapping patterns and the author wants unambiguous
  classification.
- The author wants the entry's type to be inspectable in the source without
  consulting the profile.

**Ambiguity and diagnostics.** When multiple patterns match the same display ID,
tooling emits a warning and requires the author to disambiguate via an explicit
`type:` attribute. When no pattern matches, the entry has no type attribute
unless one is explicitly authored; validators that require a typed entry emit an
error.

Minimum pattern grammar: literal prefix + one numeric placeholder `{n}` with
optional zero-padding (`{n:03d}`), optional scope placeholders. Later extensions
(additional placeholders, per-type scope counters, domain sub-scoping) are
additive refinements.

Templates are compiled internally to a recognizer regex for parsing and used
directly for minting. Regex-only declarations are not supported because they
cannot be inverted to generate the next available ID.

### 6. Attribute machinery: generic core, profile vocabulary

The core defines a single attribute system:

- Every entry carries a bag of `Key: Value` trailers following git-trailers
  convention (carried unchanged from ADR-001).
- Every attribute has a **name** (bare key), a **value type**, a **cardinality
  bound**, and an **origin** (`authored`, `inferred`, `assigned`, `generated`).
- Value types, cardinality, and origin semantics are core concepts (reused from
  ADR-002 Part 1).

Core reserves exactly one attribute name: **`Id:`**. Every other attribute
spelling is profile-declared. Profile schemas populate the attribute-name
namespace with their own vocabulary (`Derived-from`, `Verifies`, `Allocated-to`,
`Risk-class`, `License`, …) and their own value-type catalog extensions.

Profiles may not shadow the core `Id:` spelling. A profile can define an alias
if it desires (e.g., for migration), but the canonical slot name is `Id:`.

### 7. Typed edges (relations)

The core graph carries typed edges: every cross-reference is labelled with a
**relation name** (from the enclosing attribute's name). The core evaluator
treats edges generically — it resolves source→target, validates that targets
exist, and surfaces edges to rule evaluation. It has no built-in knowledge of
what a specific relation means.

Relation names (`Derived-from`, `Verifies`, `Allocated-to`, `Depends-on`,
`Mitigates`, `Supersedes`, …) and their semantics — direction, target matchers,
cardinality, inverse generation — are **profile-declared** via the traceability
machinery specified in ADR-008 §7.

The core has one baked-in relation: `Supersedes:` (universal retirement
semantic, carried from ADR-002 §Retirement semantics). All other relations live
in profiles.

### 8. Rule evaluator — dormant without profile

The core ships a generic rule evaluator: a small predicate runner over the entry
graph that exposes queries like "every identified entry with `type: X` must have
at least one outgoing edge labelled `R`" or "every target of `R` must be of
`type: Y`".

The evaluator carries **no rules of its own**. Rules are profile-declared
(ADR-008). With no profile loaded, the evaluator observes the graph and reports
nothing. Core-only mode is valid: the tool still parses, renders, and exposes
the model; it just enforces no domain constraints beyond core hygiene (unique
IDs, resolvable cross-references, well-formed `Id:` values).

### 9. Entry-source pipeline

The core defines an **entry-source abstraction**: an interface over places
entries come from. The Markdown parser is one implementation. Other adapters
(tree-sitter-backed doc-comment extractors for Rust/Kotlin/C/C++/Java/etc., SBOM
ingesters, ECAD/PLM connectors) plug in via the same interface.

Once extracted, an entry is shape-indistinguishable from a Markdown-authored
one. Provenance captures the source ("extracted from `src/foo.rs:42`", "ingested
from `syft` CycloneDX output"). No entry type is privileged by its source.

Adapters ship as **bundled extensions** (default language pack) or as separate
packs. The tree-sitter runtime itself lives in core (also used for code-block
syntax highlighting in rendering); specific grammars and extraction rules are
profile/extension territory.

Specification of the default language pack, SBOM delegation, and the adapter API
is deferred to **ADR-011** (Language pack + dependency ingestion).

### 10. Core-only mode

Without any profile loaded, the core provides:

- Parsing of Markdown + GFM subset (per ADR-001).
- Entry recognition: both shapes discriminated by `Id:` value format.
- Display-ID uniqueness and cross-reference resolution as hygiene checks.
- `Supersedes:` / `Superseded-by:` retirement (the one baked-in relation).
- Typography, rendering, deck/book output.
- Tree-sitter runtime for syntax highlighting in code blocks.

Core-only mode is a legitimate use case — a tech-writer persona who wants stable
IDs, cross-references, and high-quality print output without compliance
vocabulary. A small **default profile** layered on top (specified in ADR-010)
adds generic types (`requirement`, `note`, `section`, `reference`) and universal
hygiene rules grounded in RFC 2119 / BCP 14 normative language conventions —
without introducing ASPICE/ISO scaffolding.

### 11. Default and compliance profiles — stacking

The intended layering is:

```text
core (mechanism)
  │
  └─ default profile (generic types, RFC 2119 hygiene)    ← ADR-010
       │
       └─ compliance profile (ASPICE, ISO 26262, IEC 62304, …)
            │
            └─ organization / team / project profile    ← ADR-008 extends:
```

`extends:` chain semantics (ADR-008 §5) apply at every layer: additive for
vocabulary, tightening for constraints, never relaxing. Core-only mode is
equivalent to "no profile"; default-profile mode is equivalent to "default only,
no compliance stack".

### 12. Rebuttal of ADR-008 §8

ADR-008 §8 rejected a single-`Id:`-with-inference variant for four reasons. Each
is addressed by the model above:

1. **"Introduces a multi-input resolution cascade (value shape, discriminator
   attribute, display-ID TYPE prefix, profile map)."** The cascade collapses to
   a single input: the `Id:` value. ULID regex and URI-with-scheme regex are
   disjoint. No display-ID prefix, no profile map, no discriminator attribute
   participates in shape resolution.
2. **"Breaks core-only mode (no profile needed to parse entries correctly)."**
   Core-only mode is preserved: `Id:` is core-reserved, its two value formats
   are core-defined, and shape resolution completes without consulting any
   profile.
3. **"Worsens error messages; an explicit `Test-id` says what it is."** Under
   the new model, "missing `Id:`" is a single-source diagnostic. "Malformed
   `Id:` — expected ULID or URI" is concrete. Type-level diagnostics
   (`missing
   \`type: test\`` on an identified entry) are separate from
   identity diagnostics and come from profile rules.
4. **"Would invalidate the PR #217 migration shipped earlier in April 2026."**
   MarkSpec has not shipped and has no backward-compatibility obligations. PR
   #217 is reverted by the entry-model revision accompanying this ADR. No
   migration command is provided; legacy content (if any exists) is rewritten by
   hand. See §Consequences — "What this ADR enables".

ADR-008 §8 is superseded by this section.

## Consequences

### What this ADR enables

- A core model that is both tech-writer-friendly (no compliance vocabulary
  required) and compliance-ready (all the scaffolding is available the moment a
  compliance profile is loaded).
- A single, sharp rule for scope decisions: mechanism vs. policy. Every "does
  this belong in core?" question reduces to "is this universal machinery or
  domain-specific vocabulary?".
- A stable core-contract surface (`Id:`, two shapes, typed edges, generic
  attribute schema) that profiles extend without the core chasing domain
  specificity.
- A credible path to shipping MarkSpec as either an authoring tool with optional
  enforcement, or a full compliance tool — without forking the codebase or
  positioning around a single persona.

### What shifts for the code (not yet implemented)

- Entry-parser: drops four-attribute family recognition (`Spec-id` / `Test-id` /
  `Element-id` / `Reference-id` → family lookup) in favor of one-attribute
  format discrimination (`Id:` value → ULID vs URI).
- Entry model: one shape field (`identified | referenced`) replaces the
  four-family enum.
- Attribute catalog in core: reduces to the short universal set (`Id`, `Labels`,
  `References`, `External-id`, `Supersedes`, `Superseded-by`, `Deprecated`) plus
  the built-in `Supersedes:` relation. Everything else moves to the default
  profile (ADR-010) or to compliance profiles.
- Tooling: MarkSpec has not shipped and supports no backward compatibility;
  legacy content under the pre-boundary model (if any exists in fixtures or
  examples) is rewritten by hand. No migration command is introduced.

### What does _not_ change

- Markdown format (ADR-001) — unchanged.
- Document structure (ADR-007) — front matter remains the document-metadata
  carrier; `document-id` and `document-type` keep their current shape. The
  `document-id` value follows the same ULID-or-URI rule as entry `Id:`.
- Book structure (ADR-004) — unchanged; the four book parts (Product /
  Architecture / Guide / Verification) are an authoring convention, not a core
  concept.
- CLI architecture (ADR-005) — unchanged.
- Profile distribution mechanics (ADR-008 §§1–7, §§9–10) — distribution
  channels, `extends:` chain, vendoring, CLI surface, and hook-slot decisions
  are preserved.

## Dependencies

- ✅ [ADR-001 — Markdown Format](./adr-001-markdown-format.md) — trailer syntax,
  entry block form.
- ✅ [ADR-002 — Entry Model](./adr-002-entry-model.md) — attribute-origin
  taxonomy, value types, retirement semantics (reused; family-specific sections
  revised).
- ✅ [ADR-008 — Profile System](./adr-008-profile-system.md) — distribution and
  extends-chain mechanics (reused; §8 superseded, vocabulary expanded for
  type-declaration duty).
- 🔗 ADR-010 — Default Profile (follow-up): the generic type set and RFC 2119
  hygiene rules shipped with MarkSpec out of the box.
- 🔗 ADR-011 — Language Pack and Dependency Ingestion (follow-up): the bundled
  tree-sitter language pack, the SBOM-tool delegation for manifest parsing, and
  the entry-source adapter API.

## Acceptance criteria

- [ ] Core parser recognizes entries via single `Id:` attribute with ULID-or-URI
      format discrimination.
- [ ] Core model carries a two-value shape field (`identified | referenced`) and
      no four-family enum.
- [ ] Core attribute catalog reduced to the universal set; all family-specific
      attributes relocated to a profile.
- [ ] Cross-reference resolution operates on identity values without consulting
      profile vocabulary.
- [ ] Core-only mode (no profile loaded) produces a well-formed model with only
      hygiene diagnostics.
- [ ] Revisions to ADR-002, ADR-006, ADR-007, ADR-008 land alongside this ADR,
      with cross-references updated.
- [ ] No migration command exists; the pre-boundary `markspec migrate` surface
      and its tests are removed from the code.

## Out of scope (future ADRs)

- **Default profile specification** — the generic type set (`requirement`,
  `note`, `section`, `reference`), hygiene rules, RFC 2119 anchoring, and
  display-ID patterns for the out-of-box experience. **ADR-010**.
- **Language pack and dependency ingestion** — bundled tree-sitter grammars,
  per-language doc-comment conventions, SBOM-tool delegation (Syft / cdxgen),
  `pkg:` identity for dependencies, hardware BOM ingestion. **ADR-011**.
- **Profile hooks** — code extension points for parser, LSP, MCP. **ADR-012**
  (renumbered from ADR-009 slot previously reserved by ADR-008).
- **Display-ID pattern grammar extensions** — slug placeholders, per-type scope
  counters, domain sub-scoping beyond the minimum `{n:03d}` form.
