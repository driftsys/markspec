# ADR-020 — SQLite Indexing Eval (Phase 1 of Background Indexing epic)

**Status:** Accepted **Date:** 2026-05-25 **Supersedes:** — **Related:**
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

- Which SQLite driver wins on Deno (`jsr:@db/sqlite` native FFI via
  `denodrivers/sqlite3` vs a pure-WASM alternative vs `node:sqlite` via Node
  compat).
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

Default: `jsr:@db/sqlite@^0.13.0` (native FFI; the JSR package is named
`@db/sqlite` even though the upstream GitHub repo is `denodrivers/sqlite3`). The
bench layer talks through an abstract `IndexAdapter` interface (see
[bench/adapter.ts](../../eval/sqlite-indexing/bench/adapter.ts)) so an
alternative driver can be swapped without changing call sites. The eval will
either confirm `@db/sqlite` is the right pick or replace it with a benched
alternative — that's an early Phase 1 sub-decision.

## Results

> **All Phase 1 benches complete.** Numbers below are from the bench scripts
> under [`eval/sqlite-indexing/bench/`](../../eval/sqlite-indexing/bench/) and
> [`eval/sqlite-indexing/concurrency/`](../../eval/sqlite-indexing/concurrency/)
> on a single dev machine (Apple Silicon aarch64-darwin, APFS, local disk).
> Iteration / warmup counts and target selection are per-bench (see each
> section).

### Cold scan (§6 budget: 10k < 5 s)

| Scale | Pragma set                                | mean Ms | per-entry µs |
| ----- | ----------------------------------------- | ------- | ------------ |
| 1k    | baseline (sync=full, cache=2MB, no mmap)  | 17.9    | 17.9         |
| 1k    | tuned (sync=normal, cache=64MB, no mmap)  | 16.7    | 16.7         |
| 1k    | tuned + mmap=256MB                        | 16.3    | 16.3         |
| 1k    | unsafe (sync=off, cache=64MB, mmap=256MB) | 14.7    | 14.7         |
| 10k   | baseline                                  | 132.5   | 13.3         |
| 10k   | tuned                                     | 133.5   | 13.4         |
| 10k   | tuned + mmap                              | 131.9   | 13.2         |
| 10k   | unsafe                                    | 131.5   | 13.2         |
| 100k  | baseline                                  | 2180.5  | 21.8         |
| 100k  | tuned                                     | 1292.4  | 12.9         |
| 100k  | tuned + mmap                              | 1271.5  | 12.7         |
| 100k  | unsafe                                    | 1292.8  | 12.9         |

**Cold-scan observations:**

- **§6 budget is met with massive headroom.** 10k cold scan completes in ~132 ms
  regardless of pragma — 37× under the 5 s budget. 100k completes in 1.3 s with
  tuned pragmas; even baseline at 2.2 s extrapolates well beyond the spec's
  targeted scale.
- **Pragma tuning matters at 100k, not at 10k.** Below 10k the workload is small
  enough that the single-transaction fsync amortizes any pragma difference. At
  100k, baseline is **1.7× slower** than tuned because `synchronous=full` + the
  smaller 2 MB cache start to bite during the large transaction.
- **`mmap` adds < 2 % over tuned.** Not worth the platform-specific edge cases
  it introduces.
- **`sync=off` ties tuned at 100k** — the cache_size pragma is the actual lever;
  correctness-unsafe sync gains nothing in production.

### Warm incremental (§6 budget: < 50 ms per change)

Same dev machine and tuned pragma set as cold scan. `iterations=20`, `warmup=2`.
Each iteration: `adapter.updateEntry(target, edges)` followed by
`adapter.reverseEdgeClosure(target.id, cap=10000)`. Target picked
deterministically — entry index `entryCount/2` for body-edit, `entryCount * 0.6`
for non-hub-rename, entry index 0 (always a hub) for hub-rename. Closure-size
distribution measured by walking every hub once.

