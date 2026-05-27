import { assertEquals } from "@std/assert";
import { sha256Bytes, sha256String } from "./hash.ts";
import { serializeLockfile } from "./serializer.ts";
import type { Lockfile } from "./model.ts";

Deno.test("sha256Bytes: empty input has known SHA-256", async () => {
  const h = await sha256Bytes(new Uint8Array());
  // Well-known SHA-256 of zero-length input.
  assertEquals(
    h,
    "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

Deno.test("sha256String: 'abc' has known hash", async () => {
  const h = await sha256String("abc");
  assertEquals(
    h,
    "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

Deno.test("sha256Bytes: sub-buffer view hashes only the viewed slice", async () => {
  const full = new TextEncoder().encode("XXXabcYYY");
  const view = full.subarray(3, 6); // "abc"
  const fromView = await sha256Bytes(view);
  const fromDirect = await sha256Bytes(new TextEncoder().encode("abc"));
  assertEquals(fromView, fromDirect);
});

Deno.test("sha256Bytes: deterministic across calls", async () => {
  const a = await sha256Bytes(new TextEncoder().encode("hello world"));
  const b = await sha256Bytes(new TextEncoder().encode("hello world"));
  assertEquals(a, b);
});

// ---------------------------------------------------------------------------
// meta.toolchain affects the lockfile content hash (slice B)
// ---------------------------------------------------------------------------

Deno.test("hash differs when meta.toolchain.minVersion differs", async () => {
  const base: Lockfile = {
    schema: 1,
    meta: { markspecSchema: 1, lockedAt: "2026-05-27T12:00:00Z" },
    upstreams: [],
    boundEntries: [],
    generatedCache: { edgesHash: "sha256:abc", edgesCount: 0 },
  };
  const withFloor06: Lockfile = {
    ...base,
    meta: { ...base.meta, toolchain: { minVersion: "0.6" } },
  };
  const withFloor07: Lockfile = {
    ...base,
    meta: { ...base.meta, toolchain: { minVersion: "0.7" } },
  };

  const hashNone = await sha256String(serializeLockfile(base));
  const hash06 = await sha256String(serializeLockfile(withFloor06));
  const hash07 = await sha256String(serializeLockfile(withFloor07));

  // Each variant produces a distinct hash.
  assertEquals(hashNone !== hash06, true, "absent vs 0.6 should differ");
  assertEquals(hash06 !== hash07, true, "0.6 vs 0.7 should differ");
  assertEquals(hashNone !== hash07, true, "absent vs 0.7 should differ");

  // Same input always produces the same hash (deterministic).
  const hash06Again = await sha256String(serializeLockfile(withFloor06));
  assertEquals(hash06, hash06Again);
});
