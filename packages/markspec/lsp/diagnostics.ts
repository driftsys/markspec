/**
 * @module lsp/diagnostics
 *
 * Bridge between MarkSpec core diagnostics and the LSP diagnostic protocol.
 * Converts severity, line/column (1-based → 0-based), and groups
 * diagnostics by file for per-document publishing.
 */

import type {
  Diagnostic as CoreDiagnostic,
  Severity,
  SourceRange,
} from "../core/mod.ts";

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
  /** Link to rule documentation, populated for MSL-Q codes. */
  readonly codeDescription?: { readonly href: string };
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
/** Build a rule documentation URL for MSL-Q lint codes. */
function buildRuleDocUrl(code: string): string {
  return `https://markspec.dev/lint/rules/${code.toLowerCase()}`;
}

export function toLspDiagnostic(diagnostic: CoreDiagnostic): LspDiagnostic {
  // Prefer range when the diagnostic carries one (LintDiagnostic from
  // prose analysis); else fall back to a 1-line range starting at
  // location and ending at EOL (existing behaviour).
  const ext = diagnostic as CoreDiagnostic & { range?: SourceRange };
  let lspRange: LspDiagnostic["range"];
  if (ext.range) {
    lspRange = {
      start: {
        line: ext.range.start.line - 1,
        character: ext.range.start.column - 1,
      },
      end: {
        line: ext.range.end.line - 1,
        character: ext.range.end.column - 1,
      },
    };
  } else {
    const line = diagnostic.location ? diagnostic.location.line - 1 : 0;
    const character = diagnostic.location ? diagnostic.location.column - 1 : 0;
    lspRange = {
      start: { line, character },
      end: { line, character: Number.MAX_SAFE_INTEGER },
    };
  }
  const base: LspDiagnostic = {
    range: lspRange,
    severity: toLspSeverity(diagnostic.severity),
    source: "markspec",
    code: diagnostic.code,
    message: diagnostic.message,
  };
  if (diagnostic.code.startsWith("MSL-Q")) {
    return {
      ...base,
      codeDescription: { href: buildRuleDocUrl(diagnostic.code) },
    };
  }
  return base;
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
