# ADR-011: Language Pack and Dependency Ingestion

Status: Proposed\
Date: 2026-04-20\
Scope: MarkSpec\
Depends on: [ADR-008 — Profile System](./adr-008-profile-system.md),
[ADR-009 — Core / Profile Boundary](./adr-009-core-profile-boundary.md),
[ADR-010 — Default Profile](./adr-010-default-profile.md)

## Context

ADR-009 introduces an **entry-source abstraction**: entries in the MarkSpec
model may come from anywhere — Markdown files, source code doc comments,
dependency manifests, SBOM reports, ECAD/PLM exports — through a uniform
pipeline. Markdown is the canonical source; everything else is an adapter.

Two practical questions follow: which languages does MarkSpec parse out of the
box, and how does it learn about a project's third-party dependencies without
re-implementing every ecosystem's package-manager manifests? This ADR answers
both.

The decisions rest on three observations:

- **Syntax highlighting is table stakes.** The tree-sitter runtime is useful
  independent of entry extraction — every code block in rendered output wants
  grammar-based highlighting. The runtime has to live in the core for that
  reason alone. Language adapters for doc-comment extraction piggyback on the
  same infrastructure.
- **Dependency parsing is a solved problem.** Syft, cdxgen, and the wider SBOM
  ecosystem already parse every mainstream manifest format into CycloneDX / SPDX
  JSON. MarkSpec should consume that output rather than maintain a parser per
  ecosystem. CycloneDX also covers hardware BOMs, so the same path extends to
  parts and HBOM use cases.
- **Coding standards are rules, not languages.** MISRA-C, AUTOSAR C++, CERT,
  HIC++ are rule sets evaluated against an existing C / C++ parse tree. They fit
  the profile-with-rules shape defined in ADR-008 and do not justify new
  language adapters.

## Decision

### 1. Tree-sitter runtime in core

The tree-sitter runtime — grammar loading, tree walking, queries — is part of
the MarkSpec core. It is exposed as a generic service to:

- Markdown code-block syntax highlighting in the rendering pipeline (runs
  unconditionally).
- Language adapters that extract entries from source code.
- Profile hooks (future ADR-012) that want to inspect parse trees.

Grammars themselves do **not** live in core. Grammars ship with language packs
or are installed by consumers. The core runtime has no built-in language
knowledge.

### 2. Default language pack — bundled, opt-out

The **default language pack** is a bundled extension: a package built into the
MarkSpec binary, registered at startup as if the consumer had installed it. It
supplies tree-sitter grammars and per-language doc-comment extraction rules for
a curated set of languages.

**Languages in v1:**

| Language   | Grammar source         | Doc-comment convention             | Manifests (via SBOM, §5)         |
| ---------- | ---------------------- | ---------------------------------- | -------------------------------- |
| Rust       | tree-sitter-rust       | `///`, `//!`, `/** */`             | Cargo.toml, Cargo.lock           |
| Kotlin     | tree-sitter-kotlin     | KDoc `/** */`                      | build.gradle(.kts)               |
| C          | tree-sitter-c          | `/** */`, `///`, Doxygen           | (ecosystem-dependent)            |
| C++        | tree-sitter-cpp        | `/** */`, `///`, Doxygen           | (ecosystem-dependent)            |
| Java       | tree-sitter-java       | Javadoc `/** */`                   | pom.xml, build.gradle            |
| TypeScript | tree-sitter-typescript | TSDoc `/** */`                     | package.json                     |
| JavaScript | tree-sitter-javascript | JSDoc `/** */`                     | package.json                     |
| Python     | tree-sitter-python     | docstrings (module/class/function) | pyproject.toml, requirements.txt |
| C#         | tree-sitter-c-sharp    | XML doc comments `///`             | .csproj, packages.lock.json      |

Go is **deferred**. Cloud-native tooling has weaker overlap with MarkSpec's
authoring and enforcement personas; Go support can be added as an opt-in pack if
demand emerges.

**Opt-out.** A consumer disables the default language pack with
`default-language-pack: false` in `.markspec.yaml`. Useful for minimal
tech-writing projects that do not want the binary size or the extractor
overhead.

