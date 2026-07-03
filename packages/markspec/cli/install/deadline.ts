/**
 * @module cli/install/deadline
 *
 * "Never hang" watchdog for the install commands (`markspec mcp install`,
 * `markspec lsp install`). Both actions resolve a config path and read it
 * with a single `Deno.readTextFile`; under extreme host load (many
 * concurrent `markspec` processes, a contended filesystem, or a locked
 * config file) that read can park in an uninterruptible `read()` syscall,
 * leaving the command wedged with zero output until `kill -9` (#634).
 *
 * `withDeadline` races the install work against a timer so the wedge
 * becomes a fast, diagnosable failure instead of a silent hang. Because
 * `Deno.readTextFile` runs on the blocking threadpool, the JS event loop
 * stays live and the timer still fires while the read is stuck; the CLI
 * action then prints a diagnostic and `Deno.exit`s.
 *
 * Limit (documented, not hidden): if a process instead wedges *before*
 * the runtime's event loop starts (e.g. in dyld under fork/exec
 * pressure), no JS — including this timer — runs, so the watchdog cannot
 * fire. It rescues the reachable async-I/O stall, which is the common
 * and fixable case.
 */

/** Default install-command watchdog deadline, in milliseconds. Normal
 * runs finish in well under a second, so 10 s is a wide margin that never
 * trips a legitimately-progressing invocation. */
export const DEFAULT_INSTALL_DEADLINE_MS = 10_000;

/** Environment variable overriding the install watchdog deadline (ms). */
export const INSTALL_DEADLINE_ENV = "MARKSPEC_INSTALL_TIMEOUT_MS";

/** Error thrown by {@linkcode withDeadline} when the timer wins the race. */
export class DeadlineExceeded extends Error {
  /** The deadline, in milliseconds, that was exceeded. */
  readonly ms: number;
  constructor(ms: number) {
    super(`operation exceeded ${ms}ms deadline`);
    this.name = "DeadlineExceeded";
    this.ms = ms;
  }
}

/**
 * Resolve the install watchdog deadline from the environment, falling
 * back to {@linkcode DEFAULT_INSTALL_DEADLINE_MS}.
 *
 * A missing, blank, non-numeric, zero, or negative value falls back to
 * the default so a malformed override can never silently disable the
 * watchdog. `getEnv` is injectable for testability; it defaults to the
 * process environment.
 */
export function resolveInstallDeadlineMs(
  getEnv: (key: string) => string | undefined = defaultGetEnv,
): number {
  const raw = getEnv(INSTALL_DEADLINE_ENV);
  if (raw === undefined) return DEFAULT_INSTALL_DEADLINE_MS;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_INSTALL_DEADLINE_MS;
  return n;
}

/** Read an env var, treating a denied `--allow-env` permission as unset —
 * the install commands run in contexts without env access (the e2e CLI
 * harness grants only read/write), and a missing override must fall back
 * to the default, never crash. Mirrors the orchestrators' own guarded
 * `Deno.env.get` calls (readHome / readAppData). */
function defaultGetEnv(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}

/**
 * Race `work` against a `ms`-millisecond timer.
 *
 * Resolves with `work`'s value when it settles first; rejects with
 * {@linkcode DeadlineExceeded} when the timer wins. The timer is always
 * cleared once the race settles so it cannot keep the event loop alive
 * after a fast resolve.
 */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceeded(ms)), ms);
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
