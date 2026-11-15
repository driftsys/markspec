/**
 * @module lsp/feature_code_actions
 *
 * Locator helpers for quick fixes on `.feature` files (#943). A `.feature`
 * header is a run of comment lines (`# [ID] Title`, then `# Key: value`
 * trailer lines). These pure functions find the header run and its trailer
 * block in the file lines, so a fix edits only header lines and never a
 * step or doc-string line.
 */

import { FEATURE_HEADER_START_RE, featureHeaderRunEnd } from "../core/mod.ts";
import {
  ATTRIBUTE_KEY_RE,
  buildM060Fix,
  buildS010Fix,
  closestCoreType,
  type CodeAction,
  deleteLines,
  type LspDiagnosticLike,
  quickFix,
  splitCitationValues,
  T020_VALUE_RE,
  type TextEdit,
} from "./code_actions.ts";

/** Leading whitespace, `#`, and the spaces or tabs after it. */
const COMMENT_PREFIX_RE = /^\s*#[ \t]*/;

/** A trailer key at the start of the comment text. */
const TRAILER_KEY_RE = /^([A-Z][A-Za-z-]*)\s*:/;

/** A half-open range of line indexes: `start` inclusive, `end` exclusive. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The comment prefix of `line` (indent, `#`, and the spaces after it), or
 * `undefined` when the line is not a comment line.
 */
export function commentPrefix(line: string): string | undefined {
  return COMMENT_PREFIX_RE.exec(line)?.[0];
}

/**
 * The trailer key of a comment line, when the comment text matches
 * `^[A-Z][A-Za-z-]*\s*:`. `undefined` for any other line.
 */
export function trailerKey(line: string): string | undefined {
  const prefix = commentPrefix(line);
  if (prefix === undefined) return undefined;
  return TRAILER_KEY_RE.exec(line.slice(prefix.length))?.[1];
}

/**
 * The header run that starts at `titleIdx`: from that line up to the
 * exclusive end given by `featureHeaderRunEnd`. `undefined` when the line is
 * not a header start (`# [ID] ...`).
 *
 * Precondition: `lines` carry no line endings, in particular no trailing
 * `\r`. Split a CRLF file with {@linkcode splitLines}.
 */
export function headerRun(
  lines: readonly string[],
  titleIdx: number,
): LineRange | undefined {
  const line = lines[titleIdx];
  if (line === undefined) return undefined;
  const prefix = commentPrefix(line);
  if (prefix === undefined) return undefined;
  if (!FEATURE_HEADER_START_RE.test(line.slice(prefix.length))) {
    return undefined;
  }
  return { start: titleIdx, end: featureHeaderRunEnd(lines, titleIdx) };
}

/**
 * The trailer block of the header that starts at `titleIdx`: after trailing
 * `#`-only lines of the run are skipped, the contiguous comment lines that
 * carry a trailer key. An empty block (`start === end`) sits at the first
 * skipped `#`-only line, or at the end of the run when none is skipped.
 * `undefined` when `titleIdx` is not a header start.
 *
 * Precondition: `lines` carry no trailing `\r` (see
 * {@linkcode splitLines}).
 */
export function trailerBlock(
  lines: readonly string[],
  titleIdx: number,
): LineRange | undefined {
  const run = headerRun(lines, titleIdx);
  if (!run) return undefined;
  let end = run.end;
  while (end > run.start + 1 && lines[end - 1].trim() === "#") end--;
  let start = end;
  while (start > run.start + 1 && trailerKey(lines[start - 1]) !== undefined) {
    start--;
  }
  return { start, end };
}

/** The key and value of a trailer line's comment text (`Key: value`). */
const TRAILER_LINE_RE = /^([A-Z][A-Za-z-]*)\s*:\s*(.*)$/;

/**
 * Split `text` into lines without line endings. `crlf[i]` is `true` when
 * line `i` ended with `\r\n`, so a fix can reuse the original ending.
 */
export function splitLines(
  text: string,
): { lines: string[]; crlf: boolean[] } {
  const lines: string[] = [];
  const crlf: boolean[] = [];
  for (const raw of text.split("\n")) {
    const hasCr = raw.endsWith("\r");
    lines.push(hasCr ? raw.slice(0, -1) : raw);
    crlf.push(hasCr);
  }
  return { lines, crlf };
}

/** Index of the first trailer line with `key` inside `block`, or -1. */
function findKeyLine(
  lines: readonly string[],
  block: LineRange,
  key: string,
): number {
  for (let i = block.start; i < block.end; i++) {
    if (trailerKey(lines[i]) === key) return i;
  }
  return -1;
}

