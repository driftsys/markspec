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
 */

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

/**
 * Walk every line of `text`, scan for `oldId`, and emit a TextEdit
 * for each whole-token occurrence that replaces it with `newId`.
 *
 * Positions are returned as zero-based line/character (LSP
 * convention). Each occurrence's range covers only the `oldId`
 * characters — the editor uses the textual replacement to perform
 * the rename, so the range must be exact.
 */
export function findIdOccurrencesInFile(
  text: string,
  oldId: string,
  newId: string,
): TextEdit[] {
  if (oldId.length === 0) return [];
  const edits: TextEdit[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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
  }
  return edits;
}
