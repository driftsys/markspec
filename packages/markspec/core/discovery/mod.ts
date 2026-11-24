/**
 * @module core/discovery
 *
 * Gitignore-aware project file discovery shared by CLI scope resolution,
 * LSP indexing, lockfile entry collection and nested-project discovery.
 * Yields absolute paths of MarkSpec-relevant files under a
 * root, unconditionally skipping hidden directories and honoring (in
 * precedence order):
 *
 *   1. built-in skips — common build-output directories
 *   2. `.gitignore` files (root + nested, standard semantics), plus, when
 *      the caller names an enclosing folder, the `.gitignore` files of the
 *      folders from that folder down to the root's parent
 *   3. caller-supplied `exclude` patterns (gitignore syntax, root-anchored),
 *      applied last at every directory level, including for negations
 *
 * I/O is injected via {@linkcode DiscoveryIO} so the module stays
 * Node-compatible; entry points supply the Deno implementation.
 */

import {
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  SEPARATOR,
} from "@std/path";
import { discoverProjectRoot } from "../config/mod.ts";
import { type GitignoreRule, isIgnored, parseGitignore } from "./gitignore.ts";

export { type GitignoreRule, isIgnored, parseGitignore } from "./gitignore.ts";

/**
 * Source-file extensions the parser can extract doc-comment entries
 * from (tree-sitter grammars available). Single SSOT — `lsp/context.ts`
 * imports this set.
 */
export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
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
  ".ts",
  ".tsx",
  ".jsx",
  ".js",
  ".mjs",
  ".cjs",
  ".cs",
]);

/** Markdown only — the `fmt` scope (the formatter never rewrites source). */
export const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set([".md"]);

/**
 * Gherkin `.feature` files, whose `# [ID]` header comments define entries
 * (ADR-038). Not part of {@linkcode SOURCE_EXTENSIONS}: that set drives the
 * tree-sitter grammars and the LSP, and `.feature` files use neither.
 */
export const FEATURE_EXTENSIONS: ReadonlySet<string> = new Set([".feature"]);

/** Everything MarkSpec-relevant: markdown, source and `.feature` files. */
export const RELEVANT_EXTENSIONS: ReadonlySet<string> = new Set([
  ...MARKDOWN_EXTENSIONS,
  ...SOURCE_EXTENSIONS,
  ...FEATURE_EXTENSIONS,
]);

/** One directory entry from {@linkcode DiscoveryIO.readDir}.
 * Structurally compatible with `Deno.DirEntry`. */
export interface DiscoveryDirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
}

/** Injected filesystem surface for the walker. */
export interface DiscoveryIO {
  readDir(path: string): AsyncIterable<DiscoveryDirEntry>;
  /** Resolves `undefined` when the file does not exist or is unreadable. */
  readFile(path: string): Promise<string | undefined>;
}

/** Options for {@linkcode discoverFiles}. */
export interface DiscoverOptions {
  /** Extension filter; defaults to {@linkcode RELEVANT_EXTENSIONS}. */
  readonly extensions?: ReadonlySet<string>;
  /** Extra gitignore-syntax patterns, anchored at `root` (e.g. from
   * `.markspec.yaml` `exclude:`). Applied after built-in build-output skips and
   * `.gitignore` rules at every directory level. Negations can re-include
   * non-hidden directories; an ignored parent must also be re-included. */
  readonly exclude?: readonly string[];
  /**
   * An enclosing folder of `root`, such as the root of the project that a
   * nested project lies in. The `.gitignore` files of the folders from it
   * down to the parent of `root` also apply, each anchored to its own
   * folder, so the walk of a nested project skips the files that those
   * `.gitignore` files ignore. Only `.gitignore` files are inherited, not
   * the enclosing folder's `exclude` patterns. No `.gitignore` above this
   * folder is read. Ignored when it is not a strict ancestor of `root`.
   */
  readonly inheritGitignoreFrom?: string;
  /**
   * Skip the folders below `root` that are project roots of their own, so the
   * walk covers one project only. A folder is such a root when a document in
   * it resolves its project to the folder itself, as
   * {@linkcode resolveConfigRoot} does: it holds a `project.yaml`, or a
   * `.markspec.yaml` while no `project.yaml` lies at or above `root`. A
   * `.markspec.yaml` below a `project.yaml` belongs to that project, so its
   * folder is walked.
   */
  readonly excludeNestedProjects?: boolean;
}

/**
 * Directory names pruned by default, in addition to the hidden-dir skip.
 * These are the common build-output / dependency directories the
 * pre-`core/discovery` walkers (LSP `walkDirectory`, lockfile
 * `collectEntries`) hardcoded; keeping them restores that guarantee
 * independent of a consumer's `.gitignore` — otherwise a project that does
 * not list them recurses into build artifacts (duplicate-ID noise, slow LSP
 * indexing, spurious `MSL-L212` edge-hash entries).
 *
 * Unlike the hidden-dir skip these are overridable: they are applied as the
 * lowest-precedence rule layer (before `.gitignore` and `exclude:`), so a
 * negated `!target/` entry in either re-includes that directory under
 * gitignore last-match-wins.
 */
