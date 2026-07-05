/**
 * @module lsp/definition
 *
 * Go-to-definition helper. Converts an Entry's core `SourceLocation`
 * (file path with 1-based line/column) into an LSP `Location` (URI
 * with zero-based range). The range is a zero-width cursor placed at
 * the entry's start so editors land on the title line without an
 * incidental selection.
 *
 * The server module composes this with `displayIdAtPosition` (from
 * `hover.ts`) and the workspace index to implement `onDefinition`.
 */

import type { Entry } from "../core/model/mod.ts";
import { isUpstreamEntry } from "../core/mod.ts";
import { pathToUri } from "./util.ts";

/** A subset of the LSP `Location` type — sufficient for `onDefinition`. */
export interface LspLocation {
  readonly uri: string;
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
}

/**
 * Convert an Entry's source location to an LSP `Location` pointing at
 * the entry's start (zero-width range). 1-based core line/column are
 * shifted to 0-based per the LSP spec.
 */
export function entryToLspLocation(entry: Entry): LspLocation {
  const line = Math.max(0, entry.location.line - 1);
  const character = Math.max(0, entry.location.column - 1);
  return {
    uri: pathToUri(entry.location.file),
    range: {
      start: { line, character },
      end: { line, character },
    },
  };
}

/**
 * Resolve the go-to-definition target for an entry. Returns the entry's
 * LSP `Location` for project- and delivered-corpus-authored entries;
 * `null` for a locked upstream entry (federated-upstream slice 5) whose
 * `location.file` is a path inside the upstream repo that does not exist
 * in this workspace — navigating there would open a non-existent file.
 * Delivered corpus (`kind:"profile"`) keeps working: its file is a real
 * local `.markspec/cache/…` path.
 */
export function resolveDefinitionLocation(entry: Entry): LspLocation | null {
  if (isUpstreamEntry(entry)) return null;
  return entryToLspLocation(entry);
}
