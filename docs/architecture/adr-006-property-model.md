# ADR-006: Property Model

Status: Proposed\
Date: 2026-04-17\
Scope: MarkSpec\
Depends on: [ADR-002 — Entry Model](./adr-002-entry-model.md)

## Context

ADR-002 introduces a two-tier model for entries:

- **Attributes** — language-level facts authored in source (`Spec-id`,
  `Derived-from`, `Status`, …) or generated at build time from inverse relations
  (`Verified-by`, `Cited-by`, …).
- **Properties** — model-level observations about an entry: where it lives in
  the repository, when it was created, who has touched it, how an external
  system tracks it. Properties are never authored in source, never round-trip
  through `markspec format`, and do not appear in git diffs.

ADR-002 defines the concept and lists four property categories (`file`, `git`,
`sync`, `build`) without specifying how they are captured, represented in the
model, or exposed to downstream consumers.

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
- 🔗 Related: profile document format ADR (profile-declared properties), in-code
  entries ADR (file properties for code-authored entries)

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
