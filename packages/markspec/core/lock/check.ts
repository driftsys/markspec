/**
 * @module core/lock/check
 *
 * Drift detection: compare a locked Lockfile against the currently-
 * resolved upstreams. Emits `MSL-L2xx` diagnostics for each drift
 * category. Pure function — no I/O.
 *
 * Drift categories:
 *   - MSL-L202 — upstream in resolved but missing from lockfile (also:
 *     a declared reference with no lockfile registry row)
 *   - MSL-L203 — upstream in lockfile but missing from resolved (also:
 *     a locked registry row no longer declared in project.yaml)
 *   - MSL-L210 — hash mismatch (same identity, different bytes)
 *   - MSL-L211 — profile resolved-version drift (npm range now resolves a different exact version)
 *   - MSL-L212 — canonical edge hash drift (traceability graph changed)
 *
 * Federated registry rows (org `references:`) are checked by pure
 * id-presence against `declaredReferenceIds` — no hash comparison.
 * Content integrity for those rows is the offline cache gate (a later
 * task), not this online-vs-lockfile comparison.
 */

import type { Diagnostic } from "../model/mod.ts";
import type {
  Lockfile,
  UpstreamProfile,
  UpstreamReference,
  UpstreamRegistry,
} from "./model.ts";
import type { ResolvedUpstreams } from "./resolve.ts";

/**
 * Compare locked vs resolved upstreams; return one diagnostic per drift
 * case. An empty result means the lockfile is in sync with the current
 * project state.
 *
 * @param declaredReferenceIds - Upstream ids derived from
 *   `config.references` (via `deriveUpstreamId`) — the id-presence
 *   comparison set for federated registry rows.
 */
export function checkDrift(
  locked: Lockfile,
  resolved: ResolvedUpstreams,
  declaredReferenceIds: readonly string[],
): Diagnostic[] {
  const diags: Diagnostic[] = [];

  // -------------------------------------------------------------------------
  // References — match by slug.
  // -------------------------------------------------------------------------

  const lockedRefs = new Map<string, UpstreamReference>();
  for (const u of locked.upstreams) {
    if (u.kind === "reference") lockedRefs.set(u.slug, u);
  }
  const resolvedRefs = new Map<string, UpstreamReference>();
  for (const r of resolved.references) {
    resolvedRefs.set(r.upstream.slug, r.upstream);
  }

  for (const [slug, current] of resolvedRefs) {
    const old = lockedRefs.get(slug);
    if (old === undefined) {
      diags.push({
        code: "MSL-L202",
        severity: "error",
        message:
          `New Reference '${slug}' is not in markspec.lock. Run \`markspec lock --update\` to add it.`,
        location: undefined,
      });
      continue;
    }
    if (
      old.hash !== undefined && current.hash !== undefined &&
      old.hash !== current.hash
    ) {
      diags.push({
        code: "MSL-L210",
        severity: "error",
        message:
          `Hash mismatch for Reference '${slug}': locked ${old.hash} vs current ${current.hash}.`,
        location: undefined,
      });
    }
  }
  for (const slug of lockedRefs.keys()) {
    if (!resolvedRefs.has(slug)) {
      diags.push({
        code: "MSL-L203",
        severity: "error",
        message:
          `Locked Reference '${slug}' is no longer present in source. Run \`markspec lock\` to remove it.`,
        location: undefined,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Profiles — match by id.
  // -------------------------------------------------------------------------

  const lockedProfs = new Map<string, UpstreamProfile>();
  for (const u of locked.upstreams) {
    if (u.kind === "profile") lockedProfs.set(u.id, u);
  }
  const resolvedProfs = new Map<string, UpstreamProfile>();
  for (const r of resolved.profiles) {
    resolvedProfs.set(r.upstream.id, r.upstream);
  }

  for (const [id, current] of resolvedProfs) {
    const old = lockedProfs.get(id);
    if (old === undefined) {
      diags.push({
        code: "MSL-L202",
        severity: "error",
        message: `New profile tier '${id}' is not in markspec.lock.`,
        location: undefined,
      });
      continue;
    }
    if (old.resolved !== current.resolved) {
      diags.push({
        code: "MSL-L211",
        severity: "error",
        message:
          `Profile '${id}' resolved version drifted: locked ${old.resolved} vs current ${current.resolved}. Run \`markspec lock --update=${id}\`.`,
        location: undefined,
      });
    } else if (old.hash !== current.hash) {
      diags.push({
        code: "MSL-L210",
        severity: "error",
        message:
          `Hash mismatch for profile '${id}': locked ${old.hash} vs current ${current.hash}.`,
        location: undefined,
      });
    }
  }
  for (const id of lockedProfs.keys()) {
    if (!resolvedProfs.has(id)) {
      diags.push({
        code: "MSL-L203",
        severity: "error",
        message: `Locked profile tier '${id}' is no longer in the chain.`,
        location: undefined,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Federated registries — pure id-presence against declared references.
  // No hash comparison: content integrity is the offline cache gate.
  // -------------------------------------------------------------------------

  const lockedRegistries = locked.upstreams.filter(
    (u): u is UpstreamRegistry => u.kind === "registry",
  );
  const lockedRegistryIds = new Set(lockedRegistries.map((r) => r.id));
  for (const id of declaredReferenceIds) {
    if (!lockedRegistryIds.has(id)) {
      diags.push({
        code: "MSL-L202",
        severity: "error",
        message:
          `declared reference '${id}' has no lockfile row — run 'markspec lock'`,
        location: undefined,
      });
    }
  }
  const declaredRegistryIds = new Set(declaredReferenceIds);
  for (const row of lockedRegistries) {
    if (!declaredRegistryIds.has(row.id)) {
      diags.push({
        code: "MSL-L203",
        severity: "error",
        message:
          `locked reference '${row.id}' is no longer declared in project.yaml — run 'markspec lock'`,
        location: undefined,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Canonical edge hash — single comparison, MSL-L212 on mismatch.
  // -------------------------------------------------------------------------

  if (locked.generatedCache.edgesHash !== resolved.canonicalEdgeHash) {
    diags.push({
      code: "MSL-L212",
      severity: "error",
      message:
        `Canonical edge hash drifted: locked ${locked.generatedCache.edgesHash} (${locked.generatedCache.edgesCount} edges) vs current ${resolved.canonicalEdgeHash} (${resolved.canonicalEdgeCount} edges).`,
      location: undefined,
    });
  }

  return diags;
}
