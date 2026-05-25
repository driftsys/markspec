/**
 * @module run
 *
 * Phase 1 orchestrator. Runs the full eval matrix and writes results to
 * `results/`. Designed to be re-runnable: deletes prior NDJSON for the same
 * (bench, scale) tuple before recording fresh samples, so re-running is the
 * same as a clean run.
 *
 * Matrix:
 *
 *   scales × benches × variants
 *
 *   scales:  1k, 10k, 100k
 *   benches: cold_scan, warm_incremental, lookups, size
 *   cold_scan variants: pragma sweep (4 sets)
 *   warm_incremental variants: body-edit, non-hub-rename, hub-rename
 *   lookups variants: 4 query shapes
 *   concurrency: wal_contention (10k only), kill_recovery (10k only),
 *                schema_mismatch (1k only)
 *
 * Total runs (Phase 1, before any optimisation): ~3*4 + 3*3 + 3*4 + 3 + 3 + 1
 *   = 12 + 9 + 12 + 3 + 3 + 1 = 40 measurement points.
 *
 * Estimated runtime at full scale: dominated by 100k cold scans + 100k
 * lookup warmup. Sketch budget: 30–60 min on dev hardware.
 */

export async function runAll(): Promise<void> {
  // TODO(phase-1):
  //   - Iterate the matrix, calling each bench's run* function in turn.
  //   - Catch + record failures (don't let one bench take down the run).
  //   - Emit a summary table at the end (or hand off to report.ts).
  throw new Error("run.ts: not yet implemented");
}

if (import.meta.main) await runAll();