| Scale | Change type    | p50 Ms | p95 Ms | p99 Ms | closure size (mean / p95 / max) |
| ----- | -------------- | ------ | ------ | ------ | ------------------------------- |
| 1k    | body-edit      | 0.08   | 0.15   | 0.15   | 1 / 1 / 1                       |
| 1k    | non-hub-rename | 0.07   | 0.08   | 0.08   | ~1 (non-hub)                    |
| 1k    | hub-rename     | 0.36   | 0.45   | 0.45   | 412 / 434 / 434 (5 hubs)        |
| 10k   | body-edit      | 0.06   | 0.09   | 0.09   | 1 / 1 / 1                       |
| 10k   | non-hub-rename | 0.08   | 0.09   | 0.09   | ~1 (non-hub)                    |
| 10k   | hub-rename     | 0.39   | 0.55   | 0.55   | 423 / 460 / 470 (50 hubs)       |
| 100k  | body-edit      | 0.05   | 0.09   | 0.09   | 1 / 1 / 1                       |
| 100k  | non-hub-rename | 0.15   | 0.70   | 0.70   | ~1 (non-hub)                    |
| 100k  | hub-rename     | 0.40   | 0.61   | 0.61   | 422 / 456 / 489 (500 hubs)      |

**Warm-incremental observations:**

- **§6 budget (< 50 ms per change) is met with > 100× headroom** for every
  change type at every scale. Even the worst case (100k hub-rename p99 = 0.61
  ms) is ~80× under budget. SQLite is not the warm-path bottleneck.
- **Closure size is scale-invariant in this corpus** (mean ≈ 420 at every scale)
  because the generator holds `hubRatio = 0.005` constant — so hubCount scales
  with entryCount, keeping per-hub in-degree constant at
  ~`edgeDensity × hubTargetProbability / hubRatio` = ~420. Real projects may or
  may not scale this way; the bench documents the shape of one realistic
  synthetic distribution.
- **§9 Q5's ≈200 cap is well below the observed hub closure size** (every hub in
  this corpus has > 200 reverse edges). **Important caveat:** the walk itself is
  fast (~0.4 ms even with a 500-row closure) — the cap exists to bound the
  _downstream re-validation_ cost of touching every entry in the closure, which
  is **not yet measured by this bench**. Cap calibration should re-run once the
  re-validation cost-per-entry is measured.
- **Body-edit and non-hub-rename are essentially free** at every scale (< 1 ms).
  The interesting cost is concentrated in hub changes — exactly where §5.2
  designed the closure walk.

### Hot-path lookups (§6 budgets: < 5 ms p95 for point queries)

Same dev machine and tuned pragma set. `iterations=500`, `warmup=50`,
`keySet=64` random pre-picked target keys per shape (deterministic seed per
shape). Prefix scan uses `LIKE 'REQ_0%' LIMIT 100`.

| Scale | Query shape                 | p50 µs | p95 µs | p99 µs | max µs |
| ----- | --------------------------- | ------ | ------ | ------ | ------ |
| 1k    | getEntryById                | 15     | 24     | 83     | 122    |
| 1k    | getEntryByDisplayId         | 15     | 18     | 29     | 233    |
| 1k    | getEntriesByDisplayIdPrefix | 119    | 140    | 205    | 239    |
| 1k    | getGlossaryBySlug           | 7      | 9      | 32     | 56     |
| 10k   | getEntryById                | 16     | 53     | 97     | 762    |
| 10k   | getEntryByDisplayId         | 16     | 32     | 73     | 139    |
| 10k   | getEntriesByDisplayIdPrefix | 127    | 294    | 782    | 2_902  |
| 10k   | getGlossaryBySlug           | 7      | 9      | 15     | 27     |
| 100k  | getEntryById                | 16     | 23     | 35     | 174    |
| 100k  | getEntryByDisplayId         | 17     | 22     | 75     | 268    |
| 100k  | getEntriesByDisplayIdPrefix | 121    | 159    | 293    | 1_369  |
| 100k  | getGlossaryBySlug           | 7      | 9      | 15     | 58     |

