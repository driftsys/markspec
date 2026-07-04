import { assertEquals } from "@std/assert";
import { parseFile } from "../parser/mod.ts";
import { serializeEntry } from "../compiler/schema.ts";
import { loadUpstreamCorpus } from "./mod.ts";

const UP_A_MD = `# A

- [SYS_0001] Threat assessment

  The system shall compute a threat level within 200 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`;

async function snapshotFiles(
  dir: string,
  md: string,
  file: string,
  reexport?: { upstreamId: string; version: string },
): Promise<Map<string, string>> {
  const { entries } = await parseFile(md, { file });
  const serialized = entries.map((e) =>
    serializeEntry(
      reexport
        ? { ...e, origin: { kind: "upstream" as const, ...reexport } }
        : e,
    )
  );
  const manifest = {
    markspecSchemaVersion: 1,
    generator: { release: "0.0.0-test", coreSchema: 1 },
    project: { name: "up", root: "/up" },
    counts: { entries: serialized.length, edges: 0, byType: {} },
    entries: { format: "inline", file: "compiled.json" },
    edges: { format: "inline", file: "compiled.json" },
    sqliteMirror: null,
    federation: [],
    reserved: {},
  };
  const compiled = {
    entries: Object.fromEntries(serialized.map((s) => [s.displayId, s])),
  };
  return new Map([
    [`${dir}/manifest.json`, JSON.stringify(manifest)],
    [`${dir}/compiled.json`, JSON.stringify(compiled)],
  ]);
}

function readerFor(files: Map<string, string>) {
  return (path: string) => Promise.resolve(files.get(path));
}

/** Wrap {@linkcode readerFor} to record every requested path — lets the
 * skew test pin that the snapshot data file is never read (ordering
 * contract: skew check before any data-file read). */
function recordingReaderFor(files: Map<string, string>, requested: string[]) {
  const inner = readerFor(files);
  return (path: string) => {
    requested.push(path);
    return inner(path);
  };
}

Deno.test("loadUpstreamCorpus: hydrates and stamps upstream origin", async () => {
  const files = await snapshotFiles("/c/up/product", UP_A_MD, "/up/a.md");
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: "/c/up/product" }],
    readerFor(files),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.entries.length, 1);
  assertEquals(result.entries[0].displayId, "SYS_0001");
  assertEquals(result.entries[0].origin, {
    kind: "upstream",
    upstreamId: "product",
    version: "v2.1.0",
  });
});

Deno.test("loadUpstreamCorpus: authoritative-source rule skips re-exports", async () => {
  // product's snapshot re-exports an entry it pulled from 'icd' — skip it.
  const files = await snapshotFiles("/c/up/product", UP_A_MD, "/up/a.md", {
    upstreamId: "icd",
    version: "v1.0.0",
  });
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: "/c/up/product" }],
    readerFor(files),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.entries, []);
});

Deno.test("loadUpstreamCorpus: missing manifest → 002, other upstreams still load", async () => {
  const files = await snapshotFiles("/c/up/product", UP_A_MD, "/up/a.md");
  const result = await loadUpstreamCorpus(
    [
      { id: "ghost", version: "v0", dir: "/c/up/ghost" },
      { id: "product", version: "v2.1.0", dir: "/c/up/product" },
    ],
    readerFor(files),
  );
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "UPSTREAM-SNAPSHOT-002");
  assertEquals(result.entries.length, 1);
});

Deno.test("loadUpstreamCorpus: schema skew → 001, upstream skipped", async () => {
  const files = await snapshotFiles("/c/up/product", UP_A_MD, "/up/a.md");
  const manifest = JSON.parse(files.get("/c/up/product/manifest.json")!);
  manifest.generator.coreSchema = 99;
  files.set("/c/up/product/manifest.json", JSON.stringify(manifest));
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: "/c/up/product" }],
    readerFor(files),
  );
  assertEquals(result.diagnostics[0].code, "UPSTREAM-SNAPSHOT-001");
  assertEquals(result.entries, []);
});

