# MarkSpec — External Sync Model

Status: Draft (Prompt 7 of the next-gen refactor — Stage 2)\
Scope: the **common data model** for syncing entries with external systems
(Jira, DOORS, Jama, Codebeamer, PLM, …) — **not** any per-tool connector\
Date: 2026-05-17\
Builds on: core-data-model (Prompt 1 — `External-id` §1.4, value types §1.8,
generated provenance §1.6), profile-schema (Prompt 2), lockfile (Prompt 7 —
locked-attribute pinning), background-indexing (Prompt 7 — `sync.*` excluded
from the index); ADR-002 (`External-id`, `sync` properties), ADR-006 (property
model — `sync.*` §1, sync connector model §4, caching §5), ADR-011 (ingestion),
ADR-012 (diagnostic codes)

One of four sibling Prompt-7 specs
([compile-output](markspec-compile-output.md), [lockfile](markspec-lockfile.md),
[background-indexing](markspec-background-indexing.md)). **Not unified with
them** (compile-output §1.2). This spec freezes the _common_ sync data model.
**Per-tool connectors are out of scope — each is its own ADR** (ADR-006
§Out-of-scope). If this line blurs, MarkSpec becomes a sync framework, which is
a different product (Prompt-7 Context).

---

## 0. Terminology

| Term                 | Meaning in this spec                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **external system**  | A requirements/ALM/PLM tool the project mirrors entries to/from (Jira, DOORS, Jama, Codebeamer, PLM, a ReqIF export).                      |
| **connector**        | The per-system implementation (API calls, field maps, auth). **Out of scope here**; each connector is a separate ADR.                      |
| **`External-id`**    | The core universal attribute binding an entry to its identifier(s) in external systems (core-data-model §1.4; value type `external-id`).   |
| **mapping file**     | `.markspec/sync/<system>.yaml` — the project-authored schema binding MarkSpec attributes ↔ external fields (§3). The connector's contract. |
| **locked attribute** | An attribute that, while the entry is bound to an external system, is owned upstream and read-only locally (§4).                           |
| **sync log**         | `.markspec/sync/<system>/log.ndjson` — the append-only audit trail of sync operations (§7).                                                |

---

## 1. Scope — ruthless core/connector split

Per the Prompt-7 Context, the line is drawn hard:

| **Core (this spec owns)**                 | **Connector (separate ADR per tool)**             |
| ----------------------------------------- | ------------------------------------------------- |
| `External-id` attribute semantics (§2)    | Every per-tool API call                           |
| Sync directions & their model (§2.3)      | Every field-value transformation                  |
| `mapping.yaml` **schema** (§3)            | The concrete field map _content_ for a given tool |
| Locked-attribute inference & lint (§4)    | Authentication / credential flows                 |
| Conflict-resolution **policy** model (§5) | The conflict UI                                   |
| Cache **shape** & TTL semantics (§6)      | The wire protocol / pagination                    |
| Audit-log **shape** (§7)                  | Rate limiting, retries, tool quirks               |

A proposal that adds tool-specific knowledge to this spec is rejected by
construction. **Why a separate spec (anti-unification):** the sync log is
append-only audit that may carry external-system data (a distinct security
posture); the compile output is published, the lockfile committed, the index
disposable (compile-output §1.2 table).

## 2. `External-id` and sync directions

### 2.1 `External-id` semantics

`External-id` is core (core-data-model §1.4), value type `external-id`
(repeatable, `scheme:value`, core-data-model §1.8 / ADR-002). One entry may bind
several systems:

```text
External-id: jira:PROJ-1423
External-id: doors:/Project/Reqs/REQ-107
```

The `scheme` selects which `mapping.yaml` / connector applies. `External-id` is
**authored** (the binding is a project decision); the _state_ of that binding is
observed as `sync.*` **properties** (`last_synced_at`, `remote_state`,
`external_source` — ADR-006 §1), never authored, never round-tripped
(core-data-model §5; ADR-002 properties).

### 2.2 `remote_state` taxonomy

`sync.remote_state` (ADR-006 §4) is fixed here as a closed vocabulary: `ok` ·
`ahead` (local edits not pushed) · `behind` (upstream edits not pulled) ·
`conflict` (both sides changed) · `deleted-upstream` · `unreachable` (sync
attempted, system unavailable) · `unbound` (no live binding). Connectors map
their tool state into this vocabulary; consumers (lint, matrix, LSP status) read
only this vocabulary.

### 2.3 Sync directions

| Direction         | Meaning                                                                                | Locked attributes (§4)                         |
| ----------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **outbound**      | MarkSpec is source of truth; the external system mirrors it.                           | none (local is authoritative)                  |
| **inbound**       | The external system is source of truth; entries are projected read-only into MarkSpec. | all mapped attributes                          |
| **bidirectional** | Both author; conflicts possible and resolved per §5.                                   | per-attribute, declared in `mapping.yaml` (§3) |

