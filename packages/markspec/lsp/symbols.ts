/**
 * @module lsp/symbols
 *
 * Document-symbol helper. Converts a file's parsed Entry list into
 * the `DocumentSymbol[]` payload the LSP outline view consumes.
 *
 * The server module composes this with the workspace index to
 * implement `connection.onDocumentSymbol`.
 */

import type { Entry } from "../core/model/mod.ts";

/** LSP `SymbolKind.Class` numeric constant. */
export const SymbolKindClass = 5;

/** A subset of the LSP `DocumentSymbol` interface. */
export interface DocumentSymbol {
  readonly name: string;
  readonly detail?: string;
  readonly kind: number;
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly selectionRange: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
}

/**
 * Build a DocumentSymbol list for a single file's entries. Each entry
 * becomes a top-level symbol named by its display ID, with `detail`
 * carrying the title (and resolved type, when set).
 *
 * Ranges and selection ranges are zero-width cursors at the entry's
 * start. A future iteration could compute a true range covering the
 * full entry block — for now the cursor placement is enough for
 * outline navigation.
 */
export function entriesToDocumentSymbols(
  entries: readonly Entry[],
): DocumentSymbol[] {
  return entries.map((entry) => {
    const line = Math.max(0, entry.location.line - 1);
    const character = Math.max(0, entry.location.column - 1);
    const position = { line, character };
    const detail = entry.type ? `${entry.type} — ${entry.title}` : entry.title;
    return {
      name: entry.displayId,
      detail,
      kind: SymbolKindClass,
      range: { start: position, end: position },
      selectionRange: { start: position, end: position },
    };
  });
}
