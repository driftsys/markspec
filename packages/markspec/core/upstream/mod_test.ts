import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parseFile } from "../parser/mod.ts";
import { serializeEntry } from "../compiler/schema.ts";
import { loadUpstreamCorpus } from "./mod.ts";

/** Cache dirs used across the fixtures below, built via `join()` rather
 * than a hardcoded forward-slash literal — `loadUpstreamCorpus` now reads
 * `join(up.dir, "manifest.json")` internally, which normalises to
 * backslashes on Windows. A hardcoded literal `"/c/up/product/manifest.json"`
 * map key would never match that request on Windows; building both sides
 * with `join()` keeps them in exact agreement on every platform. */
const PRODUCT_DIR = join("/c", "up", "product");
const GHOST_DIR = join("/c", "up", "ghost");
const BAD_DIR = join("/c", "up", "bad");
const PRODUCT_MANIFEST = join(PRODUCT_DIR, "manifest.json");
const PRODUCT_COMPILED = join(PRODUCT_DIR, "compiled.json");
const BAD_COMPILED = join(BAD_DIR, "compiled.json");

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
    [join(dir, "manifest.json"), JSON.stringify(manifest)],
    [join(dir, "compiled.json"), JSON.stringify(compiled)],
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
  const files = await snapshotFiles(PRODUCT_DIR, UP_A_MD, "/up/a.md");
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: PRODUCT_DIR }],
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
  const files = await snapshotFiles(PRODUCT_DIR, UP_A_MD, "/up/a.md", {
    upstreamId: "icd",
    version: "v1.0.0",
  });
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: PRODUCT_DIR }],
    readerFor(files),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.entries, []);
});

Deno.test("loadUpstreamCorpus: missing manifest → 002, other upstreams still load", async () => {
  const files = await snapshotFiles(PRODUCT_DIR, UP_A_MD, "/up/a.md");
  const result = await loadUpstreamCorpus(
    [
      { id: "ghost", version: "v0", dir: GHOST_DIR },
      { id: "product", version: "v2.1.0", dir: PRODUCT_DIR },
    ],
    readerFor(files),
  );
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "UPSTREAM-SNAPSHOT-002");
  assertEquals(result.entries.length, 1);
});

Deno.test("loadUpstreamCorpus: schema skew → 001, upstream skipped", async () => {
  const files = await snapshotFiles(PRODUCT_DIR, UP_A_MD, "/up/a.md");
  const manifest = JSON.parse(files.get(PRODUCT_MANIFEST)!);
  manifest.generator.coreSchema = 99;
  files.set(PRODUCT_MANIFEST, JSON.stringify(manifest));
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: PRODUCT_DIR }],
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
  const files = await snapshotFiles(PRODUCT_DIR, UP_A_MD, "/up/a.md");
  const manifest = JSON.parse(files.get(PRODUCT_MANIFEST)!);
  manifest.generator.coreSchema = 99;
  files.set(PRODUCT_MANIFEST, JSON.stringify(manifest));
  const requested: string[] = [];
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: PRODUCT_DIR }],
    recordingReaderFor(files, requested),
  );
  assertEquals(result.diagnostics[0].code, "UPSTREAM-SNAPSHOT-001");
  assertEquals(requested.includes(PRODUCT_MANIFEST), true);
  assertEquals(requested.includes(PRODUCT_COMPILED), false);
});

Deno.test("loadUpstreamCorpus: no upstreams → empty result", async () => {
  const result = await loadUpstreamCorpus([], readerFor(new Map()));
  assertEquals(result.entries, []);
  assertEquals(result.diagnostics, []);
});

Deno.test("loadUpstreamCorpus: empty snapshot entries → no entries, no diagnostics", async () => {
  const files = await snapshotFiles(PRODUCT_DIR, UP_A_MD, "/up/a.md");
  files.set(PRODUCT_COMPILED, JSON.stringify({ entries: {} }));
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: PRODUCT_DIR }],
    readerFor(files),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.entries, []);
});

Deno.test("loadUpstreamCorpus: missing snapshot data file → 002", async () => {
  // Data-file-level failure: valid manifest, but the compiled.json it
  // names is gone — distinct from the manifest-level 002 tested above.
  const files = await snapshotFiles(PRODUCT_DIR, UP_A_MD, "/up/a.md");
  files.delete(PRODUCT_COMPILED);
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: PRODUCT_DIR }],
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
  const badFiles = await snapshotFiles(BAD_DIR, UP_A_MD, "/up/a.md");
  badFiles.set(
    BAD_COMPILED,
    JSON.stringify({ entries: { X: null } }),
  );
  const goodFiles = await snapshotFiles(PRODUCT_DIR, UP_A_MD, "/up/a.md");
  const files = new Map([...badFiles, ...goodFiles]);
  const result = await loadUpstreamCorpus(
    [
      { id: "bad", version: "v1.0.0", dir: BAD_DIR },
      { id: "product", version: "v2.1.0", dir: PRODUCT_DIR },
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
  const files = await snapshotFiles(PRODUCT_DIR, UP_A_MD, "/up/a.md");
  const manifest = JSON.parse(files.get(PRODUCT_MANIFEST)!);
  manifest.entries = { format: "inline", file: "../../evil.json" };
  files.set(PRODUCT_MANIFEST, JSON.stringify(manifest));
  const requested: string[] = [];
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: PRODUCT_DIR }],
    recordingReaderFor(files, requested),
  );
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "UPSTREAM-SNAPSHOT-003");
  assertEquals(result.entries, []);
  assertEquals(requested.includes(PRODUCT_MANIFEST), true);
  assertEquals(
    requested.some((p) => p.includes("evil.json")),
    false,
  );
});
