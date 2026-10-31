/**
 * @module core/discovery
 *
 * Gitignore-aware project file discovery — the single walker every
 * MarkSpec surface uses (CLI verbs, LSP indexing, lockfile entry
 * collection). Yields absolute paths of MarkSpec-relevant files under a
 * root, honoring (in precedence order):
 *
 *   1. built-in skips — hidden directories (name starts with `.`)
 *   2. `.gitignore` files (root + nested, standard semantics), plus the
 *      `.gitignore` files of the root's ancestor directories up to the
 *      git work-tree root (the nearest directory that holds `.git`)
 *   3. caller-supplied `exclude` patterns (gitignore syntax, root-anchored)
 *
 * I/O is injected via {@linkcode DiscoveryIO} so the module stays
 * Node-compatible; entry points supply the Deno implementation.
 */

import { dirname, extname, join } from "@std/path";
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

/** Everything MarkSpec-relevant: markdown + source families. */
export const RELEVANT_EXTENSIONS: ReadonlySet<string> = new Set([
  ...MARKDOWN_EXTENSIONS,
  ...SOURCE_EXTENSIONS,
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
   * project.yaml `exclude:`). Applied after `.gitignore` rules. */
  readonly exclude?: readonly string[];
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
 * LOWEST-precedence rule layer (before `.gitignore` and `exclude:`), so a
 * negated `!target/` entry in either re-includes them under gitignore
 * last-match-wins.
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
 *
 * Like git, the walk also applies the `.gitignore` files of the
 * directories above `root`, up to the nearest directory that holds `.git`
 * (a directory or a worktree file). Each of those rules stays anchored to
 * the directory of its own `.gitignore`. When no directory at or above
 * `root` holds `.git`, no ancestor rules apply.
 */
export async function* discoverFiles(
  root: string,
  io: DiscoveryIO,
  options: DiscoverOptions = {},
): AsyncGenerator<string> {
  const extensions = options.extensions ?? RELEVANT_EXTENSIONS;
  const ancestors = await ancestorGitignoreRules(root, io);
  // Every rule is matched against paths relative to the work-tree root
  // when one was found above `root`, so `prefix` is the path from that
  // root down to `root` (`""` otherwise).
  const prefix = ancestors.prefix;
  const excludeRules = parseGitignore(
    (options.exclude ?? []).join("\n"),
    prefix,
  );
  // Built-in build-output skips are the lowest-precedence layer: ancestor
  // `.gitignore` rules, `exclude:`, and the walk's own `.gitignore` files
  // (appended per-directory in `walk`) all come after, so a `!target/`
  // negation in any of them overrides them.
  yield* walk(
    root,
    prefix,
    [...BUILTIN_SKIP_RULES, ...ancestors.rules, ...excludeRules],
    io,
    extensions,
  );
}

/**
 * Collect the `.gitignore` rules of the directories above `root`, up to
 * the nearest directory that holds `.git`. Returns the rules, outermost
 * first, together with the POSIX path from that directory down to `root`.
 * Returns no rules and an empty path when `root` itself holds `.git`, or
 * when no directory above it does.
 */
async function ancestorGitignoreRules(
  root: string,
  io: DiscoveryIO,
): Promise<{ rules: GitignoreRule[]; prefix: string }> {
  const none = { rules: [], prefix: "" };
  if (await holdsGit(root, io)) return none;
  // Directory names from the work-tree root down to `root`, built while
  // walking up; `contents` holds the `.gitignore` text of each ancestor.
  const segments: string[] = [];
  const contents: Array<string | undefined> = [];
  let dir = root;
  while (true) {
    const parent = dirname(dir);
    if (parent === dir) return none; // reached the filesystem root
    segments.unshift(dir.slice(parent.length).replace(/^[\\/]+/, ""));
    contents.unshift(await io.readFile(join(parent, ".gitignore")));
    dir = parent;
    if (await holdsGit(dir, io)) break;
  }
  const rules: GitignoreRule[] = [];
  for (let i = 0; i < contents.length; i++) {
    const raw = contents[i];
    if (raw === undefined || raw.length === 0) continue;
    rules.push(...parseGitignore(raw, segments.slice(0, i).join("/")));
  }
  return { rules, prefix: segments.join("/") };
}

/**
 * `true` when `dir` holds `.git`: a worktree or submodule `.git` file, or
 * a `.git` directory (detected by its `HEAD` file, which every repository
 * has). Uses only `readFile`, so every {@linkcode DiscoveryIO} supports it.
 */
async function holdsGit(dir: string, io: DiscoveryIO): Promise<boolean> {
  return await io.readFile(join(dir, ".git")) !== undefined ||
    await io.readFile(join(dir, ".git", "HEAD")) !== undefined;
}

/**
 * Walk `absDir`. `relDir` is the POSIX path of `absDir` relative to the
 * directory the rules are anchored at (the work-tree root when ancestor
 * rules apply, else the walk root); `""` for that directory itself.
 */
async function* walk(
  absDir: string,
  relDir: string,
  rules: readonly GitignoreRule[],
  io: DiscoveryIO,
  extensions: ReadonlySet<string>,
): AsyncGenerator<string> {
  // Nested .gitignore rules append after inherited ones — deeper rules
  // win under last-match-wins.
  const raw = await io.readFile(join(absDir, ".gitignore"));
  const active = raw !== undefined && raw.length > 0
    ? [...rules, ...parseGitignore(raw, relDir)]
    : rules;

  const entries: DiscoveryDirEntry[] = [];
  try {
    for await (const e of io.readDir(absDir)) entries.push(e);
  } catch {
    return; // unreadable directory — a project walk must not abort
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name.startsWith(".")) continue; // built-in: hidden dirs
      // Git semantics: paths under an ignored directory cannot be
      // re-included, so pruning here is correct (and fast).
      if (isIgnored(rel, true, active)) continue;
      yield* walk(join(absDir, entry.name), rel, active, io, extensions);
    } else if (entry.isFile) {
      if (!extensions.has(extname(entry.name).toLowerCase())) continue;
      if (isIgnored(rel, false, active)) continue;
      yield join(absDir, entry.name);
    }
  }
}
