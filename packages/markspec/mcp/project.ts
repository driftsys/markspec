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

import {
  compile,
  type CompileResult,
  discoverProjectRoot,
  type EffectiveProfile,
  loadConfig,
  loadProfileForCommand,
  type ProfileChain,
  type ProjectConfig,
  type ReadFile,
} from "../core/mod.ts";

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

/** Filesystem + environment shim, injectable for tests. */
export interface ProjectEnv {
  /** Return the starting working directory used for root discovery. */
  cwd(): string;
  /** Read a file's text content, or undefined if missing. */
  readFile: ReadFile;
  /** Return the file's last-modified time in milliseconds since epoch. */
  stat(path: string): Promise<{ mtime: number }>;
  /** Async-iterate every file path under `root` (recursive). */
  walk(root: string): AsyncIterable<string>;
}

/** Per-tracked-file mtime snapshot. */
interface TrackedFile {
  path: string;
  mtime: number;
}

/** Handler signature for invalidation subscribers. */
export type InvalidationHandler = (result: CompileResult) => void;

/** Project context handle returned by {@linkcode createProject}. */
export interface Project {
  /** Discovered project root, or undefined when no `project.yaml` was found. */
  readonly projectRoot: string | undefined;
  /** Loaded project config, or undefined when no `project.yaml` was found. */
  readonly config: ProjectConfig | undefined;
  /** Active profile chain, or null when no profile is configured. */
  readonly profileChain: ProfileChain | null;
  /** Effective profile derived from the chain, or undefined. */
  readonly profile: EffectiveProfile | undefined;
  /** Return the current compiled graph, recompiling when stale. */
  getCompiled(): Promise<CompileResult>;
  /** Force a recompile and return the fresh result. */
  forceRefresh(): Promise<CompileResult>;
  /** Subscribe to recompile events. Returns an unsubscribe function. */
  subscribeInvalidation(handler: InvalidationHandler): () => void;
}

/**
 * Default {@linkcode ProjectEnv} backed by Deno APIs.
 *
 * Intended for use from entry points (`mcp/server.ts`). Library code should
 * never construct one of these directly — accept a `ProjectEnv` instead so
 * tests can supply an in-memory shim.
 */
export function defaultEnv(): ProjectEnv {
  return {
    cwd: () => Deno.cwd(),
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
      const path = `${dir}/${entry.name}`;
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
  const cwd = env.cwd();
  const projectRoot = await discoverProjectRoot(cwd, env.readFile);

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
    const paths = await discoverTracked();
    const result = await compile(paths, {
      readFile: async (p: string) => {
        const content = await env.readFile(p);
        if (content === undefined) {
          throw new Error(`failed to read ${p}`);
        }
        return content;
      },
      profile: profileChain?.effective ?? undefined,
    });

    // Snapshot mtimes for next invalidation check.
    const snapshot: TrackedFile[] = [];
    for (const path of paths) {
      try {
        const { mtime } = await env.stat(path);
        snapshot.push({ path, mtime });
      } catch {
        // File disappeared during compile — ignore.
      }
    }
    tracked = snapshot;
    cached = result;
    inFlight = null;
    for (const h of handlers) h(result);
    return result;
  }

  /** Detect any change in the tracked file set since the last compile. */
  async function isStale(): Promise<boolean> {
    if (!projectRoot) return false;
    // 1) Any tracked file with newer mtime, or missing?
    for (const t of tracked) {
      try {
        const { mtime } = await env.stat(t.path);
        if (mtime !== t.mtime) return true;
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
    inFlight = runCompile().catch(() => {
      // Errors surface on the awaited call.
      return null as unknown as CompileResult;
    });
  }

  return {
    projectRoot,
    config,
    profileChain,
    profile: profileChain?.effective,
    async getCompiled(): Promise<CompileResult> {
      if (!projectRoot) {
        throw new Error(
          "MarkSpec MCP server: no project.yaml found. " +
            "Operations require project context.",
        );
      }
      if (inFlight) {
        const result = await inFlight;
        if (result) return result;
      }
      if (cached && !(await isStale())) return cached;
      inFlight = runCompile();
      return await inFlight;
    },
    async forceRefresh(): Promise<CompileResult> {
      if (!projectRoot) {
        throw new Error(
          "MarkSpec MCP server: no project.yaml found. " +
            "Operations require project context.",
        );
      }
      inFlight = runCompile();
      return await inFlight;
    },
    subscribeInvalidation(handler: InvalidationHandler): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
