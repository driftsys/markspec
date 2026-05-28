/**
 * @module lsp/event_log
 *
 * Unified, perf-safe event log for the LSP server. The single buffered
 * writer behind every LSP log channel: one open file handle, an
 * in-memory line buffer, and either a 250ms timer or a 4KB watermark
 * triggering a flush. Per-emit cost is one array push plus a small
 * length check — well under a microsecond — so events are enabled by
 * default without measurable impact on the LSP hot paths.
 *
 * Levels (`info`/`warn`/`error`) exist for future filtering but no
 * level gate is enforced yet. One log destination resolved as:
 *
 *   1. `MARKSPEC_LSP_LOG_OFF=1` → disabled, no writes
 *   2. `MARKSPEC_LSP_LOG=<path>` → that path
 *   3. else, after `setProjectRoot(root)` is called → `<root>/.markspec/lsp.log`
 *   4. else → events are dropped silently (no project root, no env var)
 *
 * Line format: `[<ISO timestamp>] <level> kind=<kind> [key=value ...]`
 * where values containing whitespace are double-quoted. One line per
 * event. Designed for `grep` / `awk`.
 */

import { dirname, join } from "@std/path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Level = "info" | "warn" | "error";

export type EventFields = Record<
  string,
  string | number | boolean | undefined
>;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const FLUSH_INTERVAL_MS = 250;
const FLUSH_THRESHOLD_BYTES = 4096;

/**
 * Size cap (in bytes) at which the active log file is rotated. When the
 * existing `lsp.log` is at or above this size on session open, it is
 * rotated to `lsp.log.1` and a fresh `lsp.log` is created. Exported so
 * tests can size pre-rotation fixtures against the production threshold.
 */
export const MAX_BYTES = 1024 * 1024;

/**
 * Number of rotated log files to retain on disk. The active file
 * (`lsp.log`) plus `lsp.log.1` … `lsp.log.{KEEP}`. The oldest rotated
 * file is evicted on each rotation.
 */
const KEEP = 3;

let initialized = false;
let disabled = false;
let projectRoot: string | undefined;
let explicitPath: string | undefined;
let handle: Deno.FsFile | undefined;
let buffer: string[] = [];
let bufferBytes = 0;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

// ---------------------------------------------------------------------------
// Path resolution + init
// ---------------------------------------------------------------------------

function readEnvOnce(): void {
  if (initialized) return;
  initialized = true;
  if ((Deno.env.get("MARKSPEC_LSP_LOG_OFF") ?? "") !== "") {
    disabled = true;
    return;
  }
  const explicit = Deno.env.get("MARKSPEC_LSP_LOG");
  if (explicit && explicit.length > 0) {
    explicitPath = explicit;
  }
}

function resolveLogPath(): string | undefined {
  readEnvOnce();
  if (disabled) return undefined;
  if (explicitPath) return explicitPath;
  if (projectRoot) return join(projectRoot, ".markspec", "lsp.log");
  return undefined;
}

/**
 * Run an `fs` step that is expected to be a no-op when the target
 * doesn't exist. Swallows `Deno.errors.NotFound` and rethrows
 * everything else (permission denied, cross-device link, etc.) so the
 * outer `openHandleIfNeeded` catch can disable the channel cleanly.
 */
function ignoreNotFound(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}

/**
 * Rotate the active log file when it has reached {@linkcode MAX_BYTES}.
 * Performs the classic newsyslog-style shuffle:
 *
 *   lsp.log.3  ← evicted
 *   lsp.log.2  → lsp.log.3
 *   lsp.log.1  → lsp.log.2
 *   lsp.log    → lsp.log.1
 *
 * A fresh `lsp.log` is then created by the open-for-append in
 * {@linkcode openHandleIfNeeded}. The function is a no-op when the
 * file does not yet exist or is below the cap. Rotation happens at
 * most once per session because the buffered writer keeps the handle
 * open after the first open.
 */
