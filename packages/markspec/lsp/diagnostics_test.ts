/**
 * @module lsp/diagnostics_test
 *
 * Unit tests for the core Diagnostic → LSP Diagnostic bridge.
 */

import { assertEquals } from "@std/assert";
import {
  groupDiagnosticsByFile,
  toLspDiagnostic,
  toLspSeverity,
} from "./diagnostics.ts";
import type { Diagnostic as CoreDiagnostic } from "../core/mod.ts";

Deno.test("toLspSeverity: maps error to 1", () => {
  assertEquals(toLspSeverity("error"), 1);
});

Deno.test("toLspSeverity: maps warning to 2", () => {
  assertEquals(toLspSeverity("warning"), 2);
});

Deno.test("toLspSeverity: maps info to 3", () => {
  assertEquals(toLspSeverity("info"), 3);
});

Deno.test("toLspDiagnostic: converts core diagnostic to LSP diagnostic", () => {
  const core: CoreDiagnostic = {
    code: "MSL-R003",
    severity: "error",
    message: "STK_001: missing Id: attribute",
    location: { file: "reqs.md", line: 10, column: 3 },
  };
  const lsp = toLspDiagnostic(core);
  assertEquals(lsp.range.start.line, 9); // 0-based
  assertEquals(lsp.range.start.character, 2); // 0-based
  assertEquals(lsp.range.end.line, 9);
  assertEquals(lsp.severity, 1); // Error
  assertEquals(lsp.source, "markspec");
  assertEquals(lsp.code, "MSL-R003");
  assertEquals(lsp.message, "STK_001: missing Id: attribute");
});

Deno.test("toLspDiagnostic: handles undefined location", () => {
  const core: CoreDiagnostic = {
    code: "MSL-E000",
    severity: "error",
    message: "failed to read file",
    location: undefined,
  };
  const lsp = toLspDiagnostic(core);
  assertEquals(lsp.range.start.line, 0);
  assertEquals(lsp.range.start.character, 0);
});

Deno.test("groupDiagnosticsByFile: groups diagnostics by file path", () => {
  const diagnostics: CoreDiagnostic[] = [
    {
      code: "MSL-R003",
      severity: "error",
      message: "a",
      location: { file: "a.md", line: 1, column: 1 },
    },
    {
      code: "MSL-R006",
      severity: "error",
      message: "b",
      location: { file: "b.md", line: 2, column: 1 },
    },
    {
      code: "MSL-R010",
      severity: "warning",
      message: "c",
      location: { file: "a.md", line: 5, column: 1 },
    },
    { code: "MSL-E000", severity: "error", message: "d", location: undefined },
  ];
  const grouped = groupDiagnosticsByFile(diagnostics);
  assertEquals(grouped.get("a.md")?.length, 2);
  assertEquals(grouped.get("b.md")?.length, 1);
  // Diagnostics with undefined location are not grouped
  assertEquals(grouped.size, 2);
});
