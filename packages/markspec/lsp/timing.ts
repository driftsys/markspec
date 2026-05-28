/**
 * @module lsp/timing
 *
 * Performance timing for LSP hot paths. Activated by the
 * MARKSPEC_LSP_TIMING_LOG environment variable, which doubles as the
 * destination path. When unset, every helper is a near-zero no-op.
 *
 * Output format: one line per measurement, append-only, e.g.
 *   [2026-05-27T14:32:11.123Z] timing: onCompletion/scaffold 0.42ms
 *
 * Kept separate from MARKSPEC_LSP_DEBUG_LOG so timing noise doesn't
 * drown out lifecycle/crash events when both are enabled.
 *
 * Slow-event flags (Job 2 of the event-log epic): when a measurement
 * exceeds a label-prefix threshold (see {@linkcode THRESHOLDS}), a
 * `kind=slow` WARN event is ALSO emitted via the default-on
 * {@link ./event_log.ts event_log}. This second channel is
 * independent of MARKSPEC_LSP_TIMING_LOG — slow flags fire even when
 * detailed timing output is disabled.
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

let logPath: string | undefined;
let initialized = false;

function lazyInit(): void {
  if (initialized) return;
  initialized = true;
  const value = Deno.env.get("MARKSPEC_LSP_TIMING_LOG");
  if (value && value.length > 0) logPath = value;
}

function write(label: string, ms: number): void {
  if (!logPath) return;
  try {
    Deno.writeTextFileSync(
      logPath,
      `[${new Date().toISOString()}] timing: ${label} ${ms.toFixed(2)}ms\n`,
      { append: true },
    );
  } catch {
    // Drop silently — stderr is captured by the LSP framework, and a
    // failed log write must not crash the server.
  }
}

/**
 * Emit a `kind=slow` WARN event when `duration` exceeds the
 * registered threshold for `label`. Independent of MARKSPEC_LSP_TIMING_LOG —
 * slow flags ride the default-on event log so perf regressions show
 * up in `.markspec/lsp.log` without authors opting in to detailed
 * timing capture.
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
  lazyInit();
  // Fast-path when neither channel cares about this label: skip the
  // performance.now() pair entirely. The slow-event channel only
  // cares when the label matches a registered prefix.
  if (!logPath && findThreshold(label) === undefined) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    const duration = performance.now() - start;
    write(label, duration);
    maybeFlagSlow(label, duration);
  }
}

/** Time an async function. Returns its result. */
export async function timeAsync<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  lazyInit();
  if (!logPath && findThreshold(label) === undefined) return await fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const duration = performance.now() - start;
    write(label, duration);
    maybeFlagSlow(label, duration);
  }
}

/** Test-only reset. */
export function _resetTiming(): void {
  initialized = false;
  logPath = undefined;
}