Deno.test("loadUpstreamCorpus: skew check runs before any data-file read", async () => {
  // Ordering pin (contract 1): a skewed snapshot must never reach the
  // data file — assert on the paths the reader was asked for, not just
  // the outcome. Reordering the loader to pre-read compiled.json before
  // (or regardless of) the skew check would fail this test even though
  // the 001-diagnostic outcome stays the same.
  const files = await snapshotFiles("/c/up/product", UP_A_MD, "/up/a.md");
  const manifest = JSON.parse(files.get("/c/up/product/manifest.json")!);
  manifest.generator.coreSchema = 99;
  files.set("/c/up/product/manifest.json", JSON.stringify(manifest));
  const requested: string[] = [];
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: "/c/up/product" }],
    recordingReaderFor(files, requested),
  );
  assertEquals(result.diagnostics[0].code, "UPSTREAM-SNAPSHOT-001");
  assertEquals(requested.includes("/c/up/product/manifest.json"), true);
  assertEquals(requested.includes("/c/up/product/compiled.json"), false);
});

Deno.test("loadUpstreamCorpus: no upstreams → empty result", async () => {
  const result = await loadUpstreamCorpus([], readerFor(new Map()));
  assertEquals(result.entries, []);
  assertEquals(result.diagnostics, []);
});

Deno.test("loadUpstreamCorpus: empty snapshot entries → no entries, no diagnostics", async () => {
  const files = await snapshotFiles("/c/up/product", UP_A_MD, "/up/a.md");
  files.set("/c/up/product/compiled.json", JSON.stringify({ entries: {} }));
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: "/c/up/product" }],
    readerFor(files),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.entries, []);
});

Deno.test("loadUpstreamCorpus: missing snapshot data file → 002", async () => {
  // Data-file-level failure: valid manifest, but the compiled.json it
  // names is gone — distinct from the manifest-level 002 tested above.
  const files = await snapshotFiles("/c/up/product", UP_A_MD, "/up/a.md");
  files.delete("/c/up/product/compiled.json");
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: "/c/up/product" }],
    readerFor(files),
  );
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "UPSTREAM-SNAPSHOT-002");
  assertEquals(result.entries, []);
});

Deno.test("loadUpstreamCorpus: isolation — a non-object entry value in one upstream doesn't abort the others", async () => {
  // Regression pin for the loader's documented isolation contract: a
  // malformed entry value (valid JSON, wrong shape) in one upstream's
  // snapshot must not reject the whole call or block a sibling upstream
  // from loading.
  const badFiles = await snapshotFiles("/c/up/bad", UP_A_MD, "/up/a.md");
  badFiles.set(
    "/c/up/bad/compiled.json",
    JSON.stringify({ entries: { X: null } }),
  );
  const goodFiles = await snapshotFiles("/c/up/product", UP_A_MD, "/up/a.md");
  const files = new Map([...badFiles, ...goodFiles]);
  const result = await loadUpstreamCorpus(
    [
      { id: "bad", version: "v1.0.0", dir: "/c/up/bad" },
      { id: "product", version: "v2.1.0", dir: "/c/up/product" },
    ],
    readerFor(files),
  );
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "UPSTREAM-SNAPSHOT-003");
  assertEquals(result.entries.length, 1);
  assertEquals(result.entries[0].origin, {
    kind: "upstream",
    upstreamId: "product",
    version: "v2.1.0",
  });
});

Deno.test("loadUpstreamCorpus: relFile escaping the cache dir → 003, never read outside the upstream dir", async () => {
  const files = await snapshotFiles("/c/up/product", UP_A_MD, "/up/a.md");
  const manifest = JSON.parse(files.get("/c/up/product/manifest.json")!);
  manifest.entries = { format: "inline", file: "../../evil.json" };
  files.set("/c/up/product/manifest.json", JSON.stringify(manifest));
  const requested: string[] = [];
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: "/c/up/product" }],
    recordingReaderFor(files, requested),
  );
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "UPSTREAM-SNAPSHOT-003");
  assertEquals(result.entries, []);
  assertEquals(requested.includes("/c/up/product/manifest.json"), true);
  assertEquals(
    requested.some((p) => p.includes("evil.json")),
    false,
  );
});
