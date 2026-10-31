/**
 * @module mcp/workspace
 *
 * The set of MarkSpec projects the MCP server answers for. Discovers every
 * project root at and below the start folder (`discoverProjectRoots`) and
 * holds one {@linkcode Project} per root. Each project skips the files of
 * the projects nested below it. When discovery finds exactly one project it
 * compiles in the background at once, as before; with several projects,
 * each one compiles only on its first use, so startup runs discovery only.
 *
 * All I/O goes through the injected {@linkcode ProjectEnv}.
 */

import { dirname, relative, SEPARATOR } from "@std/path";
import { discoverProjectRoots, nearestRoot } from "../core/mod.ts";
import {
  buildSoftGateMessage,
  openProject,
  type Project,
  type ProjectEnv,
} from "./project.ts";

/** One project of the workspace, with the label tools and resources show. */
export interface WorkspaceProject {
  /** The project root relative to {@linkcode McpWorkspace.startRoot}, with
   * `/` separators; `"."` for the start root itself. */
  readonly label: string;
  /** The project context for this root. */
  readonly project: Project;
}

/** Every MarkSpec project reachable from the server's start folder. */
export interface McpWorkspace {
  /** The canonical (symlink-resolved) primary root that discovery started
   * from. Labels are relative to it. */
  readonly startRoot: string;
  /** The current projects, sorted by label. */
  projects(): readonly WorkspaceProject[];
  /** The "no project found" message; set only when `projects()` is empty. */
  readonly softGateMessage?: string;
  /**
   * Resolve a `project` tool argument. `undefined` selects every project;
   * `"."` selects the only project when there is exactly one. Returns the
   * error text for an unknown label.
   */
  select(label?: string): readonly WorkspaceProject[] | string;
  /** The project whose root is the deepest ancestor of the canonical
   * absolute path `absPath`, or `undefined` when no project holds it. */
  ownerOf(absPath: string): WorkspaceProject | undefined;
  /** Resolve symlinks in the absolute path `absPath`, as discovery does for
   * project roots; returns it unchanged when that fails (for example a
   * missing file). Use it before {@linkcode McpWorkspace.ownerOf}. */
  canonicalPath(absPath: string): Promise<string>;
  /** Re-run discovery. Projects whose root is still present are reused. */
  rediscover(): Promise<void>;
  /**
   * Call `handler` when any project recompiles or when `rediscover` changes
   * the set of projects. Returns an unsubscribe function.
   */
  subscribeInvalidation(handler: () => void): () => void;
}

/** The result of one discovery run. */
interface Discovery {
  readonly startRoot: string;
  readonly roots: readonly string[];
  readonly candidates: readonly string[];
}

/** An opened project and the unsubscribe function for its invalidations. */
interface OpenedProject {
  readonly project: Project;
  readonly unsubscribe: () => void;
}

/** Resolve symlinks in `path`; return it unchanged when that fails. */
async function canonical(env: ProjectEnv, path: string): Promise<string> {
  try {
    return await env.realPath(path);
  } catch {
    return path;
  }
}

/**
 * Try the ADR-028 candidates in order (`--root`, `MARKSPEC_PROJECT_ROOT`,
 * `CLAUDE_PROJECT_DIR`, cwd). The first candidate whose discovery finds at
 * least one root wins. When none does, `roots` is empty and `startRoot` is
 * the primary root of the last candidate (the cwd). A candidate that
 * repeats an earlier one, as given or after symlink resolution, is skipped.
 */
async function discover(env: ProjectEnv): Promise<Discovery> {
  const candidates = [...new Set([...env.rootOverrides(), env.cwd()])];
  const home = env.homeDir();
  // discoverProjectRoots compares homeDir as a raw string, so both sides
  // must be canonical paths.
  const homeDir = home === undefined ? undefined : await canonical(env, home);
  const io = {
    readDir: (path: string) => env.readDir(path),
    readFile: env.readFile,
  };
  let startRoot = "";
  const scanned = new Set<string>();
  for (const candidate of candidates) {
    const startDir = await canonical(env, candidate);
    if (scanned.has(startDir)) continue;
    scanned.add(startDir);
    const found = await discoverProjectRoots(startDir, io, { homeDir });
    startRoot = found.primaryRoot;
    if (found.roots.length > 0) {
      return { startRoot, roots: found.roots, candidates };
    }
  }
  return { startRoot, roots: [], candidates };
}

