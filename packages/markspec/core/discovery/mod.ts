/**
 * @module core/discovery
 *
 * Gitignore-aware project file discovery — the single walker every
 * MarkSpec surface uses (CLI verbs, LSP indexing, lockfile entry
 * collection). Yields absolute paths of MarkSpec-relevant files under a
 * root, honoring (in precedence order):
 *
 *   1. built-in skips — hidden directories (name starts with `.`)
 *   2. `.gitignore` files (root + nested, standard semantics)
 *   3. caller-supplied `exclude` patterns (gitignore syntax, root-anchored)
 *
 * I/O is injected via {@linkcode DiscoveryIO} so the module stays
 * Node-compatible; entry points supply the Deno implementation.
 */

import { extname, join } from "@std/path";
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
  const excludeRules = parseGitignore(
    (options.exclude ?? []).join("\n"),
    "",
  );
  yield* walk(root, "", excludeRules, io, extensions);
}

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
