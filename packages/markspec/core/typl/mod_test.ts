import { assertEquals } from "@std/assert";
import {
  bridgeTyplDiagnostic,
  extractTyplFences,
  KINDS,
  parseTyplBlock,
  type TyplDiagnostic,
  TYPL_CODES,
} from "./mod.ts";

Deno.test("typl module exposes parseTyplBlock", () => {
  const { ast, diagnostics } = parseTyplBlock("$Speed : signal float[0..300]");
  assertEquals(diagnostics, []);
  assertEquals(ast.bindings[0].kind, "signal");
});

Deno.test("typl module exposes KINDS and TYPL_CODES", () => {
  assertEquals(KINDS.includes("signal"), true);
  assertEquals("TYPL-007" in TYPL_CODES, true);
});

Deno.test("typl module exposes extractTyplFences", () => {
  // Use it on an empty input — just confirm import resolves
  const result = extractTyplFences([]);
  assertEquals(result, []);
});

Deno.test("typl module exposes bridgeTyplDiagnostic", () => {
  // Type check via call signature; we don't need to assert behaviour here
  // — that's covered by bridge_test.ts.
  const fn: (
    diag: TyplDiagnostic,
    file: string,
    fenceStartLine: number,
  ) => unknown = bridgeTyplDiagnostic;
  assertEquals(typeof fn, "function");
});