/** The label of `root` relative to `startRoot`. */
function labelOf(startRoot: string, root: string): string {
  const rel = relative(startRoot, root);
  return rel === "" ? "." : rel.split(SEPARATOR).join("/");
}

/**
 * Discover every project below the start folder and open one
 * {@linkcode Project} per root. Only a lone project starts compiling at
 * once; with several, each compiles on first use. A project whose config is
 * malformed still appears and reports its problem when used.
 */
export async function createWorkspace(env: ProjectEnv): Promise<McpWorkspace> {
  const handlers = new Set<() => void>();
  const opened = new Map<string, OpenedProject>();
  // Read by every project's `ownsFile` on each call, so a project added
  // below an existing one by `rediscover` takes its files from then on.
  let currentRoots: readonly string[] = [];
  let discovery: Discovery = { startRoot: "", roots: [], candidates: [] };
  let projectList: readonly WorkspaceProject[] = [];

  function notify(): void {
    for (const handler of handlers) {
      try {
        handler();
      } catch (err) {
        console.error(`Workspace invalidation handler error: ${err}`);
      }
    }
  }

  /** Install a discovery result. Returns `true` when the project set or
   * any label changed. */
  async function apply(next: Discovery): Promise<boolean> {
    const previousLabels = projectList.map((p) => p.label).join("\n");
    const previousRoots = [...opened.keys()].join("\n");
    currentRoots = next.roots;
    // One project: compile at once, as the single-project server always
    // did. Several: compile each one on first use.
    const eager = next.roots.length === 1;
    const kept = new Map<string, OpenedProject>();
    for (const root of next.roots) {
      let entry = opened.get(root);
      if (entry === undefined) {
        const project = await openProject(root, env, {
          ownsFile: (path) => nearestRoot(dirname(path), currentRoots) === root,
          eager,
        });
        const unsubscribe = project.subscribeInvalidation(() => notify());
        entry = { project, unsubscribe };
      }
      kept.set(root, entry);
    }
    for (const [root, entry] of opened) {
      if (!kept.has(root)) entry.unsubscribe();
    }
    opened.clear();
    for (const [root, entry] of kept) opened.set(root, entry);
    discovery = next;
    projectList = [...opened.entries()]
      .map(([root, { project }]) => ({
        label: labelOf(next.startRoot, root),
        project,
      }))
      .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    return projectList.map((p) => p.label).join("\n") !== previousLabels ||
      [...opened.keys()].join("\n") !== previousRoots;
  }

  await apply(await discover(env));

  // Serializes rediscover runs so two refreshes never interleave their
  // updates to `opened`.
  let rediscoverChain: Promise<void> = Promise.resolve();

  return {
    get startRoot(): string {
      return discovery.startRoot;
    },
    projects: () => projectList,
    get softGateMessage(): string | undefined {
      return projectList.length === 0
        ? buildSoftGateMessage(discovery.candidates, { searchedBelow: true })
        : undefined;
    },
    select(label?: string): readonly WorkspaceProject[] | string {
      if (label === undefined) return projectList;
      const match = projectList.filter((p) => p.label === label);
      if (match.length > 0) return match;
      // "." names the only project even when its root is below the start
      // root (for example a folder holding one project).
      if (label === "." && projectList.length === 1) return projectList;
      const known = projectList.map((p) => p.label).join(", ");
      return `Unknown project "${label}". Known projects: ${known}.`;
    },
    ownerOf(absPath: string): WorkspaceProject | undefined {
      const root = nearestRoot(absPath, currentRoots);
      if (root === undefined) return undefined;
      const owner = opened.get(root)?.project;
      return projectList.find((p) => p.project === owner);
    },
    canonicalPath: (absPath: string) => canonical(env, absPath),
    rediscover(): Promise<void> {
      const run = rediscoverChain.then(async () => {
        if (await apply(await discover(env))) notify();
      });
      rediscoverChain = run.catch(() => {});
      return run;
    },
    subscribeInvalidation(handler: () => void): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