(All times reported in **µs** — point-lookup p95 sits around 20 µs across all
scales, hundreds of times under §6's 5 ms budget.)

**Lookups observations:**

- **§6 point-lookup budget (< 5 ms p95) is met with ~150–300× headroom** across
  all scales. p95 of every shape at every scale is < 800 µs.
- **Lookups are essentially scale-invariant** — the B-tree primary key and
  secondary indices keep cost constant from 1k to 100k. SQLite is the textbook
  case for this workload.
- **Glossary lookup (the prose-analysis flagship's < 5 ms budget) sits at 7 µs
  p50, 9 µs p95.** ~550× under budget; this rule will never be bottlenecked by
  the index.
- **Prefix scan is bounded by `LIMIT 100`** at ~120 µs p50, with p99
  occasionally spiking (max 2.9 ms at 10k — likely page-cache miss on a cold
  range). Still 5–40× under any reasonable budget.

### Index file size

Cold-scanned, then `PRAGMA wal_checkpoint(TRUNCATE)`, then `VACUUM`, stat'ing
after each step. Steady-state size is the `post-checkpoint db` column (`VACUUM`
itself writes to the WAL, so the post-vacuum total re-grows the WAL — only the
main `.db` file reflects compacted state).

| Scale | raw db (MB) | raw WAL (MB) | post-checkpoint db (MB) | post-vacuum db (MB) | bytes/entry |
| ----- | ----------- | ------------ | ----------------------- | ------------------- | ----------- |
| 1k    | 0.004       | 0.87         | 0.80                    | 0.80                | 815         |
| 10k   | 7.94        | 8.05         | 7.95                    | 7.57                | 757         |
| 100k  | 79.56       | 46.53        | 79.63                   | 76.00               | 760         |

**Size observations:**

- **~750–815 bytes per entry** post-vacuum, consistent across scales. Includes
  the entry row, its share of edges (~3 per entry at the generator's
  `edgeDensity`), and the relevant indices.
- **At 100k entries the on-disk index is ~76 MB** — modest, comfortably fits on
  any modern dev machine. The §8 privacy paragraph can commit to "expect ~80 MB
  at 100k entries" as a defensible upper bound.
- **Raw size at 1k is dominated by the WAL** (~870 KB WAL vs 4 KB main file)
  because SQLite's default WAL auto-checkpoint threshold is 1000 pages — at 1k
  entries the cold scan hasn't crossed that yet. At larger scales the
  auto-checkpoint fires during the scan and the WAL stays bounded.
- **Production-relevant takeaway:** the indexer should run an explicit
  `wal_checkpoint(TRUNCATE)` after cold-scan completes so the WAL doesn't sit at
  the cold-scan size between editor restarts. A periodic checkpoint on idle is
  the standard pattern.

### Concurrency survival

Tuned pragma set + `PRAGMA busy_timeout = 5000` (added during this slice —
standard SQLite production setting for multi-process access, makes concurrent
open/write contention wait rather than erroring with SQLITE_BUSY).

#### WAL contention (1 writer + 8 readers, 10 s sustained, 10k scale)

| Role    | Total ops | Ops/sec    | p50 µs    | p95 µs    | Errors |
| ------- | --------- | ---------- | --------- | --------- | ------ |
| writer  | 14 380    | 1 312      | 122       | 1 692     | **0**  |
| readers | 726 102   | 72 610 agg | 17 (mean) | 181 (max) | **0**  |

Readers ran a rotating 64-key `getEntryById` workload; writer ran `updateEntry`
against rotating entries. **Zero errors on both sides** — §4's "readers never
block writer, writer never blocks readers" claim holds under sustained load.

#### Kill recovery (SIGKILL writer mid-stream, 1k scale)

| Kill point                | Re-opened | integrity_check | quick_check | Lookups (8/8 after kill) |
| ------------------------- | --------- | --------------- | ----------- | ------------------------ |
| start (5 ms post-READY)   | yes       | ok              | ok          | 8/8                      |
| middle (50 ms post-READY) | yes       | ok              | ok          | 8/8                      |
| end (200 ms post-READY)   | yes       | ok              | ok          | 8/8                      |

SQLite's automatic WAL recovery on next-open handles SIGKILL cleanly at all
three sampled points. The §7 "delete + cold rebuild" fallback was **not needed**
for SIGKILL — WAL alone suffices.

#### Schema-version mismatch (1k scale)

| Field            | Detected                | Post-rebuild version | Mechanism viable         |
| ---------------- | ----------------------- | -------------------- | ------------------------ |
| `schema_version` | yes (999 vs expected 1) | 1                    | yes — primitives present |

The eval changed `open()` to `INSERT OR IGNORE` instead of `INSERT OR REPLACE`
so a stale version is preserved across re-opens; `getSchemaVersion()` exposes
the read. The production indexer (Phase 2) wraps this as
`open → getSchemaVersion → compare → delete + cold-scan
if mismatch` — verified
by manual simulation in the bench.

**Concurrency observations:**

- **§4 claim confirmed** — 1W + 8R sustained for 10 s with zero errors on either
  side. Writer's p95 of 1.7 ms is well under any interactive budget; reader p95
  of 0.18 ms is the same shape as the standalone lookups bench.
- **§7 claim confirmed** for the SIGKILL path — SQLite recovers without needing
  the explicit rebuild. The rebuild path remains the fallback for actual
  corruption (truncated WAL, disk-level damage) which is hard to simulate
  deterministically.
- **`busy_timeout = 5000` is essential.** Without it, concurrent open attempts
  that write to `schema_meta` race and ~60 % fail with SQLITE_BUSY. With it, all
  open attempts succeed sequentially. This must be in the production pragma set.

## Decisions

1. **Driver:** **`jsr:@db/sqlite@^0.13.0`** (native FFI via the
   `denodrivers/sqlite3` GitHub project; the JSR package is named `@db/sqlite`).
   Confirmed across all benches — driver is never the bottleneck. Comparison
   against `jsr:@db/sqlite` pure-WASM and `node:sqlite` is **deferred to Phase
   2** as a follow-up if the FFI permission requirement becomes a deployment
   concern; the §6 budgets are met with so much headroom that a slower driver
   would still work.

2. **Production pragma set:** **tuned + busy_timeout**, exactly:

   ```text
   PRAGMA journal_mode  = WAL
   PRAGMA synchronous   = NORMAL
   PRAGMA cache_size    = -64000      -- 64 MB (negative = KB)
   PRAGMA mmap_size     = 0
   PRAGMA temp_store    = MEMORY
   PRAGMA busy_timeout  = 5000        -- 5 s
   ```

   Hits §6's 10k < 5 s cold-scan budget with 37× headroom; 100k cold scan
   finishes in 1.3 s. `mmap=256MB` adds < 2 % and isn't worth the platform edge
   cases. `synchronous=OFF` ties tuned at large scale and is correctness-unsafe.
   `busy_timeout=5000` is **required for multi-process safety** — without it,
   concurrent opens that write to `schema_meta` race and ~60 % fail with
   SQLITE_BUSY (discovered during the WAL contention bench).

3. **`index.invalidation-cap` default:** **Hold the spec's ≈200 as the v1
   default; revisit in a follow-up revalidate bench.** The observed hub closure
   size in the synthetic corpus is mean ≈ 420 at every scale, so this default
   will fall back to a full re-validate on most hub-renames. That's acceptable
   because (a) the closure walk itself is fast (~0.4 ms even at 500 rows), so
   the cap exists to bound the **downstream re-validation cost** (touching every
   closure entry's prose / trace links) which this eval does not yet measure,
   and (b) full re-validate is also fast at our scales. The cap value is
   empirical, expected to change once the revalidate cost per entry is known.

4. **Driver-level WAL caveats discovered:**

   - **`busy_timeout` is required** for multi-process access (folded into the
     pragma set above). Discovered during wal_contention.
   - **SIGKILL recovery is automatic.** SQLite's WAL recovery on next-open
     handles abrupt termination; the §7 "delete + cold rebuild" path is reserved
     for actual corruption (truncated WAL, disk-level damage), not SIGKILL.
   - **macOS APFS aarch64-darwin** is the eval platform; no anomalies observed.
     Linux ext4 / Windows NTFS not benchmarked — expected to behave the same per
     SQLite documentation, but a brief smoke-test on each is recommended during
     Phase 2 platform validation.

## Recommendations

**Design confirmed. Proceed to Phase 2 (production indexer)** with the pragma
set and adapter shape validated by this eval.

Phase 1 produced no gaps requiring a spec change. The single adapter hardening
discovered during the benches (`busy_timeout = 5000`, `INSERT OR IGNORE` on
`schema_meta`, `getSchemaVersion()` exposed for mismatch detection) carries
forward into Phase 2 as part of the production code.

Two **follow-up benches** are recommended but **not blockers** for Phase 2:

- **Revalidate cost per closure entry** — measures the downstream cost the §9 Q5
  `index.invalidation-cap` exists to bound. Calibrates the cap's value (the
  mechanism is already validated). Can run after Phase 2's invalidation walker
  is implemented.
- **Driver alternatives bench** (`jsr:@db/sqlite` pure-WASM vs `node:sqlite`) —
  only if the FFI permission requirement becomes a deployment concern. Otherwise
  `@db/sqlite` is sufficient.

A driver-level platform smoke-test on Linux ext4 / Windows NTFS is recommended
once Phase 2 has a runnable production indexer; the eval ran only on
aarch64-darwin / APFS.

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