/**
 * Build quick fixes for the diagnostics of a `.feature` file (#943). Every
 * edit stays inside the trailer block of the header that the diagnostic
 * points at; a `# Id:` line is never edited. Codes without a fix return
 * nothing.
 *
 * @param uri - Document URI.
 * @param _filePath - Document path (used by later fixes that re-parse).
 * @param diagnostics - Diagnostics the editor has on the range.
 * @param documentText - Full document text; LF or CRLF line endings.
 */
// deno-lint-ignore require-await
export async function buildFeatureCodeActions(
  uri: string,
  _filePath: string,
  diagnostics: readonly LspDiagnosticLike[],
  documentText: string,
): Promise<CodeAction[]> {
  const { lines, crlf } = splitLines(documentText);
  const out: CodeAction[] = [];
  for (const diag of diagnostics) {
    let action: CodeAction | undefined;
    switch (diag.code) {
      case "MSL-M060":
        action = buildM060Fix(uri, diag);
        break;
      case "MSL-S010":
        action = buildS010Fix(uri, diag);
        break;
      case "MSL-A030":
      case "MSL-A012":
      case "MSL-A013":
      case "MSL-T020":
      case "MSL-A011":
        action = headerFix(uri, diag, lines, crlf);
        break;
    }
    if (action) out.push(action);
  }
  return out;
}

/** Dispatch for the fixes that edit the header trailer block. */
function headerFix(
  uri: string,
  diag: LspDiagnosticLike,
  lines: readonly string[],
  crlf: readonly boolean[],
): CodeAction | undefined {
  const block = trailerBlock(lines, diag.range.start.line);
  if (!block) return undefined;
  if (diag.code === "MSL-T020") return typeFix(uri, diag, lines, block);
  const key = ATTRIBUTE_KEY_RE.exec(diag.message)?.[1];
  if (key === undefined || key === "Id") return undefined;
  const at = findKeyLine(lines, block, key);
  if (at < 0) return undefined;
  switch (diag.code) {
    case "MSL-A030":
      return quickFix(uri, diag, `Remove '${key}' line`, [
        deleteLines(at, at + 1),
      ]);
    case "MSL-A012":
      return quickFix(uri, diag, `Remove empty '${key}' line`, [
        deleteLines(at, at + 1),
      ]);
    case "MSL-A013": {
      const edits: TextEdit[] = [];
      for (let i = at + 1; i < block.end; i++) {
        if (trailerKey(lines[i]) === key) edits.push(deleteLines(i, i + 1));
      }
      if (edits.length === 0) return undefined;
      return quickFix(uri, diag, `Remove duplicate '${key}' line(s)`, edits);
    }
    default:
      return citationFix(uri, diag, lines, crlf, at, key);
  }
}

/** MSL-T020: replace the `# Type:` value with the closest core type. */
function typeFix(
  uri: string,
  diag: LspDiagnosticLike,
  lines: readonly string[],
  block: LineRange,
): CodeAction | undefined {
  const bad = T020_VALUE_RE.exec(diag.message)?.[1];
  if (bad === undefined) return undefined;
  const suggestion = closestCoreType(bad);
  if (suggestion === undefined) return undefined;
  const at = findKeyLine(lines, block, "Type");
  if (at < 0) return undefined;
  const line = lines[at];
  const colon = line.indexOf(":", (commentPrefix(line) ?? "").length);
  const idx = line.indexOf(bad, colon + 1);
  if (idx < 0) return undefined;
  return {
    title: `Replace with '${suggestion}'`,
    kind: "quickfix",
    diagnostics: [diag],
    isPreferred: true,
    edit: {
      changes: {
        [uri]: [{
          range: {
            start: { line: at, character: idx },
            end: { line: at, character: idx + bad.length },
          },
          newText: suggestion,
        }],
      },
    },
  };
}

/** MSL-A011: one `# Key: value` line per top-level value. */
function citationFix(
  uri: string,
  diag: LspDiagnosticLike,
  lines: readonly string[],
  crlf: readonly boolean[],
  at: number,
  key: string,
): CodeAction | undefined {
  const line = lines[at];
  const prefix = commentPrefix(line) ?? "";
  const match = TRAILER_LINE_RE.exec(line.slice(prefix.length));
  if (!match) return undefined;
  const values = splitCitationValues(match[2]);
  if (values.length < 2) return undefined;
  const eol = crlf[at] ? "\r\n" : "\n";
  const newText = values.map((v) => `${prefix}${key}: ${v}`).join(eol);
  return quickFix(uri, diag, `Rewrite '${key}' as multi-line`, [{
    range: {
      start: { line: at, character: 0 },
      end: { line: at, character: line.length },
    },
    newText,
  }]);
}
