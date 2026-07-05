/**
 * @module upstream/refs
 *
 * Map a parsed markspec.lock's snapshot-carrying upstream rows to the
 * UpstreamSnapshotRef[] loadUpstreamCorpus consumes. Pure — no I/O.
 */

import { join } from "@std/path";
import type { Lockfile } from "../lock/model.ts";
import { upstreamCacheRoot } from "../lock/upstream_refs.ts";
import type { UpstreamSnapshotRef } from "./mod.ts";

/** Fallback badge label when an upstream row carries neither a `version`
 * field nor a `resolved` pin to derive one from. */
const UNVERSIONED = "unversioned";

/**
 * Derive a human-readable badge label from a git dependency's `resolved`
 * pin (`"tag:<t>"` | `"branch:<b>"` | `"sha:<s>"`). A tag or branch pin
 * renders bare (`v2.1.0`, `main`); a sha pin renders as its 7-char short
 * hash (`abcdef0`). A pin with an unrecognised scheme renders verbatim,
 * and an empty pin falls back to `UNVERSIONED` (#800).
 */
function versionFromResolved(resolved: string): string {
  const colon = resolved.indexOf(":");
  if (colon < 0) return resolved || UNVERSIONED;
  const scheme = resolved.slice(0, colon);
  const rest = resolved.slice(colon + 1);
  if (rest.length === 0) return UNVERSIONED;
  if (scheme === "sha") return rest.slice(0, 7);
  if (scheme === "tag" || scheme === "branch") return rest;
  return resolved;
}

/**
 * Map a parsed lockfile's snapshot-carrying upstream rows to
 * UpstreamSnapshotRef[] for loadUpstreamCorpus. Registry + dependency
 * rows with a `snapshot` are included; rows without a snapshot (legacy
 * pin-only) are skipped.
 *
 * The `version` field feeds the origin badge (`<id>@<version>`).
 * Registry rows use their published `project.version`, falling back to
 * `UNVERSIONED` when unpublished. Dependency rows carry no `version`, so
 * the label is derived from the `resolved` pin via
 * {@linkcode versionFromResolved} (#800) — previously every git
 * dependency rendered as `<id>@unversioned` despite carrying a precise pin.
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
    let version: string;
    if ("version" in u && u.version) {
      version = u.version;
    } else if (u.kind === "dependency") {
      version = versionFromResolved(u.resolved);
    } else {
      version = UNVERSIONED;
    }
    refs.push({
      id: u.id,
      version,
      dir: join(cacheRoot, u.id),
    });
  }
  return refs;
}
