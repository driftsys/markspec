# MarkSpec — Background Indexing

Status: Draft (Prompt 7 of the next-gen refactor — Stage 2)\
Date: 2026-05-17\
Scope: the **local-only** index that backs sub-100 ms editor queries — data
model, storage, modes, concurrency, invalidation, recovery\
Builds on: core-data-model (Prompt 1 — entry/Item §1, AST §2, inline markers
§2.5, inverses §1.6, round-trip §5), profile-schema (Prompt 2),
listing-directives (Prompt 2 — glossary §4, components §5), prose-analysis
(Prompt 5 — the flagship glossary cross-check consumes this index);
ADR-001/002/003/004, ADR-006 (caching/staleness §5), ADR-012 (diagnostic codes);
LSP ground truth: `lsp/workspace.ts` (`WorkspaceIndex`), `lsp/server.ts`,
`lsp/completions.ts`

One of four sibling Prompt-7 specs
([compile-output](markspec-core-data-model.md#annex-c--serialized-form-compile-output),
[lockfile](markspec-lockfile.md),
[external-sync-model](markspec-external-sync-model.md)). **Not unified with
them** (compile-output §1.2). This spec freezes the local index; it is **not**
the published `/api/` output (that is compile-output — Annex C of the core data
model spec — different durability and audience: this is disposable and never
published).

---

## 0. Terminology

| Term                 | Meaning in this spec                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **index**            | `.markspec/index.db` — the local, disposable query accelerator. Never committed, never published.                    |
| **cold scan**        | Building the index from nothing (no db, or a corrupt one) — full project walk.                                       |
| **warm incremental** | Updating the index for the files that changed since the last run, only.                                              |
| **federated read**   | Querying a federated upstream's published `/api/` (compile-output §5) through the local index's resolver, read-only. |
| **invalidation**     | Deciding which index rows a file change makes stale — the actual hard problem (Prompt-7 Context).                    |
| **edge**             | A trace relation: authored (from source) or generated inverse (core-data-model §1.6 / ADR-003 §Part 3).              |

---

## 1. Purpose & why it is its own spec

### 1.1 Purpose

The index makes the interactive surfaces fast: **sub-100 ms** `$Identifier`
resolution (core-data-model §2.5.2), `Derived-from:` / trace-attribute
completion (`lsp/completions.ts`), and the prose-analysis flagship **glossary
cross-check** (`xref-glossary-undefined`, prose-analysis §2.8 — it resolves a
capitalized term against glossary `Definition` items; that lookup must be
index-backed to hit its <5 ms budget). It is the persistent, scalable
replacement for the current in-memory `WorkspaceIndex` (`lsp/workspace.ts`),
which rebuilds the whole project on every server start.

### 1.2 Why a separate spec (anti-unification)

The index is **disposable, local-only, per-keystroke**. The compile output is
archival/published; the lockfile is committed/slow; the sync log is append-only
audit. Conflating the per-keystroke cache with the published contract is the
six-months-elegant / years-cornered mistake the Prompt-7 Context rejects
(compile-output §1.2 table). The index may share the _schema philosophy_ of the
optional SQLite mirror (compile-output §4.3) but **not the file**: `index.db` is
never published; the mirror is never used as the editor's working store.

## 2. Storage — options analysis

| Option                                     | Rejected / chosen because                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SQLite (`.markspec/index.db`) — chosen** | The boring correct answer. Embedded, zero-config, single-file, ACID, mature WAL concurrency (§4), and **every editor/CLI/human can inspect it** with ubiquitous tooling if a query is wrong. The interesting problem is invalidation (§5), not storage — SQLite removes storage as a variable. |
| Tantivy / a full-text engine               | **Rejected.** Optimizes ranked text search; the dominant queries are exact-key point lookups (Id, displayId, edge endpoint) and prefix completion, which a B-tree index serves better and simpler. Adds a large dependency for the wrong query shape.                                          |
| RocksDB / LMDB (KV store)                  | **Rejected.** Faster raw KV, but no ad-hoc query, no human-inspectable form, and the project would hand-roll the relational queries (edges, glossary joins) SQLite gives for free. Speed it adds is below the budget headroom (§6).                                                            |
| Custom binary format                       | **Rejected.** Every reason to not invent the compile-output format (compile-output §3) applies double to a format nobody else can open. Maintenance and corruption-recovery burden with no upside over SQLite.                                                                                 |
| In-memory only (status quo)                | **Rejected at scale.** `WorkspaceIndex` reparses the whole project per server start; the §6 cold budget at 10k entries is unmet without persistence. Kept as the tiny-project fast path (§3.4).                                                                                                |

## 3. Index data model & modes

### 3.1 Tables (logical)

- `entries` — `Id`, `displayId`, resolved `Type` (core-data-model §1.3), shape,
  title, file/line (`file.*` property, ADR-006), `content_hash`.
- `edges` — `(from_id, kind, to_id, generated)`: authored relations and
  generated inverses (core-data-model §1.6 / ADR-003 §Part 3) in one table,
  `generated` flags which.
- `glossary` — `Definition` items (slug, term, file) from the glossary
  heading-shape (listing-directives §4) — backs `xref-glossary-undefined`.
- `components` — Component-typed entries keyed by their parsed Id scheme
  (listing-directives §5: `pkg`/`mfg`/`gtin`/`cpe`/`urn:*`).
- `references` — Reference-shape entries (slug, URI, `Type`) — backs
  `References:` resolution (`MSL-R085`).
- `entities` — `$Identifier` symbols (core-data-model §2.5.2) for sub-5 ms
  resolution.

### 3.2 Modes

- **Cold scan.** No db / corrupt db / schema-version mismatch (§7) → full
  project walk, parse, populate. Budget §6.
- **Warm incremental.** Watch / on-demand: only files whose mtime+hash changed
  (§5) are reparsed; only their rows + the rows their change invalidates (§5.2)
  are rewritten.
- **Federated read.** A cross-project target (compile-output §5) is resolved by
  reading the upstream's published `entries.idx` through a read-through cache
  table; **read-only**, never written back into the upstream, pinned by the
  lockfile (lockfile spec §2.2 `[[upstream.registry]]`).

## 4. Concurrency

**Single-writer, many-reader.** One writer process holds the index (SQLite WAL
mode: readers never block the writer, the writer never blocks readers). The LSP
server is the canonical writer; CLI (`compile`, `validate`) and MCP open
**read-only** and, if the index is absent/stale, fall back to a direct parse
rather than contending for the write lock (correctness without the index is
always available — §8). A stale read is acceptable for completion/hover (it
self-heals on the next incremental); it is never acceptable for
`validate`/`compile`, which therefore do not trust a stale index for a
correctness verdict (§8 OQ).

## 5. Invalidation — the actual design problem

Storage is solved (§2); **invalidation is where this is won or lost**. If the
warm path constantly invalidates itself, the cold/warm distinction is
meaningless.

### 5.1 Change detection

A file is unchanged iff `(mtime, size)` matches **and**, on a cheap mismatch, a
content `sha256` matches the stored `content_hash`. mtime is the fast gate; the
hash is the truth (mtime is unreliable across checkout/clone — git touches
mtimes without changing content; the hash prevents a spurious full reparse of an
unchanged tree, the classic self-invalidation trap).

### 5.2 Cross-file invalidation

A change is not local when it changes a **resolution target**:

- **Rename / Id change** of an entry → every edge row pointing at the old Id, in
  any file, is stale (the trace graph is global, core-data-model §1.3).
  Invalidate the changed file **plus** the reverse-edge closure of the affected
  Ids (bounded by `edges.to_id` index — not a full rescan).
- **Glossary change** (a `Definition` added/removed/renamed, listing-directives
  §4) → every entry whose prose was flagged (or cleared) by
  `xref-glossary-undefined` against that term is stale (prose-analysis §2.8).
  Invalidate by the `glossary.slug` → referencing entries reverse map, not the
  whole project.
- **Profile change** (`.markspec.yaml` / a resolved profile tier, profile-schema
  §5) → type inference (core-data-model §1.3.1) can shift for many entries →
  **cold scan** (a profile change is rare and legitimately global; pretending it
  is incremental is the self-invalidation trap in the other direction).

The rule: invalidate the **closure of what actually depends on the change**,
computed from the index's own reverse maps — never "the file" (too little,
misses cross-file) and never "everything" (too much, kills warm). This closure
is the spec's core contribution.

