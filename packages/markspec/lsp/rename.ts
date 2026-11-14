/**
 * @module lsp/rename
 *
 * Workspace-rename helper. Finds every whole-token occurrence of a
 * display ID in a file's text and builds the `TextEdit[]` payload an
 * LSP `WorkspaceEdit` needs.
 *
 * Whole-token matching means `REQ-001` does not match `REQ-0010` or
 * `REQ-001-extra` — both ends of the token must be at a non-ID
 * character. The ID character set uses the shared core token grammar:
 * letters, digits, `._/-`.
 *
 * `findIdOccurrencesInFile` scans raw file text rather than parsed
 * entries, so it must skip fenced code regions itself (#680, same
 * class as the `core/refs` `canonicalizeRefs` fix in #679/#668) —
 * otherwise renaming a real entry also rewrites the ID inside an
 * illustrative fenced example that merely reuses the same text. It
 * reuses `walkProseLines` (`core/util/fence.ts`) rather than
 * re-implementing fence tracking. Markdown uses cached CommonMark boundaries;
 * the server supplies the original line-scanner boundaries for source files.
 * An ID inside a closed scenario locator on a trailer line is not
 * rewritten (#915), as in `core/refs` rename-heal.
 * `prepareRenameRange` stays
 * single-line and fence-unaware by design — the server gates
 * `onPrepareRename` against a fenced cursor position separately (via
 * `isLineFenced`) using the full document text it already has.
 * `displayIdForRename` applies the same guard to direct rename requests.
 */

import {
  DISPLAY_ID_CHAR_RE,
  DISPLAY_ID_TOKEN_RE,
  isLineFenced,
  walkProseLines,
} from "../core/mod.ts";
import { displayIdAtPosition } from "./hover.ts";

/**
 * Return the display ID at the cursor, or `undefined` inside a code fence.
 * Direct rename requests must reject fenced cursors even when the client
 * has not called `prepareRename`.
 * The caller supplies the cursor line from the LSP document range and may
 * reuse the fenced-line set when also collecting edits for this text.
 */
export function displayIdForRename(
  text: string,
  line: string,
  lspLine: number,
  column: number,
  fencedLines?: ReadonlySet<number>,
): string | undefined {
  if (isLineFenced(text, lspLine, fencedLines)) return undefined;
  return displayIdAtPosition(line, column);
}

/** A subset of the LSP `TextEdit` interface. */
export interface TextEdit {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly newText: string;
}

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
  while (start > 0 && DISPLAY_ID_CHAR_RE.test(line[start - 1])) start--;
  let end = column;
  while (end < line.length && DISPLAY_ID_CHAR_RE.test(line[end])) end++;
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
 * Lines classified as fenced by the supplied set or CommonMark parser are skipped — an
 * illustrative example that happens to display the same ID as sample
 * text is not a real reference and must not be rewritten (#680).
 *
 * Set `featureFile` for a Gherkin `.feature` file: its trailers are
 * `# Key: value` comment lines, so a bracketed scenario-name locator on such
 * a line is kept, as on an indented trailer line.
 */
export function findIdOccurrencesInFile(
  text: string,
  oldId: string,
  newId: string,
  fencedLines?: ReadonlySet<number>,
  featureFile = false,
): TextEdit[] {
  // Skip the fence computation, which parses the document, when the text
  // cannot hold an occurrence.
  if (oldId.length === 0 || !text.includes(oldId)) return [];
  const edits: TextEdit[] = [];
  const trailerLine = featureFile ? FEATURE_TRAILER_LINE_RE : TRAILER_LINE_RE;
  walkProseLines(text, (line, i) => {
    const locators = locatorSpans(line, trailerLine);
    let start = 0;
    while (true) {
      const idx = line.indexOf(oldId, start);
      if (idx < 0) break;
      // An ID inside a scenario locator is scenario text, not a reference;
      // core/refs rename-heal leaves it unchanged too (#915).
      if (locators.some(([from, to]) => idx >= from && idx < to)) {
        start = idx + oldId.length;
        continue;
      }
      const before = idx === 0 ? "" : line[idx - 1];
      const after = idx + oldId.length >= line.length
        ? ""
        : line[idx + oldId.length];
      const boundedLeft = before === "" || !DISPLAY_ID_CHAR_RE.test(before);
      const boundedRight = after === "" || !DISPLAY_ID_CHAR_RE.test(after);
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
  }, fencedLines);
  return edits;
}

/** A trailer line: optional doc-comment prefix, at least 4 spaces of
 * indent, then `Key:`. */
const TRAILER_LINE_RE = /^(?:\s*(?:\/\/[/!]?|\*|#))?\s{4,}[A-Z][A-Za-z-]*\s*:/;

/** A `.feature` header trailer line: `#`, optional spaces, then `Key:`. */
const FEATURE_TRAILER_LINE_RE = /^\s*#\s*[A-Z][A-Za-z-]*\s*:/;

/** A closed bracket locator after whitespace, with escapes (same grammar
 * as `core/refs/split.ts`). */
const LOCATOR_SPAN_RE = /\s\[(?:\\[\s\S]|[^\]\\])*\]/g;

/** `[start, end)` column spans of the closed locators on a line that
 * `trailerLine` accepts; empty for any other line. */
function locatorSpans(
  line: string,
  trailerLine: RegExp,
): Array<[number, number]> {
  if (!trailerLine.test(line)) return [];
  return [...line.matchAll(LOCATOR_SPAN_RE)].map((
    m,
  ) => [m.index!, m.index! + m[0].length]);
}
