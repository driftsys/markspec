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
import {
  discoverFiles,
  type DiscoverOptions,
  type DiscoveryIO,
} from "./mod.ts";
import { type GitignoreRule, isIgnored, parseGitignore } from "./gitignore.ts";

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
 * same answer the CLI gives for a file there. A found root is dropped when
 * the `.markspec.yaml` `exclude:` list of another found root above it
 * covers it: each project's exclude list applies to its own subtree, with
 * patterns relative to that project. The result is sorted.
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
  const nested = [...out];
  const excludeRules = new Map<string, readonly GitignoreRule[]>();
  const kept: string[] = [];
  for (const candidate of nested) {
    let covered = false;
    for (const ancestor of nested) {
      if (ancestor === candidate || !isWithin(ancestor, candidate)) continue;
      let rules = excludeRules.get(ancestor);
      if (rules === undefined) {
        const { config } = await loadToolConfig(ancestor, io.readFile);
        rules = parseGitignore(config.exclude.join("\n"), "");
        excludeRules.set(ancestor, rules);
      }
      if (isExcludedDir(relative(ancestor, candidate), rules)) {
        covered = true;
        break;
      }
    }
    if (!covered) kept.push(candidate);
  }
  return kept.sort();
}

/** Result of {@linkcode discoverOwnedFiles}. */
export interface OwnedFiles {
  /** Absolute paths of the files that belong to the walked root itself, in
   * walk order. Files of nested projects are not included. */
  readonly files: string[];
  /** Roots of the projects nested strictly below the walked root, sorted
   * (see {@linkcode findNestedProjectRoots}). */
  readonly nestedRoots: string[];
}

/**
 * Walk `root` and return only the files that belong to `root` itself: a
 * file belongs to its nearest project root among `root` and the nested
 * roots found below it. Files under a nested project are left out, so each
 * file is owned by exactly one project (ADR-028 section 7).
 *
 * `options` (`extensions`, `exclude`) apply to the file walk. The nested
 * roots are found with the same `exclude` list. A caller that processes a
 * nested project calls this function again with that project's root and its
 * own `exclude:` list.
 */
export async function discoverOwnedFiles(
  root: string,
  io: DiscoveryIO,
  options: DiscoverOptions = {},
): Promise<OwnedFiles> {
  const nestedRoots = await findNestedProjectRoots(root, io, options.exclude);
  const roots = [root, ...nestedRoots];
  const files: string[] = [];
  for await (const file of discoverFiles(root, io, options)) {
    if (nearestRoot(dirname(file), roots) === root) files.push(file);
  }
  return { files, nestedRoots };
}

/** `true` when the directory at `rel` (relative, host separators), or any
 * directory above it, matches `rules` — the same pruning the walk does. */
function isExcludedDir(
  rel: string,
  rules: readonly GitignoreRule[],
): boolean {
  if (rules.length === 0) return false;
  const segments = rel.split(SEPARATOR);
  for (let i = 1; i <= segments.length; i++) {
    if (isIgnored(segments.slice(0, i).join("/"), true, rules)) return true;
  }
  return false;
}

/** Options for {@linkcode discoverProjectRoots}. */
export interface ProjectDiscoveryOptions {
  /** The user's home folder. When the primary root equals this folder, no
   * downward scan runs from it. */
  readonly homeDir?: string;
}

/**
 * Find every MarkSpec project reachable from `startDir`.
 *
 * `primaryRoot` is the nearest config root found by walking up from
 * `startDir` (see {@linkcode resolveConfigRoot}), or `startDir` itself
 * when there is none. `roots` holds the primary root (only when it has a
 * config) plus every nested root below it, sorted. The nested scan honours
 * the primary project's `.markspec.yaml` `exclude:` list, and each nested
 * project's own list for the folders below it.
 *
 * When the primary root is a filesystem root or `options.homeDir`, no
 * downward scan runs, even when that folder holds a config: `roots` then
 * holds only the primary root when it has a config, and is empty
 * otherwise.
 */
export async function discoverProjectRoots(
  startDir: string,
  io: DiscoveryIO,
  options: ProjectDiscoveryOptions = {},
): Promise<{ primaryRoot: string; roots: string[] }> {
  const configRoot = await resolveConfigRoot(startDir, io.readFile);
  const primaryRoot = configRoot ?? startDir;
  const isFilesystemRoot = dirname(primaryRoot) === primaryRoot;
  if (isFilesystemRoot || primaryRoot === options.homeDir) {
    return {
      primaryRoot,
      roots: configRoot !== undefined ? [primaryRoot] : [],
    };
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
