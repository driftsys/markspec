import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  deriveUpstreamId,
  resolveProjectReferences,
  type UpstreamRefsIO,
} from "./upstream_refs.ts";
import { sha256Bytes } from "./hash.ts";
import { loadUpstreamCorpus } from "../upstream/mod.ts";
import { parseFile } from "../parser/mod.ts";
import { serializeEntry } from "../compiler/schema.ts";

const enc = new TextEncoder();

/** Cache dirs used by the `cache.has(...)` assertions below, built via
 * `join()` rather than a hardcoded forward-slash literal —
 * `resolveProjectReferences` writes through `writeCache`, which calls
 * `join(dir, "manifest.json")` / `join(dir, rel)` internally and
 * normalises to backslashes on Windows. A hardcoded literal
 * `"/proj/.markspec/cache/upstreams/refhub/manifest.json"` map key
 * would never match that write on Windows; building both sides with
 * `join()` keeps them in exact agreement on every platform. */
const PROJ_CACHE_ROOT = "/proj/.markspec/cache/upstreams";
const PROJ_REFHUB_DIR = join(PROJ_CACHE_ROOT, "refhub");
const C_REFHUB_DIR = join("/c", "refhub");

function makeManifest(entriesFile = "compiled.json"): string {
  return JSON.stringify({
    markspecSchemaVersion: 1,
    generator: { release: "0.0.0-test", coreSchema: 1 },
    project: { name: "up", root: "/up", version: "1.4.0" },
    counts: { entries: 1, edges: 0, byType: {} },
    entries: { format: "inline", file: entriesFile },
    edges: { format: "inline", file: entriesFile },
    sqliteMirror: null,
    federation: [],
    reserved: {},
  });
}

const COMPILED = JSON.stringify({ entries: {} });

function makeIO(
  site: Record<string, string>,
  cache: Map<string, Uint8Array> = new Map(),
): { io: UpstreamRefsIO; cache: Map<string, Uint8Array>; fetched: string[] } {
  const fetched: string[] = [];
  return {
    cache,
    fetched,
    io: {
      fetchUrl: (url) => {
        fetched.push(url);
        const body = site[url];
        return Promise.resolve(
          body === undefined ? { error: "HTTP 404" } : enc.encode(body),
        );
      },
      readFile: (path) => {
        const bytes = cache.get(path);
        return Promise.resolve(bytes ?? { error: "not found" });
      },
      writeFile: (path, bytes) => {
        cache.set(path, bytes);
        return Promise.resolve({});
      },
    },
  };
}

const SITE = {
  "https://x.example/refhub/manifest.json": makeManifest(),
  "https://x.example/refhub/compiled.json": COMPILED,
};

Deno.test("deriveUpstreamId: from URL path, strips .git and trailing slash", () => {
  assertEquals(
    deriveUpstreamId({ url: "https://x.example/refhub/" }),
    "refhub",
  );
  assertEquals(
    deriveUpstreamId({ url: "git@github.com:acme/aeb-icd.git" }),
    "aeb-icd",
  );
  assertEquals(deriveUpstreamId({ url: "../aeb-sensor" }), "aeb-sensor");
  assertEquals(deriveUpstreamId({ url: "https://x.example/", name: "n" }), "n");
});

Deno.test("first lock: fetches, caches, and pins a reference", async () => {
  const { io, cache } = makeIO(SITE);
  const result = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: [],
    cacheRoot: PROJ_CACHE_ROOT,
    update: false,
    io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  assertEquals(result.diagnostics, []);
  assertEquals(result.registries.length, 1);
  const row = result.registries[0];
  assertEquals(row.id, "refhub");
  assertEquals(row.api, "https://x.example/refhub");
  assertEquals(row.version, "1.4.0");
  assertEquals(row.snapshot, await sha256Bytes(enc.encode(COMPILED)));
  assertEquals(row.lockedAt, "2026-07-04T12:00:00Z");
  assertEquals(
    cache.has(join(PROJ_REFHUB_DIR, "manifest.json")),
    true,
  );
  assertEquals(
    cache.has(join(PROJ_REFHUB_DIR, "compiled.json")),
    true,
  );
});

Deno.test("keep: intact cache means no network", async () => {
  const first = makeIO(SITE);
  const locked = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: [],
    cacheRoot: "/c",
    update: false,
    io: first.io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  const second = makeIO(SITE, first.cache);
  const result = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: locked.registries,
    cacheRoot: "/c",
    update: false,
    io: second.io,
    lockedAt: "2026-07-05T00:00:00Z",
  });
  assertEquals(result.diagnostics, []);
  assertEquals(second.fetched, []); // offline
  assertEquals(result.registries, locked.registries); // pin unmoved
});

Deno.test("restore: missing cache refetches and verifies against the pin", async () => {
  const first = makeIO(SITE);
  const locked = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: [],
    cacheRoot: "/c",
    update: false,
    io: first.io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  const restored = makeIO(SITE); // empty cache
  const result = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: locked.registries,
    cacheRoot: "/c",
    update: false,
    io: restored.io,
    lockedAt: "2026-07-05T00:00:00Z",
  });
  assertEquals(result.diagnostics, []);
  assertEquals(result.registries, locked.registries); // pin unmoved
  assertEquals(restored.cache.size, 2); // repopulated
});

