/**
 * @module core/collect
 *
 * Project-entry collection: discover every MarkSpec-relevant file under a
 * root and parse it into a flat `Entry[]`. The single source of truth for
 * "the set of entries whose trace edges the lockfile pins" — shared by
 * `markspec lock` (the pinner) and its checkers (`compile`, `fmt`, `doctor`)
 * so they cannot disagree on which files count. Previously each of those
 * commands hand-rolled the same discover→parse loop (a `cli/commands/lock.ts`
 * private helper the others reached into), which had to stay byte-identical
 * by hand or the lockfile edge-hash comparison would drift spuriously.
 */

import type { Entry } from "../model/mod.ts";
import { discoverFiles, type DiscoveryIO } from "../discovery/mod.ts";
import { parseFile } from "../parser/mod.ts";

/** Options for {@linkcode collectProjectEntries}. */
export interface CollectOptions {
  /** Gitignore-syntax patterns (e.g. `project.yaml` `exclude:`), anchored at
   * `root`. Applied after `.gitignore` rules. Defaults to none. */
  readonly exclude?: readonly string[];
}

/**
 * Walk `root` via {@linkcode discoverFiles} — relying on its default
 * extension set (`RELEVANT_EXTENSIONS`), the parity point every caller
 * depends on — and parse each discovered file, returning the flattened
 * entry list. Unreadable files are skipped. Parse diagnostics are not
 * surfaced here: this collector exists to give the lockfile pinner and its
 * checkers one definition of the file set; callers that need diagnostics
 * re-parse.
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
  for await (const file of discoverFiles(root, io, { exclude: opts.exclude })) {
    const content = await io.readFile(file);
    if (content === undefined) continue;
    const result = await parseFile(content, { file });
    out.push(...result.entries);
  }
  return out;
}
