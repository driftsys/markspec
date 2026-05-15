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

/** Capture the attribute key inside `'…'` in an MSL-A030 message. */
const ATTRIBUTE_KEY_RE = /'([A-Z][A-Za-z-]*)'/;

/**
 * Build quick-fix actions for the supplied diagnostics. Returns an
 * empty array when none of the diagnostics has a known fix.
 *
 * `documentText` is optional; it's only needed for fixes that locate
 * a specific line in the source (e.g. MSL-A030 attribute removal).
 * MSL-M060 only invocations may omit it.
 */
export function buildCodeActions(
  uri: string,
  diagnostics: readonly LspDiagnosticLike[],
  documentText?: string,
): CodeAction[] {
  const out: CodeAction[] = [];
  for (const diag of diagnostics) {
    if (diag.code === "MSL-M060") {
      const action = buildM060Fix(uri, diag);
      if (action) out.push(action);
    } else if (diag.code === "MSL-A030" && documentText !== undefined) {
      const action = buildA030Fix(uri, diag, documentText);
      if (action) out.push(action);
    }
  }
  return out;
}

function buildM060Fix(
  uri: string,
  diag: LspDiagnosticLike,
): CodeAction | undefined {
  const match = KEYWORD_RE.exec(diag.message);
  if (!match) return undefined;
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
  return {
    title: `Lowercase '${lowercase}'`,
    kind: "quickfix",
    diagnostics: [diag],
    isPreferred: true,
    edit: { changes: { [uri]: [edit] } },
  };
}

function buildA030Fix(
  uri: string,
  diag: LspDiagnosticLike,
  documentText: string,
): CodeAction | undefined {
  const match = ATTRIBUTE_KEY_RE.exec(diag.message);
  if (!match) return undefined;
  const attrKey = match[1];
  // Walk forward from the diagnostic's line and find the trailer
  // line that defines this attribute — `<indent><Key>:`. The parser
  // canonicalises trailer indent to 6 spaces but accepts any indent
  // ≥4 (one tab), so we match leniently.
  const lines = documentText.split("\n");
  const startLine = diag.range.start.line;
  const lineRe = new RegExp(`^\\s{4,}${attrKey}\\s*:`);
  for (let i = startLine; i < lines.length; i++) {
    if (!lineRe.test(lines[i])) continue;
    return {
      title: `Remove '${attrKey}' line`,
      kind: "quickfix",
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [{
            range: {
              start: { line: i, character: 0 },
              end: { line: i + 1, character: 0 },
            },
            newText: "",
          }],
        },
      },
    };
  }
  return undefined;
}
