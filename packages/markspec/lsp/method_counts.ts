/**
 * @module lsp/method_counts
 *
 * Per-method LSP request/notification counter. The server calls
 * {@linkcode tally} at the top of each handler; at session shutdown
 * {@linkcode snapshot} feeds the rolled-up counts into the `kind=shutdown`
 * event log entry. Kept in its own module so the counter state is unit-
 * testable without spinning up the LSP transport.
 *
 * State is module-scoped — there is exactly one LSP session per server
 * process, so a singleton is the right shape.
 */

const counts = new Map<string, number>();

/** Record one invocation of the named LSP method. O(1). */
export function tally(method: string): void {
  counts.set(method, (counts.get(method) ?? 0) + 1);
}

/**
 * Read-only view of the current counts. Returned `Map` is the live
 * instance (not a copy) so iteration is allocation-free, but it is
 * typed as `ReadonlyMap` to discourage mutation by callers.
 */
export function snapshot(): ReadonlyMap<string, number> {
  return counts;
}

/** Reset counters. Test-only — there is no production use case. */
export function _reset(): void {
  counts.clear();
}
