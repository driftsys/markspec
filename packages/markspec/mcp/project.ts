/**
 * @module mcp/project
 *
 * Project context for the MCP server. Discovers the project root from a
 * starting CWD, loads the active profile, caches a `CompileResult`, and
 * refreshes the cache when tracked files change (mtime check) or when a
 * caller invokes `forceRefresh()`.
 *
 * All I/O is injected via {@linkcode ProjectEnv} so this module is testable
 * without filesystem access.
 */

import { join } from "@std/path";
import {
  compile,
  type CompileResult,
  type DeliveredDocument,
  discoverProjectRoot,
  type EffectiveProfile,
  loadConfig,
  loadDeliveredCorpus,
  loadProfileForCommand,
  type ProfileChain,
  type ProjectConfig,
  type ReadFile,
} from "../core/mod.ts";

/**
 * Canonical soft-gate message returned when no MarkSpec project is detected
 * in the workspace. Load-bearing: the trigger language in tool descriptions
 * (ADR-023) keys on the phrase "No MarkSpec project found" verbatim. Do not
 * paraphrase across handlers.
 */
export const SOFT_GATE_MESSAGE =
  "No MarkSpec project found in this workspace (looked for .markspec.yaml and project.yaml from cwd upward). This MCP server has no work to do here — stop calling MarkSpec tools.";

/**
 * Compose the soft-gate message that names every directory searched. Starts
 * with the same load-bearing phrase as {@linkcode SOFT_GATE_MESSAGE} (ADR-023)
 * and points the operator at the `--root` / `MARKSPEC_PROJECT_ROOT` remedies.
 */
export function buildSoftGateMessage(searchedDirs: readonly string[]): string {
  const dirs = searchedDirs.join(", ");
  return "No MarkSpec project found in this workspace.\n" +
    `Searched from: ${dirs} (walked upward for .markspec.yaml / project.yaml).\n` +
    "Point the server at your project with `markspec mcp --root <path>` or the " +
    "MARKSPEC_PROJECT_ROOT environment variable. This server has no work to do " +
    "here — stop calling MarkSpec tools.";
}

/**
 * Detect whether the workspace at `cwd` is a MarkSpec project.
 *
 * Walks up from `cwd` checking for either `project.yaml` (canonical config)
 * or `.markspec.yaml` (profile activation chain). Returns `true` as soon as
 * either is found, `false` only when neither is found anywhere up to the
 * filesystem root.
 *
 * Per ADR-023 §6.1.
 */
export async function detectMarkspecProject(
  cwd: string,
  readFile: ReadFile,
): Promise<boolean> {
  let dir = cwd;
  while (true) {
    if (await readFile(join(dir, "project.yaml")) !== undefined) return true;
    if (await readFile(join(dir, ".markspec.yaml")) !== undefined) return true;
    const parent = join(dir, "..");
    // join("/", "..") → "/" on POSIX (idempotent at root). Detect with
    // equality rather than parent.length, which doesn't catch the case.
    const resolvedParent = parent === dir ? null : parent;
    if (resolvedParent === null) return false;
    dir = resolvedParent;
  }
}

/** Files MarkSpec parses: Markdown plus supported source extensions. */
const TRACKED_EXTENSIONS = new Set([
  ".md",
  ".rs",
  ".kt",
  ".kts",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".cxx",
  ".hpp",
  ".hxx",
]);

/** Directories never scanned for tracked files. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".worktrees",
  "target",
  "dist",
  "build",
  ".claude",
]);

/**
 * Assemble the ordered project-root override candidates that take precedence
 * over the launch `cwd`. Order encodes precedence (first wins): explicit
 * `--root` flags, then `MARKSPEC_PROJECT_ROOT` (colon-separated, POSIX
 * `PATH`-style), then Claude Code's auto-injected `CLAUDE_PROJECT_DIR`. Blank
 * segments are dropped so an unset or empty env var contributes nothing, and
 * each kept candidate is trimmed of surrounding whitespace.
 */
