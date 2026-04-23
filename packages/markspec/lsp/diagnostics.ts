/**
 * @module lsp/diagnostics
 *
 * Bridge between MarkSpec core diagnostics and the LSP diagnostic protocol.
 * Converts severity, line/column (1-based → 0-based), and groups
 * diagnostics by file for per-document publishing.
 */

import type { Diagnostic as CoreDiagnostic, Severity } from "../core/mod.ts";

/**
 * LSP Diagnostic — a subset of the full LSP type.
 *
 * Defined locally so the bridge is testable without importing the full
 * vscode-languageserver package in unit tests.
 */
export interface LspDiagnostic {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly severity: number;
  readonly source: string;
  readonly code: string;
  readonly message: string;
}

/** Map MarkSpec severity to LSP DiagnosticSeverity numeric values. */
export function toLspSeverity(severity: Severity): number {
  switch (severity) {
    case "error":
      return 1; // DiagnosticSeverity.Error
    case "warning":
      return 2; // DiagnosticSeverity.Warning
    case "info":
      return 3; // DiagnosticSeverity.Information
  }
}

/**
 * Convert a core Diagnostic to an LSP Diagnostic.
 *
 * Core uses 1-based line/column; LSP uses 0-based. For range end, we use
 * the same line with a large character value — the editor will clamp to
 * end-of-line, producing an underline from the start position to EOL.
 */
export function toLspDiagnostic(diagnostic: CoreDiagnostic): LspDiagnostic {
  const line = diagnostic.location ? diagnostic.location.line - 1 : 0;
  const character = diagnostic.location ? diagnostic.location.column - 1 : 0;
  return {
    range: {
      start: { line, character },
      end: { line, character: Number.MAX_SAFE_INTEGER },
    },
    severity: toLspSeverity(diagnostic.severity),
    source: "markspec",
    code: diagnostic.code,
    message: diagnostic.message,
  };
}

/**
 * Group core diagnostics by their source file path.
 *
 * Diagnostics with `undefined` location are dropped — they represent
 * file-level errors (e.g., "failed to read file") that have no
 * meaningful position.
 */
export function groupDiagnosticsByFile(
  diagnostics: readonly CoreDiagnostic[],
): Map<string, CoreDiagnostic[]> {
  const grouped = new Map<string, CoreDiagnostic[]>();
  for (const d of diagnostics) {
    if (!d.location) continue;
    const file = d.location.file;
    const list = grouped.get(file);
    if (list) {
      list.push(d);
    } else {
      grouped.set(file, [d]);
    }
  }
  return grouped;
}
