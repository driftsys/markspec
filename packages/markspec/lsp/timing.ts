/**
 * @module lsp/timing
 *
 * Performance-timing wrappers for LSP hot paths. The wrappers run
 * `performance.now()` around their wrapped function and, when the
 * measured duration exceeds a label-prefix threshold (see
 * {@linkcode THRESHOLDS}), emit a `kind=slow` WARN event via the
 * default-on {@link ./event_log.ts event_log}.
 *
 * There is no per-event timing-log channel — `time()`/`timeAsync()`
 * are silent except for the slow-event emission. Detailed timing
 * output, if ever needed, can ride the existing event log.
 */

import { logEvent } from "./event_log.ts";

/**
 * Label-prefix → threshold-ms table. Order documents prefix
 * specificity: longer prefixes come first so they win over shorter
 * ones in {@linkcode findThreshold}. When two prefixes would both
 * match a label, the first array entry wins.
 */
const THRESHOLDS: ReadonlyArray<readonly [string, number]> = [
  ["onInitialized/parseFile", 50],
  ["onInitialized/parseAll", 5000],
  ["validateAll/", 100],
  ["onCompletion/", 10],
] as const;

/** Return the first threshold whose prefix matches `label`, or undefined. */
function findThreshold(label: string): number | undefined {
  for (const [prefix, ms] of THRESHOLDS) {
    if (label.startsWith(prefix)) return ms;
  }
  return undefined;
}

/**
 * Emit a `kind=slow` WARN event when `duration` exceeds the
 * registered threshold for `label`.
 */
function maybeFlagSlow(label: string, duration: number): void {
  const threshold = findThreshold(label);
  if (threshold === undefined) return;
  if (duration <= threshold) return;
  logEvent("warn", "slow", {
    label,
    ms: Math.round(duration),
    threshold,
  });
}

/** Time a synchronous function. Returns its result. */
export function time<T>(label: string, fn: () => T): T {
  // Fast-path when no threshold matches: skip the performance.now()
  // pair entirely.
  if (findThreshold(label) === undefined) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    maybeFlagSlow(label, performance.now() - start);
  }
}

/** Time an async function. Returns its result. */
export async function timeAsync<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (findThreshold(label) === undefined) return await fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    maybeFlagSlow(label, performance.now() - start);
  }
}
