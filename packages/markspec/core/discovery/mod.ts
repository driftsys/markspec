/**
 * @module core/discovery
 *
 * Gitignore-aware project file discovery — the single walker every
 * MarkSpec surface uses (CLI verbs, LSP indexing, lockfile entry
 * collection). Yields absolute paths of MarkSpec-relevant files under a
 * root, honoring (in precedence order):
 *
 *   1. built-in skips — hidden directories (name starts with `.`)
 *   2. `.gitignore` files (root + nested, standard semantics), plus, when
 *      the caller names an enclosing folder, the `.gitignore` files of the
 *      folders from that folder down to the root's parent
 *   3. caller-supplied `exclude` patterns (gitignore syntax, root-anchored)
 *
 * I/O is injected via {@linkcode DiscoveryIO} so the module stays
 * Node-compatible; entry points supply the Deno implementation.
 */

import { extname, join, relative, resolve, SEPARATOR } from "@std/path";
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
  /**
   * An enclosing folder of `root`, such as the root of the project that a
   * nested project lies in. The `.gitignore` files of the folders from it
   * down to the parent of `root` also apply, each anchored to its own
   * folder, so the walk of a nested project skips the files that the walk
   * from the enclosing folder skips. No `.gitignore` above this folder is
   * read. Ignored when it is not an ancestor of `root`.
   */
  readonly inheritGitignoreFrom?: string;
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
 */
export async function* discoverFiles(
  root: string,
  io: DiscoveryIO,
  options: DiscoverOptions = {},
): AsyncGenerator<string> {
  const extensions = options.extensions ?? RELEVANT_EXTENSIONS;
  const inherited = options.inheritGitignoreFrom === undefined
    ? { rules: [], prefix: "" }
    : await inheritedGitignoreRules(options.inheritGitignoreFrom, root, io);
  // With inherited rules, every rule is matched against paths relative to
  // the enclosing folder, so `prefix` is the path from it down to `root`.
  const prefix = inherited.prefix;
  const excludeRules = parseGitignore(
    (options.exclude ?? []).join("\n"),
    prefix,
  );
  // Built-in build-output skips are the lowest-precedence layer: inherited
  // `.gitignore` rules, `exclude:`, and the walk's own `.gitignore` files
  // (appended per-directory in `walk`) all come after, so a `!target/`
  // negation in any of them overrides them.
  yield* walk(
    root,
    prefix,
    [...BUILTIN_SKIP_RULES, ...inherited.rules, ...excludeRules],
    io,
    extensions,
  );
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

/**
 * Walk `absDir`. `relDir` is the POSIX path of `absDir` relative to the
 * folder the rules are anchored at (the enclosing folder when rules are
 * inherited, else the walk root); `""` for that folder itself.
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
