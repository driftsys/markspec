import { assertEquals } from "@std/assert";
import {
  canonicalEdgeJson,
  type EdgeQuad,
  hashCanonicalEdges,
} from "./canonical_edges.ts";

const E1: EdgeQuad = {
  source: "REQ-001",
  relation: "Satisfies",
  target: "STK-001",
  provenance: "local",
};
const E2: EdgeQuad = {
  source: "REQ-002",
  relation: "Verified-by",
  target: "TST-001",
  provenance: "local",
};

Deno.test("canonicalEdgeJson: empty edges produce empty array", () => {
  assertEquals(canonicalEdgeJson([]), "[]");
});

Deno.test("canonicalEdgeJson: keys sorted within each quad", () => {
  const json = canonicalEdgeJson([E1]);
  // Sorted-key order is provenance, relation, source, target.
  assertEquals(
    json,
    '[{"provenance":"local","relation":"Satisfies","source":"REQ-001","target":"STK-001"}]',
  );
});

Deno.test("canonicalEdgeJson: edges sorted lexicographically", () => {
  const a = canonicalEdgeJson([E1, E2]);
  const b = canonicalEdgeJson([E2, E1]);
  assertEquals(a, b, "edge order must not affect output");
});

Deno.test("hashCanonicalEdges: permutations produce identical hash", async () => {
  const h1 = await hashCanonicalEdges([E1, E2]);
  const h2 = await hashCanonicalEdges([E2, E1]);
  assertEquals(h1, h2);
});

Deno.test("hashCanonicalEdges: different edge sets produce different hashes", async () => {
  const h1 = await hashCanonicalEdges([E1]);
  const h2 = await hashCanonicalEdges([E1, E2]);
  if (h1 === h2) throw new Error("hash must differ for different edge sets");
});

Deno.test("canonicalEdgeJson: a quad without a locator serializes as before", () => {
  assertEquals(
    canonicalEdgeJson([{
      source: "A",
      relation: "Satisfies",
      target: "B",
      provenance: "local",
    }]),
    '[{"provenance":"local","relation":"Satisfies","source":"A","target":"B"}]',
  );
});

Deno.test("canonicalEdgeJson: a locator is part of the quad", () => {
  assertEquals(
    canonicalEdgeJson([{
      source: "A",
      relation: "Satisfies",
      target: "B",
      locator: "x",
      provenance: "local",
    }]),
    '[{"locator":"x","provenance":"local","relation":"Satisfies","source":"A","target":"B"}]',
  );
});

Deno.test("canonicalEdgeJson: edges differing only by locator sort by locator", () => {
  const quad = (locator: string) => ({
    source: "A",
    relation: "Verifies",
    target: "B",
    locator,
    provenance: "local" as const,
  });
  assertEquals(
    canonicalEdgeJson([quad("y"), quad("x")]),
    canonicalEdgeJson([quad("x"), quad("y")]),
  );
});