## 6. Performance budgets (numbers)

| Operation                           | Budget      | Basis                                                                                                                                            |
| ----------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cold index, 10 000 entries          | **< 5 s**   | parse-bound; one pass, batched inserts in one transaction.                                                                                       |
| Warm incremental, per changed entry | **< 50 ms** | reparse one file + rewrite its rows + the §5.2 closure (bounded by reverse-edge index).                                                          |
| Single-Id query                     | **< 5 ms**  | primary-key/B-tree point lookup; this is the `$Identifier` / completion hot path and the prose-analysis flagship's budget (prose-analysis §5.4). |
| Glossary cross-check lookup         | **< 5 ms**  | indexed `glossary.slug` lookup — the index exists largely to make this rule viable at scale.                                                     |

Budgets are determinism-friendly: identical project state ⇒ identical index
content (modulo `properties` observation), so warm == cold result (consistency
check in CI, §8 OQ).

## 7. Recovery & versioning

- **Corrupt index → rebuild, never block.** A failed integrity check, a
  truncated WAL, or an unreadable db ⇒ delete `index.db`, cold-scan, log one
  warning. The index is **disposable by definition**; a corrupt cache must never
  break `validate`/`compile`/the editor (those always have the source as ground
  truth — §4).
- **Schema-version row.** `index.db` stores its own format `schema` integer
  **and** the `markspec-schema` it was built under. A mismatch on either ⇒
  treated exactly as corruption ⇒ silent rebuild. No index migration is written
  — and none is needed (this is _why_ the no-migration-until-1.0 decision
  (2026-05-17) is free here: the index is regenerated from source in < 5 s, §6).
  Pre-1.0 format churn costs one cold scan.
