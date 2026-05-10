# ADR-006: Property Model

## Context

ADR-002 introduces a two-tier model for entries:

- **Attributes** — language-level facts authored in source (`Id:`,
  `Derived-from:`, …) or generated at build time from inverse relations
  (`Verified-by:`, `Cited-by:`, …).
- **Properties** — model-level observations about an entry: where it lives in
  the repository, when it was created, who has touched it, how an external
  system tracks it. Properties are never authored in source, never round-trip
  through `markspec format`, and do not appear in git diffs.

ADR-009 §4 formalizes the dual of this distinction on the identity axis:
**identity** (ULID or URI in the `Id:` attribute, display ID, slug) is stable
across renames and refactors; **provenance** (path, module, line, commit,
extraction tool, source-type) is mutable and must never be used as identity. All
provenance facts are properties; none are attributes.

ADR-002 defines the concept and lists four property categories (`file`, `git`,
`sync`, `build`) without specifying how they are captured, represented in the
model, or exposed to downstream consumers. ADR-009 introduces a fifth
operational concern — **entry-source provenance** for entries extracted from
non-Markdown sources (doc comments in source code, SBOM ingestion, ECAD/PLM
exports) — which this ADR must also specify.

This ADR specifies the property model in detail.

## Scope

This ADR must define:

### 1. Property categories and names

Canonical property names per category:

- **`file.*`** — repository location: `path`, `line`, `column`.
- **`git.*`** — version control observations: `created_at`, `modified_at`,
  `contributors`, `revision`.
- **`sync.*`** — external connector state: `last_synced_at`, `remote_state`,
  `external_source`.
- **`build.*`** — compilation-time provenance: `resolution_source`,
  `registry_origin`.
- **`source.*`** — entry-source provenance (per ADR-009 §9 and ADR-011): `type`
  (one of `markdown`, `code`, `sbom`, `ecad`, `plm`, …), `adapter` (language
  pack / SBOM tool / custom adapter identifier), `language` (where applicable:
  `rust`, `kotlin`, `c`, …), `rule` (the extractor rule that matched, for
  debugging), `extracted_at` (timestamp of last extraction).

The `source.*` category is populated when an entry is produced by an adapter
other than the Markdown parser. Markdown-authored entries set `source.type` to
`markdown` and omit adapter-specific fields.

### 2. Observation contracts

How each property is computed:

- Git observation: which `git` commands, behavior under shallow clones,
  generated vs handwritten file policy, rename following.
- File observation: absolute vs workspace-relative path, platform separator.
- Sync observation: connector interface, polling cadence, failure semantics.
- Build observation: when properties are populated in the compile pipeline.

### 3. Property namespace in the model

Where properties live in the internal data structures:

- `entry.attributes` vs `entry.properties` — separate maps on the entry record.
- Inline reference syntax: `{{spec.SRS_X.modified_at}}` — does this reach into
  properties or only attributes?
- Serialization format for compiled artifacts (JSON schema for a properties
  object).

### 4. Sync connector model

How external systems (Jira, DOORS, Jama, Codebeamer, PLM) integrate:

- Connector authoring interface.
- Authentication and credential handling.
- Conflict detection and resolution.
- Offline behavior and stale property handling.
- `remote_state` value taxonomy (`ok`, `deleted-upstream`, `conflict`,
  `unreachable`, …).

### 5. Caching and staleness

- When to recompute properties (per-command, per-run, content-hash-based).
- Where to cache (in-memory, disk, LSP session).
- Cache invalidation triggers.
- Cross-tool sharing (LSP, CLI, MCP all observing the same properties).

### 6. Rendering surface

- Which properties appear in rendered output by default.
- How to select/filter properties for rendering.
- Traceability matrix: property-based columns (last-modified, owner from sync,
  …).

## Dependencies

- ✅ [ADR-002](./adr-002-entry-model.md) — Entry Model (attributes vs properties
  distinction)
- ✅ [ADR-009 — Core / Profile Boundary](./adr-009-core-profile-boundary.md) —
  identity vs provenance principle (§4); entry-source abstraction (§9)
- 🔗 Related: [ADR-008 — Profile System](./adr-008-profile-system.md)
  (profile-declared attributes populating the property layer),
  [ADR-011 — Language Pack and Dependency Ingestion](./adr-011-language-pack-and-dependency-ingestion.md)
  (source-category properties for code-extracted and SBOM-ingested entries)

## Acceptance criteria

- [ ] Canonical property names and categories defined.
- [ ] Observation contracts specified for git and file categories.
- [ ] Sync connector interface defined (at least one reference implementation).
- [ ] Model exposes `entry.properties` alongside `entry.attributes`.
- [ ] Inline reference syntax supports property access.
- [ ] Caching strategy documented and implemented.
- [ ] Traceability matrix supports property-based columns.

## Out of scope (future ADRs)

- Specific connector implementations (Jira, DOORS, …) — each may have its own
  ADR or remain an extension.
- UI for resolving sync conflicts — tooling concern.
