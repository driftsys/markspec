// packages/markspec/core/typl/diagnostics_test.ts
import { assertEquals } from "@std/assert";
import { TYPL_CODES, typlDiagnostic } from "./diagnostics.ts";

Deno.test("TYPL codes: 001..008 present with severity + template", () => {
  const expected = [
    "TYPL-001",
    "TYPL-002",
    "TYPL-003",
    "TYPL-004",
    "TYPL-005",
    "TYPL-006",
    "TYPL-007",
    "TYPL-008",
  ];
  assertEquals(Object.keys(TYPL_CODES).sort(), expected);
});

Deno.test("typlDiagnostic: formats template substitutions", () => {
  const d = typlDiagnostic("TYPL-007", { keyword: "stream" }, {
    line: 1,
    column: 12,
  });
  assertEquals(d.code, "TYPL-007");
  assertEquals(d.severity, "error");
  assertEquals(
    d.message,
    "Unknown kind keyword stream. Expected one of: event, signal, command, state, const, config, document, stream, namespace.",
  );
});
