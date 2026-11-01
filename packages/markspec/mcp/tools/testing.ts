/**
 * @module mcp/tools/testing
 *
 * Test helpers for the MCP tool tests: an in-memory {@linkcode ProjectEnv}
 * for building real workspaces, and stub workspaces over stub
 * {@linkcode Project}s. Shared by the MCP tests that need an in-memory
 * environment or workspace. Not used by production code.
 */

import { join, resolve, SEPARATOR } from "@std/path";
import { nearestRoot } from "../../core/mod.ts";
import type { Project, ProjectEnv } from "../project.ts";
import type { McpWorkspace, WorkspaceProject } from "../workspace.ts";

/** The parent folder used by the in-memory fixtures. */
export const MEMORY_PARENT = resolve("/work");

/** A minimal `project.yaml` body. */
export const PROJECT_YAML = `name: test\nversion: 0.0.1\n`;

/** An entry document with one entry. */
export function entryDoc(
  displayId: string,
  title: string,
  ulid: string,
  trailer = "",
): string {
  return `- [${displayId}] ${title}\n\n  Body.\n\n      Id: ${ulid}\n${trailer}`;
}

/** Files for two sibling projects `a` and `b` below {@linkcode MEMORY_PARENT}. */
export function twoProjectFiles(
  docA: string,
  docB: string,
): Record<string, string> {
  return {
    [join(MEMORY_PARENT, "a", "project.yaml")]: PROJECT_YAML,
    [join(MEMORY_PARENT, "a", "req.md")]: docA,
    [join(MEMORY_PARENT, "b", "project.yaml")]: PROJECT_YAML,
    [join(MEMORY_PARENT, "b", "req.md")]: docB,
  };
}

/**
 * The direct children of `dir` implied by a set of file paths (an in-memory
 * `ProjectEnv.readDir`).
 */
export async function* listChildren(
  paths: Iterable<string>,
  dir: string,
): AsyncGenerator<{ name: string; isFile: boolean; isDirectory: boolean }> {
  const prefix = dir.endsWith(SEPARATOR) ? dir : dir + SEPARATOR;
  const seen = new Set<string>();
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const name = rest.split(/[\\/]/)[0];
    if (seen.has(name)) continue;
    seen.add(name);
    const isFile = rest === name;
    yield { name, isFile, isDirectory: !isFile };
  }
}

/** Options for {@linkcode memoryEnv}. */
export interface MemoryEnvOptions {
  readonly cwd?: string;
  readonly rootOverrides?: string[];
  readonly realPath?: (path: string) => string;
  readonly homeDir?: string;
}

/** A {@linkcode ProjectEnv} over an in-memory file map. Folders are implied
 * by the file paths. `store` is the live file map, so a test can add or
 * remove files after the environment was built. */
export function memoryEnv(
  files: Record<string, string>,
  options: MemoryEnvOptions = {},
): ProjectEnv & { readonly store: Map<string, string> } {
  const store = new Map(Object.entries(files));
  const under = (dir: string, path: string) =>
    path.startsWith(dir.endsWith(SEPARATOR) ? dir : dir + SEPARATOR);
  return {
    store,
    cwd: () => options.cwd ?? MEMORY_PARENT,
    rootOverrides: () => options.rootOverrides ?? [],
    readFile: (path) => Promise.resolve(store.get(path)),
    readDir: (dir) => listChildren(store.keys(), dir),
    homeDir: () => options.homeDir,
    realPath: (path) => Promise.resolve(options.realPath?.(path) ?? path),
    stat: (path) => {
      if (!store.has(path)) return Promise.reject(new Error(`ENOENT ${path}`));
      return Promise.resolve({ mtime: 1 });
    },
    walk: async function* (root) {
      for (const path of store.keys()) if (under(root, path)) yield path;
    },
  };
}

/**
 * A workspace over stub projects, listed in the given order. `select` and
 * `ownerOf` follow the production rules: a label picks its project (`"."`
 * names the only project), and a path belongs to the project with the
 * nearest root above it.
 */
export function stubWorkspace(
  entries: readonly WorkspaceProject[],
  options: { startRoot?: string; softGateMessage?: string } = {},
): McpWorkspace {
  return {
    startRoot: options.startRoot ?? "/work",
    projects: () => entries,
    softGateMessage: options.softGateMessage,
    select(label?: string) {
      if (label === undefined) return entries;
      const match = entries.filter((e) => e.label === label);
      if (match.length > 0) return match;
      if (label === "." && entries.length === 1) return entries;
      return `Unknown project "${label}". Known projects: ${
        entries.map((e) => e.label).join(", ")
      }.`;
    },
    ownerOf(absPath: string) {
      const roots = new Map<string, WorkspaceProject>();
      for (const e of entries) {
        if (e.project.projectRoot !== undefined) {
          roots.set(e.project.projectRoot, e);
        }
      }
      const root = nearestRoot(absPath, roots.keys());
      return root === undefined ? undefined : roots.get(root);
    },
    canonicalPath: (path) => Promise.resolve(path),
    rediscover: () => Promise.resolve(),
    subscribeInvalidation: () => () => {},
  };
}

/**
 * Wrap one stub {@linkcode Project} as a workspace. A project with
 * `markspecDetected: false` gives an empty workspace whose soft-gate
 * message is the project's; otherwise the workspace holds the project
 * under label `"."`.
 */
export function workspaceOf(project: Project): McpWorkspace {
  return stubWorkspace(
    project.markspecDetected ? [{ label: ".", project }] : [],
    {
      startRoot: project.projectRoot ?? "",
      softGateMessage: project.markspecDetected
        ? undefined
        : project.softGateMessage,
    },
  );
}
