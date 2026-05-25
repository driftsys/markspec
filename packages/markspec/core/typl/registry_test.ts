import { assertEquals } from "@std/assert";
import type { Entry } from "../model/mod.ts";
import { buildTypeRegistry } from "./registry.ts";

function entry(
  displayId: string,
  file: string,
  types?: Entry["types"],
): Entry {
  return {
    displayId: displayId as Entry["displayId"],
    title: "t",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    id: "01HZZZ0000000000000000000A",
    type: undefined,
    shape: "Authored",
    location: { file, line: 1, column: 1 },
    source: { kind: "markdown" },
    properties: { file: { path: file, line: 1, column: 1 } },
    bodyTokens: [],
    types,
  };
}

Deno.test("buildTypeRegistry: empty input → empty registry", () => {
  const r = buildTypeRegistry([]);
  assertEquals(r.bindings.size, 0);
  assertEquals(r.typedefs.size, 0);
});

Deno.test("buildTypeRegistry: ignores entries without types field", () => {
  const r = buildTypeRegistry([entry("REQ_0001", "a.md")]);
  assertEquals(r.bindings.size, 0);
});

Deno.test("buildTypeRegistry: collects bindings from one entry", () => {
  const e = entry("REQ_0001", "a.md", {
    bindings: [
      {
        statementKind: "binding",
        name: "$Speed",
        kind: "signal",
        shape: { kind: "primitive", type: "int" },
        position: { line: 5, column: 1 },
      },
    ],
    typedefs: [],
  });
  const r = buildTypeRegistry([e]);
  assertEquals(r.bindings.size, 1);
  assertEquals(r.bindings.get("$Speed")?.length, 1);
  assertEquals(r.bindings.get("$Speed")?.[0].entryDisplayId, "REQ_0001");
});

Deno.test("buildTypeRegistry: collects multiple declarations of same name across entries", () => {
  const a = entry("REQ_A", "a.md", {
    bindings: [
      {
        statementKind: "binding",
        name: "$Speed",
        kind: "signal",
        position: { line: 3, column: 1 },
      },
    ],
    typedefs: [],
  });
  const b = entry("REQ_B", "b.md", {
    bindings: [
      {
        statementKind: "binding",
        name: "$Speed",
        kind: "signal",
        position: { line: 7, column: 1 },
      },
    ],
    typedefs: [],
  });
  const r = buildTypeRegistry([a, b]);
  assertEquals(r.bindings.get("$Speed")?.length, 2);
  assertEquals(r.bindings.get("$Speed")?.[0].entryFile, "a.md");
  assertEquals(r.bindings.get("$Speed")?.[1].entryFile, "b.md");
});

Deno.test("buildTypeRegistry: collects typedefs from entries", () => {
  const e = entry("REQ_0001", "a.md", {
    bindings: [],
    typedefs: [
      {
        statementKind: "typedef",
        name: "Frame",
        shape: { kind: "primitive", type: "int" },
        position: { line: 10, column: 1 },
      },
    ],
  });
  const r = buildTypeRegistry([e]);
  assertEquals(r.typedefs.get("Frame")?.length, 1);
});
