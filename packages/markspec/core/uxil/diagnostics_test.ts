import { assertEquals, assertStringIncludes } from "@std/assert";
import { UXIL_CODES, uxilDiagnostic, uxilDiagnosticAt } from "./diagnostics.ts";

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

Deno.test("uxilDiagnosticAt: file-anchored core diagnostic (#727)", () => {
  const d = uxilDiagnosticAt(
    "UXIL-024",
    { ref: ".confirm" },
    { file: "a.md", line: 7, column: 5 },
  );
  assertEquals(d.code, "UXIL-024");
  assertEquals(d.severity, "error");
  assertEquals(
    d.message,
    "Relative reference '.confirm' has no base in scope.",
  );
  assertEquals(d.location, { file: "a.md", line: 7, column: 5 });
});

Deno.test("UXIL-023/025/026 templates substitute their params (#727)", () => {
  const loc = { file: "a.md", line: 1, column: 1 };
  assertEquals(
    uxilDiagnosticAt(
      "UXIL-023",
      { entry: "REQ_0001", type: "requirement" },
      loc,
    )
      .message,
    "uxil declaration outside a declaring entry type: 'REQ_0001' (type 'requirement') may not declare surfaces (requires 'declares: ux-surface').",
  );
  assertEquals(
    uxilDiagnosticAt(
      "UXIL-025",
      { element: "hint", surface: "voice", kind: "agent" },
      loc,
    ).message,
    "Element 'hint' declares 'observe' but surface 'voice' has non-visual kind 'agent'.",
  );
  assertEquals(
    uxilDiagnosticAt("UXIL-026", { element: "go" }, loc).message,
    "Element 'go' declares 'navigate' without a '-> target' clause.",
  );
});
