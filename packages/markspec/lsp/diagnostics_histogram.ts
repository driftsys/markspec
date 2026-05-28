/**
 * @module lsp/diagnostics_histogram
 *
 * Build a bounded histogram of diagnostic codes for the
 * `kind=diagnostics` event_log entry that `publishAllDiagnostics`
 * emits after every cross-file validation.
 *
 * The cap matters: a single broken-reference cascade can fire the
 * same MSL code thousands of times in a large project. Without a
 * cap, the event log line would grow without bound and lose its
 * `grep`-ability. We keep the top-N most frequent codes by name and
 * lump the long tail into a synthetic `"other"` field so the line
 * size stays bounded.
 */

import type { Diagnostic } from "../core/mod.ts";

/**
 * Build a code-frequency histogram from a flat diagnostic list,
 * capped at the {@linkcode topN} most frequent codes. Excess codes
 * are summed into a single `"other"` field.
 *
 * The returned object is sorted by descending count so the resulting
 * event-log line reads top-down (most-fired code first), then by
 * code name as a deterministic tiebreaker so a flapping
 * least-frequent code does not produce flaky tests.
 *
 * @param diags - Flat list of core diagnostics from a single
 *   `validateAll` run. Each diagnostic's `code` field is used as the
 *   histogram key.
 * @param topN - Maximum number of distinct codes to surface by
 *   name. Codes beyond the cutoff contribute to the `"other"`
 *   bucket.
 */
export function buildDiagnosticsHistogram(
  diags: readonly Diagnostic[],
  topN: number,
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const diag of diags) {
    counts.set(diag.code, (counts.get(diag.code) ?? 0) + 1);
  }
  // Sort by count desc, then code asc — deterministic tiebreak so
  // tests are not flaky when two codes share the cutoff count.
  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  const out: Record<string, number> = {};
  if (sorted.length <= topN) {
    for (const [code, count] of sorted) out[code] = count;
    return out;
  }
  const kept = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  for (const [code, count] of kept) out[code] = count;
  let otherSum = 0;
  for (const [, count] of rest) otherSum += count;
  out["other"] = otherSum;
  return out;
}
