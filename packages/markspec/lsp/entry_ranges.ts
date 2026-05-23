/**
 * @module lsp/entry_ranges
 *
 * Build the payload returned by the `markspec/entryRanges` custom
 * LSP request: per-entry title range, trailer-dim ranges that
 * exclude embedded display IDs, and label ranges with a validity
 * flag and optional diagnostic message.
 *
 * Pure function — deterministic on its inputs. The server's
 * request handler is a thin shim that reads the document buffer,
 * fetches entries from the workspace index, and calls this.
 *
 * Range coordinates follow the LSP convention: zero-based line and
 * character.
 */

import type { Diagnostic, EffectiveProfile, Entry } from "../core/model/mod.ts";
import { scanEntryTrailer, type TrailerLine } from "./entry_trailer.ts";

/** LSP `Position`-shaped tuple. */
export interface Position {
  readonly line: number;
  readonly character: number;
}

/** LSP `Range`-shaped tuple. */
export interface Range {
  readonly start: Position;
  readonly end: Position;
}

/** One label inside a `Labels:` value, with validity + optional diag. */
export interface LabelRange {
  readonly range: Range;
  readonly valid: boolean;
  readonly diagnostic?: string;
}

/**
 * Admonition / blockquote kind. `plain` is for `> …` runs without an
 * `[!KIND]` first-line marker; the five named kinds follow the
 * GitHub-flavoured Markdown alert vocabulary.
 */
export type BlockquoteKind =
  | "note"
  | "tip"
  | "important"
  | "warning"
  | "caution"
  | "plain";

/** A contiguous run of `>` -prefixed lines in entry body, classified. */
export interface BlockquoteRange {
  readonly range: Range;
  readonly kind: BlockquoteKind;
  /**
   * Range of the `[!KIND]` marker text on the blockquote's first line,
   * when `kind !== "plain"`. Lets the client highlight just the marker
   * (e.g., as a coloured pill) instead of the whole block.
   */
  readonly markerRange?: Range;
}

/** Layout info for one entry. */
export interface EntryRangeInfo {
  /**
   * Full entry block — from the title line through the last trailer
   * line. Used by the client to paint a subtle card-style background
   * behind the entire entry.
   */
  readonly entryRange: Range;
  readonly titleRange: Range;
  readonly trailerDimRanges: readonly Range[];
  readonly labelRanges: readonly LabelRange[];
  readonly blockquoteRanges: readonly BlockquoteRange[];
}

/** Response payload for `markspec/entryRanges`. */
export interface EntryRangesResponse {
  readonly entries: readonly EntryRangeInfo[];
}

/**
 * Title line pattern: `- [DISPLAY_ID] Title text`.
 *
 * The ID class mirrors the project's canonical display-ID grammar used
 * by `entry_trailer.ts` (`DISPLAY_ID_RE`), `semantic_tokens.ts`, and
 * `hover.ts` (`DISPLAY_ID_TOKEN_RE`): a leading alphanumeric followed
 * by at least two more characters from the set `[A-Za-z0-9._/-]`. The
 * `{2,}` quantifier (not `+`) enforces the ≥3-char total length that
 * those modules also require, so entry-range layout covers every ID the
 * parser, hover, rename, and references already accept (e.g.
 * `my-entry`, `my.entry`, `ns/entry`).
 */
const TITLE_LINE_RE =
  /^(\s*-\s+\[)(@?[A-Za-z0-9][A-Za-z0-9._/-]{2,})(\]\s*)(.*)$/;

/**
 * Build entry-ranges for every entry in `entries`. `diagnostics` is
 * consulted to attach hover messages to invalid label pills (any
 * diagnostic whose location lands on a label range becomes that
 * label's `diagnostic` field).
 */
export function buildEntryRanges(
  entries: readonly Entry[],
  profile: EffectiveProfile | undefined,
  diagnostics: readonly Diagnostic[],
  lines: readonly string[],
): EntryRangesResponse {
  const allowedLabels = collectAllowedLabels(profile);
  const sorted = [...entries].sort(
    (a, b) => a.location.line - b.location.line,
  );
  const out: EntryRangeInfo[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const endLineExclusive = i + 1 < sorted.length
      ? sorted[i + 1].location.line - 1
      : lines.length;
    const titleRange = computeTitleRange(entry, lines);
    if (!titleRange) continue;
    const trailerLines = scanEntryTrailer(entry, lines, endLineExclusive);
    const trailerDimRanges = computeDimRanges(trailerLines, lines);
    const labelRanges = computeLabelRanges(
      trailerLines,
      lines,
      allowedLabels,
      diagnostics,
      entry.location.file,
    );
    const blockquoteRanges = computeBlockquoteRanges(
      entry,
      lines,
      trailerLines,
      endLineExclusive,
    );
    const entryRange = computeEntryRange(
      entry,
      lines,
      trailerLines,
      endLineExclusive,
    );
    out.push({
      entryRange,
      titleRange,
      trailerDimRanges,
      labelRanges,
      blockquoteRanges,
    });
  }

  return { entries: out };
}

