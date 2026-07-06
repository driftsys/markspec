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

import type { Entry, SourceLocation } from "../core/model/mod.ts";
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
 * Convert a raw `SourceLocation` (1-based line/column) to an LSP
 * `Location` (URI + zero-based, zero-width range). Shared by
 * `entryToLspLocation` (below) and the uxil go-to-declaration path
 * (`SurfaceRecord.location`, S10 #728), which has no `Entry` to hang
 * off of.
 */
export function sourceLocationToLspLocation(loc: SourceLocation): LspLocation {
  const line = Math.max(0, loc.line - 1);
  const character = Math.max(0, loc.column - 1);
  return {
    uri: pathToUri(loc.file),
    range: {
      start: { line, character },
      end: { line, character },
    },
  };
}

/**
 * Convert an Entry's source location to an LSP `Location` pointing at
 * the entry's start (zero-width range). 1-based core line/column are
 * shifted to 0-based per the LSP spec.
 */
export function entryToLspLocation(entry: Entry): LspLocation {
  return sourceLocationToLspLocation(entry.location);
}

/**
 * Whether an entry has a location that can be opened in this workspace.
 * Upstream entries (federated corpus) live in another repository and carry
 * a tree-relative `location.file` that pathToUri cannot convert — they have
 * no navigable local location. Project + delivered-corpus entries always do.
 */
export function hasNavigableLocation(entry: Entry): boolean {
  return !isUpstreamEntry(entry);
}

/**
 * Resolve the navigable target for an entry — used by both go-to-definition
 * and find-references. Returns the entry's LSP `Location` for project- and
 * delivered-corpus-authored entries; `null` for a locked upstream entry
 * (federated-upstream slice 5) whose `location.file` is a path inside the
 * upstream repo that does not exist in this workspace — navigating there
 * would open a non-existent file, and converting it via `pathToUri` would
 * throw (#783). Delivered corpus (`kind:"profile"`) keeps working: its file
 * is a real local `.markspec/cache/…` path. Total — never throws on an
 * upstream entry.
 */
export function resolveNavigableLocation(entry: Entry): LspLocation | null {
  return hasNavigableLocation(entry) ? entryToLspLocation(entry) : null;
}
