/**
 * @module lsp/feature_code_actions
 *
 * Quick fixes for `.feature` files (#943). A `.feature` header is a run of
 * comment lines (`# [ID] Title`, then `# Key: value` trailer lines). The
 * locator functions find the header run and its trailer block in the file
 * lines, so a trailer fix edits only lines of that block (the P021 fix also
 * deletes the `#`-only line above an all-empty block) and never a step or
 * doc-string line. `buildFeatureCodeActions` builds the fixes for
 * MSL-A030, A013, A012, A011, T020, P021 (empty `# Key:` line), B069 (blank
 * lines between header and node), M060 and S010.
 */

import {
  FEATURE_HEADER_START_RE,
  featureHeaderRunEnd,
  parseFile,
} from "../core/mod.ts";
import {
  ATTRIBUTE_KEY_RE,
  buildM060Fix,
  buildS010Fix,
  closestCoreType,
  type CodeAction,
  deleteLines,
  EMPTY_TRAILER_RE,
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
 *
 * Precondition: `line` carries no trailing `\r` (see {@linkcode splitLines}).
 */
export function commentPrefix(line: string): string | undefined {
  return COMMENT_PREFIX_RE.exec(line)?.[0];
}

/**
 * The trailer key of a comment line, when the comment text matches
 * `^[A-Z][A-Za-z-]*\s*:`. `undefined` for any other line.
 *
 * Precondition: `line` carries no trailing `\r` (see {@linkcode splitLines}).
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

/**
 * The value of a trailer line (text after `Key:`), or `undefined`. One
 * trailing continuation backslash is dropped, as the attribute parser does.
 *
 * Precondition: `line` carries no trailing `\r` (see
 * {@linkcode splitLines}).
 */
export function lineValue(line: string): string | undefined {
  const prefix = commentPrefix(line) ?? "";
  const raw = TRAILER_LINE_RE.exec(line.slice(prefix.length))?.[2];
  return raw === undefined ? undefined : raw.replace(/\\$/, "");
}

/**
 * Index of the `nth` (zero-based) trailer line with `key` inside `block`
 * that satisfies `accept`, or -1.
 */
function findKeyLine(
  lines: readonly string[],
  block: LineRange,
  key: string,
  accept: (value: string) => boolean = () => true,
  nth = 0,
): number {
  let seen = 0;
  for (let i = block.start; i < block.end; i++) {
    if (trailerKey(lines[i]) !== key) continue;
    if (!accept(lineValue(lines[i]) ?? "")) continue;
    if (seen++ === nth) return i;
  }
  return -1;
}

/**
 * Build quick fixes for the diagnostics of a `.feature` file (#943). The
 * attribute fixes (A030, A012, A013, T020, A011) edit only lines inside the
 * trailer block of the header that the diagnostic points at, and never a
 * `# Id:` line. P021 removes empty `# Key:` lines of that block, which can
 * include an empty `# Id:` line; no fix removes a value-bearing one. B069
 * deletes the blank lines between a header and its node, only when a
 * re-parse of the edited text yields the entry. M060 and S010 use the shared
 * builders, which work from the diagnostic range alone. Codes without a fix
 * return nothing. A builder that throws or rejects for one
 * diagnostic loses only that diagnostic's action. When several diagnostics
 * of A030, A012 or A011 name the same key on one header, the nth diagnostic
 * fixes the nth matching line, so each action has its own line. A013 keeps
 * the first line of the key and removes the rest. T020 uses the first
 * `# Type:` line that contains the bad value.
 *
 * @param uri - Document URI.
 * @param filePath - Document path, used to re-parse the edited text.
 * @param diagnostics - Diagnostics the editor has on the range.
 * @param documentText - Full document text; LF or CRLF line endings.
 */
export async function buildFeatureCodeActions(
  uri: string,
  filePath: string,
  diagnostics: readonly LspDiagnosticLike[],
  documentText: string,
): Promise<CodeAction[]> {
  const { lines, crlf } = splitLines(documentText);
  const out: CodeAction[] = [];
  const seenCounts = new Map<string, number>();
  for (const diag of diagnostics) {
    let action: CodeAction | undefined;
    try {
      switch (diag.code) {
        case "MSL-M060":
          action = buildM060Fix(uri, diag);
          break;
        case "MSL-S010":
          action = buildS010Fix(uri, diag);
          break;
        case "MSL-P021":
          action = emptyTrailerFix(uri, diag, lines);
          break;
        case "MSL-B069":
          action = await blankGapFix(uri, filePath, diag, lines, documentText);
          break;
        case "MSL-A030":
        case "MSL-A012":
        case "MSL-A013":
        case "MSL-T020":
        case "MSL-A011":
          {
            const key = ATTRIBUTE_KEY_RE.exec(diag.message)?.[1];
            const slot = `${diag.code}|${diag.range.start.line}|${key}`;
            const nth = seenCounts.get(slot) ?? 0;
            seenCounts.set(slot, nth + 1);
            action = headerFix(uri, diag, lines, crlf, nth);
          }
          break;
      }
    } catch {
      // One failing builder must not drop the other diagnostics' actions.
      continue;
    }
    if (action) out.push(action);
  }
  return out;
}

/**
 * MSL-P021: the diagnostic points at the offending trailer line. Fixes only
 * an empty-valued `# Key:` comment line. Deletes every empty `# Key:` line
 * of the trailer block, and the `#`-only line above the block when every
 * line of the block is empty (as the Markdown fix does).
 */
function emptyTrailerFix(
  uri: string,
  diag: LspDiagnosticLike,
  lines: readonly string[],
): CodeAction | undefined {
  const target = diag.range.start.line;
  const targetLine = lines[target];
  if (targetLine === undefined) return undefined;
  const prefix = commentPrefix(targetLine);
  if (prefix === undefined) return undefined;
  if (!EMPTY_TRAILER_RE.test(targetLine.slice(prefix.length).trim())) {
    return undefined;
  }
  // Find the header start above the target, inside the comment run.
  let titleIdx = target;
  while (titleIdx >= 0 && headerRun(lines, titleIdx) === undefined) {
    if (commentPrefix(lines[titleIdx]) === undefined) return undefined;
    titleIdx--;
  }
  if (titleIdx < 0) return undefined;
  const block = trailerBlock(lines, titleIdx);
  if (!block || target < block.start || target >= block.end) return undefined;
  const emptyLines: number[] = [];
  for (let i = block.start; i < block.end; i++) {
    const p = commentPrefix(lines[i]) ?? "";
    if (EMPTY_TRAILER_RE.test(lines[i].slice(p.length).trim())) {
      emptyLines.push(i);
    }
  }
  const wholeBlock = emptyLines.length === block.end - block.start;
  const edits: TextEdit[] = wholeBlock
    ? [deleteLines(
      block.start - 1 > titleIdx && lines[block.start - 1].trim() === "#"
        ? block.start - 1
        : block.start,
      block.end,
    )]
    : emptyLines.map((i) => deleteLines(i, i + 1));
  const key = trailerKey(targetLine);
  return quickFix(
    uri,
    diag,
    emptyLines.length > 1
      ? "Remove empty trailer lines"
      : `Remove empty '${key}' line`,
    edits,
  );
}

/** Dispatch for the fixes that edit the header trailer block. */
function headerFix(
  uri: string,
  diag: LspDiagnosticLike,
  lines: readonly string[],
  crlf: readonly boolean[],
  nth: number,
): CodeAction | undefined {
  const block = trailerBlock(lines, diag.range.start.line);
  if (!block) return undefined;
  if (diag.code === "MSL-T020") return typeFix(uri, diag, lines, block);
  const key = ATTRIBUTE_KEY_RE.exec(diag.message)?.[1];
  if (key === undefined || key === "Id") return undefined;
  const accept = diag.code === "MSL-A012"
    ? (value: string) => splitCitationValues(value).length === 0
    : diag.code === "MSL-A011"
    ? (value: string) => splitCitationValues(value).length >= 2
    : () => true;
  // A013 reports once per key, so it always starts at the first line.
  const at = findKeyLine(
    lines,
    block,
    key,
    accept,
    diag.code === "MSL-A013" ? 0 : nth,
  );
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
  const at = findKeyLine(lines, block, "Type", (v) => v.includes(bad));
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
  const value = lineValue(line);
  if (value === undefined) return undefined;
  const values = splitCitationValues(value);
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

/**
 * MSL-B069, blank-gap variant: the diagnostic points at the header start.
 * Walks from the end of the header run over blank lines, tag lines and plain
 * comment lines, and offers to delete the blank lines. The first non-blank
 * line after the header run must not be a comment line: removing the blank
 * lines would join that comment to the header run and void the trailer. Only
 * a tag line or the node keyword may follow the header.
 *
 * The checks on the re-parsed edited text are a backstop behind that guard:
 * the fix is offered only when the re-parse gives an entry at the header start
 * line (this rejects a header that does not attach to a node, such as a header
 * above a Background, Examples or a step or a stacked header, and an edit that
 * no longer parses), gives no MSL-P020 inside the header run, and, when the
 * header had a `# Id:` line with a value, still gives the entry that Id. The
 * last two checks keep the fix from voiding the trailer, which would make
 * Format Document stamp a second `# Id:` line.
 */
async function blankGapFix(
  uri: string,
  filePath: string,
  diag: LspDiagnosticLike,
  lines: readonly string[],
  documentText: string,
): Promise<CodeAction | undefined> {
  const titleIdx = diag.range.start.line;
  const run = headerRun(lines, titleIdx);
  if (!run) return undefined;
  const blanks: number[] = [];
  let firstNonBlank: string | undefined;
  for (let i = run.end; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      blanks.push(i);
      continue;
    }
    firstNonBlank ??= trimmed;
    if (trimmed.startsWith("@")) {
      continue;
    } else if (trimmed.startsWith("#")) {
      if (FEATURE_HEADER_START_RE.test(trimmed.slice(1).trimStart())) break;
    } else {
      break;
    }
  }
  if (blanks.length === 0) return undefined;
  if (firstNonBlank?.startsWith("#")) return undefined;
  const removed = new Set(blanks);
  const edited = documentText
    .split("\n")
    .filter((_, i) => !removed.has(i))
    .join("\n");
  const parsed = await parseFile(edited, { file: filePath });
  const headerLine = titleIdx + 1;
  const entry = parsed.entries.find((e) => e.location.line === headerLine);
  if (!entry) return undefined;
  const hadId = lines.slice(run.start, run.end).some((l) =>
    trailerKey(l) === "Id" && (lineValue(l) ?? "").trim() !== ""
  );
  if (hadId && !entry.id) return undefined;
  const voided = parsed.diagnostics.some((d) =>
    d.code === "MSL-P020" && d.location !== undefined &&
    d.location.line >= headerLine && d.location.line <= run.end
  );
  if (voided) return undefined;
  return quickFix(
    uri,
    diag,
    blanks.length === 1
      ? "Remove the blank line between the header and the node"
      : "Remove the blank lines between the header and the node",
    blanks.map((i) => deleteLines(i, i + 1)),
  );
}