function rotateIfNeeded(path: string): void {
  let stat: Deno.FileInfo;
  try {
    stat = Deno.statSync(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return;
    throw err;
  }
  if (stat.size < MAX_BYTES) return;
  ignoreNotFound(() => Deno.removeSync(`${path}.${KEEP}`));
  for (let i = KEEP - 1; i >= 1; i--) {
    ignoreNotFound(() => Deno.renameSync(`${path}.${i}`, `${path}.${i + 1}`));
  }
  Deno.renameSync(path, `${path}.1`);
}

function openHandleIfNeeded(): void {
  if (handle || disabled) return;
  const path = resolveLogPath();
  if (!path) return;
  try {
    Deno.mkdirSync(dirname(path), { recursive: true });
    rotateIfNeeded(path);
    handle = Deno.openSync(path, { create: true, append: true });
  } catch {
    // Any failure opening (or rotating) the log makes the channel
    // inert for the session — better than crashing the server. We
    // do not retry.
    disabled = true;
    handle = undefined;
  }
}

/**
 * Inform the event log of the project root. Called by the LSP server
 * once `onInitialize` has resolved the workspace path. Triggers a
 * one-time open of the default log file (when no explicit env var
 * overrides the path), and flushes any events queued before this
 * point.
 */
export function setProjectRoot(root: string): void {
  if (projectRoot === root) return;
  projectRoot = root;
  if (!disabled && !handle) {
    openHandleIfNeeded();
    if (handle && buffer.length > 0) flushSync();
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const QUOTABLE_RE = /[\s"=]/;

function formatValue(value: string | number | boolean): string {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (QUOTABLE_RE.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function formatLine(
  level: Level,
  kind: string,
  fields: EventFields | undefined,
): string {
  const parts: string[] = [
    `[${new Date().toISOString()}]`,
    level,
    `kind=${formatValue(kind)}`,
  ];
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      parts.push(`${k}=${formatValue(v)}`);
    }
  }
  return parts.join(" ") + "\n";
}

// ---------------------------------------------------------------------------
// Buffered emit
// ---------------------------------------------------------------------------

/** Emit one structured event. Cheap when disabled or when the log
 * destination is not yet resolved (events are simply dropped). */
export function logEvent(
  level: Level,
  kind: string,
  fields?: EventFields,
): void {
  readEnvOnce();
  if (disabled) return;
  if (!handle && !explicitPath && !projectRoot) {
    // No destination yet — drop. Callers that need pre-init capture
    // should defer their events until after setProjectRoot fires.
    return;
  }
  openHandleIfNeeded();
  if (!handle) return;
  const line = formatLine(level, kind, fields);
  buffer.push(line);
  bufferBytes += line.length;
  if (bufferBytes >= FLUSH_THRESHOLD_BYTES) {
    flushSync();
  } else if (flushTimer === undefined) {
    flushTimer = setTimeout(flushSync, FLUSH_INTERVAL_MS);
  }
}

/** Force-flush the in-memory buffer. Called on a timer, when the
 * byte threshold is exceeded, and from `onShutdown` / `onExit`. */
export function flushSync(): void {
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  if (!handle || buffer.length === 0) {
    buffer = [];
    bufferBytes = 0;
    return;
  }
  try {
    const bytes = new TextEncoder().encode(buffer.join(""));
    handle.writeSync(bytes);
  } catch {
    // Writing failed (disk full, permission lost, etc.). Disable
    // the channel to avoid repeated failures.
    disabled = true;
    try {
      handle.close();
    } catch {
      // already closed
    }
    handle = undefined;
  }
  buffer = [];
  bufferBytes = 0;
}

/** Whether the channel will actually write events. Cheap probe. */
export function isEnabled(): boolean {
  readEnvOnce();
  if (disabled) return false;
  return Boolean(explicitPath || projectRoot);
}

// ---------------------------------------------------------------------------
// Test-only reset
// ---------------------------------------------------------------------------

/** Reset all module-scoped state. Test-only. */
export function _resetEventLog(): void {
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  if (handle) {
    try {
      handle.close();
    } catch {
      // already closed
    }
  }
  initialized = false;
  disabled = false;
  projectRoot = undefined;
  explicitPath = undefined;
  handle = undefined;
  buffer = [];
  bufferBytes = 0;
}
