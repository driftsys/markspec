import { assertEquals } from "@std/assert";
import { sha256Bytes, sha256String } from "./hash.ts";

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
