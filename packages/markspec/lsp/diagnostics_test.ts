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

Deno.test("toLspDiagnostic: prefers range when present", () => {
  const d = {
    code: "MSL-Q302",
    severity: "warning" as const,
    message: "vague",
    location: { file: "x.md", line: 5, column: 1 },
    range: {
      start: { line: 5, column: 10 },
      end: { line: 5, column: 25 },
    },
  };
  const lsp = toLspDiagnostic(d);
  assertEquals(lsp.range.start.line, 4); // 1-based → 0-based
  assertEquals(lsp.range.start.character, 9);
  assertEquals(lsp.range.end.line, 4);
  assertEquals(lsp.range.end.character, 24);
  // codeDescription must still be populated for MSL-Q* on the range path.
  assertEquals(
    lsp.codeDescription?.href,
    "https://markspec.dev/lint/rules/msl-q302",
  );
});

Deno.test("toLspDiagnostic: falls back to location when range absent", () => {
  const d = {
    code: "MSL-Q302",
    severity: "warning" as const,
    message: "vague",
    location: { file: "x.md", line: 5, column: 1 },
  };
  const lsp = toLspDiagnostic(d);
  assertEquals(lsp.range.start.line, 4);
  assertEquals(lsp.range.start.character, 0);
  // Existing behaviour: end is MAX_SAFE_INTEGER (clamped to EOL).
  assertEquals(lsp.range.end.character, Number.MAX_SAFE_INTEGER);
});

Deno.test("toLspDiagnostic: PA-1 diagnostic without range still works", () => {
  const d = {
    code: "MSL-Q302",
    severity: "warning" as const,
    message: "found 'some' in entry body",
    location: { file: "x.md", line: 10, column: 1 },
  };
  const lsp = toLspDiagnostic(d);
  assertEquals(lsp.range.start.line, 9);
  assertEquals(lsp.range.end.character, Number.MAX_SAFE_INTEGER);
});

Deno.test("toLspDiagnostic: UXIL codes carry a spec-chapter codeDescription (#727)", () => {
  const lsp = toLspDiagnostic({
    code: "UXIL-009",
    severity: "error",
    message:
      "Unknown surface kind 'widget' (expected screen, panel, or agent).",
    location: { file: "a.md", line: 3, column: 3 },
  });
  assertEquals(
    lsp.codeDescription?.href,
    "https://markspec.dev/extensions/uxil#uxil-009",
  );
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