Direction is declared per system (and optionally per attribute) in the mapping
file. Inbound entries carry `Origin: synthesized`-class provenance
(core-data-model §1 / ADR-003 §Part 4) so `fmt`/`compile` know they are
externally owned.

## 3. Mapping file schema — `.markspec/sync/<system>.yaml`

This spec defines the **schema**; a connector ADR supplies the values.

```yaml
system: jira                       # scheme used in External-id
direction: bidirectional           # outbound | inbound | bidirectional (§2.3)
identity:
  external-id-scheme: jira         # which External-id scheme binds here
attributes:                        # MarkSpec attr ↔ external field
  - markspec: Title
    external: summary
    direction: bidirectional
  - markspec: Derived-from
    external: customfield_parent
    direction: outbound
  - markspec: Labels
    external: labels
    locked: true                   # upstream-owned while bound (§4)
conflict:
  default: manual                  # §5 — manual | local-wins | remote-wins | newest-wins
cache:
  ttl: 15m                         # §6
```

### 3.1 ReqIF MCP-server approach

For ReqIF (the common DOORS/Jama interchange), a connector ADR will define an
**MCP server** whose tool an agent calls to _analyze a ReqIF export and emit a
`mapping.yaml`_. This spec defines **only the `mapping.yaml` schema** the agent
must produce (above) — **not** the agent prompt, the ReqIF parser, or the MCP
tool surface (those are the ReqIF connector ADR). The schema is the contract;
generation of an instance of it is connector territory. (This is the one place
the brief names a mechanism; the boundary still holds — we own the target
schema, not the generator.)

### 3.2 Options analysis — mapping file format & location

| Decision                                            | Alternative                       | Why rejected                                                                                                                                                                                                                                                               |
| --------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YAML at `.markspec/sync/<system>.yaml` (**chosen**) | A `sync:` block in `project.yaml` | Per-system files isolate blast radius, allow per-system git history/ownership, and keep `project.yaml` from becoming an n-system god-object. Mirrors `.markspec/sync/<system>/…` cache+log locality.                                                                       |
| YAML (**chosen**)                                   | TOML / JSON                       | Authored by humans (and agents emitting human-reviewable config); YAML matches the profile-manifest authoring convention (profile-schema). Distinct from the lockfile (tool-written → TOML, lockfile §2.1) — different author, different choice, deliberately not unified. |
| One file per system                                 | One file, all systems             | A multi-system god-file conflates security postures (one system's token-scoped fields beside another's) and update cadences — the same anti-unification logic as the four artifacts.                                                                                       |

## 4. Locked-attribute inference

When an entry is bound (`External-id`) under an inbound or per-attribute
`locked: true` mapping, those attributes are **owned upstream**: editing them
locally is a defect (the next sync overwrites the edit or creates a spurious
conflict).

- **Inference.** Locked set = (direction == inbound ⇒ all mapped attributes) ∪
  (attributes with `locked: true`). Computed from `mapping.yaml` + the entry's
  `External-id`; no per-tool knowledge.
- **The lockfile records which** (cross-ref: lockfile spec). `markspec
  lock`
  records, per bound entry, the locked-attribute set and the upstream value hash
  at lock time — so a trace audit can prove a locked attribute was not locally
  tampered with (lockfile spec §1 framing). The sync model _infers_ the set; the
  lockfile _pins_ it. Two specs, one fact, no duplication (anti-unification).
- **Lint flags edits to locked attributes.** A locally modified locked attribute
  is a diagnostic (ADR-012 catalogue — a `sync`/`MSL-?` locked-edit code; exact
  code §9 OQ). It is a **warning** locally (the author may be staging an
  intentional upstream change) and an **error** in CI / `--locked` (parity with
  lockfile spec §5: integrity guarantees are hard in CI).

## 5. Conflict resolution

A conflict is: local and upstream both changed a mapped attribute since
`last_synced_at` (detected by comparing hashes against the lockfile's recorded
upstream hash — §4 / lockfile spec §3, not by trusting timestamps).

- **Policy is configurable; default is `manual`.** Vocabulary: `manual` (default
  — record the conflict, change nothing, surface it), `local-wins`,
  `remote-wins`, `newest-wins` (by upstream change timestamp, only where the
  connector supplies a trustworthy one).
- `manual` writes a conflict record to the sync log (§7) and sets
  `sync.remote_state = conflict` (§2.2); it never silently picks a side.
  Auto-resolution is opt-in per system/attribute in `mapping.yaml`.
- The **resolution UI is connector/tooling territory**; this spec fixes only the
  policy vocabulary and that `manual` is the safe default (ADR-006
  §Out-of-scope: "UI for resolving sync conflicts — tooling concern").

## 6. Caching, generated-attribute provenance, privacy

- **Cache.** `.markspec/sync/<system>/cache/` holds the last fetched upstream
  snapshot per bound entry, with a per-system `ttl` (§3, default 15m; ADR-006
  §5). The cache makes offline work and conflict detection possible without
  re-hitting the API every command. It is **disposable** (rebuilt on next online
  sync) — like the index (background-indexing §7), unlike the lockfile.
