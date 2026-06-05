import { assertEquals } from "@std/assert";
import { checkDrift } from "./check.ts";
import type { Lockfile } from "./model.ts";
import type { ResolvedUpstreams } from "./resolve.ts";

const EMPTY_LOCKED: Lockfile = {
  schema: 1,
  meta: { markspecSchema: 1, lockedAt: "2026-05-25T12:00:00Z" },
  upstreams: [],
  boundEntries: [],
  edges: [],
  generatedCache: { edgesHash: "sha256:0", edgesCount: 0 },
};

const EMPTY_RESOLVED: ResolvedUpstreams = {
  references: [],
  profiles: [],
  registries: [],
  boundEntries: [],
  canonicalEdgeHash: "sha256:0",
  canonicalEdgeCount: 0,
  lockedAt: "2026-05-25T12:00:00Z",
  diagnostics: [],
};

Deno.test("checkDrift: identical → no diagnostics", () => {
  const d = checkDrift(EMPTY_LOCKED, EMPTY_RESOLVED);
  assertEquals(d.length, 0);
});

Deno.test("checkDrift: new Reference not in lockfile → MSL-L202", () => {
  const resolved: ResolvedUpstreams = {
    ...EMPTY_RESOLVED,
    references: [{
      upstream: {
        kind: "reference",
        slug: "ISO-26262-6",
        id: "urn:iso:std:iso:26262:-6:ed-2",
        resolved: "ed-2",
        hash: "sha256:abc",
        source: "file:///a",
      },
      diagnostics: [],
    }],
  };
  const d = checkDrift(EMPTY_LOCKED, resolved);
  assertEquals(d.some((x) => x.code === "MSL-L202"), true);
});

Deno.test("checkDrift: locked Reference absent from current → MSL-L203", () => {
  const locked: Lockfile = {
    ...EMPTY_LOCKED,
    upstreams: [{
      kind: "reference",
      slug: "ISO-26262-6",
      id: "urn:iso:std:iso:26262:-6:ed-2",
      hash: "sha256:abc",
    }],
  };
  const d = checkDrift(locked, EMPTY_RESOLVED);
  assertEquals(d.some((x) => x.code === "MSL-L203"), true);
});

Deno.test("checkDrift: Reference hash mismatch → MSL-L210", () => {
  const locked: Lockfile = {
    ...EMPTY_LOCKED,
    upstreams: [{
      kind: "reference",
      slug: "ISO-26262-6",
      id: "urn:iso:std:iso:26262:-6:ed-2",
      hash: "sha256:abc",
    }],
  };
  const resolved: ResolvedUpstreams = {
    ...EMPTY_RESOLVED,
    references: [{
      upstream: {
        kind: "reference",
        slug: "ISO-26262-6",
        id: "urn:iso:std:iso:26262:-6:ed-2",
        hash: "sha256:DIFFERENT",
      },
      diagnostics: [],
    }],
  };
  const d = checkDrift(locked, resolved);
  assertEquals(d.some((x) => x.code === "MSL-L210"), true);
});

Deno.test("checkDrift: profile resolved-version drift → MSL-L211", () => {
  const locked: Lockfile = {
    ...EMPTY_LOCKED,
    upstreams: [{
      kind: "profile",
      id: "@org/aspice",
      specifier: "npm:@org/aspice@^1.2",
      resolved: "1.2.4",
      hash: "sha256:abc",
    }],
  };
  const resolved: ResolvedUpstreams = {
    ...EMPTY_RESOLVED,
    profiles: [{
      upstream: {
        kind: "profile",
        id: "@org/aspice",
        specifier: "npm:@org/aspice@^1.2",
        resolved: "1.3.0",
        hash: "sha256:abc",
      },
      diagnostics: [],
    }],
  };
  const d = checkDrift(locked, resolved);
  assertEquals(d.some((x) => x.code === "MSL-L211"), true);
});

Deno.test("checkDrift: canonical edge hash drift → MSL-L212", () => {
  const resolved: ResolvedUpstreams = {
    ...EMPTY_RESOLVED,
    canonicalEdgeHash: "sha256:CHANGED",
  };
  const d = checkDrift(EMPTY_LOCKED, resolved);
  assertEquals(d.some((x) => x.code === "MSL-L212"), true);
});