**Custom packs.** Consumers install additional or alternative language packs
through the ordinary profile-distribution channels (local path, git, npm). A
pack is a profile (per ADR-008) that declares grammars and extractors in its
manifest and optionally ships them in its bundle. Rule-profiles (§6) compose
with whatever adapters are active — default pack, custom pack, or both.

### 3. Entry-source adapter API

Each language adapter in a pack implements the entry-source interface specified
(in detail) by a follow-up ADR. At the architectural level the contract is:

```text
adapter.detect(path) -> yields (entry-shape, identity, attributes, provenance)
```

- Given a path to a file the adapter recognizes, it walks the tree-sitter parse
  tree and yields MarkSpec entries.
- Each yielded entry carries its **provenance** (source path, line, column,
  language, extraction rule) as properties, not as authored attributes (per
  ADR-009 §4).
- Each yielded entry carries a **shape** (identified or referenced) and a
  `type:` value that the active profile recognizes.

Default-pack extractors follow a consistent pattern: a doc-comment attached to a
code declaration yields an **identified** entry with a type drawn from the
language pack's convention (`type: unit` for a function or method,
`type: module` for a package-level declaration). An `import` / `use` / `require`
/ `#include` statement optionally yields a **referenced** entry whose identity
is a purl (§5) or language-specific URI.

### 4. Language-pack extraction scope

The default pack's extractors are conservative by default. They emit entries
for:

- Declarations that carry a doc comment (identified, `type: unit` or
  equivalent).
- Imports / external references at the module level (referenced, identity = purl
  when resolvable).

Extractors do **not** attempt to emit entries for every declaration. Authors opt
into extraction by writing a doc comment; silent walls of auto-generated entries
would pollute the model and flood cross-reference resolution.

**Compliance profiles may tighten this.** An ASPICE profile can declare that
every function in a subsystem requires a doc-comment-backed identified entry or
a `Realizes:` link (ADR-008 traceability rules). The default pack supplies the
extraction; the compliance profile supplies the requirement.

### 5. Dependency ingestion — SBOM delegation

MarkSpec does not parse ecosystem manifest formats (Cargo.toml, package.json,
pom.xml, pyproject.toml, .csproj, …) natively. Instead, it delegates to external
SBOM generators that already handle every mainstream ecosystem.

**Tooling.** The supported SBOM producers in v1 are:

