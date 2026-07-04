/**
 * @module upstream/refs
 *
 * Map a parsed markspec.lock's snapshot-carrying upstream rows to the
 * UpstreamSnapshotRef[] loadUpstreamCorpus consumes. Pure — no I/O.
 */

import type { Lockfile } from "../lock/model.ts";
import { upstreamCacheRoot } from "../lock/upstream_refs.ts";
import type { UpstreamSnapshotRef } from "./mod.ts";

/** Fallback version label when a registry row carries no `version`. */
const UNVERSIONED = "unversioned";

/**
 * Map a parsed lockfile's snapshot-carrying upstream rows to
 * UpstreamSnapshotRef[] for loadUpstreamCorpus. Registry + dependency
 * rows with a `snapshot` are included; rows without a snapshot (legacy
 * pin-only) are skipped. `version` falls back to `"unversioned"` when the
 * row has none (UpstreamSnapshotRef.version is required; the loader only
 * uses it for the origin badge).
 */
export function upstreamRefsFromLockfile(
  lockfile: Lockfile,
  projectRoot: string,
): UpstreamSnapshotRef[] {
  const cacheRoot = upstreamCacheRoot(projectRoot);
  const refs: UpstreamSnapshotRef[] = [];
  for (const u of lockfile.upstreams) {
    if (u.kind !== "registry" && u.kind !== "dependency") continue;
    if (u.snapshot === undefined) continue;
    refs.push({
      id: u.id,
      version: ("version" in u && u.version) ? u.version : UNVERSIONED,
      dir: `${cacheRoot}/${u.id}`,
    });
  }
  return refs;
}
