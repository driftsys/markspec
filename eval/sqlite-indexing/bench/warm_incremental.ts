/**
 * @module bench/warm_incremental
 *
 * Warm-incremental benchmark. Three change types — each calibrating a
 * different §5.2 invalidation path:
 *
 *   1. **body-edit**     — one entry's body changes; closure size = 1.
 *   2. **non-hub-rename** — one mid-degree entry renamed; closure ≈ edges of
 *                          that entry (single-digit typical).
 *   3. **hub-rename**    — one high-degree (top hubRatio) entry renamed;
 *                          closure can be in the hundreds-to-thousands.
 *                          This calibrates the §9 Q5 `index.invalidation-cap`
 *                          default (≈200).
 *
 * §6 budget: warm incremental per changed entry must complete in < 50 ms.
 *
 * Output: one BenchResult per (scale × change-type) tuple, plus the
 * hub-rename closure-size distribution as `notes.closureSizes`.
 */

export type ChangeType = "body-edit" | "non-hub-rename" | "hub-rename";

export async function runWarmIncremental(
  _scale: "1k" | "10k" | "100k",
  _changeType: ChangeType,
): Promise<void> {
  // TODO(phase-1):
  //   1. Cold-load the corpus once.
  //   2. Pick a target entry matching `changeType` (random body, random
  //      non-hub, deterministically-chosen hub).
  //   3. For each iteration:
  //        a. Mutate the in-memory corpus to reflect the change.
  //        b. measure() the adapter's updateEntry() + reverseEdgeClosure()
  //           call.
  //        c. Record closure size for hub-rename.
  //   4. summarise() + record().
  throw new Error("runWarmIncremental: not yet implemented");
}

if (import.meta.main) {
  await runWarmIncremental("1k", "body-edit");
  await runWarmIncremental("1k", "non-hub-rename");
  await runWarmIncremental("1k", "hub-rename");
}
