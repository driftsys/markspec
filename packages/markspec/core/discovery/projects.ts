/**
 * @module core/discovery/projects
 *
 * Project-root discovery shared by the LSP and the MCP server.
 *
 * A "project root" is a directory that holds a `project.yaml` or a
 * `.markspec.yaml`. {@linkcode discoverProjectRoots} finds the primary
 * root by walking up from a start folder, then every nested root below
 * it with the gitignore-aware file walk.
 */

import { basename, dirname, isAbsolute, relative, SEPARATOR } from "@std/path";
import { discoverProjectRoot } from "../config/mod.ts";
import { discoverMarkspecRoot, loadToolConfig } from "../config/markspec.ts";
import { discoverFiles, type DiscoveryIO } from "./mod.ts";

/** The file names whose directory can be a project root. */
const CONFIG_BASENAMES: ReadonlySet<string> = new Set([
  "project.yaml",
  ".markspec.yaml",
]);

/** `true` when `path` is `root` itself or lies below it. */
export function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  // A child directory may itself start with `..` (e.g. `..cache`), so
  // compare whole path segments, not a string prefix.
  return rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${SEPARATOR}`) && !isAbsolute(rel));
}

/**
 * Return the deepest root in `roots` that is `dir` itself or an ancestor
 * of `dir`, or `undefined` when none is.
 */
export function nearestRoot(
  dir: string,
  roots: Iterable<string>,
): string | undefined {
  let best: string | undefined;
  for (const root of roots) {
    if (!isWithin(root, dir)) continue;
    if (best === undefined || root.length > best.length) best = root;
  }
  return best;
}

/**
 * Walk up from `startDir` to the nearest `project.yaml`, else the nearest
 * `.markspec.yaml`. Returns `undefined` when neither exists. Same order as
 * the CLI's `discoverProjectRoot` fallback and `mcp/project.ts`.
 */
export async function resolveConfigRoot(
  startDir: string,
  readFile: (path: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  return await discoverProjectRoot(startDir, readFile) ??
    await discoverMarkspecRoot(startDir, readFile);
}

/**
 * Directories strictly below `root` that a document walk-up would
 * resolve to, found with the gitignore-aware project walk (honouring
 * `exclude`). Each discovered `project.yaml` or `.markspec.yaml` is
 * resolved with {@linkcode resolveConfigRoot} from its own directory, so a
 * `.markspec.yaml` below a `project.yaml` is not a root of its own — the
 * same answer the CLI gives for a file there. The result is sorted.
 */
export async function findNestedProjectRoots(
  root: string,
  io: DiscoveryIO,
  exclude?: readonly string[],
): Promise<string[]> {
  const out = new Set<string>();
  for await (
    const path of discoverFiles(root, io, {
      extensions: new Set([".yaml"]),
      exclude,
    })
  ) {
    if (!CONFIG_BASENAMES.has(basename(path))) continue;
    const dir = dirname(path);
    if (dir === root) continue;
    const found = await resolveConfigRoot(dir, io.readFile);
    if (found !== undefined && found !== root && isWithin(root, found)) {
      out.add(found);
    }
  }
  return [...out].sort();
}

/** Options for {@linkcode discoverProjectRoots}. */
export interface ProjectDiscoveryOptions {
  /** The user's home folder. A start folder with no config that equals
   * this folder is not scanned downward. */
  readonly homeDir?: string;
}

/**
 * Find every MarkSpec project reachable from `startDir`.
 *
 * `primaryRoot` is the nearest config root found by walking up from
 * `startDir` (see {@linkcode resolveConfigRoot}), or `startDir` itself
 * when there is none. `roots` holds the primary root (only when it has a
 * config) plus every nested root below it, sorted. The nested scan honours
 * the primary project's `.markspec.yaml` `exclude:` list. When the primary
 * root has no config and is a filesystem root or `options.homeDir`, no
 * downward scan runs and `roots` is empty.
 */
export async function discoverProjectRoots(
  startDir: string,
  io: DiscoveryIO,
  options: ProjectDiscoveryOptions = {},
): Promise<{ primaryRoot: string; roots: string[] }> {
  const configRoot = await resolveConfigRoot(startDir, io.readFile);
  const primaryRoot = configRoot ?? startDir;
  if (configRoot === undefined) {
    const isFilesystemRoot = dirname(primaryRoot) === primaryRoot;
    if (isFilesystemRoot || primaryRoot === options.homeDir) {
      return { primaryRoot, roots: [] };
    }
  }
  const { config } = configRoot !== undefined
    ? await loadToolConfig(primaryRoot, io.readFile)
    : { config: undefined };
  const nested = await findNestedProjectRoots(
    primaryRoot,
    io,
    config?.exclude,
  );
  const roots = configRoot !== undefined ? [primaryRoot, ...nested] : nested;
  return { primaryRoot, roots: roots.sort() };
}