export function buildRootOverrides(
  flagRoots: readonly string[],
  markspecProjectRoot: string | undefined,
  claudeProjectDir: string | undefined,
): string[] {
  const out: string[] = [];
  // Push trimmed values: a padded candidate (e.g. " /real ") would otherwise
  // reach discoverProjectRoot, whose resolve() treats a leading-space path as
  // relative — silently producing a garbage root that never matches.
  for (const r of flagRoots) {
    const trimmed = r.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  if (markspecProjectRoot) {
    for (const seg of markspecProjectRoot.split(":")) {
      const trimmed = seg.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  if (claudeProjectDir) {
    const trimmed = claudeProjectDir.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

/** Filesystem + environment shim, injectable for tests. */
export interface ProjectEnv {
  /** Return the starting working directory used for root discovery. */
  cwd(): string;
  /**
   * Ordered project-root override candidates that take precedence over
   * {@linkcode ProjectEnv.cwd} during discovery. See
   * {@linkcode buildRootOverrides}.
   */
  rootOverrides(): string[];
  /** Read a file's text content, or undefined if missing. */
  readFile: ReadFile;
  /** Return the file's last-modified time in milliseconds since epoch. */
  stat(path: string): Promise<{ mtime: number }>;
  /** Async-iterate every file path under `root` (recursive). */
  walk(root: string): AsyncIterable<string>;
}

/** Per-tracked-file mtime + content-hash snapshot. */
interface TrackedFile {
  path: string;
  mtime: number;
  /** SHA-256 hex digest of file content. `undefined` → no hash stored (treat as stale on mtime change). */
  contentHash?: string;
}

/** Compute SHA-256 hex digest of UTF-8 text using the Web Crypto global. */
async function sha256(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(buf);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Two-step staleness gate for a single file.
 *
 * - **Fast gate**: if `currentMtime === storedMtime`, the file is unchanged → not stale.
 *   `readContent` is never called.
 * - **Truth gate**: if mtime changed, compute the content hash. If `storedHash` is
 *   `undefined` (no hash recorded yet), treat as stale. Otherwise compare hashes —
 *   content-identical files (e.g. after `git checkout`) are not stale.
 *
 * Exported for unit testing.
 */
export async function checkFileStaleness(
  storedMtime: number,
  storedHash: string | undefined,
  currentMtime: number,
  readContent: () => Promise<string | undefined>,
): Promise<boolean> {
  if (currentMtime === storedMtime) return false; // fast path
  if (!storedHash) return true; // no stored hash → always stale
  const content = await readContent();
  if (content === undefined) return true; // file gone
  const currentHash = await sha256(content);
  return currentHash !== storedHash;
}

/** Handler signature for invalidation subscribers. */
export type InvalidationHandler = (
  result: CompileResult,
) => void | Promise<void>;

/** Project context handle returned by {@linkcode createProject}. */
export interface Project {
  /** Discovered project root, or undefined when no `project.yaml` was found. */
  readonly projectRoot: string | undefined;
  /**
   * `true` when the workspace contains either `project.yaml` or
   * `.markspec.yaml` anywhere up the directory tree from cwd. Tools and
   * resources should short-circuit with `SOFT_GATE_MESSAGE` when this is
   * `false`. Per ADR-023 §6.
   */
  readonly markspecDetected: boolean;
  /**
   * Human-readable "no project here" message naming the directories searched,
   * for tools/resources to return when {@linkcode Project.markspecDetected} is
   * `false`. Starts with the load-bearing ADR-023 phrase.
   */
  readonly softGateMessage: string;
  /** Loaded project config, or undefined when no `project.yaml` was found. */
  readonly config: ProjectConfig | undefined;
  /** Active profile chain, or null when no profile is configured. */
  readonly profileChain: ProfileChain | null;
  /** Effective profile derived from the chain, or undefined. */
  readonly profile: EffectiveProfile | undefined;
  /** Documents delivered by the active profile chain (ADR-030). */
  readonly delivers: readonly DeliveredDocument[];
  /** Return the current compiled graph, recompiling when stale. */
  getCompiled(): Promise<CompileResult>;
  /** Force a recompile and return the fresh result. */
  forceRefresh(): Promise<CompileResult>;
  /** Subscribe to recompile events. Returns an unsubscribe function. */
  subscribeInvalidation(handler: InvalidationHandler): () => void;
  /** Read a delivered document's raw text from the profile cache. */
  readDeliveredDocument(
    profileId: string,
    relPath: string,
  ): Promise<string | undefined>;
}

/**
 * Default {@linkcode ProjectEnv} backed by Deno APIs.
 *
 * Intended for use from entry points (`mcp/server.ts`). Library code should
 * never construct one of these directly — accept a `ProjectEnv` instead so
 * tests can supply an in-memory shim.
 */
export function defaultEnv(flagRoots: readonly string[] = []): ProjectEnv {
  const envGet = (key: string): string | undefined => {
    try {
      return Deno.env.get(key);
    } catch {
      return undefined; // --allow-env not granted; treat as unset
    }
  };
  return {
    cwd: () => Deno.cwd(),
    rootOverrides: () =>
      buildRootOverrides(
        flagRoots,
        envGet("MARKSPEC_PROJECT_ROOT"),
        envGet("CLAUDE_PROJECT_DIR"),
      ),
    readFile: async (path: string) => {
      try {
        return await Deno.readTextFile(path);
      } catch {
        return undefined;
      }
    },
    stat: async (path: string) => {
      const stat = await Deno.stat(path);
      return { mtime: stat.mtime?.getTime() ?? 0 };
    },
    walk: (root: string) => walkFs(root),
  };
}

/** Recursive filesystem walker used by {@linkcode defaultEnv}. */
async function* walkFs(dir: string): AsyncGenerator<string> {
  try {
    for await (const entry of Deno.readDir(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          yield* walkFs(path);
        }
      } else if (entry.isFile) {
        yield path;
      }
    }
  } catch {
    // Skip unreadable directories.
  }
}

/**
 * Initialize a project context from the given environment. Performs
 * project-root discovery, loads config + profile, and kicks off a
 * background compile.
 *
 * Returns a {@linkcode Project} handle whose {@linkcode Project.getCompiled}
 * method awaits the background compile on first call.
 */
export async function createProject(env: ProjectEnv): Promise<Project> {
  // Ordered discovery candidates: explicit overrides first (Task 1), launch
  // cwd last. First candidate whose upward walk detects a project wins (D2).
  const candidates = [...env.rootOverrides(), env.cwd()];
  let markspecDetected = false;
  let projectRoot: string | undefined;
  for (const candidate of candidates) {
    if (await detectMarkspecProject(candidate, env.readFile)) {
      markspecDetected = true;
      projectRoot = await discoverProjectRoot(candidate, env.readFile);
      break;
    }
  }
  const softGateMessage = buildSoftGateMessage(candidates);

  let config: ProjectConfig | undefined;
  let profileChain: ProfileChain | null = null;

  if (projectRoot) {
    try {
      const loaded = await loadConfig(projectRoot, env.readFile);
      config = loaded?.config;
    } catch { /* config errors surface on first compile */ }

    try {
      const result = await loadProfileForCommand(projectRoot, env.readFile);
      profileChain = result.chain;
    } catch { /* profile errors surface on first compile */ }
  }

  // Cache state.
  let inFlight: Promise<CompileResult> | null = null;
  let cached: CompileResult | null = null;
  let tracked: TrackedFile[] = [];
  const handlers = new Set<InvalidationHandler>();

  /** Discover all tracked file paths under `projectRoot`. */
  async function discoverTracked(): Promise<string[]> {
    if (!projectRoot) return [];
    const out: string[] = [];
    for await (const path of env.walk(projectRoot)) {
      const dot = path.lastIndexOf(".");
      if (dot < 0) continue;
      const ext = path.slice(dot).toLowerCase();
      if (TRACKED_EXTENSIONS.has(ext)) out.push(path);
    }
    out.sort();
    return out;
  }

  /** Run compile() over current tracked set; update cache. */
  async function runCompile(): Promise<CompileResult> {
    try {
      const paths = await discoverTracked();
      const corpus = profileChain
        ? await loadDeliveredCorpus(
          profileChain.effective.delivers,
          env.readFile,
        )
        : { entries: [], diagnostics: [] };
      const result = await compile(paths, {
        readFile: async (p: string) => {
          const content = await env.readFile(p);
          if (content === undefined) {
            throw new Error(`failed to read ${p}`);
          }
          return content;
        },
        profile: profileChain?.effective ?? undefined,
        corpusEntries: corpus.entries,
      });

      // Surface corpus-load diagnostics (e.g. PROFILE-DELIVERS-001 for a
      // missing delivered file) in the compiled context — CLI `check`
      // parity: without this, the MCP validate tool reports clean on a
      // project whose `markspec check` fails. Corpus diagnostics lead;
      // compile diagnostics keep their own order (determinism).
      const merged = corpus.diagnostics.length > 0
        ? {
          ...result,
          diagnostics: [...corpus.diagnostics, ...result.diagnostics],
        }
        : result;

      // Snapshot mtime + SHA256 hash for the next invalidation check.
      const snapshot: TrackedFile[] = [];
      for (const path of paths) {
        try {
          const { mtime } = await env.stat(path);
          const content = await env.readFile(path);
          const contentHash = content !== undefined
            ? await sha256(content)
            : undefined;
          snapshot.push({ path, mtime, contentHash });
        } catch {
          // File disappeared during compile — ignore.
        }
      }
      tracked = snapshot;
      cached = merged;
      // Fire handlers AFTER cache is committed but isolate handler errors so
      // one bad subscriber doesn't break others or abort the compile result.
      // Async handlers are not awaited — their rejections are caught and logged.
      for (const h of handlers) {
        const maybePromise = (() => {
          try {
            return h(merged);
          } catch (err) {
            console.error(`InvalidationHandler sync error: ${err}`);
            return undefined;
          }
        })();
        if (maybePromise instanceof Promise) {
          maybePromise.catch((err) => {
            console.error(`InvalidationHandler async error: ${err}`);
          });
        }
      }
      return merged;
    } finally {
      // Always reset the in-flight slot — success or failure — so a subsequent
      // call can retry. Without this, a single compile failure jams the cache
      // permanently (every future await re-throws the same rejection).
      inFlight = null;
    }
  }

  /**
   * Idempotent compile starter. Returns the existing in-flight promise if
   * one is running; otherwise starts a new compile and stores its promise.
   * This is the single gate through which all recompiles must pass — it
   * prevents two concurrent callers from kicking off duplicate compiles.
   */
  function ensureCompile(): Promise<CompileResult> {
    if (!inFlight) inFlight = runCompile();
    return inFlight;
  }

  /** Detect any change in the tracked file set since the last compile. */
  async function isStale(): Promise<boolean> {
    if (!projectRoot) return false;
    // 1) Any tracked file that is stale (mtime fast path → SHA256 truth gate)?
    for (const t of tracked) {
      try {
        const { mtime } = await env.stat(t.path);
        const stale = await checkFileStaleness(
          t.mtime,
          t.contentHash,
          mtime,
          () => env.readFile(t.path),
        );
        if (stale) return true;
      } catch {
        return true; // file disappeared
      }
    }
    // 2) Any new tracked file?
    const known = new Set(tracked.map((t) => t.path));
    for await (const path of env.walk(projectRoot)) {
      const dot = path.lastIndexOf(".");
      if (dot < 0) continue;
      const ext = path.slice(dot).toLowerCase();
      if (!TRACKED_EXTENSIONS.has(ext)) continue;
      if (!known.has(path)) return true;
    }
    return false;
  }

  // Kick off background compile so first tool call doesn't pay the cost.
  if (projectRoot) {
    const promise = ensureCompile();
    // Prevent unhandled-rejection warnings if no caller awaits this promise
    // immediately. The error still surfaces naturally on the first
    // getCompiled() / forceRefresh() call, and inFlight will have been reset
    // to null by runCompile()'s finally so the next call can retry.
    promise.catch(() => {});
  }

  return {
    projectRoot,
    markspecDetected,
    softGateMessage,
    config,
    profileChain,
    profile: profileChain?.effective,
    delivers: profileChain?.effective.delivers ?? [],
    async readDeliveredDocument(
      profileId: string,
      relPath: string,
    ): Promise<string | undefined> {
      const doc = (profileChain?.effective.delivers ?? []).find(
        (d) => d.profileId === profileId && d.path === relPath,
      );
      if (!doc) return undefined;
      return await env.readFile(doc.absPath);
    },
    async getCompiled(): Promise<CompileResult> {
      if (!projectRoot) {
        throw new Error(
          "MarkSpec MCP server: no project.yaml found. " +
            "Operations require project context.",
        );
      }
      // Ride an in-flight compile if one is already running.
      if (inFlight) return await inFlight;
      // Stale-check is async — re-check inFlight afterwards in case another
      // caller raced us into starting a compile during the await.
      if (cached && !(await isStale())) {
        if (inFlight) return await inFlight;
        return cached;
      }
      return await ensureCompile();
    },
    async forceRefresh(): Promise<CompileResult> {
      if (!projectRoot) {
        throw new Error(
          "MarkSpec MCP server: no project.yaml found. " +
            "Operations require project context.",
        );
      }
      // Wait for any in-flight compile to settle so its finally-block can
      // reset inFlight before we start a fresh one. Then clear the cache so
      // ensureCompile unconditionally kicks off a new compile.
      if (inFlight) {
        try {
          await inFlight;
        } catch { /* ignore — errors surface on next getCompiled() */ }
      }
      cached = null;
      return await ensureCompile();
    },
    subscribeInvalidation(handler: InvalidationHandler): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
