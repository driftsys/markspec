import { assertEquals } from "@std/assert";
import { KINDS, parseTyplBlock, TYPL_CODES } from "./mod.ts";

Deno.test("typl module exposes parseTyplBlock", () => {
  const { ast, diagnostics } = parseTyplBlock("$Speed : signal float[0..300]");
  assertEquals(diagnostics, []);
  assertEquals(ast.bindings[0].kind, "signal");
});

Deno.test("typl module exposes KINDS and TYPL_CODES", () => {
  assertEquals(KINDS.includes("signal"), true);
  assertEquals("TYPL-007" in TYPL_CODES, true);
});
