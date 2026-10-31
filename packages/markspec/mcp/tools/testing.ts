/**
 * @module mcp/tools/testing
 *
 * Test helpers for the MCP tool tests: an in-memory {@linkcode ProjectEnv}
 * for building real workspaces, and a wrapper that turns one stub
 * {@linkcode Project} into a one-project workspace. Not used by production
 * code.
 */

import { join, resolve, SEPARATOR } from "@std/path";
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

/** A {@linkcode ProjectEnv} over an in-memory file map. Folders are implied
 * by the file paths. */
export function memoryEnv(
  files: Record<string, string>,
  cwd: string = MEMORY_PARENT,
): ProjectEnv {
  const store = new Map(Object.entries(files));
  const under = (dir: string, path: string) =>
    path.startsWith(dir.endsWith(SEPARATOR) ? dir : dir + SEPARATOR);
  return {
    cwd: () => cwd,
    rootOverrides: () => [],
    readFile: (path) => Promise.resolve(store.get(path)),
    readDir: async function* (dir) {
      const seen = new Set<string>();
      for (const path of store.keys()) {
        if (!under(dir, path)) continue;
        const rest = path.slice(dir.length).replace(/^[\\/]/, "");
        const name = rest.split(/[\\/]/)[0];
        if (seen.has(name)) continue;
        seen.add(name);
        const isFile = rest === name;
        yield { name, isFile, isDirectory: !isFile };
      }
    },
    homeDir: () => undefined,
    realPath: (path) => Promise.resolve(path),
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
 * Wrap one stub {@linkcode Project} as a workspace. A project with
 * `markspecDetected: false` gives an empty workspace whose soft-gate
 * message is the project's; otherwise the workspace holds the project
 * under label `"."`.
 */
export function workspaceOf(project: Project): McpWorkspace {
  const list: readonly WorkspaceProject[] = project.markspecDetected
    ? [{ label: ".", project }]
    : [];
  return {
    startRoot: project.projectRoot ?? "",
    projects: () => list,
    softGateMessage: project.markspecDetected
      ? undefined
      : project.softGateMessage,
    select(label?: string) {
      if (label === undefined || label === ".") return list;
      return `Unknown project "${label}". Known projects: ${
        list.map((p) => p.label).join(", ")
      }.`;
    },
    ownerOf: () => list[0],
    canonicalPath: (path) => Promise.resolve(path),
    rediscover: () => Promise.resolve(),
    subscribeInvalidation: () => () => {},
  };
}
