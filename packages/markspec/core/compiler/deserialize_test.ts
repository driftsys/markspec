import { assertEquals } from "@std/assert";
import { parseFile } from "../parser/mod.ts";
import { serializeEntry } from "./schema.ts";
import {
  checkSnapshotSchema,
  deserializeEntry,
  extractSerializedEntries,
} from "./deserialize.ts";

const FIXTURE = `# Sample

- [STK_0001] Braking distance

  The system shall stop the vehicle within 40 m from 100 km/h.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Labels: ASIL-B

- [SYS_0001] Threat assessment

  The system shall compute a threat level within 200 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Satisfies: STK_0001
`;

Deno.test("deserializeEntry: JSON wire round-trip preserves the entry", async () => {
  const { entries } = await parseFile(FIXTURE, { file: "/proj/sample.md" });
  for (const entry of entries) {
    const wire = JSON.parse(JSON.stringify(serializeEntry(entry)));
    assertEquals(deserializeEntry(wire), entry);
  }
});

// A references document (basename `references.md`) with a slug display ID
// and no `Id:` trailer produces a Reference-shaped entry whose `id` is an
// own key with value `undefined` — the field-presence case that
// `JSON.stringify` would otherwise erase from the wire form.
const REFERENCE_FIXTURE = `# References

- [iso-26262] ISO 26262 Road vehicles — Functional safety

  Part 6: product development at the software level.
`;

Deno.test("deserializeEntry: round-trip preserves a Reference-shaped entry", async () => {
  const { entries } = await parseFile(REFERENCE_FIXTURE, {
    file: "/proj/references.md",
  });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].shape, "Reference");
  const wire = JSON.parse(JSON.stringify(serializeEntry(entries[0])));
  assertEquals(deserializeEntry(wire), entries[0]);
});

Deno.test("deserializeEntry: origin passes through verbatim", async () => {
  const { entries } = await parseFile(FIXTURE, { file: "/proj/sample.md" });
  const withOrigin = {
    ...entries[0],
    origin: {
      kind: "upstream" as const,
      upstreamId: "product",
      version: "v1.0.0",
    },
  };
  const wire = JSON.parse(JSON.stringify(serializeEntry(withOrigin)));
  assertEquals(deserializeEntry(wire).origin, withOrigin.origin);
});

const GOOD_MANIFEST = {
  markspecSchemaVersion: 1,
  generator: { release: "0.0.0-test", coreSchema: 1 },
  project: { name: "up", root: "/up" },
  counts: { entries: 1, edges: 0, byType: {} },
  entries: { format: "inline", file: "compiled.json" },
  edges: { format: "inline", file: "compiled.json" },
  sqliteMirror: null,
  federation: [],
  reserved: {},
};

Deno.test("checkSnapshotSchema: matching versions → undefined", () => {
  assertEquals(
    checkSnapshotSchema(GOOD_MANIFEST, "/c/manifest.json"),
    undefined,
  );
});

Deno.test("checkSnapshotSchema: core-schema skew → UPSTREAM-SNAPSHOT-001", () => {
  const skewed = {
    ...GOOD_MANIFEST,
    generator: { release: "9", coreSchema: 99 },
  };
  const d = checkSnapshotSchema(skewed, "/c/manifest.json");
  assertEquals(d?.code, "UPSTREAM-SNAPSHOT-001");
  assertEquals(d?.severity, "error");
});

Deno.test("extractSerializedEntries: inline compiled.json", async () => {
  const { entries } = await parseFile(FIXTURE, { file: "/up/sample.md" });
  const compiled = JSON.stringify({
    entries: Object.fromEntries(
      entries.map((e) => [e.displayId, serializeEntry(e)]),
    ),
  });
  const result = extractSerializedEntries(
    GOOD_MANIFEST,
    (rel) => (rel === "compiled.json" ? compiled : undefined),
    "/c/manifest.json",
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.entries.length, 2);
});

Deno.test("extractSerializedEntries: ndjson block", async () => {
  const { entries } = await parseFile(FIXTURE, { file: "/up/sample.md" });
  const ndjson =
    entries.map((e) => JSON.stringify(serializeEntry(e))).join("\n") + "\n";
  const manifest = {
    ...GOOD_MANIFEST,
    entries: { format: "ndjson", file: "entries.ndjson", index: "entries.idx" },
  };
  const result = extractSerializedEntries(
    manifest,
    (rel) => (rel === "entries.ndjson" ? ndjson : undefined),
    "/c/manifest.json",
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.entries.length, 2);
});

Deno.test("extractSerializedEntries: missing snapshot file → UPSTREAM-SNAPSHOT-002", () => {
  const result = extractSerializedEntries(
    GOOD_MANIFEST,
    () => undefined,
    "/c/manifest.json",
  );
  assertEquals(result.entries, []);
  assertEquals(result.diagnostics[0]?.code, "UPSTREAM-SNAPSHOT-002");
});
