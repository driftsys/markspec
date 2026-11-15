/**
 * @module lsp/document_links
 *
 * Pure helper for the LSP `textDocument/documentLink` handler. Walks
 * each entry's source lines, finds `Source:` trailer lines, and emits
 * one `DocumentLink` per value that is a file path or an `http(s)://`
 * URI.
 *
 * The link **range** covers only the path (not the optional `:line[:col]`
 * suffix) or the whole URI. The link **target** is the URI returned by
 * `resolveTarget` for a path, or the value itself for a URI. A value for
 * which `resolveTarget` returns `undefined` (for example a display ID, or
 * a path that does not exist) gets no link.
 */

import type { Entry } from "../core/mod.ts";

/** A subset of the LSP `DocumentLink` interface. */
export interface DocumentLink {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly target: string;
}

/**
 * Matches a trailer-indented `Source:` line, capturing the leading
 * indent + key + ": " prefix in group 1 so callers can compute the
 * value's starting column.
 *
 * Trailer indent is ≥4 spaces per the parser; the formatter
 * canonicalises to 6.
 */
const SOURCE_LINE_RE = /^(\s{4,}Source\s*:\s*)(.*)$/;

/** A value that is an `http(s)://` URI, linked as is. */
const URI_TOKEN_RE = /^https?:\/\/\S+$/i;

/**
 * Match a single path value: `<path>` with an optional `:line[:col]`
 * suffix. Group 1 captures the path (which the link range covers);
 * group 2 captures the line number when present.
 *
 * Path characters: anything except whitespace, comma, and colon, which
 * keeps the boundary between path and `:line` unambiguous.
 */
const PATH_TOKEN_RE = /^([^\s,:]+)(?::(\d+)(?::\d+)?)?$/;

/**
 * Build the `DocumentLink[]` for a document.
 *
 * @param entries — entries declared in the document the client requested
 *   links for. Each entry's `location.line` (1-based) anchors the search;
 *   the helper scans lines from that entry's start up to either the next
 *   entry's start − 1 or the end of `text`.
 * @param text — the full text of the document. Used to locate the value's
 *   column within each `Source:` line.
 * @param resolveTarget — `(path, lineSuffix?) => uri | undefined`.
 *   Resolves a value's path portion to a `file://` URI, appending
 *   `#L<lineSuffix>` when `lineSuffix` is a number. Returns `undefined`
 *   to suppress the link (for example when the file does not exist).
 *   Keeping the resolver injected keeps the helper free of I/O.
 */
export function buildDocumentLinks(
  entries: readonly Entry[],
  text: string,
  resolveTarget: (
    path: string,
    lineSuffix: number | undefined,
  ) => string | undefined,
): DocumentLink[] {
  if (entries.length === 0) return [];

  const lines = text.split("\n");
  const sorted = [...entries].sort(
    (a, b) => a.location.line - b.location.line,
  );

  const out: DocumentLink[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    // 1-based inclusive start; 1-based inclusive end.
    const startLine = entry.location.line;
    const endLine = i + 1 < sorted.length
      ? sorted[i + 1].location.line - 1
      : lines.length;

    for (let lineNo = startLine; lineNo <= endLine; lineNo++) {
      const line = lines[lineNo - 1];
      if (line === undefined) continue;
      const m = SOURCE_LINE_RE.exec(line);
      if (!m) continue;

      // Walk comma-separated tokens, tracking the column of each token's
      // start so the emitted range is accurate.
      let cursor = m[1].length;
      const csvParts = m[2].split(",");
      for (let p = 0; p < csvParts.length; p++) {
        const part = csvParts[p];
        let tokenStart = 0;
        while (tokenStart < part.length && /\s/.test(part[tokenStart])) {
          tokenStart++;
        }
        let tokenEnd = part.length;
        while (tokenEnd > tokenStart && /\s/.test(part[tokenEnd - 1])) {
          tokenEnd--;
        }
        const token = part.slice(tokenStart, tokenEnd);
        const tokenColumn = cursor + tokenStart;

        // Advance past this part and the comma separator.
        cursor += part.length;
        if (p < csvParts.length - 1) cursor += 1;

        if (token.length === 0) continue;

        let target: string | undefined;
        let length: number;
        if (URI_TOKEN_RE.test(token)) {
          target = token;
          length = token.length;
        } else {
          const pm = PATH_TOKEN_RE.exec(token);
          if (!pm) continue;
          const numericLine = pm[2] !== undefined ? Number(pm[2]) : undefined;
          target = resolveTarget(pm[1], numericLine);
          length = pm[1].length;
        }
        if (target === undefined) continue;

        const lspLine = lineNo - 1;
        out.push({
          range: {
            start: { line: lspLine, character: tokenColumn },
            end: { line: lspLine, character: tokenColumn + length },
          },
          target,
        });
      }
    }
  }
  return out;
}