const BUILTIN_SKIP_DIRS: readonly string[] = [
  "node_modules",
  "target",
  "dist",
  "build",
];

/** Compiled once: the built-in skip as unanchored, directory-only gitignore
 * rules (each matches a directory of that name at any depth). */
const BUILTIN_SKIP_RULES: readonly GitignoreRule[] = parseGitignore(
  BUILTIN_SKIP_DIRS.map((d) => `${d}/`).join("\n"),
  "",
);

/**
 * Walk `root` recursively, yielding absolute paths of relevant files.
 * Entries are yielded in sorted order per directory — deterministic
 * output across filesystems. Unreadable directories are skipped.
 */
export async function* discoverFiles(
  root: string,
  io: DiscoveryIO,
  options: DiscoverOptions = {},
): AsyncGenerator<string> {
  const extensions = options.extensions ?? RELEVANT_EXTENSIONS;
  const start = await walkStart(root, io, options);
  // Resolved once for the whole walk: no folder below `root` that the walk
  // enters holds a `project.yaml`, since such a folder is skipped.
  const nested: NestedRoots | undefined = options.excludeNestedProjects
    ? {
      projectAbove: await discoverProjectRoot(root, io.readFile) !== undefined,
    }
    : undefined;
  // Carry excludes separately: they must stay after every `.gitignore`,
  // including ones loaded deeper in the walk.
  yield* walk(
    root,
    start.prefix,
    start.rules,
    start.excludeRules,
    io,
    extensions,
    nested,
    true,
  );
}

/**
 * Report whether {@linkcode discoverFiles} with the same `root`, `io` and
 * `options` would yield `path`. It applies the same rules as the walk: the
 * extension filter, hidden directories, the built-in build-output skips, the
 * `.gitignore` chain and `exclude`. It checks the directories from `root`
 * down to the file, so a file under an ignored directory is not included.
 * The file must exist as a regular file: a path that does not exist, a
 * symbolic link, and a path outside `root` are not included. It lists every
 * ancestor directory of the file, so it is meant for per-file checks, not
 * bulk use. It compares paths as given: case and symbolic links in the
 * directories above the file are not resolved.
 */
export async function isDiscoverable(
  path: string,
  root: string,
  io: DiscoveryIO,
  options: DiscoverOptions = {},
): Promise<boolean> {
  const extensions = options.extensions ?? RELEVANT_EXTENSIONS;
  if (!isRelevantFile(path, extensions)) return false;
  const rel = relative(resolve(root), resolve(path));
  if (
    rel === "" || rel === ".." || rel.startsWith(`..${SEPARATOR}`) ||
    isAbsolute(rel)
  ) {
    return false;
  }
  const segments = rel.split(SEPARATOR);
  const start = await walkStart(root, io, options);
  let rules = start.rules;
  let absDir = root;
  let relDir = start.prefix;
  for (let i = 0; i < segments.length; i++) {
    const gitignoreRules = await rulesForDirectory(absDir, relDir, rules, io);
    const active = [...gitignoreRules, ...start.excludeRules];
    const name = segments[i];
    const entryRel = relDir === "" ? name : `${relDir}/${name}`;
    const isLast = i === segments.length - 1;
    // The walk yields only entries that report isFile or isDirectory, so a
    // symbolic link, or a path that does not exist, is not discoverable.
    const kind = await entryKind(absDir, name, io);
    if (isLast ? kind !== "file" : kind !== "directory") return false;
    if (isLast) return !isIgnored(entryRel, false, active);
    if (isPrunedDirectory(name, entryRel, active)) return false;
    rules = gitignoreRules;
    absDir = join(absDir, name);
    relDir = entryRel;
  }
  return false;
}

/** The kind of the entry `name` in `absDir`, as the walk sees it. */
async function entryKind(
  absDir: string,
  name: string,
  io: DiscoveryIO,
): Promise<"file" | "directory" | undefined> {
  try {
    for await (const e of io.readDir(absDir)) {
      if (e.name !== name) continue;
      return e.isDirectory ? "directory" : e.isFile ? "file" : undefined;
    }
  } catch {
    // An unreadable directory is skipped by the walk.
  }
  return undefined;
}

/** The starting rule state of a walk of `root`, shared by the walk and
 * {@linkcode isDiscoverable}. `prefix` is the path of `root` below the
 * folder the rules are anchored at. */
async function walkStart(
  root: string,
  io: DiscoveryIO,
  options: DiscoverOptions,
): Promise<{
  prefix: string;
  rules: readonly GitignoreRule[];
  excludeRules: readonly GitignoreRule[];
}> {
  const inherited = options.inheritGitignoreFrom === undefined
    ? { rules: [], prefix: "" }
    : await inheritedGitignoreRules(options.inheritGitignoreFrom, root, io);
  // With inherited rules, every rule is matched against paths relative to
  // the enclosing folder, so `prefix` is the path from it down to `root`.
  return {
    prefix: inherited.prefix,
    rules: [...BUILTIN_SKIP_RULES, ...inherited.rules],
    excludeRules: parseGitignore(
      (options.exclude ?? []).join("\n"),
      inherited.prefix,
    ),
  };
}