Deno.test("restore mismatch: moved site → MSL-L214, pin kept", async () => {
  const first = makeIO(SITE);
  const locked = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: [],
    cacheRoot: "/c",
    update: false,
    io: first.io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  const movedSite = {
    "https://x.example/refhub/manifest.json": makeManifest(),
    "https://x.example/refhub/compiled.json": JSON.stringify({
      entries: { CHANGED: {} },
    }),
  };
  const restored = makeIO(movedSite); // empty cache, changed content
  const result = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: locked.registries,
    cacheRoot: "/c",
    update: false,
    io: restored.io,
    lockedAt: "2026-07-05T00:00:00Z",
  });
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "MSL-L214");
  assertEquals(result.diagnostics[0].severity, "warning");
  assertEquals(result.registries, locked.registries);
  assertEquals(restored.cache.size, 0); // mismatched content never written to cache
});

Deno.test("keep: snapshot-less existing row re-pins instead of MSL-L214", async () => {
  const existing = {
    kind: "registry" as const,
    id: "refhub",
    api: "https://x.example/refhub",
    resolvedManifestHash: "deadbeef",
    markspecSchema: 1,
    // `snapshot` intentionally omitted — a representable pre-existing row
    // with no pin to verify a fetch against.
  };
  const { io, cache } = makeIO(SITE);
  const result = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: [existing],
    cacheRoot: "/c",
    update: false,
    io,
    lockedAt: "2026-07-05T00:00:00Z",
  });
  assertEquals(result.diagnostics, []);
  assertEquals(result.registries.length, 1);
  const row = result.registries[0];
  assertEquals(row.id, "refhub");
  assertEquals(row.snapshot, await sha256Bytes(enc.encode(COMPILED)));
  assertEquals(row.lockedAt, "2026-07-05T00:00:00Z");
  assertEquals(cache.has(join(C_REFHUB_DIR, "manifest.json")), true);
  assertEquals(cache.has(join(C_REFHUB_DIR, "compiled.json")), true);
});

Deno.test("update: refetches and moves the pin", async () => {
  const first = makeIO(SITE);
  const locked = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: [],
    cacheRoot: "/c",
    update: false,
    io: first.io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  const movedSite = {
    "https://x.example/refhub/manifest.json": makeManifest(),
    "https://x.example/refhub/compiled.json": JSON.stringify({
      entries: { NEW: {} },
    }),
  };
  const updated = makeIO(movedSite, first.cache);
  const result = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: locked.registries,
    cacheRoot: "/c",
    update: "refhub",
    io: updated.io,
    lockedAt: "2026-07-06T00:00:00Z",
  });
  assertEquals(result.diagnostics, []);
  assertEquals(
    result.registries[0].snapshot !== locked.registries[0].snapshot,
    true,
  );
  assertEquals(result.registries[0].lockedAt, "2026-07-06T00:00:00Z");
});

Deno.test("fetch failure → MSL-L213, other references still resolve", async () => {
  const { io } = makeIO(SITE);
  const result = await resolveProjectReferences({
    references: [
      { url: "https://gone.example/nowhere", name: "ghost" },
      { url: "https://x.example/refhub" },
    ],
    existing: [],
    cacheRoot: "/c",
    update: false,
    io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "MSL-L213");
  assertEquals(result.diagnostics[0].severity, "warning");
  assertEquals(result.registries.length, 1);
  assertEquals(result.registries[0].id, "refhub");
});

Deno.test("duplicate derived ids → MSL-L213 for the duplicate", async () => {
  const { io } = makeIO(SITE);
  const result = await resolveProjectReferences({
    references: [
      { url: "https://x.example/refhub" },
      { url: "https://y.example/refhub" },
    ],
    existing: [],
    cacheRoot: "/c",
    update: false,
    io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  assertEquals(result.registries.length, 1);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "MSL-L213");
  assertEquals(result.diagnostics[0].severity, "warning");
});

Deno.test("schema-skewed published site → MSL-L213 at lock time", async () => {
  const skewed = JSON.parse(makeManifest());
  skewed.generator.coreSchema = 99;
  const { io } = makeIO({
    "https://x.example/refhub/manifest.json": JSON.stringify(skewed),
    "https://x.example/refhub/compiled.json": COMPILED,
  });
  const result = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: [],
    cacheRoot: "/c",
    update: false,
    io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  assertEquals(result.registries, []);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "MSL-L213");
  assertEquals(result.diagnostics[0].severity, "warning");
});

Deno.test("lock-written cache is loadable by loadUpstreamCorpus", async () => {
  const { entries } = await parseFile(
    `# Up\n\n- [SYS_0001] Threat assessment\n\n  The system shall compute a threat level within 200 ms.\n\n      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG\n`,
    { file: "/up/a.md" },
  );
  const compiled = JSON.stringify({
    entries: Object.fromEntries(
      entries.map((e) => [e.displayId, serializeEntry(e)]),
    ),
  });
  const { io, cache } = makeIO({
    "https://x.example/refhub/manifest.json": makeManifest(),
    "https://x.example/refhub/compiled.json": compiled,
  });
  const locked = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: [],
    cacheRoot: "/c",
    update: false,
    io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  assertEquals(locked.diagnostics, []);
  const row = locked.registries[0];
  const corpus = await loadUpstreamCorpus(
    [{ id: row.id, version: row.version ?? "unversioned", dir: C_REFHUB_DIR }],
    (path) => {
      const bytes = cache.get(path);
      return Promise.resolve(
        bytes === undefined ? undefined : new TextDecoder().decode(bytes),
      );
    },
  );
  assertEquals(corpus.diagnostics, []);
  assertEquals(corpus.entries.length, 1);
  assertEquals(corpus.entries[0].origin, {
    kind: "upstream",
    upstreamId: "refhub",
    version: "1.4.0",
  });
});
