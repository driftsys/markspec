/**
 * @module lsp/debug_log
 *
 * Append-only debug log for LSP lifecycle events. Activated by the
 * MARKSPEC_LSP_DEBUG_LOG environment variable; otherwise a no-op.
 *
 * Stderr is intercepted by the LSP framework, and the framework's own error
 * handlers swallow exceptions silently. This module lets us recover crash
 * information after the fact by writing to a file we control.
 */

const ENV_KEY = "MARKSPEC_LSP_DEBUG_LOG";

let logPath: string | undefined;
let initialized = false;

function lazyInit(): void {
  if (initialized) return;
  initialized = true;
  const value = Deno.env.get(ENV_KEY);
  if (value && value.length > 0) {
    logPath = value;
  }
}

/** Append a timestamped event to the debug log. No-op if env var is unset. */
export function debugLog(event: string): void {
  lazyInit();
  if (!logPath) return;
  try {
    Deno.writeTextFileSync(
      logPath,
      `[${new Date().toISOString()}] ${event}\n`,
      { append: true },
    );
  } catch {
    // Cannot write the log — there's no fallback (stderr is intercepted).
    // Drop the event silently rather than crash the server.
  }
}

/** Returns the configured log path, or undefined. For testing. */
export function getDebugLogPath(): string | undefined {
  lazyInit();
  return logPath;
}

/** Reset the cached env-var read. Test-only. */
export function _resetDebugLog(): void {
  initialized = false;
  logPath = undefined;
}
