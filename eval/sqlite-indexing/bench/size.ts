/**
 * @module bench/size
 *
 * Index file-size benchmark. After cold-scan completes, measure:
 *   - size of `.db` file
 *   - size of `.db-wal` file (if WAL active and not yet checkpointed)
 *   - size of `.db-shm` file
 *   - size after `PRAGMA wal_checkpoint(TRUNCATE)`
 *   - size after `VACUUM`
 *
 * Reported per scale. Lets the ADR commit to a defensible disk-budget number
 * for §8 (privacy) — the user needs to know roughly how big this cache will
 * grow on their machine.
 */

export interface SizeResult {
  readonly scale: "1k" | "10k" | "100k";
  readonly dbBytes: number;
  readonly walBytes: number;
  readonly shmBytes: number;
  readonly postCheckpointBytes: number;
  readonly postVacuumBytes: number;
  readonly timestamp: string;
}

export async function runSizeMeasurement(
  _scale: "1k" | "10k" | "100k",
): Promise<void> {
  // TODO(phase-1): cold-scan the corpus, stat the resulting files, then
  // checkpoint + vacuum and re-stat. Record as a SizeResult.
  throw new Error("runSizeMeasurement: not yet implemented");
}

if (import.meta.main) {
  await runSizeMeasurement("1k");
}
