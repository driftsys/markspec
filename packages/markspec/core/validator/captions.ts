/**
 * @module core/validator/captions
 *
 * Caption-adjacency validation per spec §2.6. Captions are recognised
 * in entry body prose and must sit immediately above or below a
 * captionable block of the matching type (separated by exactly one
 * blank line).
 */

import type { Diagnostic, Entry } from "../model/mod.ts";

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

/** Fence open/close marker for ``` and ~~~ blocks. */
const FENCE_RE = /^\s*(```|~~~)/;

/** Heuristic captionable-block matchers keyed by caption keyword. */
const captionableMatchers: Record<CaptionKeyword, (line: string) => boolean> = {
  // Image inline link.
  Figure: (l) => /^\s*!\[/.test(l),
  // GFM pipe table (any line with a pipe — first-pass heuristic).
  Table: (l) => /\|/.test(l),
  // Fenced code block (any language).
  Listing: (l) => FENCE_RE.test(l),
  // Gherkin-tagged fenced code block; the loose check is fence-only
  // because the language tag is on the opening fence line.
  Feature: (l) => FENCE_RE.test(l),
  // Math fence (`$$`).
  Equation: (l) => /^\s*\$\$/.test(l),
  // Markdown list (ordered or unordered).
  List: (l) => /^\s*([-*+]|\d+\.)\s/.test(l),
};

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

    // Walk to the nearest non-blank line below.
    let below = i + 1;
    while (below < lines.length && lines[below].trim() === "") below++;
    const belowBlock = below < lines.length && matcher(lines[below]);

    if (aboveBlock || belowBlock) continue;

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
