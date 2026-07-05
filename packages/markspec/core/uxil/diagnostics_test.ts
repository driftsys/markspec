import { assertEquals, assertStringIncludes } from "@std/assert";
import { UXIL_CODES, uxilDiagnostic } from "./diagnostics.ts";

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

Deno.test("UXIL semantic codes: all present with error severity", () => {
  for (let n = 9; n <= 22; n++) {
    const code = `UXIL-${
      String(n).padStart(3, "0")
    }` as keyof typeof UXIL_CODES;
    assertEquals(UXIL_CODES[code].severity, "error", code);
  }
});

Deno.test("UXIL-015 substitutes surface + origin", () => {
  const d = uxilDiagnostic(
    "UXIL-015",
    { surface: "media.home", otherFile: "a.md", otherLine: 3 },
    { line: 1, column: 1 },
  );
  assertStringIncludes(d.message, "media.home");
  assertStringIncludes(d.message, "a.md:3");
});
