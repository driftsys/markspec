import { assertEquals } from "@std/assert";
import type { Entry } from "../model/mod.ts";
import { validateTypl } from "./validator.ts";

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

Deno.test("validateTypl: empty input → no diagnostics", () => {
  const { diagnostics } = validateTypl([]);
  assertEquals(diagnostics.length, 0);
});

Deno.test("validateTypl: same $Name same kind+shape across entries → no diagnostic", () => {
  const binding = {
    statementKind: "binding" as const,
    name: "$Speed",
    kind: "signal" as const,
    shape: { kind: "primitive" as const, type: "int" as const },
    position: { line: 1, column: 1 },
  };
  const a = entry("REQ_A", "a.md", { bindings: [binding], typedefs: [] });
  const b = entry("REQ_B", "b.md", { bindings: [binding], typedefs: [] });
  const { diagnostics } = validateTypl([a, b]);
  assertEquals(diagnostics.length, 0);
});

Deno.test("validateTypl: TYPL-002 on different kind", () => {
  const a = entry("REQ_A", "a.md", {
    bindings: [{
      statementKind: "binding",
      name: "$Speed",
      kind: "signal",
      position: { line: 1, column: 1 },
    }],
    typedefs: [],
  });
  const b = entry("REQ_B", "b.md", {
    bindings: [{
      statementKind: "binding",
      name: "$Speed",
      kind: "event",
      position: { line: 1, column: 1 },
    }],
    typedefs: [],
  });
  const { diagnostics } = validateTypl([a, b]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "TYPL-002");
});

Deno.test("validateTypl: TYPL-003 on different shape (same kind)", () => {
  const a = entry("REQ_A", "a.md", {
    bindings: [{
      statementKind: "binding",
      name: "$Speed",
      kind: "signal",
      shape: { kind: "primitive", type: "int" },
      position: { line: 1, column: 1 },
    }],
    typedefs: [],
  });
  const b = entry("REQ_B", "b.md", {
    bindings: [{
      statementKind: "binding",
      name: "$Speed",
      kind: "signal",
      shape: { kind: "primitive", type: "float" },
      position: { line: 1, column: 1 },
    }],
    typedefs: [],
  });
  const { diagnostics } = validateTypl([a, b]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "TYPL-003");
});

Deno.test("validateTypl: TYPL-005 on undefined typedef ref in binding", () => {
  const e = entry("REQ_A", "a.md", {
    bindings: [{
      statementKind: "binding",
      name: "$Brake",
      kind: "command",
      shape: { kind: "ref", name: "MissingType" },
      position: { line: 5, column: 1 },
    }],
    typedefs: [],
  });
  const { diagnostics } = validateTypl([e]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "TYPL-005");
});

Deno.test("validateTypl: ref resolves to typedef in same entry → no diagnostic", () => {
  const e = entry("REQ_A", "a.md", {
    bindings: [{
      statementKind: "binding",
      name: "$Brake",
      kind: "command",
      shape: { kind: "ref", name: "BrakeReq" },
      position: { line: 5, column: 1 },
    }],
    typedefs: [{
      statementKind: "typedef",
      name: "BrakeReq",
      shape: { kind: "primitive", type: "int" },
      position: { line: 7, column: 1 },
    }],
  });
  const { diagnostics } = validateTypl([e]);
  assertEquals(diagnostics.length, 0);
});

Deno.test("validateTypl: cross-entry typedef ref does NOT resolve (entry-local scope)", () => {
  const a = entry("REQ_A", "a.md", {
    bindings: [],
    typedefs: [{
      statementKind: "typedef",
      name: "BrakeReq",
      shape: { kind: "primitive", type: "int" },
      position: { line: 1, column: 1 },
    }],
  });
  const b = entry("REQ_B", "b.md", {
    bindings: [{
      statementKind: "binding",
      name: "$Brake",
      kind: "command",
      shape: { kind: "ref", name: "BrakeReq" }, // references typedef from entry A
      position: { line: 5, column: 1 },
    }],
    typedefs: [],
  });
  const { diagnostics } = validateTypl([a, b]);
  // Entry B's ref to BrakeReq is undefined within entry B's local scope.
  // v1 scope is entry-local; cross-entry typedef sharing is v2.
  assertEquals(diagnostics.some((d) => d.code === "TYPL-005"), true);
});

Deno.test("validateTypl: ref inside record field is checked", () => {
  const e = entry("REQ_A", "a.md", {
    bindings: [{
      statementKind: "binding",
      name: "$Combo",
      kind: "command",
      shape: {
        kind: "record",
        fields: {
          part: { kind: "ref", name: "MissingPart" },
        },
      },
      position: { line: 5, column: 1 },
    }],
    typedefs: [],
  });
  const { diagnostics } = validateTypl([e]);
  assertEquals(diagnostics.some((d) => d.code === "TYPL-005"), true);
});
