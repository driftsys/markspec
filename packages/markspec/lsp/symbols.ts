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
import { hasNavigableLocation } from "./definition.ts";
import { pathToUri } from "./util.ts";

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
/** A subset of the LSP `SymbolInformation` interface. */
export interface SymbolInformation {
  readonly name: string;
  readonly kind: number;
  readonly location: {
    readonly uri: string;
    readonly range: {
      readonly start: { readonly line: number; readonly character: number };
      readonly end: { readonly line: number; readonly character: number };
    };
  };
  readonly containerName?: string;
}

/**
 * Filter and project the workspace's entries to LSP
 * `SymbolInformation[]` for the `workspace/symbol` request.
 *
 * `query` is matched case-insensitively as a substring against both
 * the entry's display ID and its title; an empty query matches every
 * entry. `containerName` carries the title so editor results lists
 * still show both pieces of identifying info.
 */
export function entriesToWorkspaceSymbols(
  entries: readonly Entry[],
  query: string,
): SymbolInformation[] {
  const needle = query.toLowerCase();
  const out: SymbolInformation[] = [];
  for (const entry of entries) {
    // Upstream entries (federated corpus, #783) have no navigable local
    // location — their location.file is a tree-relative path pathToUri
    // cannot convert. Omit them rather than throwing.
    if (!hasNavigableLocation(entry)) continue;
    if (needle.length > 0) {
      const matches = entry.displayId.toLowerCase().includes(needle) ||
        entry.title.toLowerCase().includes(needle);
      if (!matches) continue;
    }
    const line = Math.max(0, entry.location.line - 1);
    const character = Math.max(0, entry.location.column - 1);
    const position = { line, character };
    out.push({
      name: entry.displayId,
      kind: SymbolKindClass,
      location: {
        uri: pathToUri(entry.location.file),
        range: { start: position, end: position },
      },
      containerName: entry.title,
    });
  }
  return out;
}

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
