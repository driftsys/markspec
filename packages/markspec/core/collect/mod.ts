/**
 * @module core/collect
 *
 * Project-entry collection: discover the MarkSpec-relevant files of one
 * project (a root, minus the projects nested below it) and parse them into
 * a flat `Entry[]`. The single source of truth for
 * "the set of entries whose trace edges the lockfile pins" — shared by
 * `markspec lock` (the pinner) and its checkers (`compile`, `fmt`, `doctor`)
 * so they cannot disagree on which files count. Previously each of those
 * commands hand-rolled the same discover→parse loop (a `cli/commands/lock.ts`
 * private helper the others reached into), which had to stay byte-identical
 * by hand or the lockfile edge-hash comparison would drift spuriously.
 */

import type { Entry } from "../model/mod.ts";
import { dirname } from "@std/path";
import { discoverFiles, type DiscoveryIO } from "../discovery/mod.ts";
import { nearestRoot } from "../discovery/projects.ts";
import { parseFile } from "../parser/mod.ts";

/** Options for {@linkcode collectProjectEntries}. */
export interface CollectOptions {
  /** Gitignore-syntax patterns (e.g. `project.yaml` `exclude:`), anchored at
   * `root`. Applied after `.gitignore` rules. Defaults to none. */
  readonly exclude?: readonly string[];
  /** An enclosing project root whose `.gitignore` files, from it down to
   * `root`, also apply (`discoverFiles` option of the same name). Pass the
   * outermost project root above a nested project, so the nested project
   * pins the files a bare `check` from any folder walks. */
  readonly inheritGitignoreFrom?: string;
  /** Roots of the projects nested below `root`. Their files belong to those
   * projects and are skipped: each `markspec.lock` pins only the entries
   * of its own project. Defaults to none. */
  readonly nestedRoots?: readonly string[];
}

/**
 * Walk `root` via {@linkcode discoverFiles} — relying on its default
 * extension set (`RELEVANT_EXTENSIONS`), the parity point every caller
 * depends on — and parse each discovered file of the project at `root`,
 * returning the flattened entry list. Files below `opts.nestedRoots` are
 * skipped, and `opts.inheritGitignoreFrom` adds the `.gitignore` files of
 * an enclosing project. Unreadable files are skipped. Parse diagnostics are
 * not surfaced here: this collector exists to give the lockfile pinner and
 * its checkers one definition of the file set; callers that need
 * diagnostics re-parse.
 *
 * @param io Injected filesystem surface (keeps `core/` Node-compatible; CLI
 *   entry points pass a Deno-backed implementation).
 */
export async function collectProjectEntries(
  root: string,
  io: DiscoveryIO,
  opts: CollectOptions = {},
): Promise<Entry[]> {
  const out: Entry[] = [];
  const roots = [root, ...opts.nestedRoots ?? []];
  for await (
    const file of discoverFiles(root, io, {
      exclude: opts.exclude,
      inheritGitignoreFrom: opts.inheritGitignoreFrom,
    })
  ) {
    if (nearestRoot(dirname(file), roots) !== root) continue;
    const content = await io.readFile(file);
    if (content === undefined) continue;
    const result = await parseFile(content, { file });
    out.push(...result.entries);
  }
  return out;
}
