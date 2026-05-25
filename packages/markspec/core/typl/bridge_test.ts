import { assertEquals } from "@std/assert";
import { bridgeTyplDiagnostic } from "./bridge.ts";
import { typlDiagnostic } from "./diagnostics.ts";

Deno.test("bridgeTyplDiagnostic: line is fence-start + typl-position; column passes through", () => {
  // Fence opens at file line 10. A typl diagnostic at typl-position
  // line 2 col 5 should map to file line 12 col 5.
  const td = typlDiagnostic(
    "TYPL-007",
    { keyword: "blah" },
    { line: 2, column: 5 },
  );
  const d = bridgeTyplDiagnostic(td, "docs/example.md", 10);
  assertEquals(d.code, "TYPL-007");
  assertEquals(d.severity, "error");
  assertEquals(d.location, {
    file: "docs/example.md",
    line: 12, // 10 + 2
    column: 5,
  });
});

Deno.test("bridgeTyplDiagnostic: message is passed through verbatim", () => {
  const td = typlDiagnostic(
    "TYPL-005",
    { name: "Frame" },
    { line: 1, column: 1 },
  );
  const d = bridgeTyplDiagnostic(td, "x.md", 0);
  assertEquals(d.message, td.message);
});

Deno.test("bridgeTyplDiagnostic: works at fence-start line 0 (degenerate)", () => {
  // Edge case: caller passes 0 for fenceStartLine.
  // Result line should equal the typl diagnostic's line.
  const td = typlDiagnostic(
    "TYPL-006",
    { detail: "bad" },
    { line: 3, column: 1 },
  );
  const d = bridgeTyplDiagnostic(td, "x.md", 0);
  assertEquals(d.location?.line, 3);
});
