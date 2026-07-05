import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { upstreamRefsFromLockfile } from "./refs.ts";
import type { Lockfile } from "../lock/mod.ts";
import { upstreamCacheRoot } from "../lock/upstream_refs.ts";

/** Expected cache dir for the `"/proj"` fixture root, built the same
 * `join()`-based way production does — a hardcoded forward-slash literal
 * would never match the backslash path Windows produces. */
const REFHUB_DIR = join(upstreamCacheRoot("/proj"), "refhub");

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

Deno.test("upstreamRefsFromLockfile: registry row → ref with cache dir", () => {
  const refs = upstreamRefsFromLockfile(
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
    "/proj",
  );
  assertEquals(refs, [{
    id: "refhub",
    version: "1.4.0",
    dir: REFHUB_DIR,
  }]);
});

Deno.test("upstreamRefsFromLockfile: snapshot-less row is skipped", () => {
  const refs = upstreamRefsFromLockfile(
    lf([{
      kind: "registry",
      id: "old",
      api: "https://x",
      resolvedManifestHash: "sha256:a",
      markspecSchema: 1,
    }]),
    "/proj",
  );
  assertEquals(refs, []);
});

Deno.test("upstreamRefsFromLockfile: version falls back to 'unversioned'", () => {
  const refs = upstreamRefsFromLockfile(
    lf([{
      kind: "registry",
      id: "refhub",
      api: "https://x",
      resolvedManifestHash: "sha256:a",
      markspecSchema: 1,
      snapshot: "sha256:b",
      lockedAt: "2026-07-04T00:00:00Z",
    }]),
    "/proj",
  );
  assertEquals(refs[0].version, "unversioned");
});

Deno.test("upstreamRefsFromLockfile: reference/profile (non-snapshot) rows skipped", () => {
  const refs = upstreamRefsFromLockfile(
    lf([
      { kind: "reference", slug: "ISO", id: "urn:iso" },
      {
        kind: "profile",
        id: "p",
        specifier: "npm:x",
        resolved: "1",
        hash: "sha256:z",
      },
    ]),
    "/proj",
  );
  assertEquals(refs, []);
});

Deno.test("upstreamRefsFromLockfile: dependency row → ref with cache dir", () => {
  // Git dependencies (slice 3) share the registry rows' snapshot-carrying
  // shape and cache namespace; the mapper must include them identically.
  const refs = upstreamRefsFromLockfile(
    lf([{
      kind: "dependency",
      id: "product",
      url: "git@github.com:acme/product.git",
      intent: "auto",
      resolved: "tag:v2.1.0",
      sha: "a".repeat(40),
      snapshot: "sha256:c",
      lockedAt: "2026-07-04T00:00:00Z",
    }]),
    "/proj",
  );
  assertEquals(refs, [{
    id: "product",
    // UpstreamDependency carries no `version` field — the badge label
    // falls back to "unversioned" (the resolved pin lives in `resolved`).
    version: "unversioned",
    dir: join(upstreamCacheRoot("/proj"), "product"),
  }]);
});
