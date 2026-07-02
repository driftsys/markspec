/**
 * @module core/lock/edge_drift
 *
 * Offline traceability edge-drift detection: compare the current project
 * graph's canonical edge hash against a lockfile's generated-cache. Pure,
 * offline (no upstream resolution) — the single source of truth shared by
 * `check`'s MSL-L212 gate and `doctor`'s lock-drift health check so the two
 * can never disagree on what "drift" means.
 */

import type { Entry } from "../model/mod.ts";
import type { GeneratedCache } from "./model.ts";
import { extractEdgeQuads } from "./resolve.ts";
import { hashCanonicalEdges } from "./canonical_edges.ts";

/** Result of the offline (no-network) edge-hash drift comparison. */
export interface OfflineEdgeDrift {
  /** True when the current canonical edge hash differs from the lockfile. */
  readonly drifted: boolean;
  /** Edge count recorded in the lockfile's generated-cache. */
  readonly lockedCount: number;
  /** Edge count in the current project graph. */
  readonly currentCount: number;
}

/**
 * Compare the current project graph's canonical edge hash against a
 * lockfile's generated-cache. Offline by design — no upstream resolution.
 *
 * `projectEntries` MUST already exclude delivered-corpus entries (ADR-030
 * corpus-blindness); the caller filters `!e.origin`, mirroring how
 * `markspec lock` and `check`'s MSL-L212 gate count only project-owned
 * edges.
 */
export async function detectOfflineEdgeDrift(
  projectEntries: readonly Entry[],
  cache: GeneratedCache,
): Promise<OfflineEdgeDrift> {
  const quads = extractEdgeQuads(projectEntries);
  const currentHash = await hashCanonicalEdges(quads);
  return {
    drifted: cache.edgesHash !== currentHash,
    lockedCount: cache.edgesCount,
    currentCount: quads.length,
  };
}
