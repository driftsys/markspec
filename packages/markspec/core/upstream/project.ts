/**
 * @module upstream/project
 *
 * Shared lockfile→upstream hydration (#771): the one function every
 * surface that feeds locked upstream snapshots into the graph goes
 * through — the CLI compiler (`compileProject`), `check`, the LSP
 * (`seedUpstreamCorpus`), and the MCP server (`loadLockedUpstreams`).
 * Composes {@linkcode upstreamRefsFromLockfile} +
 * {@linkcode loadUpstreamCorpus} with the shared no-lockfile /
 * empty-refs short-circuit so the four surfaces' soft-fail and
 * diagnostic semantics cannot drift. Pure — file access via the
 * injected {@linkcode ReadFile}, same rule as `loadUpstreamCorpus`;
 * never throws on a missing or cold cache (failures surface as
 * UPSTREAM-SNAPSHOT-00x diagnostics).
 */

import type { Lockfile } from "../lock/model.ts";
import type { ReadFile } from "../config/mod.ts";
import { loadUpstreamCorpus, type LoadUpstreamCorpusResult } from "./mod.ts";
import { upstreamRefsFromLockfile } from "./refs.ts";

/**
 * Hydrate a project's locked upstream snapshots into read-only
 * `Entry[]`. Returns empty when there is no lockfile or no
 * snapshot-carrying upstream rows (without touching `readFile`).
 */
export async function loadProjectUpstreams(
  projectRoot: string,
  lockfile: Lockfile | undefined,
  readFile: ReadFile,
): Promise<LoadUpstreamCorpusResult> {
  if (!lockfile) return { entries: [], diagnostics: [] };
  const refs = upstreamRefsFromLockfile(lockfile, projectRoot);
  if (refs.length === 0) return { entries: [], diagnostics: [] };
  return await loadUpstreamCorpus(refs, readFile);
}
