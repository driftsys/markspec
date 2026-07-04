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
