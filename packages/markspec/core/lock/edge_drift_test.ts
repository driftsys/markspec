/**
 * @module core/lock/edge_drift_test
 *
 * Unit tests for {@linkcode detectOfflineEdgeDrift} — the offline
 * edge-hash drift comparison shared by `check`'s MSL-L212 gate and
 * `doctor`'s lock-drift health check.
 */

import { assertEquals } from "@std/assert";
import type { Entry } from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";
import type { GeneratedCache } from "./model.ts";
import { extractEdgeQuads } from "./resolve.ts";
import { hashCanonicalEdges } from "./canonical_edges.ts";
import { detectOfflineEdgeDrift } from "./edge_drift.ts";

/** Minimal Authored entry — extractEdgeQuads only reads displayId +
 * rawAttributes, so the rest is boilerplate. */
function makeEntry(
  displayId: string,
  rawAttributes: Array<{ key: string; value: string }>,
): Entry {
  return {
    displayId: makeDisplayId(displayId),
    title: displayId,
    body: "",
    rawAttributes,
    typedAttributes: new Map() as never,
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    location: { file: "x.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
  };
}

Deno.test("detectOfflineEdgeDrift: matching hash → not drifted", async () => {
  const entries = [
    makeEntry("REQ-1", [{ key: "Satisfies", value: "STK-1, STK-2" }]),
  ];
  const quads = extractEdgeQuads(entries);
  const cache: GeneratedCache = {
    edgesHash: await hashCanonicalEdges(quads),
    edgesCount: quads.length,
  };

  const result = await detectOfflineEdgeDrift(entries, cache);

  assertEquals(result.drifted, false);
  assertEquals(result.lockedCount, 2);
  assertEquals(result.currentCount, 2);
});

Deno.test("detectOfflineEdgeDrift: changed graph → drifted, counts reflect both sides", async () => {
  // Locked snapshot: two edges.
  const locked = [
    makeEntry("REQ-1", [{ key: "Satisfies", value: "STK-1, STK-2" }]),
  ];
  const lockedQuads = extractEdgeQuads(locked);
  const cache: GeneratedCache = {
    edgesHash: await hashCanonicalEdges(lockedQuads),
    edgesCount: lockedQuads.length,
  };

  // Current graph drops one edge — hash no longer matches the pin.
  const current = [
    makeEntry("REQ-1", [{ key: "Satisfies", value: "STK-1" }]),
  ];

  const result = await detectOfflineEdgeDrift(current, cache);

  assertEquals(result.drifted, true);
  assertEquals(result.lockedCount, 2);
  assertEquals(result.currentCount, 1);
});
