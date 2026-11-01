/**
 * @module core/discovery/projects
 *
 * Project-root discovery shared by the CLI, the LSP and the MCP server.
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
 * `.markspec.yaml`. Returns `undefined` when neither exists.
 *
 * The LSP server and the MCP server use this order to find the root
 * above their workspace. The CLI (`check`, `fmt`, `lint`) uses
 * {@linkcode createProjectRootResolver}, which starts from this nearest
 * config root but skips a config that an enclosing project hides (#845).
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

/** Answers which project root owns a folder; see
 * {@linkcode createProjectRootResolver}. */
export interface ProjectRootResolver {
  /**
   * The project root that owns files in `dir`, or `undefined` when no
   * `project.yaml` or `.markspec.yaml` is at or above `dir`.
   */
  ownerOf(dir: string): Promise<string | undefined>;
  /**
   * The nested project roots below `root`
   * ({@linkcode findNestedProjectRoots} with the `.markspec.yaml`
   * `exclude:` list of `root`). Cached per root.
   */
  nestedRoots(root: string): Promise<string[]>;
  /**
   * The outermost project root at or above `dir`: the root from which the
   * LSP would index `dir` when its workspace is the outermost project. A
   * nested project's walk inherits the `.gitignore` files from this root
   * down (`discoverFiles` option `inheritGitignoreFrom`). `undefined` when
   * no `project.yaml` or `.markspec.yaml` is at or above `dir`.
   */
  outermostOf(dir: string): Promise<string | undefined>;
}

/**
 * Create a resolver that gives, for any folder, the project root the LSP
 * would give a document in that folder when the editor workspace is the
 * outermost project root above it (#845).
 *
 * The nearest config root {@linkcode resolveConfigRoot} finds is not
 * always the owner: when an enclosing project hides that config (an
 * `exclude:` entry, a `.gitignore` entry, a hidden folder), the LSP and
 * the MCP server never treat it as a root, and its files belong to the
 * enclosing project. So the resolver walks up from the nearest config
 * root to the outermost enclosing one, finds the nested roots below that
 * outermost root the way the LSP does, and returns the deepest of them
 * that contains `dir`.
 *
 * The walk up stops before a filesystem root and before
 * `options.homeDir`: {@linkcode discoverProjectRoots} never scans down
 * from those folders, so a stray config there must not claim every
 * project below it. Results are cached per folder.
 */
export function createProjectRootResolver(
  io: DiscoveryIO,
  options: ProjectDiscoveryOptions = {},
): ProjectRootResolver {
  const owners = new Map<string, Promise<string | undefined>>();
  const outermosts = new Map<string, Promise<string | undefined>>();
  const nested = new Map<string, Promise<string[]>>();

  function nestedRoots(root: string): Promise<string[]> {
    let found = nested.get(root);
    if (found === undefined) {
      found = loadToolConfig(root, io.readFile).then(({ config }) =>
        findNestedProjectRoots(root, io, config.exclude)
      );
      nested.set(root, found);
    }
    return found;
  }

  function outermostOf(dir: string): Promise<string | undefined> {
    let found = outermosts.get(dir);
    if (found === undefined) {
      found = resolveOutermost(dir);
      outermosts.set(dir, found);
    }
    return found;
  }

  async function resolveOutermost(dir: string): Promise<string | undefined> {
    const nearest = await resolveConfigRoot(dir, io.readFile);
    if (nearest === undefined) return undefined;
    let outermost = nearest;
    while (true) {
      const parent = dirname(outermost);
      if (parent === outermost) break;
      const above = await resolveConfigRoot(parent, io.readFile);
      if (
        above === undefined || dirname(above) === above ||
        above === options.homeDir
      ) {
        break;
      }
      outermost = above;
    }
    return outermost;
  }

  async function resolveOwner(dir: string): Promise<string | undefined> {
    const nearest = await resolveConfigRoot(dir, io.readFile);
    if (nearest === undefined) return undefined;
    const outermost = await outermostOf(dir) ?? nearest;
    if (outermost === nearest) return nearest;
    const roots = [outermost, ...await nestedRoots(outermost)];
    return nearestRoot(dir, roots) ?? outermost;
  }

  return {
    ownerOf(dir: string): Promise<string | undefined> {
      let owner = owners.get(dir);
      if (owner === undefined) {
        owner = resolveOwner(dir);
        owners.set(dir, owner);
      }
      return owner;
    },
    nestedRoots,
    outermostOf,
  };
}
