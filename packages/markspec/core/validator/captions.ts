/**
 * @module core/validator/captions
 *
 * Caption-adjacency validation per spec §2.6. Emits `MSL-C070` for
 * orphaned captions (no captionable neighbour) and `MSL-C071` for
 * wrong-type adjacency. The builder emits `CaptionNode` blocks with a
 * `keyword` field (Figure, Table, etc.) and a `position` hint
 * ("above"/"below"); the validator checks each caption against its
 * nearest non-blank neighbour. Captions inside verbatim blocks are
 * automatically excluded — the builder does not emit `CaptionNode`s for
 * verbatim content. The "Listing or Feature" ambiguity (a fenced block
 * without a lang tag is ambiguous) is preserved in the mismatch message.
 */

import type { Diagnostic, Entry } from "../model/mod.ts";
import type { BodyBlock } from "../ast/nodes.ts";

/** Caption keywords recognised by the core (spec §2.6). */
const CAPTION_KEYWORDS = [
  "Figure",
  "Table",
  "Listing",
  "Feature",
  "Equation",
  "List",
] as const;
type CaptionKeyword = typeof CAPTION_KEYWORDS[number];

// ---------------------------------------------------------------------------
// Block-type → caption-keyword classification
// ---------------------------------------------------------------------------

/**
 * Map an AST block kind to the caption keyword whose captionable-block
 * this block represents, or `undefined` when the block is not captionable
 * (e.g. paragraph, unknown, note, blockquote, definition-list).
 *
 * `code` maps to `Listing` (first in the CAPTION_KEYWORDS order) — the
 * ambiguity with `Feature`/Gherkin is handled by the caller which emits
 * "Listing or Feature (fenced)" for `CodeNode`.
 */
function blockKindToCaption(
  block: BodyBlock,
): CaptionKeyword | undefined {
  switch (block.kind) {
    case "figure":
      return "Figure";
    case "table":
      return "Table";
    case "code":
      return "Listing"; // possibly also Feature — ambiguous without lang tag
    case "feature":
      return "Feature";
    case "math":
      return "Equation";
    case "list":
      return "List";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate caption adjacency for one entry. Emits `MSL-C070` for any
 * caption whose nearest non-blank neighbour (above or below) is not a
 * captionable block of the matching type, and `MSL-C071` when there is
 * a captionable block of the *wrong* type adjacent.
 */
export function validateCaptions(entry: Entry): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const blocks = entry.bodyAst ?? [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.kind !== "caption") continue;

    const keyword = block.keyword as CaptionKeyword; // safe: CaptionNode.keyword and CaptionKeyword are the same 6-string set

    // Immediate preceding block (no caption-skipping — a CaptionNode
    // neighbour is not a captionable block, matching baseline semantics).
    const prevIdx = i - 1;
    const prevBlock = prevIdx >= 0 ? blocks[prevIdx] : undefined;

    // Immediate following block (no caption-skipping — same rationale).
    const nextIdx = i + 1;
    const nextBlock = nextIdx < blocks.length ? blocks[nextIdx] : undefined;

    // Check if either neighbour is a captionable block of the matching type.
    const prevKind = prevBlock ? blockKindToCaption(prevBlock) : undefined;
    const nextKind = nextBlock ? blockKindToCaption(nextBlock) : undefined;

    // A `CodeNode` may be either Listing or Feature (Gherkin) — both
    // `blockKindToCaption` returns "Listing" for `code`, so a `Feature:`
    // caption below a `CodeNode` block is considered matching (the
    // closing fence has no lang tag; we can't distinguish at this point).
    const prevMatches = prevBlock !== undefined &&
      (prevKind === keyword ||
        (keyword === "Feature" && prevBlock.kind === "code") ||
        (keyword === "Listing" && prevBlock.kind === "feature"));
    const nextMatches = nextBlock !== undefined &&
      (nextKind === keyword ||
        (keyword === "Feature" && nextBlock.kind === "code") ||
        (keyword === "Listing" && nextBlock.kind === "feature"));

    if (prevMatches || nextMatches) {
      // Adjacent to a matching captionable block — valid.
      continue;
    }

    // No matching block adjacent. Decide between C070 (orphan) and C071
    // (wrong-type adjacency).
    const mismatchKind = prevKind ?? nextKind;
    const mismatchBlock = mismatchKind !== undefined
      ? (prevKind !== undefined ? prevBlock : nextBlock)
      : undefined;

    // File line: body-relative 1-based start line → entry.location.line + bodyLine
    const fileLine = entry.location.line + block.range.start.line;

    if (mismatchKind !== undefined && mismatchBlock !== undefined) {
      // Listing and Feature share a fence-only matcher — a CodeNode or
      // FeatureNode is ambiguous without the opening fence's language tag.
      const mismatchLabel =
        mismatchBlock.kind === "code" || mismatchBlock.kind === "feature"
          ? "Listing or Feature (fenced)"
          : mismatchKind;
      diagnostics.push({
        code: "MSL-C071",
        severity: "error",
        message: `${entry.displayId}: ${keyword}: caption is adjacent to a ` +
          `${mismatchLabel} block, not a ${keyword} block (spec §4.7)`,
        location: {
          file: entry.location.file,
          line: fileLine,
          column: 1,
        },
      });
    } else {
      diagnostics.push({
        code: "MSL-C070",
        severity: "error",
        message:
          `${entry.displayId}: ${keyword}: caption is not adjacent to a ` +
          `captionable block of type ${keyword}`,
        location: {
          file: entry.location.file,
          line: fileLine,
          column: 1,
        },
      });
    }
  }

  return diagnostics;
}