- **Coexistence with `/api/`.** The index is local-only and never published; the
  compile output is published and never used as the editor store (compile-output
  §1.2 / §4.3). A project may have both, one, or neither; they never share a
  file and never invalidate each other.

## 8. Privacy

`index.db` lives under `.markspec/` and is **git-ignored by default** (a
generated, machine-local cache). It mirrors source content (entries, prose,
glossary) plus `file.*`/`git.*` properties — all repository-internal. It
**excludes** `sync.*` external-system state (that is the sync model's cache,
§sync spec §5, with its own TTL and locality) and any credential. Nothing in the
index is transmitted; it is never an input to the published `/api/`. A federated
read caches an upstream's _public_ `/api/` data only.

## 9. Open questions

Capped at five.

1. **Stale-index trust for `validate`/`compile`.** §4 says correctness commands
   don't trust a stale index. Do they (a) always full-parse (simple, slower CI),
   (b) trust the index iff a fast whole-project hash matches, or (c)
   verify-then-use? The CI-time cost of (a) at 100k entries may be unacceptable.
2. **Watch vs on-demand incremental.** §3.2 warm mode — file-watcher (instant,
   OS-specific, flaky on network FS) vs lazy on-query staleness check (portable,
   a small first-query latency). Which is canonical, which optional?
3. **Federated-read cache lifetime.** §3.2 read-through cache of an upstream
   `/api/` — TTL like the sync cache (sync spec §5), or pinned strictly by the
   lockfile hash (lockfile spec §3) and only refreshed on `lock --update`?
4. **Index sharing across worktrees.** A repo with multiple git worktrees (this
   project uses them — `.worktrees/`) — one `index.db` per worktree (isolation,
   N rebuilds) or a shared keyed store (one build, harder invalidation §5)?
5. **Cross-file invalidation cost ceiling.** §5.2's reverse-edge closure is
   bounded but a hub entry (compile-output §2 worst case) has a huge reverse
   set; a rename there is O(huge). Cap the closure and fall back to cold above a
   threshold, or always pay it?

## Annex — Cross-reference summary

| Section | Source                                                                                                |
| ------- | ----------------------------------------------------------------------------------------------------- |
| §1      | core-data-model §2.5 / §2.5.2; `lsp/workspace.ts` / `lsp/completions.ts`; prose-analysis §2.8 / §5.4  |
| §2      | Prompt-7 Context (SQLite "boring correct"; invalidation is the problem)                               |
| §3      | core-data-model §1.3 / §1.6; ADR-003 §Part 3; listing-directives §4 / §5; compile-output §5           |
| §4      | SQLite WAL; AGENTS.md (correctness without cache); §8                                                 |
| §5      | ADR-006 §5 (caching/staleness); core-data-model §1.3 / §1.3.1; prose-analysis §2.8; profile-schema §5 |
| §6      | Prompt-7 budgets; prose-analysis §5.4                                                                 |
| §7      | compile-output §1.2 / §4.3; project decision (no migration until 1.0); profile-schema §8.2            |
