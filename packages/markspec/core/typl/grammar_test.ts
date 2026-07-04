// packages/markspec/core/typl/grammar_test.ts
import { assertEquals } from "@std/assert";
import { parseTyplBlock } from "./grammar.ts";

Deno.test("parseTyplBlock: explicit kind + range", () => {
  const { ast, diagnostics } = parseTyplBlock(
    "$Speed : signal float[0..300]",
  );
  assertEquals(diagnostics, []);
  assertEquals(ast.bindings.length, 1);
  const b = ast.bindings[0];
  assertEquals(b.name, "$Speed");
  assertEquals(b.kind, "signal");
  assertEquals(b.shape, {
    kind: "range",
    type: "float",
    min: 0,
    max: 300,
  });
});

Deno.test("parseTyplBlock: omitted kind defaults to value", () => {
  const { ast, diagnostics } = parseTyplBlock("$count : int[0..]");
  assertEquals(diagnostics, []);
  assertEquals(ast.bindings[0].kind, "value");
  assertEquals(ast.bindings[0].shape, {
    kind: "range",
    type: "int",
    min: 0,
  });
});

Deno.test("parseTyplBlock: typedef with record", () => {
  const { ast, diagnostics } = parseTyplBlock(
    "type BrakeReq = { force_N: float[0..12000] }",
  );
  assertEquals(diagnostics, []);
  assertEquals(ast.typedefs.length, 1);
  const t = ast.typedefs[0];
  assertEquals(t.name, "BrakeReq");
  assertEquals(t.shape, {
    kind: "record",
    fields: {
      force_N: { kind: "range", type: "float", min: 0, max: 12000 },
    },
  });
});

Deno.test("parseTyplBlock: comment line yields no statement", () => {
  const { ast, diagnostics } = parseTyplBlock("# just a note");
  assertEquals(diagnostics, []);
  assertEquals(ast.bindings.length + ast.typedefs.length, 0);
});

Deno.test("parseTyplBlock: unknown kind emits TYPL-007", () => {
  const { diagnostics } = parseTyplBlock("$X : blah int[0..]");
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "TYPL-007");
});

Deno.test("parseTyplBlock: multi-line block — every statement parsed", () => {
  const { ast, diagnostics } = parseTyplBlock(
    "$A : signal\n$B : event\n$C : state",
  );
  assertEquals(diagnostics, []);
  assertEquals(ast.bindings.length, 3);
  assertEquals(ast.bindings.map((b) => b.name), ["$A", "$B", "$C"]);
  assertEquals(ast.bindings.map((b) => b.kind), ["signal", "event", "state"]);
});

Deno.test("parseTyplBlock: TYPL-001 on duplicate $Name in same block", () => {
  const { ast, diagnostics } = parseTyplBlock(
    "$Speed : signal float[0..300]\n$Speed : event",
  );
  assertEquals(ast.bindings.length, 1);
  assertEquals(ast.bindings[0].kind, "signal"); // first wins
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "TYPL-001");
});

Deno.test("parseTyplBlock: TYPL-004 on duplicate typedef in same block", () => {
  const { ast, diagnostics } = parseTyplBlock(
    "type Frame = int[0..255]\ntype Frame = float[0.0..1.0]",
  );
  assertEquals(ast.typedefs.length, 1);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "TYPL-004");
});

Deno.test("parseTyplBlock: binding without shape (e.g. $Idle : state)", () => {
  const { ast, diagnostics } = parseTyplBlock("$Idle : state");
  assertEquals(diagnostics, []);
  assertEquals(ast.bindings.length, 1);
  assertEquals(ast.bindings[0].name, "$Idle");
  assertEquals(ast.bindings[0].kind, "state");
  assertEquals(ast.bindings[0].shape, undefined);
});

Deno.test("grammar: namespace declaration parses without shape", () => {
  const { ast, diagnostics } = parseTyplBlock(
    "$powertrain.brake : namespace",
  );
  assertEquals(diagnostics.length, 0);
  assertEquals(ast.bindings.length, 1);
  assertEquals(ast.bindings[0].name, "$powertrain.brake");
  assertEquals(ast.bindings[0].kind, "namespace");
  assertEquals(ast.bindings[0].shape, undefined);
});

Deno.test("grammar: namespace with a shape is TYPL-006", () => {
  const { diagnostics } = parseTyplBlock(
    "$powertrain.brake : namespace float",
  );
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "TYPL-006");
});

Deno.test("grammar: relative binding name parses", () => {
  const { ast, diagnostics } = parseTyplBlock(
    "$.pedal_position : signal float[0..100]",
  );
  assertEquals(diagnostics.length, 0);
  assertEquals(ast.bindings[0].name, "$.pedal_position");
  assertEquals(ast.bindings[0].kind, "signal");
});
