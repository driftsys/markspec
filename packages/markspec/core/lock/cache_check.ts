/**
 * @module core/lock/cache_check
 *
 * Offline upstream cache-integrity check — the MSL-L212 cache-drift case
 * (Task 9). For every locked upstream row that carries a `snapshot` hash
 * (a federated registry or git-repository dependency), verify its cache
 * under `<cacheRoot>/<id>/` is still present and hash-intact.
 *
 * Reuses {@linkcode probeCacheSnapshot} — the exact probe
 * `resolveProjectReferences`'s keep/restore flow already uses
 * (`upstream_refs.ts`, Task 5) — so `markspec check` and `markspec lock`
 * never disagree on what "cache intact" means. Rows without a `snapshot`
 * (legacy registry rows predating this field, or upstream kinds that never
 * carry one — reference, profile) are skipped: there is nothing to verify
 * offline.
 *
 * Pure module: file access only via the injected {@linkcode ReadFile}.
 */

import type { Diagnostic } from "../model/mod.ts";
import type { Upstream } from "./model.ts";
import type { ReadFile } from "./resolve.ts";
import { probeCacheSnapshot } from "./upstream_refs.ts";

function cacheDriftDiagnostic(id: string): Diagnostic {
  return {
    code: "MSL-L212",
    severity: "error",
    message:
      `upstream '${id}' cache snapshot is missing or does not match markspec.lock — run 'markspec lock'`,
    location: undefined,
  };
}

/**
 * Verify every snapshot-carrying upstream row's cache under `cacheRoot`.
 * One `MSL-L212` diagnostic per row whose cache is missing or whose
 * entries-file hash no longer matches the locked `snapshot`.
 */
export async function verifyUpstreamCache(
  upstreams: readonly Upstream[],
  cacheRoot: string,
  readFile: ReadFile,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const upstream of upstreams) {
    if (upstream.kind !== "registry" && upstream.kind !== "dependency") {
      continue; // references/profiles never carry a cache snapshot
    }
    if (upstream.snapshot === undefined) continue; // legacy row — skip
    const dir = `${cacheRoot}/${upstream.id}`;
    const intact = await probeCacheSnapshot(dir, upstream.snapshot, readFile);
    if (!intact) diagnostics.push(cacheDriftDiagnostic(upstream.id));
  }
  return diagnostics;
}
