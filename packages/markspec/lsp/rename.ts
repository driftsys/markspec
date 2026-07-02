/**
 * @module lsp/rename
 *
 * Workspace-rename helper. Finds every whole-token occurrence of a
 * display ID in a file's text and builds the `TextEdit[]` payload an
 * LSP `WorkspaceEdit` needs.
 *
 * Whole-token matching means `REQ-001` does not match `REQ-0010` or
 * `REQ-001-extra` — both ends of the token must be at a non-ID
 * character. The ID character set matches the parser's display-ID
 * grammar: letters, digits, `._/-`.
 *
 * `findIdOccurrencesInFile` scans raw file text rather than parsed
 * entries, so it must skip fenced code regions itself (#680, same
 * class as the `core/refs` `canonicalizeRefs` fix in #679/#668) —
 * otherwise renaming a real entry also rewrites the ID inside an
 * illustrative fenced example that merely reuses the same text. It
 * reuses `walkProseLines` (`core/util/fence.ts`) rather than
 * re-implementing the fence toggle. `prepareRenameRange` stays
 * single-line and fence-unaware by design — the server gates
 * `onPrepareRename` against a fenced cursor position separately (via
 * `isLineFenced`) using the full document text it already has.
 */

import { walkProseLines } from "../core/mod.ts";

/** A subset of the LSP `TextEdit` interface. */
export interface TextEdit {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly newText: string;
}

/** Display-ID character set — letters, digits, dot, slash, hyphen, underscore. */
const ID_CHAR_RE = /[A-Za-z0-9._/-]/;

/** Whole-token display-ID grammar — must look like an identifier (≥3 chars, starts with alphanumeric). */
const DISPLAY_ID_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{2,}$/;

/** Result of {@linkcode prepareRenameRange}. */
export interface PrepareRenameResult {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly placeholder: string;
}

/**
 * Validate that the cursor sits on a renameable display ID and return
 * the LSP `prepareRename` response payload: the exact range of the
 * token plus the placeholder text the editor pre-fills in the rename
 * input.
 *
 * Returns `null` when:
 *   - the cursor lies on whitespace or past the line end, or
 *   - the token at that position doesn't satisfy the display-ID
 *     grammar (≥3 chars, alphanumeric start, valid ID chars only).
 *
 * The returned range covers only the display-ID token so the rename
 * UI underlines the right span.
 */
export function prepareRenameRange(
  line: string,
  column: number,
  lspLine: number,
): PrepareRenameResult | null {
  if (column < 0 || column >= line.length) return null;
  if (/\s/.test(line[column])) return null;
  let start = column;
  while (start > 0 && ID_CHAR_RE.test(line[start - 1])) start--;
  let end = column;
  while (end < line.length && ID_CHAR_RE.test(line[end])) end++;
  const token = line.slice(start, end);
  if (!DISPLAY_ID_TOKEN_RE.test(token)) return null;
  return {
    range: {
      start: { line: lspLine, character: start },
      end: { line: lspLine, character: end },
    },
    placeholder: token,
  };
}

/**
 * Walk every line of `text`, scan for `oldId`, and emit a TextEdit
 * for each whole-token occurrence that replaces it with `newId`.
 *
 * Positions are returned as zero-based line/character (LSP
 * convention). Each occurrence's range covers only the `oldId`
 * characters — the editor uses the textual replacement to perform
 * the rename, so the range must be exact.
 *
 * Lines inside a fenced code block (``` or ~~~) are skipped — an
 * illustrative example that happens to display the same ID as sample
 * text is not a real reference and must not be rewritten (#680).
 */
export function findIdOccurrencesInFile(
  text: string,
  oldId: string,
  newId: string,
): TextEdit[] {
  if (oldId.length === 0) return [];
  const edits: TextEdit[] = [];
  walkProseLines(text, (line, i) => {
    let start = 0;
    while (true) {
      const idx = line.indexOf(oldId, start);
      if (idx < 0) break;
      const before = idx === 0 ? "" : line[idx - 1];
      const after = idx + oldId.length >= line.length
        ? ""
        : line[idx + oldId.length];
      const boundedLeft = before === "" || !ID_CHAR_RE.test(before);
      const boundedRight = after === "" || !ID_CHAR_RE.test(after);
      if (boundedLeft && boundedRight) {
        edits.push({
          range: {
            start: { line: i, character: idx },
            end: { line: i, character: idx + oldId.length },
          },
          newText: newId,
        });
      }
      start = idx + oldId.length;
    }
  });
  return edits;
}
