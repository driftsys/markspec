/**
 * @module core/validator/captions
 *
 * Caption-adjacency validation per spec §2.6. Captions are recognised
 * in entry body prose and must sit immediately above or below a
 * captionable block of the matching type (separated by exactly one
 * blank line).
 */

import type { Diagnostic, Entry } from "../model/mod.ts";
import { FENCE_RE } from "../util/fence.ts";

/** Caption keywords recognised by the core. */
const CAPTION_KEYWORDS = [
  "Figure",
  "Table",
  "Listing",
  "Feature",
  "Equation",
  "List",
] as const;
type CaptionKeyword = typeof CAPTION_KEYWORDS[number];

/** Line shape for a caption: `Keyword: text`. */
const CAPTION_LINE_RE = new RegExp(
  `^\\s*(${CAPTION_KEYWORDS.join("|")}):\\s+(\\S.*)$`,
);

/** Heuristic captionable-block matchers keyed by caption keyword. */
const captionableMatchers: Record<CaptionKeyword, (line: string) => boolean> = {
  // Image inline link.
  Figure: (l) => /^\s*!\[/.test(l),
  // GFM pipe table (any line with a pipe — first-pass heuristic).
  Table: (l) => /\|/.test(l),
  // Fenced code block (any language).
  Listing: (l) => FENCE_RE.test(l),
  // Gherkin-tagged fenced code block; the loose check is fence-only
  // because the language tag is on the opening fence line — when the
  // caption sits BELOW the block, only the closing fence is the
  // adjacent line and that line has no tag. Tightening to require
  // `gherkin` would produce false MSL-C071s for valid caption-below
  // placements. A future cleaner fix would pre-scan fence pairs to
  // attach language metadata to both opener and closer.
  Feature: (l) => FENCE_RE.test(l),
  // Math fence (`$$`).
  Equation: (l) => /^\s*\$\$/.test(l),
  // Markdown list (ordered or unordered).
  List: (l) => /^\s*([-*+]|\d+\.)\s/.test(l),
};

/**
 * Return the caption keyword whose matcher recognises the given line,
 * or `undefined` when no matcher fires. Used to distinguish a
 * "captionable but wrong type" mismatch from an orphan caption. When
 * multiple matchers fire (e.g., a fenced code block matches both
 * `Listing` and `Feature`), the first declaration order wins —
 * sufficient for MSL-C071 detection because the test "did the caption
 * keyword's own matcher fire" runs first.
 */
function classifyAdjacentBlock(line: string): CaptionKeyword | undefined {
  for (const kw of CAPTION_KEYWORDS) {
    if (captionableMatchers[kw](line)) return kw;
  }
  return undefined;
}

/**
 * Validate caption adjacency for one entry. Emits `MSL-C070` for any
 * caption line whose immediate non-blank neighbour (above or below) is
 * not a captionable block of the matching type.
 *
 * Skip rules:
 * - Lines inside fenced code blocks — captions in verbatim content
 *   are not real captions.
 */
export function validateCaptions(entry: Entry): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = entry.body.split("\n");
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = CAPTION_LINE_RE.exec(lines[i]);
    if (!match) continue;
    const keyword = match[1] as CaptionKeyword;
    const matcher = captionableMatchers[keyword];

    // Walk to the nearest non-blank line above.
    let above = i - 1;
    while (above >= 0 && lines[above].trim() === "") above--;
    const aboveBlock = above >= 0 && matcher(lines[above]);
    const aboveKind = above >= 0
      ? classifyAdjacentBlock(lines[above])
      : undefined;

    // Walk to the nearest non-blank line below.
    let below = i + 1;
    while (below < lines.length && lines[below].trim() === "") below++;
    const belowBlock = below < lines.length && matcher(lines[below]);
    const belowKind = below < lines.length
      ? classifyAdjacentBlock(lines[below])
      : undefined;

    if (aboveBlock || belowBlock) continue;

    // No matching block adjacent. Decide between C070 (no captionable
    // block at all) and C071 (a captionable block of the wrong type).
    const mismatchKind = aboveKind ?? belowKind;
    if (mismatchKind !== undefined) {
      diagnostics.push({
        code: "MSL-C071",
        severity: "error",
        message: `${entry.displayId}: ${keyword}: caption is adjacent to a ` +
          `${mismatchKind} block, not a ${keyword} block (spec §4.7)`,
        location: {
          file: entry.location.file,
          line: entry.location.line + 1 + i,
          column: 1,
        },
      });
      continue;
    }

    diagnostics.push({
      code: "MSL-C070",
      severity: "error",
      message: `${entry.displayId}: ${keyword}: caption is not adjacent to a ` +
        `captionable block of type ${keyword}`,
      location: {
        file: entry.location.file,
        // Body content begins on the line after the entry title.
        line: entry.location.line + 1 + i,
        column: 1,
      },
    });
  }

  return diagnostics;
}
