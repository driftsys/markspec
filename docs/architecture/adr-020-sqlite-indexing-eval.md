# ADR-020 — SQLite Indexing Eval (Phase 1 of Background Indexing epic)

**Status:** Draft (Phase 1 in progress) **Date:** 2026-05-25 **Supersedes:** —
**Related:**
[markspec-background-indexing.md](../spec/internal/markspec-background-indexing.md)
(spec, all decisions ratified in PR #430 + amended in PR #434)

## Context

The Background Indexing spec freezes the design: SQLite for storage, WAL for
concurrency (§4), verify-then-use staleness (§9 Q1), on-demand incremental (§9
Q2), lockfile-pinned federated cache (§9 Q3), one index per worktree (§9 Q4 —
amended in PR #434 to live under the OS cache directory), and an
invalidation-closure cap at ≈200 (§9 Q5). Performance budgets are normative
(§6).

What the spec does **not** answer (and was never going to without measurements):

- Which SQLite driver wins on Deno (`jsr:@db/sqlite3` native FFI vs
  `jsr:@db/sqlite` pure WASM vs `node:sqlite` via Node compat).
- Which pragma set hits §6's cold-scan budget without over-trading correctness
  for speed.
- Whether WAL holds up under sustained 1-writer + 8-reader load matching the
  LSP-writer + CLI-reader topology.
- Whether SIGKILL mid-transaction leaves the db in a state the §7 rebuild path
  actually handles, or just in a state that _looks_ recoverable.
- The actual hub-rename closure-size distribution at 100k entries — the
  empirical value that the ≈200 default for `index.invalidation-cap` was guessed
  against.

Phase 1 is an investigation epic with one deliverable: this ADR, populated with
measurements + a recommendation. Phase 2 (the production indexer) does not start
until this ADR's decisions are signed off.

## Method

### Corpus

Synthetic generator, deterministic from `(seed, options)`. Three scales (1k /
10k / 100k entries) with parameterised edge density, hub ratio, glossary /
reference / component counts. See
[eval/sqlite-indexing/corpus/generator.ts](../../eval/sqlite-indexing/corpus/generator.ts).

The hub-ratio knob is the load-bearing parameter: §5.2's reverse-edge closure
and §9 Q5's cap default are both functions of how skewed the in-degree
distribution is. Production projects will sit somewhere along the curve; the
eval samples three points.

### Matrix

| Bench                         | Scales        | Variants                                                          | §6 budget                  |
| ----------------------------- | ------------- | ----------------------------------------------------------------- | -------------------------- |
| `cold_scan`                   | 1k, 10k, 100k | 4-set pragma sweep                                                | 10k < 5 s                  |
| `warm_incremental`            | 1k, 10k, 100k | body-edit, non-hub-rename, hub-rename                             | per change < 50 ms         |
| `lookups`                     | 1k, 10k, 100k | getEntryById, getEntryByDisplayId, prefix scan, getGlossaryBySlug | < 5 ms p95 (point)         |
| `size`                        | 1k, 10k, 100k | raw, post-checkpoint, post-vacuum                                 | (informational)            |
| `concurrency/wal_contention`  | 10k           | 1W + 8R sustained 60 s                                            | readers never block writer |
| `concurrency/kill_recovery`   | 10k           | kill at start / middle / end of tx                                | §7 rebuild succeeds        |
| `concurrency/schema_mismatch` | 1k            | wrong `schema`, wrong `markspec-schema`                           | §7 silent rebuild          |

40 measurement points total. Each bench writes structured NDJSON; the
orchestrator collects them and `report.ts` renders the tables below.

### Driver

Default: `jsr:@db/sqlite3` (native FFI, well-maintained, `better-sqlite3`
bindings). The bench layer talks through an abstract `IndexAdapter` interface
(see [bench/adapter.ts](../../eval/sqlite-indexing/bench/adapter.ts)) so an
alternative driver can be swapped without changing call sites. The eval will
either confirm `@db/sqlite3` is the right pick or replace it with a benched
alternative — that's an early Phase 1 sub-decision.

## Results

> **Placeholder.** Tables below are populated as Phase 1 measurements complete.

### Cold scan (§6 budget: 10k < 5 s)

| Scale | Pragma set                                  | totalMs | per-entry µs |
| ----- | ------------------------------------------- | ------- | ------------ |
| 1k    | baseline                                    | _TBD_   | _TBD_        |
| 1k    | WAL + sync=normal + cache=64MB              | _TBD_   | _TBD_        |
| 1k    | WAL + sync=normal + cache=64MB + mmap=256MB | _TBD_   | _TBD_        |
| 1k    | WAL + sync=off (upper bound, unsafe)        | _TBD_   | _TBD_        |
| 10k   | (same four)                                 | _TBD_   | _TBD_        |
| 100k  | (same four)                                 | _TBD_   | _TBD_        |

### Warm incremental (§6 budget: < 50 ms per change)

| Scale | Change type    | p50Ms | p95Ms | p99Ms | closure size (mean / max) |
| ----- | -------------- | ----- | ----- | ----- | ------------------------- |
| 1k    | body-edit      | _TBD_ | _TBD_ | _TBD_ | 1 / 1                     |
| 1k    | non-hub-rename | _TBD_ | _TBD_ | _TBD_ | _TBD_                     |
| 1k    | hub-rename     | _TBD_ | _TBD_ | _TBD_ | _TBD_                     |
| 10k   | (same three)   | _TBD_ | _TBD_ | _TBD_ | _TBD_                     |
| 100k  | (same three)   | _TBD_ | _TBD_ | _TBD_ | _TBD_                     |

### Hot-path lookups (§6 budgets: < 5 ms p95 for point queries)

| Scale | Query shape                        | p50Ms | p95Ms | p99Ms |
| ----- | ---------------------------------- | ----- | ----- | ----- |
| 1k    | getEntryById                       | _TBD_ | _TBD_ | _TBD_ |
| 1k    | getEntryByDisplayId                | _TBD_ | _TBD_ | _TBD_ |
| 1k    | getEntriesByDisplayIdPrefix (n=10) | _TBD_ | _TBD_ | _TBD_ |
| 1k    | getGlossaryBySlug                  | _TBD_ | _TBD_ | _TBD_ |
| 10k   | (same four)                        | _TBD_ | _TBD_ | _TBD_ |
| 100k  | (same four)                        | _TBD_ | _TBD_ | _TBD_ |

### Index file size

| Scale | db (MB) | wal (MB) | post-checkpoint (MB) | post-vacuum (MB) |
| ----- | ------- | -------- | -------------------- | ---------------- |
| 1k    | _TBD_   | _TBD_    | _TBD_                | _TBD_            |
| 10k   | _TBD_   | _TBD_    | _TBD_                | _TBD_            |
| 100k  | _TBD_   | _TBD_    | _TBD_                | _TBD_            |

### Concurrency survival

| Test            | Result | Notes |
| --------------- | ------ | ----- |
| WAL contention  | _TBD_  | _TBD_ |
| Kill recovery   | _TBD_  | _TBD_ |
| Schema mismatch | _TBD_  | _TBD_ |

## Decisions (filled in at the end of Phase 1)

1. **Driver:** _TBD._ Default candidate: `jsr:@db/sqlite3`.
2. **Production pragma set:** _TBD._ Will be the cheapest of the §6-meeting
   sets; `sync=off` is never the answer regardless of speed.
3. **`index.invalidation-cap` default:** _TBD._ Spec lists ≈200 as a guess; eval
   produces the empirical hub-rename closure-size distribution at 100k.
4. **Driver-level WAL caveats discovered:** _TBD._ Any platform-specific
   findings (e.g., macOS APFS quirks, Windows WAL behavior) get documented here.

## Recommendations (filled in at the end of Phase 1)

> One of:
>
> - **Design confirmed.** Proceed to Phase 2 (production indexer) with the
>   chosen pragmas + cap + driver.
> - **Gap found at $X.** Spec must change at §N before Phase 2 starts; proposed
>   change attached.

## Alternatives considered (driver layer)

- **`node:sqlite`** (Node.js 22+ experimental built-in). Available in Deno via
  Node compat. Promising on paper (no extra dep, no FFI permission) but
  experimental and not yet a Deno-recommended path. Phase 1 will benchmark it if
  time permits; default is `@db/sqlite3`.
- **Pure-WASM `jsr:@db/sqlite`.** No FFI permission required (Phase 2 benefit:
  simpler permission story). Expected to be slower at cold-scan; the margin is
  the eval question.
- **Hand-rolled storage on RocksDB/LMDB.** Already rejected by the spec (§2
  storage table). Out of scope.

## See also

- Spec:
  [markspec-background-indexing.md](../spec/internal/markspec-background-indexing.md)
- Q4 amendment (cache directory moved out of project tree): PR #434, commit
  `9f59d7b`.
- Harness: [eval/sqlite-indexing/](../../eval/sqlite-indexing/)