- **[Syft](https://github.com/anchore/syft)** — language- and ecosystem-agnostic
  SBOM generator, produces CycloneDX and SPDX.
- **[cdxgen](https://github.com/CycloneDX/cdxgen)** — OWASP CycloneDX's
  generator with broad ecosystem coverage.

Either tool satisfies the dependency-ingestion input contract: CycloneDX or SPDX
JSON. Both tools are distributable, scriptable, and ubiquitously deployed in
security-scanning pipelines.

**Invocation — compile-time, config-driven.** There is **no standalone
`markspec deps ingest` subcommand.** Dependency ingestion runs as part of
`markspec compile` when enabled in `.markspec.yaml`:

```yaml
# .markspec.yaml
deps:
  ingest: true # enable SBOM-based dependency ingestion
  tool: syft # or: cdxgen
  include: ["Cargo.toml", "package.json"] # optional path allowlist
```

During `markspec compile`, the configured SBOM producer is invoked against the
project root, its CycloneDX / SPDX JSON output is parsed, and one **referenced**
entry per package component is emitted into the compiled model along with typed
**`depends-on`** edges between them.

Caching behavior (hash of manifest inputs, re-use across runs), retry semantics,
and per-tool flags are implementation detail to be specified with the other
entry-source APIs.

When `deps.ingest:` is absent or `false`, `markspec compile` ingests no
dependencies and emits no `depends-on` edges. SBOM tooling is never required for
a project that does not opt in.

**Identity — purl.** Dependency entries use Package URL (**purl**, per the
purl-spec) as the `Id:` value:

```text
Id: pkg:cargo/serde@1.0.0
Id: pkg:npm/lodash@4.17.21
Id: pkg:pypi/requests@2.31.0
Id: pkg:maven/org.apache.commons/commons-lang3@3.14.0
Id: pkg:nuget/Newtonsoft.Json@13.0.3
```

purl values are valid RFC 3986 URIs (scheme `pkg:`), so they fit the ADR-009 §2
identity contract unchanged. Discrimination via the URI scheme classifies them
as referenced entries.

**Relation — `Depends-on`.** The core recognizes `Depends-on:` as a relation
name when a profile declares it. The default profile does **not** declare it
(dependency relationships are domain vocabulary). Compliance profiles (ASPICE,
ISO 26262, IEC 62304 SOUP) declare `Depends-on:` with their specific semantics.
The SBOM ingester emits the edges; the active profile decides what rules apply
to them.

**Attributes from SBOM.** The ingester populates:

- `Id:` — purl, as above.
- `Licenses:` — from CycloneDX/SPDX license fields (list of SPDX license IDs).
- `Description:` — package description when present.
- Provenance properties: source manifest path, SBOM tool, SBOM generation
  timestamp.

Compliance attributes (SOUP class, risk rating, verification evidence, safety
impact) are **not** populated by the ingester. They are authored — or populated
by a compliance profile hook — on top of the ingested referenced entries.

### 6. Rule-profiles — standards on top of adapters

Coding standards that constrain what is acceptable in a given language (MISRA-C,
MISRA-C++, AUTOSAR C++, CERT C/C++, HIC++, SEI coding rules, …) are profiles,
not language adapters. They ship rules evaluated by the core rule evaluator
(ADR-009 §8) against the parse tree produced by the active C / C++ adapter.

A rule-profile manifest looks structurally identical to any other profile
(ADR-008) but populates `rules:` with AST-shaped conditions rather than relation
constraints:

```yaml
# hypothetical — rule grammar specified by a follow-up ADR
profile:
  rules:
    - id: misra-c-15.1
      source: c
      pattern: goto_statement
      severity: warning
      description: The goto statement should not be used (MISRA-C 15.1)
```

Rule-profiles compose freely with compliance profiles. An ASPICE profile that
extends a MISRA-C rule-profile gets both traceability rules and static-code
rules from one `extends:` chain.

The rule grammar, AST query language, and diagnostic surface for code-shaped
rules are deferred to a follow-up ADR. This ADR reserves the pattern.

### 7. Hardware BOM and ECAD sources

The same ingestion pipeline extends to hardware:

- **CycloneDX hardware components** and **SPDX 3.0 hardware profile** are
  consumed by the same compile-time ingestion pipeline described in §5.
- **Parts** (catalog components) are emitted as referenced entries with a
  purl-like identity scheme (`pkg:hardware/...`, supplier catalog URIs, or
  profile-declared part-ID schemes).
- **Internally-specified parts** (assemblies, components declared by the
  project) are authored as identified entries with ULIDs, or extracted from
  ECAD/PLM exports via a profile-provided adapter.
- Relations specific to parts (`part-of`, `composes`, `substitutes`,
  `supplied-by`) are profile-declared.

Compliance profiles for hardware-involving domains (IEC 62304 medical device
software, ISO 26262 automotive) declare the dependency/parts relations and the
SOUP/component classification attributes they need. The core and default pack
provide the ingestion; the compliance profile provides the semantics.

## Consequences

### What this ADR enables

- Out-of-box language coverage for nine languages that between them account for
  most industry software work relevant to MarkSpec's personas.
- A first-class dependency story without MarkSpec maintaining N ecosystem
  parsers — the SBOM ecosystem carries that weight.
- A clean separation between parsing (core + pack) and rules (profile) that
  makes coding-standard support mechanical to add: one profile per standard, all
  running on the same adapter trees.
- A uniform pipeline for software and hardware BOMs, so compliance profiles in
  domains like medical devices and automotive can cover both without the tool
  chasing domain specificity.

### What shifts for existing code (not yet implemented)

- The existing language-grammar registration code relocates behind the
  entry-source adapter API.
- `markspec compile` gains a compile-time dependency-ingestion step gated by
  `.markspec.yaml` `deps.ingest:` configuration; no new top-level subcommand is
  introduced.
- SBOM-tool invocation is an external-process call; tests and CI pipelines that
  exercise ingestion need at least one producer installed. A consumer-friendly
  error path is required when `deps.ingest` is enabled but no configured
  producer is available.

### Trade-offs accepted

- **Default pack size.** Nine tree-sitter grammars add measurable weight to the
  binary. The opt-out mechanism is the escape hatch for weight-sensitive users.
  Expected binary growth is acceptable given the ubiquity of each language in
  MarkSpec's target audiences.
- **External tool dependency for ingestion.** Compile-time SBOM ingestion relies
  on Syft or cdxgen when enabled. This trades a runtime dependency for the
  avoidance of N maintainer-years of manifest-parser code. The trade is
  justified because the SBOM tools are mature, widely deployed, and standardized
  on CycloneDX / SPDX. Projects that do not opt in never invoke the tools.

## Dependencies

- ✅ [ADR-008 — Profile System](./adr-008-profile-system.md) — distribution,
  manifest schema, extends-chain; language packs and rule-profiles compose via
  the profile layer.
- ✅ [ADR-009 — Core / Profile Boundary](./adr-009-core-profile-boundary.md) —
  two-shape model, entry-source abstraction, identity via ULID or URI, typed
  edges.
- ✅ [ADR-010 — Default Profile](./adr-010-default-profile.md) — out-of-box type
  vocabulary composed with the default language pack's extraction.
- 🔗 ADR-012 — Profile Hooks (future): code extension points; language packs
  with custom extraction logic use this surface.
- 🔗 Follow-up ADR — Entry-source adapter API: the formal interface contract
  referenced in §3.
- 🔗 Follow-up ADR — Code-rule grammar: AST query language referenced in §6.

## Acceptance criteria

- [ ] Tree-sitter runtime is part of the core and usable for code-block syntax
      highlighting in the rendering pipeline.
- [ ] Default language pack ships with the nine v1 languages and is loaded at
      startup unless disabled.
- [ ] `default-language-pack: false` in `.markspec.yaml` disables it cleanly.
- [ ] Each adapter yields identified entries for doc-commented declarations and
      referenced entries for imports.
- [ ] `markspec compile`, when `.markspec.yaml` sets `deps.ingest: true`,
      invokes the configured SBOM producer (Syft or cdxgen), ingests CycloneDX /
      SPDX JSON, emits purl-identified referenced entries, and emits
      `depends-on` edges.
- [ ] Dependency entries carry SBOM-sourced attributes (licenses, description)
      and provenance properties (manifest path, tool name, timestamp).
- [ ] Hardware-BOM ingestion reuses the same CycloneDX / SPDX pipeline for
      hardware components.
- [ ] At least one rule-profile (`markspec-rules-misra-c`, as a
      proof-of-concept, if scope permits) demonstrates code-rule evaluation on a
      C adapter's parse tree.

## Out of scope (future work)

- **Entry-source adapter API specification** — interface, error handling,
  caching, incremental extraction. Follow-up ADR.
- **Code-rule grammar** — the AST query language used by rule-profiles (§6).
  Follow-up ADR.
- **Go language support** — deferred, addable as an opt-in pack.
- **Ada / MISRA-Ada, SPARK, VHDL / Verilog, MATLAB / Simulink, Solidity** —
  domain-specific languages; third-party packs.
- **Native manifest parsers** — only considered as a fallback if an ecosystem
  lacks Syft / cdxgen support. Not v1.
- **Source-to-source derivation tracking beyond doc comments** — capturing
  symbol graphs, call graphs, and data-flow relations from tree-sitter output.
  Deferred until a concrete compliance use case demands it.
- **Rule-profile ADRs per standard** — MISRA-C, MISRA-C++, AUTOSAR C++, CERT,
  HIC++ as individual profile specifications. Each is a separate follow-up.
