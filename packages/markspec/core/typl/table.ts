/**
 * @module typl/table
 *
 * Table surface adapter (#724 / S6) — recognises typl declarations authored
 * as GFM table data rows. A thin wrapper over the shared declaration-surface
 * machinery (core/decl): each data row `$name | kind shape | description` is
 * reduced to the declaration source `$name : kind shape` (the `description`
 * column is human documentation and is dropped, since a typl binding carries
 * no description), then parsed like any other surface. Rows whose first cell
 * is not a typl name — or whose shape cell is empty — are skipped, so mixed
 * tables and malformed rows contribute nothing.
 *
 * A table's `Table:` caption may carry a base: {@linkcode typlTableCaptionBase}
 * reads an absolute typl name out of the caption text, which
 * {@linkcode extractTyplTable}'s caller (assemble) hands to the entry-local
 * resolver (S4) so relative rows (`$.x`) resolve against it. Only bindings are
 * expressed in tables; typedefs (`type X = …`) keep their fence / bullet /
 * inline surfaces.
 *
 * See ADR-019.
 */

import type { BodyBlock } from "../ast/nodes.ts";
import {
  extractTableDeclarations,
  type RowRecognizer,
  type TableRowDeclaration,
} from "../decl/mod.ts";
import { isTyplDeclarationText } from "./recognize.ts";
import { typlPathOf } from "./resolve.ts";

/** A single typl table-row declaration: `{ source, range, captionText? }`. */
export type TyplTableExtraction = TableRowDeclaration;

/**
 * An absolute typl name (sigil + ≥1 dotted segments, no leading dot): the
 * only shape a `Table:` caption base may take. Mirrors `isPublishedTyplName`
 * but also admits a single-segment name (`$vehicle`) — a caption base need
 * not be dotted.
 */
const ABSOLUTE_TYPL_NAME_RE = /^\$[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/;

/**
 * Reduce a table data row to a typl declaration source, or `undefined` to
 * skip the row. The first cell supplies the binding name (`$name`), the
 * second the kind + shape; the remaining cells (a description) are dropped.
 * Returns `undefined` when the reconstructed `$name : kind shape` is not a
 * typl declaration (non-typl row) or when either required cell is empty
 * (malformed row).
 */
export const typlTableRowRecognizer: RowRecognizer = (cells) => {
  const name = cells[0]?.trim() ?? "";
  const decl = cells[1]?.trim() ?? "";
  if (name === "" || decl === "") return undefined;
  const source = `${name} : ${decl}`;
  return isTyplDeclarationText(source) ? source : undefined;
};

/**
 * Parse a base path out of a `Table:` caption's text, or `undefined` when
 * the caption carries no typl base. The base is the caption's leading
 * whitespace-delimited token when it is an absolute typl name; a trailing
 * description (`$powertrain.brake — brake signals`) is ignored. Relative
 * names (`$.x`) are not bases — they would need a base themselves — and a
 * non-typl caption yields no base. The `$` sigil is stripped, matching the
 * base paths the entry-local resolver joins against.
 */
export function typlTableCaptionBase(
  captionText: string,
): string | undefined {
  const first = captionText.trim().split(/\s+/)[0] ?? "";
  return ABSOLUTE_TYPL_NAME_RE.test(first) ? typlPathOf(first) : undefined;
}

/**
 * Walk a body AST and return a declaration for every table data row that is
 * a typl binding, in source order (recursing into list-nested tables).
 * Delegates traversal to {@linkcode extractTableDeclarations}; each result
 * carries the enclosing table's `captionText` when present.
 */
export function extractTyplTable(
  blocks: readonly BodyBlock[],
): readonly TyplTableExtraction[] {
  return extractTableDeclarations(blocks, typlTableRowRecognizer);
}
