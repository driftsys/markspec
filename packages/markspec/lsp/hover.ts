/**
 * @module lsp/hover
 *
 * Hover-content helpers for the MarkSpec LSP. Two pure, testable
 * functions:
 *
 *   - {@linkcode displayIdAtPosition}: extract the display-ID token
 *     under a cursor position on a line, if any.
 *   - {@linkcode formatHoverContent}: render an {@linkcode Entry} as
 *     a short Markdown block suitable for an LSP `MarkupContent`
 *     payload.
 *
 * The server module composes these with the workspace index to
 * implement `connection.onHover`.
 */

import {
  DISPLAY_ID_CHAR_RE,
  DISPLAY_ID_TOKEN_RE,
  type Entry,
} from "../core/mod.ts";

/**
 * Return the display-ID token at the given column on `line`, or
 * `undefined` when the column lies on whitespace, past the line end,
 * or on a token that doesn't look like a display ID.
 */
export function displayIdAtPosition(
  line: string,
  column: number,
): string | undefined {
  if (column < 0 || column >= line.length) return undefined;
  if (/\s/.test(line[column])) return undefined;
  // Scan left and right for the token boundaries — anything in the
  // grammar's character set continues the token.
  let start = column;
  while (start > 0 && DISPLAY_ID_CHAR_RE.test(line[start - 1])) start--;
  let end = column;
  while (end < line.length && DISPLAY_ID_CHAR_RE.test(line[end])) end++;
  const token = line.slice(start, end);
  return DISPLAY_ID_TOKEN_RE.test(token) ? token : undefined;
}

/**
 * Format an entry for hover display. Produces a short Markdown block:
 * a heading with the display ID + title, a metadata line listing the
 * resolved type (when set) and the `Id:` (ULID/URI), and the first
 * body paragraph as preview prose.
 */
export function formatHoverContent(entry: Entry): string {
  const lines: string[] = [];
  lines.push(`### ${entry.displayId} — ${entry.title}`);
  const metadata: string[] = [];
  if (entry.type) metadata.push(`**Type:** ${entry.type}`);
  if (entry.id) metadata.push(`**Id:** \`${entry.id}\``);
  if (metadata.length > 0) {
    lines.push("");
    lines.push(metadata.join(" · "));
  }
  const firstParagraph = entry.body.split(/\n\s*\n/)[0]?.trim();
  if (firstParagraph) {
    lines.push("");
    lines.push(firstParagraph);
  }
  return lines.join("\n");
}
