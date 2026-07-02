/**
 * @module lsp/formatting
 *
 * Pure helper for the LSP `textDocument/formatting` handler. Computes the
 * `TextEdit[]` payload that, when applied by the editor, transforms the
 * current buffer into the formatted text.
 *
 * v1 emits a single whole-document `TextEdit`. The LSP spec calls this
 * "minimal" in the sense of "one edit vs. writing to disk"; a future
 * refinement may switch to a line-level diff for richer undo granularity.
 * Whole-document replace is the canonical pattern used by
 * `typescript-language-server`, `prettier-language-server`, and
 * rust-analyzer's `rustfmt` integration.
 */

/** A subset of the LSP `TextEdit` interface — kept local so this module
 * has no protocol-package dependency and stays trivial to unit-test. */
export interface TextEdit {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly newText: string;
}

/**
 * Compute the `TextEdit[]` representing the change from `currentText` to
 * `formattedText`. Returns `[]` when the two strings are identical (no
 * edit needed).
 *
 * For changed text, emits a single whole-document edit covering `[0,0]`
 * → end-of-document. The end position is line N+1, column 0 when the
 * current text ends in a trailing newline (matching how LSP positions
 * virtual trailing-line positions); otherwise line N, column =
 * length-of-last-line.
 */
export function buildFormattingEdits(
  currentText: string,
  formattedText: string,
): TextEdit[] {
  if (currentText === formattedText) return [];

  const lines = currentText.split("\n");
  // `split("\n")` on `"foo\n"` yields `["foo", ""]` — the trailing empty
  // element represents the position after the final newline, which is
  // line N+1, column 0 in LSP coordinates.
  const lastLineIndex = lines.length - 1;
  const lastLineLength = lines[lastLineIndex].length;
  return [{
    range: {
      start: { line: 0, character: 0 },
      end: { line: lastLineIndex, character: lastLineLength },
    },
    newText: formattedText,
  }];
}

/**
 * Build the one-line editor notice for Markdown-pass fallbacks (MSL-F012):
 * body or prose segments whose dprint output was rejected/errored and kept
 * as-is (#669). Returns `undefined` when there were none, so the caller
 * logs nothing. Pure — the count and wording are unit-testable without a
 * live LSP connection (mirrors `buildDiagnosticsHistogram`).
 */
export function buildF012FallbackMessage(
  diagnostics: readonly { readonly code: string }[],
): string | undefined {
  const n = diagnostics.filter((d) => d.code === "MSL-F012").length;
  if (n === 0) return undefined;
  return `markspec: kept the original text for ${n} segment(s) — ` +
    `the Markdown formatter was not applied (MSL-F012)`;
}
