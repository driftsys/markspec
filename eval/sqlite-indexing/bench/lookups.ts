/**
 * @module bench/lookups
 *
 * Hot-path lookup benchmark. Four query shapes:
 *
 *   1. **getEntryById**           — primary-key point lookup.
 *   2. **getEntryByDisplayId**    — secondary-index point lookup.
 *   3. **getEntriesByDisplayIdPrefix** — prefix scan; the in-memory
 *                                   WorkspaceIndex's main scaling pain point.
 *   4. **getGlossaryBySlug**      — backs xref-glossary-undefined; carries
 *                                   the prose-analysis flagship's <5 ms budget.
 *
 * §6 budgets:
 *   - single-Id query        < 5 ms
 *   - glossary lookup        < 5 ms
 *   - prefix completion      (no explicit budget; report p95 anyway)
 *
 * Output: one BenchResult per (scale × query-shape) tuple with p50/p95/p99.
 */

export type QueryShape =
  | "getEntryById"
  | "getEntryByDisplayId"
  | "getEntriesByDisplayIdPrefix"
  | "getGlossaryBySlug";

export async function runLookups(
  _scale: "1k" | "10k" | "100k",
  _shape: QueryShape,
): Promise<void> {
  // TODO(phase-1):
  //   1. Cold-load the corpus.
  //   2. Pre-pick a set of N random target keys (same set each iter for
  //      reproducibility; warmup primes the page cache).
  //   3. For each iteration: measure() one query against a randomly-chosen
  //      target key.
  //   4. summarise() + record().
  throw new Error("runLookups: not yet implemented");
}

if (import.meta.main) {
  await runLookups("1k", "getEntryById");
}