function collectAllowedLabels(
  profile: EffectiveProfile | undefined,
): Set<string> | undefined {
  if (!profile) return undefined;
  const names = new Set<string>();
  for (const [name] of profile.labels) names.add(name);
  return names.size > 0 ? names : undefined;
}

function computeTitleRange(
  entry: Entry,
  lines: readonly string[],
): Range | undefined {
  const lineIndex = entry.location.line - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) return undefined;
  const m = TITLE_LINE_RE.exec(lines[lineIndex]);
  if (!m) return undefined;
  const titleStart = m[1].length + m[2].length + m[3].length;
  const titleEnd = titleStart + m[4].length;
  return {
    start: { line: lineIndex, character: titleStart },
    end: { line: lineIndex, character: titleEnd },
  };
}

function computeDimRanges(
  trailerLines: readonly TrailerLine[],
  lines: readonly string[],
): Range[] {
  const out: Range[] = [];
  for (const tl of trailerLines) {
    const line = lines[tl.lineIndex];
    // Id is the entry's own identity, not a cross-reference — dim the
    // whole line with no holes (matches semantic_tokens.ts).
    if (tl.key === "Id") {
      out.push({
        start: { line: tl.lineIndex, character: 0 },
        end: { line: tl.lineIndex, character: line.length },
      });
      continue;
    }
    // Labels: dim only the key prefix; the label values themselves stay
    // bright so the pill decoration overlay has legible text inside.
    if (tl.key === "Labels") {
      if (tl.valueStart > 0) {
        out.push({
          start: { line: tl.lineIndex, character: 0 },
          end: { line: tl.lineIndex, character: tl.valueStart },
        });
      }
      continue;
    }
    // Build dim sub-ranges by removing each idRange from the full line.
    let cursor = 0;
    const sortedIds = [...tl.idRanges].sort((a, b) => a.start - b.start);
    for (const id of sortedIds) {
      if (id.start > cursor) {
        out.push({
          start: { line: tl.lineIndex, character: cursor },
          end: { line: tl.lineIndex, character: id.start },
        });
      }
      cursor = id.start + id.length;
    }
    if (cursor < line.length) {
      out.push({
        start: { line: tl.lineIndex, character: cursor },
        end: { line: tl.lineIndex, character: line.length },
      });
    }
  }
  return out;
}

function computeLabelRanges(
  trailerLines: readonly TrailerLine[],
  lines: readonly string[],
  allowedLabels: Set<string> | undefined,
  diagnostics: readonly Diagnostic[],
  file: string,
): LabelRange[] {
  const out: LabelRange[] = [];
  for (const tl of trailerLines) {
    if (tl.key !== "Labels") continue;
    const line = lines[tl.lineIndex];
    const value = line.slice(tl.valueStart, tl.valueStart + tl.valueLength);
    let segStart = 0;
    for (let i = 0; i <= value.length; i++) {
      if (i === value.length || value[i] === ",") {
        const segText = value.slice(segStart, i);
        const trimmed = segText.trim();
        if (trimmed.length > 0) {
          const leading = segText.indexOf(trimmed);
          const start = tl.valueStart + segStart + leading;
          const end = start + trimmed.length;
          const valid = !allowedLabels || allowedLabels.has(trimmed);
          const diag = !valid
            ? findDiagnosticAt(diagnostics, file, tl.lineIndex, start, end)
            : undefined;
          out.push({
            range: {
              start: { line: tl.lineIndex, character: start },
              end: { line: tl.lineIndex, character: end },
            },
            valid,
            diagnostic: diag,
          });
        }
        segStart = i + 1;
      }
    }
  }
  return out;
}

