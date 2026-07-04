import { assertEquals } from "@std/assert";
import type { BodyToken, Entry } from "../model/mod.ts";
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

/**
 * An entry carrying body tokens (for published-tier citation checks)
 * instead of — or in addition to — typl declarations.
 */
function entryWithTokens(
  displayId: string,
  file: string,
  bodyTokens: readonly BodyToken[],
  types?: Entry["types"],
): Entry {
  return { ...entry(displayId, file, types), bodyTokens };
}

/** An `inline-code` body token wrapping a citation candidate. */
function inlineCode(
  text: string,
  file: string,
  line: number,
  column: number,
): BodyToken {
  return { kind: "inline-code", text, location: { file, line, column } };
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

Deno.test("validateTypl: plain-name cross-entry kind mismatch is silent (TYPL-002 retired)", () => {
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
  assertEquals(diagnostics.length, 0);
});

Deno.test("validateTypl: plain-name cross-entry shape mismatch is silent (TYPL-003 retired)", () => {
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
  assertEquals(diagnostics.length, 0);
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

// ---------------------------------------------------------------------------
// Published tier (#723): declared-once (TYPL-009) + citations (TYPL-010/011)
// ---------------------------------------------------------------------------

Deno.test("validateTypl: duplicate published declaration is TYPL-009", () => {
  const a = entry("REQ_1", "a.md", {
    bindings: [{
      statementKind: "binding",
      name: "$powertrain.brake.pedal",
      kind: "signal",
      position: { line: 3, column: 1 },
    }],
    typedefs: [],
  });
  const b = entry("REQ_2", "b.md", {
    bindings: [{
      statementKind: "binding",
      name: "$powertrain.brake.pedal",
      kind: "signal",
      position: { line: 7, column: 1 },
    }],
    typedefs: [],
  });
  const { diagnostics } = validateTypl([a, b]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "TYPL-009");
  assertEquals(diagnostics[0].location?.file, "b.md");
});

Deno.test("validateTypl: plain-name cross-entry difference is silent (002/003 retired)", () => {
  const a = entry("REQ_1", "a.md", {
    bindings: [{
      statementKind: "binding",
      name: "$speed",
      kind: "signal",
      position: { line: 3, column: 1 },
    }],
    typedefs: [],
  });
  const b = entry("REQ_2", "b.md", {
    bindings: [{
      statementKind: "binding",
      name: "$speed",
      kind: "state",
      position: { line: 7, column: 1 },
    }],
    typedefs: [],
  });
  const { diagnostics } = validateTypl([a, b]);
  assertEquals(diagnostics.length, 0);
});

Deno.test("validateTypl: undeclared published citation is TYPL-011", () => {
  const citing = entryWithTokens("REQ_3", "c.md", [
    inlineCode("`$powertrain.brake.ghost`", "c.md", 4, 8),
  ]);
  const { diagnostics } = validateTypl([citing]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "TYPL-011");
  assertEquals(diagnostics[0].location, { file: "c.md", line: 4, column: 8 });
});

Deno.test("validateTypl: relative citation with no root is TYPL-010", () => {
  const citing = entryWithTokens("REQ_4", "c.md", [
    inlineCode("`$.ghost`", "c.md", 4, 8),
  ]);
  const { diagnostics } = validateTypl([citing]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "TYPL-010");
});

// ---------------------------------------------------------------------------
// Upstream entries (federated-upstream epic, slice 4) are typl-inert: their
// own typl content emits no diagnostics, and their declarations do not
// count toward the corpus-wide declared-once (TYPL-009) accounting.
// ---------------------------------------------------------------------------

Deno.test("validateTypl: upstream entry contributes no TYPL-005 diagnostic; project entry with identical content still does (control)", () => {
  const undefinedRefBinding = {
    statementKind: "binding" as const,
    name: "$Brake",
    kind: "command" as const,
    shape: { kind: "ref" as const, name: "MissingType" },
    position: { line: 5, column: 1 },
  };
  const upstreamEntry = {
    ...entry("REQ_UP", "up.md", {
      bindings: [undefinedRefBinding],
      typedefs: [],
    }),
    origin: {
      kind: "upstream" as const,
      upstreamId: "acme/reqs",
      version: "v1.0",
    },
  };
  const projectEntry = entry("REQ_A", "a.md", {
    bindings: [undefinedRefBinding],
    typedefs: [],
  });

  // RED (pre-fix): validateTypl([upstreamEntry]) emitted TYPL-005 because
  // the emit loop walked all entries with no upstream exclusion.
  const upstreamOnly = validateTypl([upstreamEntry]);
  assertEquals(upstreamOnly.diagnostics, []);

  // Control: the identical undefined-ref content on a project entry still
  // emits — and only once, attributed to the project entry's file.
  const both = validateTypl([upstreamEntry, projectEntry]);
  assertEquals(both.diagnostics.length, 1);
  assertEquals(both.diagnostics[0].code, "TYPL-005");
  assertEquals(both.diagnostics[0].location?.file, "a.md");
});

Deno.test("validateTypl: upstream declaration of a dotted name does not count toward TYPL-009 declared-once", () => {
  const dottedBinding = (line: number) => ({
    statementKind: "binding" as const,
    name: "$Foo.bar",
    kind: "signal" as const,
    position: { line, column: 1 },
  });
  const projectEntry = entry("REQ_1", "a.md", {
    bindings: [dottedBinding(3)],
    typedefs: [],
  });
  const upstreamEntry = {
    ...entry("REQ_UP", "up.md", { bindings: [dottedBinding(7)], typedefs: [] }),
    origin: {
      kind: "upstream" as const,
      upstreamId: "acme/reqs",
      version: "v1.0",
    },
  };
  // RED (pre-fix): the registry included the upstream binding, so the
  // project entry's declaration looked like the second (duplicate) one.
  const { diagnostics } = validateTypl([projectEntry, upstreamEntry]);
  assertEquals(diagnostics.filter((d) => d.code === "TYPL-009"), []);
});

Deno.test("validateTypl: control — two PROJECT entries declaring the same dotted name still emits TYPL-009", () => {
  const dottedBinding = (line: number) => ({
    statementKind: "binding" as const,
    name: "$Foo.bar",
    kind: "signal" as const,
    position: { line, column: 1 },
  });
  const a = entry("REQ_1", "a.md", {
    bindings: [dottedBinding(3)],
    typedefs: [],
  });
  const b = entry("REQ_2", "b.md", {
    bindings: [dottedBinding(7)],
    typedefs: [],
  });
  const { diagnostics } = validateTypl([a, b]);
  assertEquals(diagnostics.filter((d) => d.code === "TYPL-009").length, 1);
});
