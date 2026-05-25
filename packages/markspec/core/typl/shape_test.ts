// packages/markspec/core/typl/shape_test.ts
import { assertEquals } from "@std/assert";
import { parseTyplBlock } from "./grammar.ts";

function shapeOf(source: string) {
  const { ast, diagnostics } = parseTyplBlock(`$X : ${source}`);
  if (diagnostics.length) throw new Error(JSON.stringify(diagnostics));
  return ast.bindings[0].shape;
}

Deno.test("shape: primitives", () => {
  assertEquals(shapeOf("int"), { kind: "primitive", type: "int" });
  assertEquals(shapeOf("float"), { kind: "primitive", type: "float" });
  assertEquals(shapeOf("bool"), { kind: "primitive", type: "bool" });
  assertEquals(shapeOf("string"), { kind: "primitive", type: "string" });
  assertEquals(shapeOf("bytes"), { kind: "primitive", type: "bytes" });
});

Deno.test("shape: int range", () => {
  assertEquals(shapeOf("int[0..255]"), {
    kind: "range",
    type: "int",
    min: 0,
    max: 255,
  });
  assertEquals(shapeOf("int[0..]"), {
    kind: "range",
    type: "int",
    min: 0,
  });
  assertEquals(shapeOf("int[..255]"), {
    kind: "range",
    type: "int",
    max: 255,
  });
  assertEquals(shapeOf("int[5]"), {
    kind: "range",
    type: "int",
    exact: 5,
  });
});

Deno.test("shape: float range with int literals coerces", () => {
  assertEquals(shapeOf("float[0..300]"), {
    kind: "range",
    type: "float",
    min: 0,
    max: 300,
  });
});

Deno.test("shape: string length", () => {
  assertEquals(shapeOf("string[3..6]"), {
    kind: "length",
    type: "string",
    min: 3,
    max: 6,
  });
  assertEquals(shapeOf("string[17]"), {
    kind: "length",
    type: "string",
    exact: 17,
  });
});

Deno.test("shape: pattern", () => {
  assertEquals(shapeOf("/^[A-Z]{3}$/"), {
    kind: "pattern",
    regex: "^[A-Z]{3}$",
  });
  assertEquals(shapeOf("/^x/i"), {
    kind: "pattern",
    regex: "^x",
    flags: "i",
  });
});

Deno.test("shape: array variants", () => {
  assertEquals(shapeOf("int[]"), {
    kind: "array",
    element: { kind: "primitive", type: "int" },
  });
  assertEquals(shapeOf("int[](..8)"), {
    kind: "array",
    element: { kind: "primitive", type: "int" },
    max: 8,
  });
  assertEquals(shapeOf("int[](1..8)"), {
    kind: "array",
    element: { kind: "primitive", type: "int" },
    min: 1,
    max: 8,
  });
  assertEquals(shapeOf("float[4]"), {
    kind: "array",
    element: { kind: "primitive", type: "float" },
    exact: 4,
  });
});

Deno.test("shape: enum", () => {
  assertEquals(shapeOf("'low' | 'mid' | 'high'"), {
    kind: "enum",
    values: ["low", "mid", "high"],
  });
  assertEquals(shapeOf("1 | 2 | 3"), {
    kind: "enum",
    values: [1, 2, 3],
  });
});

Deno.test("shape: record", () => {
  assertEquals(
    shapeOf("{ id: int[0..15], payload: int[0..255] }"),
    {
      kind: "record",
      fields: {
        id: { kind: "range", type: "int", min: 0, max: 15 },
        payload: { kind: "range", type: "int", min: 0, max: 255 },
      },
    },
  );
});

Deno.test("shape: ref (bare PascalCase identifier)", () => {
  assertEquals(shapeOf("Frame"), { kind: "ref", name: "Frame" });
});

Deno.test("shape: optional", () => {
  assertEquals(shapeOf("string?"), {
    kind: "optional",
    inner: { kind: "primitive", type: "string" },
  });
});

Deno.test("shape: string and bytes arrays", () => {
  assertEquals(shapeOf("string[]"), {
    kind: "array",
    element: { kind: "primitive", type: "string" },
  });
  assertEquals(shapeOf("bytes[]"), {
    kind: "array",
    element: { kind: "primitive", type: "bytes" },
  });
  assertEquals(shapeOf("string[](..4)"), {
    kind: "array",
    element: { kind: "primitive", type: "string" },
    max: 4,
  });
});

Deno.test("shape: string and bytes lengths still work", () => {
  assertEquals(shapeOf("string[3..6]"), {
    kind: "length",
    type: "string",
    min: 3,
    max: 6,
  });
  assertEquals(shapeOf("string[17]"), {
    kind: "length",
    type: "string",
    exact: 17,
  });
  assertEquals(shapeOf("bytes[0..4096]"), {
    kind: "length",
    type: "bytes",
    min: 0,
    max: 4096,
  });
});

Deno.test("shape: malformed shapes emit TYPL-006 (not silent undefined)", () => {
  // Helper that returns both shape and diagnostics
  const result1 = parseTyplBlock("$X : string[3 4]");
  // Missing DOTDOT after first number in length body
  assertEquals(
    result1.diagnostics.some((d) => d.code === "TYPL-006"),
    true,
    "string[3 4] should emit TYPL-006",
  );

  const result2 = parseTyplBlock("$X : float[bad]");
  // Non-number content inside array length brackets
  assertEquals(
    result2.diagnostics.some((d) => d.code === "TYPL-006"),
    true,
    "float[bad] should emit TYPL-006",
  );

  const result3 = parseTyplBlock("$X : int[0..");
  // Unclosed bracket
  assertEquals(
    result3.diagnostics.length > 0,
    true,
    "int[0.. should emit some diagnostic",
  );
});