function findDiagnosticAt(
  diagnostics: readonly Diagnostic[],
  file: string,
  lineIndex: number,
  startChar: number,
  endChar: number,
): string | undefined {
  for (const d of diagnostics) {
    if (!d.location || d.location.file !== file) continue;
    const dl = d.location.line - 1;
    if (dl !== lineIndex) continue;
    const dc = d.location.column - 1;
    if (dc >= startChar && dc < endChar) {
      return d.message;
    }
  }
  return undefined;
}

/** Pattern matching a blockquote line: optional indent, then `>` then space-or-EOL. */
const BLOCKQUOTE_LINE_RE = /^\s*>(\s|$)/;

/**
 * Detect the admonition kind from a blockquote's first line. Returns
 * the canonical lowercase kind for `> [!NOTE]` / `[!TIP]` /
 * `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` markers (case-insensitive
 * marker per GFM spec), or `"plain"` for any other first-line content.
 */
const ADMONITION_MARKER_RE =
  /^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;

function classifyBlockquoteFirstLine(line: string): BlockquoteKind {
  const m = ADMONITION_MARKER_RE.exec(line);
  if (!m) return "plain";
  return m[1].toLowerCase() as BlockquoteKind;
}

/**
 * Locate the `[!KIND]` marker substring on a blockquote's first line.
 * Returns the marker's start/end columns (covering the `[` through
 * the `]`) so the client can decorate just that token.
 */
function locateMarker(
  line: string,
): { start: number; end: number } | undefined {
  // Match `[!KIND]` in isolation; the surrounding `> ` and trailing
  // whitespace are bracketed by the broader ADMONITION_MARKER_RE check.
  const re = /\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
  const m = re.exec(line);
  if (!m) return undefined;
  return { start: m.index, end: m.index + m[0].length };
}

/**
 * Scan entry body for contiguous blockquote runs and classify each by
 * its admonition marker. Body is bounded by the entry's title and the
 * first trailer line (so trailer attributes and inter-entry prose are
 * never classified as blockquotes).
 */
function computeBlockquoteRanges(
  entry: Entry,
  lines: readonly string[],
  trailerLines: readonly TrailerLine[],
  endLineExclusive: number,
): BlockquoteRange[] {
  const bodyEndExclusive = trailerLines.length > 0
    ? trailerLines[0].lineIndex
    : endLineExclusive;
  const startIndex = entry.location.line;
  const out: BlockquoteRange[] = [];
  let blockStart: number | undefined;
  let blockKind: BlockquoteKind = "plain";
  const flushBlock = (endLineIndex: number): void => {
    if (blockStart === undefined) return;
    const range: Range = {
      start: { line: blockStart, character: 0 },
      end: { line: endLineIndex, character: lines[endLineIndex].length },
    };
    let markerRange: Range | undefined;
    if (blockKind !== "plain") {
      const marker = locateMarker(lines[blockStart]);
      if (marker) {
        markerRange = {
          start: { line: blockStart, character: marker.start },
          end: { line: blockStart, character: marker.end },
        };
      }
    }
    out.push({ range, kind: blockKind, markerRange });
    blockStart = undefined;
    blockKind = "plain";
  };
  for (let i = startIndex; i < bodyEndExclusive && i < lines.length; i++) {
    const line = lines[i];
    const isQuote = BLOCKQUOTE_LINE_RE.test(line);
    if (isQuote) {
      if (blockStart === undefined) {
        blockStart = i;
        blockKind = classifyBlockquoteFirstLine(line);
      }
      continue;
    }
    if (blockStart !== undefined) flushBlock(i - 1);
  }
  if (blockStart !== undefined) {
    flushBlock(Math.min(bodyEndExclusive, lines.length) - 1);
  }
  return out;
}

/**
 * Compute the full entry-block range: title line through last trailer
 * line. When no trailer exists, the entry is treated as a single-line
 * block (just the title). Used by the client to paint a card-style
 * background behind the entire entry.
 */
function computeEntryRange(
  entry: Entry,
  lines: readonly string[],
  trailerLines: readonly TrailerLine[],
  endLineExclusive: number,
): Range {
  const startLine = Math.max(0, entry.location.line - 1);
  const endLine = trailerLines.length > 0
    ? trailerLines[trailerLines.length - 1].lineIndex
    : Math.min(endLineExclusive, lines.length) - 1;
  const safeEndLine = Math.max(startLine, endLine);
  const endCol = lines[safeEndLine]?.length ?? 0;
  return {
    start: { line: startLine, character: 0 },
    end: { line: safeEndLine, character: endCol },
  };
}
