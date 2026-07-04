import { assertEquals } from "@std/assert";
import { uxilDiagnostic } from "./diagnostics.ts";

Deno.test("uxilDiagnostic: substitutes params into the template", () => {
  const d = uxilDiagnostic("UXIL-002", { char: "?" }, { line: 1, column: 5 });
  assertEquals(d.code, "UXIL-002");
  assertEquals(d.severity, "error");
  assertEquals(d.position, { line: 1, column: 5 });
  assertEquals(
    d.message,
    "Reserved character ? is not allowed in a uxil reference.",
  );
});

Deno.test("uxilDiagnostic: parameterless template passes through", () => {
  const d = uxilDiagnostic("UXIL-004", {}, { line: 1, column: 1 });
  assertEquals(
    d.message,
    "Root declaration is missing its kind (expected 'ux:surface : kind').",
  );
});
