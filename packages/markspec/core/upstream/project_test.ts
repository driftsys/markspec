import { assertEquals } from "@std/assert";
import { loadProjectUpstreams } from "./project.ts";
import type { Lockfile } from "../lock/mod.ts";

function lf(upstreams: Lockfile["upstreams"]): Lockfile {
  return {
    schema: 1,
    meta: { markspecSchema: 1, lockedAt: "2026-07-04T00:00:00Z" },
    upstreams,
    boundEntries: [],
    edges: [],
    generatedCache: { edgesHash: "sha256:0", edgesCount: 0 },
  };
}

Deno.test("loadProjectUpstreams: no lockfile → empty, no reads", async () => {
  let reads = 0;
  const result = await loadProjectUpstreams("/proj", undefined, () => {
    reads++;
    return Promise.resolve(undefined);
  });
  assertEquals(result, { entries: [], diagnostics: [] });
  assertEquals(reads, 0);
});

Deno.test("loadProjectUpstreams: no snapshot rows → empty, no reads", async () => {
  let reads = 0;
  const result = await loadProjectUpstreams(
    "/proj",
    lf([{
      kind: "registry",
      id: "old",
      api: "https://x",
      resolvedManifestHash: "sha256:a",
      markspecSchema: 1,
    }]),
    () => {
      reads++;
      return Promise.resolve(undefined);
    },
  );
  assertEquals(result, { entries: [], diagnostics: [] });
  assertEquals(reads, 0);
});

Deno.test("loadProjectUpstreams: snapshot row hydrates via loadUpstreamCorpus", async () => {
  // A readFile with no cache proves delegation: the shared loader surfaces
  // loadUpstreamCorpus's UPSTREAM-SNAPSHOT-002 missing-manifest diagnostic.
  const result = await loadProjectUpstreams(
    "/proj",
    lf([{
      kind: "registry",
      id: "refhub",
      api: "https://x",
      resolvedManifestHash: "sha256:a",
      markspecSchema: 1,
      version: "1.4.0",
      snapshot: "sha256:b",
      lockedAt: "2026-07-04T00:00:00Z",
    }]),
    () => Promise.resolve(undefined),
  );
  assertEquals(result.entries, []);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "UPSTREAM-SNAPSHOT-002");
});
