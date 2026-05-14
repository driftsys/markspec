/**
 * @module lsp/highlights
 *
 * Document-highlights helper. Locates every whole-token occurrence
 * of a display ID in a single file's text and returns LSP
 * `DocumentHighlight[]` payloads so the editor can highlight all
 * matches when the cursor sits on a display-ID token.
 *
 * The declaration site (bracketed token on a title line, e.g.
 * `- [REQ-001] Title`) is classified as `Write`; every other
 * occurrence is `Read`. This matches the LSP/IDE convention where
 * a "write" highlight marks the symbol's binding location and
 * "read" marks usages.
 */

/** Display-ID character set — letters, digits, dot, slash, hyphen, underscore. */
const ID_CHAR_RE = /[A-Za-z0-9._/-]/;

/** LSP `DocumentHighlightKind` numeric constants (spec §). */
export const DocumentHighlightKindText = 1;
export const DocumentHighlightKindRead = 2;
export const DocumentHighlightKindWrite = 3;

/** A subset of the LSP `DocumentHighlight` interface. */
export interface DocumentHighlight {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly kind: number;
}

/**
 * Walk every line of `text` and emit one `DocumentHighlight` per
 * whole-token occurrence of `displayId`. The token at the start of
 * a Markdown list-item bracket (`- [REQ-001]`) is classified as
 * `Write` — it's the declaration. All other matches are `Read`.
 */
export function findOccurrencesInFile(
  text: string,
  displayId: string,
): DocumentHighlight[] {
  if (displayId.length === 0) return [];
  const out: DocumentHighlight[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let start = 0;
    while (true) {
      const idx = line.indexOf(displayId, start);
      if (idx < 0) break;
      const before = idx === 0 ? "" : line[idx - 1];
      const after = idx + displayId.length >= line.length
        ? ""
        : line[idx + displayId.length];
      const boundedLeft = before === "" || !ID_CHAR_RE.test(before);
      const boundedRight = after === "" || !ID_CHAR_RE.test(after);
      if (boundedLeft && boundedRight) {
        // Declaration heuristic: the character immediately before the
        // token is `[`. Holds for both `- [REQ-001]` title lines and
        // any reference written with brackets.
        const kind = before === "["
          ? DocumentHighlightKindWrite
          : DocumentHighlightKindRead;
        out.push({
          range: {
            start: { line: i, character: idx },
            end: { line: i, character: idx + displayId.length },
          },
          kind,
        });
      }
      start = idx + displayId.length;
    }
  }
  return out;
}
