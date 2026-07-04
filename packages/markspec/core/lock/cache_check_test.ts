import { assertEquals } from "@std/assert";
import { verifyUpstreamCache } from "./cache_check.ts";
import { sha256Bytes } from "./hash.ts";
import type { UpstreamRegistry } from "./model.ts";
import type { ReadFile } from "./resolve.ts";

const enc = new TextEncoder();

/** In-memory bytes reader over a path → bytes map (missing → `{error}`). */
function makeReadFile(files: ReadonlyMap<string, Uint8Array>): ReadFile {
  return (path) => {
    const bytes = files.get(path);
    return Promise.resolve(bytes ?? { error: "not found" });
  };
}

function registryRow(
  id: string,
  snapshot: string | undefined,
): UpstreamRegistry {
  return {
    kind: "registry",
    id,
    api: `https://x.example/${id}`,
    resolvedManifestHash: "sha256:0",
    markspecSchema: 1,
    snapshot,
    lockedAt: "2026-07-04T00:00:00Z",
  };
}

Deno.test("verifyUpstreamCache: intact cache emits nothing", async () => {
  const dataBytes = enc.encode(JSON.stringify({ entries: {} }));
  const snapshot = await sha256Bytes(dataBytes);
  const files = new Map<string, Uint8Array>([
    [
      "/root/upstreams/refhub/manifest.json",
      enc.encode(JSON.stringify({ entries: { file: "compiled.json" } })),
    ],
    ["/root/upstreams/refhub/compiled.json", dataBytes],
  ]);
  const row = registryRow("refhub", snapshot);

  const diags = await verifyUpstreamCache(
    [row],
    "/root/upstreams",
    makeReadFile(files),
  );

  assertEquals(diags, []);
});

Deno.test("verifyUpstreamCache: missing manifest fails with one MSL-L212 naming the id", async () => {
  const row = registryRow("refhub", "sha256:deadbeef");

  const diags = await verifyUpstreamCache(
    [row],
    "/root/upstreams",
    makeReadFile(new Map()),
  );

  assertEquals(diags.length, 1);
  assertEquals(diags[0].code, "MSL-L212");
  assertEquals(diags[0].message.includes("refhub"), true);
  assertEquals(diags[0].message.includes("markspec lock"), true);
});

Deno.test("verifyUpstreamCache: hash mismatch fails with one MSL-L212", async () => {
  const dataBytes = enc.encode(JSON.stringify({ entries: {} }));
  const files = new Map<string, Uint8Array>([
    [
      "/root/upstreams/refhub/manifest.json",
      enc.encode(JSON.stringify({ entries: { file: "compiled.json" } })),
    ],
    ["/root/upstreams/refhub/compiled.json", dataBytes],
  ]);
  // Deliberately wrong — does not match the sha256 of dataBytes.
  const row = registryRow("refhub", "sha256:0000000000000000");

  const diags = await verifyUpstreamCache(
    [row],
    "/root/upstreams",
    makeReadFile(files),
  );

  assertEquals(diags.length, 1);
  assertEquals(diags[0].code, "MSL-L212");
});

Deno.test("verifyUpstreamCache: rows without a snapshot (legacy) are skipped", async () => {
  const row = registryRow("legacy", undefined);

  const diags = await verifyUpstreamCache(
    [row],
    "/root/upstreams",
    makeReadFile(new Map()),
  );

  assertEquals(diags, []);
});

Deno.test("verifyUpstreamCache: multiple rows only report the broken one", async () => {
  const dataBytes = enc.encode(JSON.stringify({ entries: {} }));
  const snapshot = await sha256Bytes(dataBytes);
  const files = new Map<string, Uint8Array>([
    [
      "/root/upstreams/good/manifest.json",
      enc.encode(JSON.stringify({ entries: { file: "compiled.json" } })),
    ],
    ["/root/upstreams/good/compiled.json", dataBytes],
  ]);
  const good = registryRow("good", snapshot);
  const broken = registryRow("broken", "sha256:mismatch");

  const diags = await verifyUpstreamCache(
    [good, broken],
    "/root/upstreams",
    makeReadFile(files),
  );

  assertEquals(diags.length, 1);
  assertEquals(diags[0].message.includes("broken"), true);
});
