/**
 * @module lsp/code_actions
 *
 * Code-action builder. Walks the diagnostics the editor has on a
 * range and emits LSP `CodeAction[]` quick fixes for the ones
 * MarkSpec knows how to mechanically repair.
 *
 * Currently handles:
 *
 *   - **MSL-M060** — uppercase modal keyword in body prose. Action:
 *     replace the keyword with its lowercase form. Single-token
 *     (`SHALL`, `SHOULD`, `MAY`, `MUST`) and two-token (`MUST NOT`,
 *     etc.) forms both supported.
 *
 * The validator already emits MSL-M060 with a per-character
 * position pointing at the keyword's start, so the fix's range is
 * `[start, start + keyword.length]`. The keyword itself comes from
 * the diagnostic message (`'<keyword>'`).
 */

/** A subset of the LSP `Diagnostic` interface — just what the
 * code-action walker needs. */
export interface LspDiagnosticLike {
  readonly code: string;
  readonly severity?: number;
  readonly message: string;
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
}

/** A subset of the LSP `TextEdit` interface. */
export interface TextEdit {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly newText: string;
}

/** A subset of the LSP `CodeAction` interface. */
export interface CodeAction {
  readonly title: string;
  readonly kind: string;
  readonly diagnostics?: readonly LspDiagnosticLike[];
  readonly isPreferred?: boolean;
  readonly edit?: { readonly changes?: Record<string, TextEdit[]> };
}

/** Capture the keyword inside `'…'` in an MSL-M060 message. */
const KEYWORD_RE = /modal keyword '([^']+)'/;

/**
 * Build quick-fix actions for the supplied diagnostics. Returns an
 * empty array when none of the diagnostics has a known fix.
 */
export function buildCodeActions(
  uri: string,
  diagnostics: readonly LspDiagnosticLike[],
): CodeAction[] {
  const out: CodeAction[] = [];
  for (const diag of diagnostics) {
    if (diag.code !== "MSL-M060") continue;
    const match = KEYWORD_RE.exec(diag.message);
    if (!match) continue;
    const keyword = match[1];
    const lowercase = keyword.toLowerCase();
    const startLine = diag.range.start.line;
    const startChar = diag.range.start.character;
    const edit: TextEdit = {
      range: {
        start: { line: startLine, character: startChar },
        end: { line: startLine, character: startChar + keyword.length },
      },
      newText: lowercase,
    };
    out.push({
      title: `Lowercase '${lowercase}'`,
      kind: "quickfix",
      diagnostics: [diag],
      isPreferred: true,
      edit: { changes: { [uri]: [edit] } },
    });
  }
  return out;
}
