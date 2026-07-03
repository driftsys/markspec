/**
 * @module core/decl/table
 *
 * Table declaration surface (uxil epic #717 §A / S3). A fourth embedding
 * surface on the shared declaration machinery (alongside fence, bullet, and
 * inline): each **data row** of a GFM table is one declaration, and the
 * table's `Table:` caption may carry a base that the entry-local resolver
 * (S4) consumes.
 *
 * DSL-agnostic, like its siblings: the caller supplies a `rowToSource`
 * recognizer that maps a row's cell texts to a declaration source (or
 * `undefined` to skip a non-declaration / malformed row), and parses the
 * actual base ref out of the surfaced {@linkcode TableRowDeclaration.captionText}
 * itself — the caption's ref grammar is DSL-specific.
 *
 * Row positions: a {@linkcode TableNode} carries one range for the whole
 * table and its verbatim `raw` source, but rows have no individual range
 * (cells are stored as text only). Per-row ranges are therefore derived
 * from the table's start line plus the row's index, past the GFM header and
 * delimiter lines.
 */

import type {
  BodyBlock,
  CaptionNode,
  SourceRange,
  TableNode,
} from "../ast/nodes.ts";
import type { BlockDeclaration } from "./surfaces.ts";

/**
 * A declaration found on one data row of a table. Extends the shared
 * {@linkcode BlockDeclaration} (`source` = the row reduced to a declaration
 * by the DSL's recognizer; `range` = the row's line-precise span) with
 * `captionText`: the enclosing table's `Table:` caption text, when the table
 * has an adjacent one — the DSL parses a base ref out of it and hands that
 * to the resolver (S4).
 */
export interface TableRowDeclaration extends BlockDeclaration {
  /** The enclosing table's `Table:` caption text, if any. */
  readonly captionText?: string;
}

/**
 * Maps a data row's cell texts to a declaration source, or returns
 * `undefined` to skip the row (not a declaration, or malformed). The only
 * DSL-specific input to {@linkcode extractTableDeclarations}.
 */
export type RowRecognizer = (cells: readonly string[]) => string | undefined;

/** GFM layout offset: a data row at `rows[i]` sits `i` lines past the
 * header (line 0) and delimiter (line 1) rows in the table's raw source. */
const HEADER_AND_DELIMITER_LINES = 2;

/**
 * Walk a body AST and return a declaration for every table data row the
 * `rowToSource` recognizer accepts, in source order. Recurses into
 * container nodes (ListNode via ListItemNode.blocks) so tables nested
 * inside list items are found. Rows the recognizer skips (`undefined`)
 * contribute nothing — the malformed-row case.
 */
export function extractTableDeclarations(
  blocks: readonly BodyBlock[],
  rowToSource: RowRecognizer,
): readonly TableRowDeclaration[] {
  const results: TableRowDeclaration[] = [];
  walk(blocks, rowToSource, results);
  return results;
}

function walk(
  blocks: readonly BodyBlock[],
  rowToSource: RowRecognizer,
  out: TableRowDeclaration[],
): void {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.kind === "table") {
      const captionText = adjacentTableCaption(blocks, i);
      const rawLines = block.raw.split("\n");
      for (let r = 0; r < block.rows.length; r++) {
        const cells = block.rows[r].map((cell) => cell.text);
        const source = rowToSource(cells);
        if (source === undefined) continue;
        out.push({
          source,
          range: rowRange(block, rawLines, r),
          ...(captionText !== undefined ? { captionText } : {}),
        });
      }
    } else if (block.kind === "list") {
      for (const item of block.items) walk(item.blocks, rowToSource, out);
    }
  }
}

/**
 * Return the text of the `Table:` caption that captions the table at
 * `blocks[index]`, or `undefined` when there is none.
 *
 * Pairing is by local adjacency, re-deriving the above/below rule from the
 * neighbours rather than trusting `CaptionNode.position`: the builder assigns
 * `position` only for top-level blocks (`assignCaptionPositions` in
 * core/ast/build.ts), so a caption inside a list item keeps the default
 * `"below"` and cannot be trusted. A `Table:` caption immediately before the
 * table captions it (the table is the caption's next captionable block); one
 * immediately after captions it only when no captionable block follows the
 * caption — otherwise that caption belongs to the following block.
 */
function adjacentTableCaption(
  blocks: readonly BodyBlock[],
  index: number,
): string | undefined {
  const prev = blocks[index - 1];
  if (isTableCaption(prev)) return prev.text;
  const next = blocks[index + 1];
  if (isTableCaption(next) && !isCaptionable(blocks[index + 2])) {
    return next.text;
  }
  return undefined;
}

function isTableCaption(
  block: BodyBlock | undefined,
): block is CaptionNode {
  return block?.kind === "caption" && block.keyword === "Table";
}

/**
 * Block kinds a caption can caption (mirrors the captionable set in
 * `assignCaptionPositions`, core/ast/build.ts). Used to decide whether a
 * caption that follows a table belongs to that table or to a later
 * captionable block.
 */
function isCaptionable(block: BodyBlock | undefined): boolean {
  if (block === undefined) return false;
  switch (block.kind) {
    case "figure":
    case "table":
    case "code":
    case "feature":
    case "math":
    case "list":
      return true;
    default:
      return false;
  }
}

/**
 * The line-precise range of data row `rowIndex`. The table's `range.start`
 * is the header line; the data row sits `HEADER_AND_DELIMITER_LINES +
 * rowIndex` lines below it, at the table's start column. `raw` is de-indented
 * by `verbatimSlice`, so adding the de-indented row length to the table's
 * column yields the true source span — correct for both top-level (column 1)
 * and list-nested (indented) tables.
 */
function rowRange(
  table: TableNode,
  rawLines: readonly string[],
  rowIndex: number,
): SourceRange {
  const line = table.range.start.line + HEADER_AND_DELIMITER_LINES + rowIndex;
  const column = table.range.start.column;
  const rawLine = rawLines[HEADER_AND_DELIMITER_LINES + rowIndex] ?? "";
  return {
    start: { line, column },
    end: { line, column: column + rawLine.length },
  };
}
