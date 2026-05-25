/**
 * @module core/lock/canonical_edges
 *
 * Canonical edge model: deterministic projection of the traceability
 * graph used for the lockfile's generated-cache.edges-hash field. Hashes
 * a sorted JSON serialization (RFC-8785-style: sorted keys, no
 * insignificant whitespace, deterministic number formatting) of the edge
 * quad list. Decouples the hash from compile-output's NDJSON format
 * (which is the same data viewed through a different serializer).
 */

import { sha256String } from "./hash.ts";

/** One traceability edge in canonical form. */
export interface EdgeQuad {
  readonly source: string;
  readonly relation: string;
  readonly target: string;
  readonly provenance: "local" | "external" | "generated";
}

/**
 * Serialize a list of edge quads to RFC-8785-style canonical JSON.
 *
 * Rules:
 *   1. Object keys sorted alphabetically.
 *   2. No insignificant whitespace.
 *   3. Top-level array sorted by (source, relation, target, provenance)
 *      so input order doesn't affect output.
 *   4. Strings JSON-escaped per RFC 8259.
 */
export function canonicalEdgeJson(edges: readonly EdgeQuad[]): string {
  const sorted = edges.slice().sort(compareEdgeQuads);
  const parts: string[] = ["["];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) parts.push(",");
    parts.push(canonicalQuad(sorted[i]));
  }
  parts.push("]");
  return parts.join("");
}

/** Compute sha256:* of the canonical JSON for a set of edges. */
export async function hashCanonicalEdges(
  edges: readonly EdgeQuad[],
): Promise<string> {
  return await sha256String(canonicalEdgeJson(edges));
}

function compareEdgeQuads(a: EdgeQuad, b: EdgeQuad): number {
  const s = a.source.localeCompare(b.source);
  if (s !== 0) return s;
  const r = a.relation.localeCompare(b.relation);
  if (r !== 0) return r;
  const t = a.target.localeCompare(b.target);
  if (t !== 0) return t;
  return a.provenance.localeCompare(b.provenance);
}

function canonicalQuad(q: EdgeQuad): string {
  // Sorted keys: provenance, relation, source, target.
  return (
    "{" +
    `"provenance":${JSON.stringify(q.provenance)},` +
    `"relation":${JSON.stringify(q.relation)},` +
    `"source":${JSON.stringify(q.source)},` +
    `"target":${JSON.stringify(q.target)}` +
    "}"
  );
}
