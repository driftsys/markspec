import { assertEquals } from "@std/assert";
import {
  type GitIO,
  resolveProjectDependencies,
  type UpstreamDepsIO,
} from "./upstream_deps.ts";
import { parseLsRemote } from "./git_intent.ts";
import type { CompiledSnapshot } from "./acquire_compile.ts";
import type { ManifestJson } from "../compiler/manifest.ts";
import { sha256Bytes } from "./hash.ts";

const MANIFEST = {
  markspecSchemaVersion: 1,
  generator: { release: "0.0.0", coreSchema: 1 },
  project: { name: "dep", root: "." },
  counts: { entries: 0, edges: 0, byType: {} },
  entries: { format: "inline", file: "compiled.json" },
  edges: { format: "inline", file: "compiled.json" },
  sqliteMirror: null,
  federation: [],
  reserved: {},
} as unknown as ManifestJson;

const LS = parseLsRemote(
  "ref: refs/heads/main\tHEAD\n" +
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tHEAD\n" +
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/main\n" +
    "cccccccccccccccccccccccccccccccccccccccc\trefs/tags/v2.0.0",
);

// Fake IO: records git calls; compileTree returns a fixed snapshot; writes go
// to an in-memory FS keyed by join()'d path (Windows-safe per slice-2/4 gotcha).
function makeIO(overrides: Partial<GitIO> = {}) {
  const fs = new Map<string, Uint8Array>();
  const acquired: string[] = [];
  const compiledBytes = new TextEncoder().encode('{"entries":{}}');
  let snapPromise: Promise<string> | undefined;
  const io: UpstreamDepsIO = {
    git: {
      lsRemote: () => Promise.resolve(LS),
      acquireTree: (_u, sha, _d) => {
        acquired.push(sha);
        return Promise.resolve({});
      },
      ...overrides,
    },
    compileTree: async (): Promise<CompiledSnapshot> => {
      snapPromise ??= sha256Bytes(compiledBytes);
      return {
        manifestJson: MANIFEST,
        compiledBytes,
        snapshot: await snapPromise,
      };
    },
    readFile: (p) => {
      const b = fs.get(p);
      return Promise.resolve(b ?? { error: "ENOENT" });
    },
    writeFile: (p, bytes) => {
      fs.set(p, bytes);
      return Promise.resolve({});
    },
    makeTempDir: () => Promise.resolve("/tmp/acq"),
    removeDir: () => Promise.resolve(),
  };
  return { io, fs, acquired, compiledBytes };
}

Deno.test("first-lock: resolves auto → tag, writes row + cache", async () => {
  const { io, fs, acquired } = makeIO();
  const r = await resolveProjectDependencies({
    dependencies: [{ url: "https://example.test/dep.git" }],
    existing: [],
    cacheRoot: "/cache",
    update: false,
    io,
    lockedAt: "2026-07-04T00:00:00Z",
  });
  assertEquals(r.diagnostics, []);
  assertEquals(r.dependencies.length, 1);
  const row = r.dependencies[0];
  assertEquals(row.resolved, "tag:v2.0.0");
  assertEquals(row.sha, "cccccccccccccccccccccccccccccccccccccccc");
  assertEquals(row.intent, "auto");
  assertEquals(acquired, ["cccccccccccccccccccccccccccccccccccccccc"]);
  // manifest.json + compiled.json written under /cache/dep.
  assertEquals(fs.has("/cache/dep/manifest.json"), true);
  assertEquals(fs.has("/cache/dep/compiled.json"), true);
});

Deno.test("keep: intact cache → no git, row preserved", async () => {
  const { io, fs, compiledBytes } = makeIO();
  const snapshot = await sha256Bytes(compiledBytes);
  // Seed an intact cache matching the existing row's snapshot.
  fs.set(
    "/cache/dep/manifest.json",
    new TextEncoder().encode(JSON.stringify(MANIFEST)),
  );
  fs.set("/cache/dep/compiled.json", compiledBytes);
  const existing = {
    kind: "dependency" as const,
    id: "dep",
    url: "https://example.test/dep.git",
    intent: "auto",
    resolved: "tag:v2.0.0",
    sha: "cccccccccccccccccccccccccccccccccccccccc",
    snapshot,
    lockedAt: "2026-07-04T00:00:00Z",
  };
  const acquired: string[] = [];
  io.git.acquireTree = (_u, sha) => {
    acquired.push(sha);
    return Promise.resolve({});
  };
  const r = await resolveProjectDependencies({
    dependencies: [{ url: existing.url }],
    existing: [existing],
    cacheRoot: "/cache",
    update: false,
    io,
    lockedAt: "2026-07-05T00:00:00Z",
  });
  assertEquals(acquired, []); // idempotent — no re-acquire
  assertEquals(r.dependencies[0], existing); // unchanged row
});

Deno.test("warn-and-write: ls-remote failure is a warning, others still resolve", async () => {
  const { io } = makeIO({
    lsRemote: () => Promise.resolve({ error: "network down" }),
  });
  const r = await resolveProjectDependencies({
    dependencies: [{ url: "https://example.test/dep.git" }],
    existing: [],
    cacheRoot: "/cache",
    update: false,
    io,
    lockedAt: "2026-07-04T00:00:00Z",
  });
  assertEquals(r.dependencies.length, 0);
  assertEquals(r.diagnostics.length, 1);
  assertEquals(r.diagnostics[0].code, "MSL-L213");
  assertEquals(r.diagnostics[0].severity, "warning");
});

Deno.test("update: re-resolves and moves the pin", async () => {
  const { io, acquired } = makeIO();
  const existing = {
    kind: "dependency" as const,
    id: "dep",
    url: "https://example.test/dep.git",
    intent: "auto",
    resolved: "branch:main",
    sha: "0000000000000000000000000000000000000000",
    snapshot: "stale",
    lockedAt: "2026-01-01T00:00:00Z",
  };
  const r = await resolveProjectDependencies({
    dependencies: [{ url: existing.url }],
    existing: [existing],
    cacheRoot: "/cache",
    update: true,
    io,
    lockedAt: "2026-07-04T00:00:00Z",
  });
  assertEquals(r.dependencies[0].resolved, "tag:v2.0.0");
  assertEquals(acquired.length, 1); // re-acquired despite existing row
});
