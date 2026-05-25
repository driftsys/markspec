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

> **Cold scan + warm incremental complete; lookups / size / concurrency
> pending.** All numbers below are from the bench scripts under
> [`eval/sqlite-indexing/bench/`](../../eval/sqlite-indexing/bench/) on a single
> dev machine (Apple Silicon aarch64-darwin, APFS, local disk). Iteration /
> warmup counts and target selection are per-bench (see each section).

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

## Decisions (filled in as Phase 1 progresses)

1. **Driver:** _Preliminary:_ `jsr:@db/sqlite@^0.13.0` (native FFI via the
   `denodrivers/sqlite3` GitHub project; despite the GitHub repo name, the JSR
   package is `@db/sqlite`). Cold-scan numbers confirm the driver is not a
   bottleneck — 100k rows inserted in ~1.3 s with tuned pragmas. Comparison
   against `jsr:@db/sqlite` pure-WASM and `node:sqlite` still pending.
2. **Production pragma set:** _Preliminary recommendation:_ **tuned** —
   `journal_mode=WAL, synchronous=NORMAL, cache_size=64MB, mmap_size=0,
   temp_store=MEMORY`.
   Hits the §6 budget with massive headroom (1.3 s at 100k vs 5 s budget at
   10k). `mmap=256MB` adds < 2 %, not worth the platform edge cases. `sync=off`
   ties tuned and is correctness-unsafe.
3. **`index.invalidation-cap` default:** _Preliminary observation_ — the spec's
   ≈200 guess is below the observed hub closure size at every scale in the
   synthetic corpus (mean ≈ 420). The closure walk itself is fast (~0.4 ms even
   at the 500-row max). Whether the cap should be raised depends on the
   **revalidation cost per closure entry**, which this bench does not yet
   measure. Hold the ≈200 default until a re-validate bench produces a per-entry
   cost number.
4. **Driver-level WAL caveats discovered:** _TBD._ Awaits concurrency benches.
   macOS APFS aarch64-darwin observed so far: no anomalies in cold scan.

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
