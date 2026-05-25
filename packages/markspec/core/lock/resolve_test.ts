import { assertEquals } from "@std/assert";
import type { ResolvedUpstreams, ResolveUpstreamsOptions } from "./resolve.ts";

Deno.test("ResolveUpstreamsOptions: type compiles with empty inputs", () => {
  const opts: ResolveUpstreamsOptions = {
    entries: [],
    profileChain: [],
    config: {
      name: "x",
      version: "0.0.0",
      labels: [],
      parents: [],
      parentFallback: "",
      captionConventions: {},
    },
    mappings: [],
    fetchUrl: () => Promise.resolve({ error: "stub" }),
  };
  assertEquals(opts.entries.length, 0);

  // Smoke-check the resolved-upstreams shape is constructible.
  const resolved: ResolvedUpstreams = {
    references: [],
    profiles: [],
    registries: [],
    boundEntries: [],
    canonicalEdgeHash: "sha256:0",
    canonicalEdgeCount: 0,
    lockedAt: "2026-05-25T12:00:00Z",
    diagnostics: [],
  };
  assertEquals(resolved.canonicalEdgeCount, 0);
});