/** `true` when a file has one of the `extensions`. */
function isRelevantFile(
  path: string,
  extensions: ReadonlySet<string>,
): boolean {
  return extensions.has(extname(path).toLowerCase());
}

/** `true` when the walk does not enter a directory: hidden, or ignored.
 * Git semantics: paths under an ignored directory cannot be re-included, so
 * pruning is correct. */
function isPrunedDirectory(
  name: string,
  rel: string,
  active: readonly GitignoreRule[],
): boolean {
  return name.startsWith(".") || isIgnored(rel, true, active);
}

/** The `.gitignore` rules in force inside `absDir`: the inherited `rules`
 * followed by the directory's own `.gitignore`, so deeper rules win. */
async function rulesForDirectory(
  absDir: string,
  relDir: string,
  rules: readonly GitignoreRule[],
  io: DiscoveryIO,
): Promise<readonly GitignoreRule[]> {
  const raw = await io.readFile(join(absDir, ".gitignore"));
  return raw !== undefined && raw.length > 0
    ? [...rules, ...parseGitignore(raw, relDir)]
    : rules;
}

/**
 * Collect the `.gitignore` rules of the folders from `from` down to the
 * parent of `root`, outermost first, each anchored to its own folder.
 * Returns them with the POSIX path from `from` down to `root`. Returns no
 * rules and an empty path when `from` is not a strict ancestor of `root`.
 */
async function inheritedGitignoreRules(
  from: string,
  root: string,
  io: DiscoveryIO,
): Promise<{ rules: GitignoreRule[]; prefix: string }> {
  const rel = relative(resolve(from), resolve(root));
  if (rel === "" || rel === ".." || rel.startsWith(`..${SEPARATOR}`)) {
    return { rules: [], prefix: "" };
  }
  const segments = rel.split(SEPARATOR);
  const rules: GitignoreRule[] = [];
  for (let i = 0; i < segments.length; i++) {
    const raw = await io.readFile(
      join(from, ...segments.slice(0, i), ".gitignore"),
    );
    if (raw === undefined || raw.length === 0) continue;
    rules.push(...parseGitignore(raw, segments.slice(0, i).join("/")));
  }
  return { rules, prefix: segments.join("/") };
}

/** How a walk recognises the nested project roots it skips. */
interface NestedRoots {
  /** A `project.yaml` lies at or above the walk root. */
  readonly projectAbove: boolean;
}

/**
 * `true` when the folder whose entries are `entries` is a project root of
 * its own (see {@linkcode DiscoverOptions.excludeNestedProjects}). It reads
 * no file: the entries are those the walk already listed.
 */
function isNestedRoot(
  entries: readonly DiscoveryDirEntry[],
  nested: NestedRoots,
): boolean {
  const has = (name: string) =>
    entries.some((entry) => entry.isFile && entry.name === name);
  return has("project.yaml") ||
    (!nested.projectAbove && has(".markspec.yaml"));
}

/**
 * Walk `absDir`. `relDir` is the POSIX path of `absDir` relative to the
 * folder the rules are anchored at (the enclosing folder when rules are
 * inherited, else the walk root); `""` for that folder itself.
 */
async function* walk(
  absDir: string,
  relDir: string,
  rules: readonly GitignoreRule[],
  excludeRules: readonly GitignoreRule[],
  io: DiscoveryIO,
  extensions: ReadonlySet<string>,
  nested: NestedRoots | undefined,
  isRoot: boolean,
): AsyncGenerator<string> {
  const entries: DiscoveryDirEntry[] = [];
  try {
    for await (const e of io.readDir(absDir)) entries.push(e);
  } catch {
    return; // unreadable directory — a project walk must not abort
  }
  // A nested project root below the walk root belongs to its own project.
  if (!isRoot && nested !== undefined && isNestedRoot(entries, nested)) return;
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Deeper `.gitignore` rules win over inherited ones. Excludes stay last
  // for this directory's decisions, but are not inherited as gitignore rules.
  const gitignoreRules = await rulesForDirectory(absDir, relDir, rules, io);
  const active = [...gitignoreRules, ...excludeRules];

  for (const entry of entries) {
    const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    if (entry.isDirectory) {
      if (isPrunedDirectory(entry.name, rel, active)) continue;
      yield* walk(
        join(absDir, entry.name),
        rel,
        gitignoreRules,
        excludeRules,
        io,
        extensions,
        nested,
        false,
      );
    } else if (entry.isFile) {
      if (!isRelevantFile(entry.name, extensions)) continue;
      if (isIgnored(rel, false, active)) continue;
      yield join(absDir, entry.name);
    }
  }
}
