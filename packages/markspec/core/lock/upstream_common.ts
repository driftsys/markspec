/**
 * @module core/lock/upstream_common
 *
 * Primitives shared by the two lock-mediated upstream acquirers —
 * `upstream_refs.ts` (published `references:` snapshots) and
 * `upstream_deps.ts` (git `dependencies:` trees). Both emit the same
 * MSL-L213 "could not be locked" warning (differing only by the noun) and
 * write a `[path, bytes][]` cache batch with identical error handling, so
 * the primitive lives here once rather than duplicated in each module.
 */

import type { Diagnostic } from "../model/mod.ts";

/** The two upstream kinds, used only to word the shared MSL-L213 message. */
export type UpstreamNoun = "reference" | "dependency";

/**
 * Warn-and-write diagnostic (design §4.2, decision 1): one upstream could
 * not be locked. Identical shape for both kinds — `noun` selects the word.
 */
export function upstreamNotLockable(
  noun: UpstreamNoun,
  id: string,
  detail: string,
): Diagnostic {
  return {
    code: "MSL-L213",
    severity: "warning",
    message: `upstream ${noun} '${id}' could not be locked: ${detail}`,
    location: undefined,
  };
}

/**
 * Write a batch of `[absolutePath, bytes]` cache files via the injected
 * `writeFile` (which creates parent directories). Returns an MSL-L213
 * warning naming the clean `id` (never the raw path) on the first failure,
 * or `undefined` when every write succeeds. Shared by both acquirers' cache
 * writers so a cache-write-failure message is worded identically.
 */
export async function writeCacheFiles(
  writes: ReadonlyArray<readonly [string, Uint8Array]>,
  noun: UpstreamNoun,
  id: string,
  writeFile: (path: string, bytes: Uint8Array) => Promise<{ error?: string }>,
): Promise<Diagnostic | undefined> {
  for (const [path, bytes] of writes) {
    const res = await writeFile(path, bytes);
    if (res.error !== undefined) {
      return upstreamNotLockable(
        noun,
        id,
        `cache write of '${path}' failed (${res.error})`,
      );
    }
  }
  return undefined;
}
