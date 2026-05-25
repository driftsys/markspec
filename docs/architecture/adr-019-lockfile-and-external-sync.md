# ADR-019 — Lockfile and external sync — design decisions for v1.0

Status: Accepted (2026-05-25)\
Supersedes: none\
Related: [ADR-002 (entry model)], [ADR-006 (property model)], [ADR-012
(diagnostic codes)], specs `markspec-lockfile.md` and
`markspec-external-sync-model.md`.

## Context

The v1.0 cycle ships the lockfile and external-sync-model specs together in one
PR (they unlock each other's value; standalone lockfile pins near-nothing for
current users, and sync §4 requires the lockfile's bound-entry record). The two
specs carried 10 open questions (5 each) between them. This ADR records the
architectural calls — the rationale lives here so it isn't lost when the specs
themselves get further edited.

## Decisions

### 1. Canonical edge model, not file bytes (lockfile OQ4)

The `generated-cache.edges-hash` records sha256 of a canonical edge projection —
sorted `(source, relation, target, provenance)` quadruples, RFC-8785-style
canonical JSON — **not** the bytes of compile-output's `edges.ndjson` artifact.
This decouples lockfile churn from any future compile-output serialization
changes. The NDJSON is one projection of the edge graph; the hash represents the
content.

### 2. Shared resolution layer `resolveUpstreams`

Both `markspec lock` and `markspec compile` consume the same
`resolveUpstreams()` function (in `core/lock/resolve.ts`). One resolution
pipeline, three call-sites (`lock`, `compile --frozen` for drift check,
`compile` no-flag for federated registry pinning). Callbacks (`fetchUrl`, `now`)
make the function unit-testable without network.

### 3. Pin exactly, do not auto-discover (lockfile OQ1)

`markspec lock` records what the author wrote (`urn:iso:…:ed-2` → pin `ed-2`,
hash the bytes if `Reference-url:` is set). Per-scheme discovery (chasing
iso.org for latest editions) is registry territory, out of scope.
`markspec lock --update` is the explicit "move the pin" verb.

### 4. Defer per-scheme hash canonicalization (lockfile OQ2)

MVP hashes raw fetched bytes. HTTP re-render → false-positive drift is a known
limitation documented in CHANGELOG. Per-scheme canonicalizers (PDF text-extract,
HTML DOM normalize, purl tarball) ship as separate ADRs when concrete consumers
materialize. The vendor-mirror path (also deferred) sidesteps this for archival
projects.

### 5. `Reference-url:` promoted to core universal attribute

Required for `markspec lock` to work universally regardless of which profile a
project uses. Small language-spec amendment (§2.3 Reference entries); other
Reference convenience attributes (`Reference-document:`, `License:`) stay
profile-declared.

### 6. `newest-wins` conflict policy dropped from MVP (sync OQ2)

No external system clock can be trusted by default (timezones, NTP drift, server
clock skew, batched update timestamps). Vocabulary is `manual` (default) /
`local-wins` / `remote-wins` plus per-direction sensible defaults. Revisit
post-1.0 when a real consumer demands it, with a per-system
`clock-trustworthy: true` opt-in.

### 7. Multi-system binding: at most one local writer per attribute (sync OQ5)

When an entry binds to multiple external systems via repeated `External-id:`
attributes, at most one of those systems can write locally (`inbound` or
`bidirectional` direction) to any given MarkSpec attribute. Multiple `outbound`s
are allowed (all push the same local value). Violations rejected at mapping load
via `MSL-S020`. Fail-fast at config time rather than discovering corruption at
sync time.

### 8. Sync log: append-only, never rotated by MarkSpec (sync OQ4)

`.markspec/sync/<system>/log.ndjson` is the evidentiary record. Rotation defeats
audit. External tools (logrotate, journald, cron) handle volume control when
needed. No `retention:` field in mapping schema. Revisit post-1.0 only if a
consumer with a regulator-approved rotation policy demands it.

### 9. Vendoring deferred post-1.0 (lockfile OQ3)

`markspec lock --vendor` and `.markspec/vendor/` mirroring are deferred out of
the v1.0 cycle entirely. The lockfile format reserves no field for vendoring;
when added post-1.0, a schema bump records the addition.

## Consequences

- Reviewer surface: ~3350 LoC PR (largest of the cycle but coherent value story)
- New diagnostic surface: `MSL-L###` + `MSL-S###` (catalogued in ADR-012)
- Two spec amendments are formally breaking (drop `newest-wins`, promote
  `Reference-url:`) — documented in CHANGELOG `### Breaking`
- Standalone lockfile remains near-empty for non-compliance pre-1.0 projects;
  combined-with-sync value justifies the engineering cost
