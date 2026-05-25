/**
 * @module bench/cold_scan
 *
 * Cold-scan benchmark. Measures how fast a fresh SQLite index can be
 * populated from a synthetic project of N entries, sweeping a few pragma
 * combinations to find the production-recommended set.
 *
 * §6 budget: cold index at 10 000 entries must complete in < 5 s.
 *
 * Pragma sweep variants (the matrix the eval will fill in):
 *   - baseline (driver defaults)
 *   - WAL + synchronous=normal + cache_size=64MB
 *   - WAL + synchronous=normal + cache_size=64MB + mmap_size=256MB
 *   - WAL + synchronous=off (correctness-unsafe — measured as upper bound)
 *
 * Output: one BenchResult per (scale × pragma-set) tuple.
 */

import { DEFAULT_PRAGMAS } from "./adapter.ts";

export async function runColdScan(
  _scale: "1k" | "10k" | "100k",
): Promise<void> {
  // TODO(phase-1):
  //   1. Load corpus NDJSON for `scale` (or generate inline).
  //   2. For each pragma set in the sweep:
  //        a. Open a fresh index at a tmp path.
  //        b. measure() the bulkInsert{Entries,Edges,Glossary} as one tx.
  //        c. summarise() + record() the result.
  //   3. Close + delete the tmp index between sweeps.
  throw new Error("runColdScan: not yet implemented");
}

if (import.meta.main) {
  await runColdScan("1k");
  console.error(`(default pragmas: ${JSON.stringify(DEFAULT_PRAGMAS)})`);
}