- **Generated-attribute provenance: local vs external.** A generated inverse
  (core-data-model §1.6) computed from _local_ edges is `provenance: local`; one
  whose endpoint is an inbound/external entry is `provenance: external`. Compile
  output (compile-output §4.6) and the matrix surface this so an auditor
  distinguishes a locally-derived trace from an upstream-asserted one. The flag
  is core model; the _value_ comes from the connector.
- **Privacy — what stays local / logged / cached.** `External-id` (authored, in
  source) and `sync.*` properties are repository-internal. The **cache** and
  **log** under `.markspec/sync/` are **git-ignored by default** and **never
  enter the published `/api/`** (compile-output §6 hard-excludes `sync.*`) **nor
  the local index** (background-indexing §8 excludes `sync.*`). Credentials live
  in the environment/connector, **never** in `mapping.yaml`, the cache, the log,
  or the lockfile (parity across all four specs). External-system payload in the
  cache/log is the one place tool data lands on disk; it is local, ignored, and
  TTL-bounded by construction.

## 7. Audit trail — `.markspec/sync/<system>/log.ndjson`

Append-only, one JSON object per sync operation:
`{ ts, op (push|pull|conflict|resolve), entryId, externalId, direction,
attrsChanged[], remoteStateBefore, remoteStateAfter, hashBefore,
hashAfter, actor }`.
NDJSON because it is append-only and streamable (the same reasoning as
compile-output entries, different artifact — a sync log is _audit_, not a
published graph; not unified). It is the evidentiary record for "when did this
entry diverge from Jira and who reconciled it", the sync-side analogue of the
lockfile's trace-audit guarantee. Rotation / retention is a tooling concern (§9
OQ); the **shape** is fixed here.

## 8. Versioning & compatibility

- `mapping.yaml` carries `schema:` (its own format version, independent of
  `markspec-schema`). A newer mapping schema read by an older binary is a hard
  error (a half-understood field map silently mis-syncs — the worst failure for
  a system of record).
- **Pre-1.0:** the mapping/log/cache formats may change without a migration path
  (project decision, 2026-05-17 — no migration/back-compat tooling until 1.0).
  Consistent and cheap because cache + log + inferred locked-set are
  **regenerable** (re-sync rebuilds the cache; the log is append-only and append
  continues; only `mapping.yaml` is hand-authored and a format bump is a
  documented hand-edit, not a tool migration — acceptable pre-1.0). The
  cross-version guarantee binds at 1.0.

## 9. Open questions

Capped at five.

1. **Locked-edit diagnostic code.** §4 needs a code for "edited a locked
   attribute". New ADR-012 `sync` category, or reuse `MSL-A` (attribute)? It
   must be distinguishable from an ordinary attribute error because its CI
   semantics differ (lockfile-tied).
2. **`newest-wins` clock trust.** §5 allows timestamp-based resolution only
   where the connector supplies a trustworthy clock. Is a per-connector "clock
   trustworthy?" declaration part of the `mapping.yaml` schema (core) or a
   connector-ADR concern?
3. **Inbound entries and `fmt`.** §2.3 inbound entries are upstream-owned. Does
   `fmt` skip them entirely, format-but-not-reorder, or treat them like
   `Origin: synthesized` (core-data-model §6 OpenQ4 territory)?
4. **Log retention.** §7 log is append-only and unbounded. Is
   rotation/compaction in scope for the _model_ (a `maxBytes`/`maxAge` in
   `mapping.yaml`) or strictly tooling?
5. **Multi-system binding of one entry.** §2.1 allows several `External-id`s. If
   two systems both map `Title` bidirectionally and disagree, is that a §5
   conflict, a configuration error rejected at `mapping.yaml` load, or a
   documented precedence order?

## Annex — Cross-reference summary

| Section | Source                                                                                        |
| ------- | --------------------------------------------------------------------------------------------- |
| §1      | Prompt-7 Context (core/connector split); ADR-006 §Out-of-scope; compile-output §1.2           |
| §2      | core-data-model §1.4 / §1.6 / §1.8 / §5; ADR-002 (properties); ADR-006 §1 / §4                |
| §3      | ADR-006 §4 (connector model); ADR-011 (ingestion); profile-schema (YAML authoring convention) |
| §4      | lockfile spec §1 / §3 / §5; ADR-012; core-data-model §1.6                                     |
| §5      | ADR-006 §4 / §Out-of-scope; lockfile spec §3                                                  |
| §6      | ADR-006 §5; compile-output §6; background-indexing §7 / §8; core-data-model §1.6              |
| §7      | ADR-006 §4; compile-output §4.6 (NDJSON reasoning, distinct artifact)                         |
| §8      | profile-schema §8.2; project decision (no migration until 1.0)                                |
