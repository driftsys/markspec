/**
 * @module core/profile/git-cache_test
 *
 * Unit tests for the git cache — key derivation, path computation.
 */

import { assertEquals } from "@std/assert";
import { computeCacheKey, computeCacheLocation } from "./git-cache.ts";

Deno.test("computeCacheKey: stable sha256 of (repo, subpath, tag)", async () => {
  const k1 = await computeCacheKey({
    repo: "https://github.com/acme/repo.git",
    subpath: undefined,
    tag: "v1.0.0",
  });
  const k2 = await computeCacheKey({
    repo: "https://github.com/acme/repo.git",
    subpath: undefined,
    tag: "v1.0.0",
  });
  assertEquals(k1, k2); // deterministic
  assertEquals(k1.length, 64); // sha256 hex
});

Deno.test("computeCacheKey: different tags produce different keys", async () => {
  const k1 = await computeCacheKey({
    repo: "https://github.com/acme/repo.git",
    subpath: undefined,
    tag: "v1.0.0",
  });
  const k2 = await computeCacheKey({
    repo: "https://github.com/acme/repo.git",
    subpath: undefined,
    tag: "v2.0.0",
  });
  if (k1 === k2) {
    throw new Error("different tags must produce different keys");
  }
});

Deno.test("computeCacheKey: subpath differentiates keys", async () => {
  const k1 = await computeCacheKey({
    repo: "https://github.com/acme/repo.git",
    subpath: "aspice",
    tag: "v1.0.0",
  });
  const k2 = await computeCacheKey({
    repo: "https://github.com/acme/repo.git",
    subpath: undefined,
    tag: "v1.0.0",
  });
  if (k1 === k2) {
    throw new Error("subpath presence must affect the key");
  }
});

Deno.test("computeCacheLocation: returns absolute cache dir + manifest path", async () => {
  const loc = await computeCacheLocation(
    "/project",
    {
      repo: "https://github.com/acme/repo.git",
      subpath: undefined,
      tag: "v1.0.0",
    },
  );
  // cache dir: <project-root>/.markspec/cache/<key>/
  if (!loc.dir.startsWith("/project/.markspec/cache/")) {
    throw new Error(
      `expected cache dir under /project/.markspec/cache/, got ${loc.dir}`,
    );
  }
  assertEquals(loc.manifestPath, `${loc.dir}/markspec.yaml`);
});

Deno.test("computeCacheLocation: subpath appears in manifest path", async () => {
  const loc = await computeCacheLocation(
    "/project",
    {
      repo: "https://github.com/acme/repo.git",
      subpath: "aspice",
      tag: "v1.0.0",
    },
  );
  assertEquals(loc.manifestPath, `${loc.dir}/aspice/markspec.yaml`);
});
