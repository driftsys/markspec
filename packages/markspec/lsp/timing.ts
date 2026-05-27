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
 */

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

/** Time a synchronous function. Returns its result. */
export function time<T>(label: string, fn: () => T): T {
  lazyInit();
  if (!logPath) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    write(label, performance.now() - start);
  }
}

/** Time an async function. Returns its result. */
export async function timeAsync<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  lazyInit();
  if (!logPath) return await fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    write(label, performance.now() - start);
  }
}

/** Test-only reset. */
export function _resetTiming(): void {
  initialized = false;
  logPath = undefined;
}
