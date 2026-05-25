// packages/markspec/core/lock/model_test.ts
import { assertEquals } from "@std/assert";
import type {
  BoundEntry as _BoundEntry,
  GeneratedCache as _GeneratedCache,
  Lockfile,
  Upstream,
} from "./model.ts";

Deno.test("Lockfile: empty lockfile constructs", () => {
  const lf: Lockfile = {
    schema: 1,
    meta: { markspecSchema: 1, lockedAt: "2026-05-25T12:00:00Z" },
    upstreams: [],
    boundEntries: [],
    generatedCache: { edgesHash: "sha256:e3b0c44...", edgesCount: 0 },
  };
  assertEquals(lf.schema, 1);
  assertEquals(lf.upstreams.length, 0);
});

Deno.test("Upstream: reference variant carries optional hash", () => {
  const ref: Upstream = {
    kind: "reference",
    slug: "ISO-26262-6",
    id: "urn:iso:std:iso:26262:-6:ed-2",
    resolved: "ed-2",
    hash: "sha256:abc",
    source: "https://www.iso.org/standard/68383.html",
  };
  assertEquals(ref.kind, "reference");
});

Deno.test("Upstream: profile variant carries optional extends", () => {
  const prof: Upstream = {
    kind: "profile",
    id: "@org/aspice",
    specifier: "npm:@org/aspice@^1.2",
    resolved: "1.2.4",
    hash: "sha256:def",
    extends: "@markspec/default",
  };
  assertEquals(prof.kind, "profile");
});
