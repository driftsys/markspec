# SQLite Indexing Eval — Phase 1

Investigation harness for the Background Indexing epic. Measures whether
SQLite/WAL meets the §6 performance budgets of
[markspec-background-indexing.md](../../docs/spec/internal/markspec-background-indexing.md)
at 1k / 10k / 100k entries, and surfaces gaps before any production indexer code
is written.

**This is not shipped code.** It lives outside `packages/`, never gets compiled
into the binary, and is not part of `just build`. Its only output is
[ADR-020](../../docs/architecture/adr-020-sqlite-indexing-eval.md) — a written
report with numbers + recommendations.

## Layout

```text
eval/sqlite-indexing/
├── corpus/        ← synthetic project generator (entries, edges, glossary)
├── bench/         ← timed benchmarks against an IndexAdapter
├── concurrency/   ← WAL contention, kill-recovery, schema-mismatch tests
├── results/       ← bench JSON output lands here (git-ignored)
└── run.ts         ← orchestrator: runs the full matrix at all scales
```

## How to run

```bash
# generate a synthetic project at the default scale (1k entries)
deno task gen

# run a single bench against the generated corpus
deno task bench:cold

# run the full eval matrix (1k / 10k / 100k × all benches)
deno task bench:all

# render the latest results as a Markdown table
deno task report
```

Tasks are defined in [deno.json](deno.json). Each bench writes a JSON line to
`results/<bench>-<timestamp>.ndjson` so the matrix is reproducible offline.

## What the eval is investigating

| Question                              | How                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| Does cold scan meet §6 (<5 s @ 10k)?  | `bench/cold_scan.ts` — one-shot batched insert with a tunable pragma sweep         |
| Does warm incremental meet <50 ms?    | `bench/warm_incremental.ts` — body edit / non-hub rename / hub rename change types |
| Does single-Id lookup meet <5 ms p95? | `bench/lookups.ts` — point + prefix + glossary lookups                             |
| Index file size at 100k entries?      | `bench/size.ts` — file-size at each scale                                          |
| Does WAL hold 1W+8R sustained?        | `concurrency/wal_contention.ts`                                                    |
| Does SIGKILL mid-tx recover cleanly?  | `concurrency/kill_recovery.ts`                                                     |
| Does schema-version mismatch rebuild? | `concurrency/schema_mismatch.ts`                                                   |
| §5.2 invalidation closure cap value?  | `bench/warm_incremental.ts` (hub-rename scaling curve)                             |

The §6 budgets, the §5.2 cap default (≈200), and the network-FS posture
(local-only by Q4 amendment) are all spec-stated; the eval either confirms them
or surfaces gaps for spec revisit.

## Out of scope for Phase 1

- Production indexer code. (Phase 2.)
- A `markspec serve` / `markspec watch` mode. (No FS watcher in v1 per §9 Q2.)
- Sharing the index across worktrees. (§9 Q4.)
- TTL-based federated cache. (§9 Q3.)
- Full network-FS coverage. The Q4 amendment moves the cache off the project
  tree by default; remote-FS becomes a non-issue except when `~/.cache/` itself
  is remote (rare; documented, not benchmarked).

## Phase 1 deliverable

A signed-off ADR-020 with measurement tables for cold scan, warm incremental
(broken out by change type), hot-path lookups, file size, and concurrency
survival; a chosen pragma set; a recommended default for
`index.invalidation-cap`; and either "design confirmed, proceed to Phase 2" or
"gap found, here is the spec change."
