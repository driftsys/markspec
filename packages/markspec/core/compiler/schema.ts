/**
 * @module schema
 *
 * Serialization helper that converts {@linkcode CompileResult} (which uses
 * Maps) to a plain JSON-serializable object suitable for export and
 * interchange.
 */

import type { CompileResult } from "./mod.ts";
import type { Diagnostic, Entry, Link } from "../model/mod.ts";

/**
 * Serialized form of {@linkcode CompileResult}.
 *
 * All `ReadonlyMap` fields are converted to plain objects keyed by display ID.
 * Arrays and scalar fields are passed through unchanged.
 */
export interface SerializedCompileResult {
  /** Entries keyed by display ID. */
  readonly entries: Record<string, Entry>;
  /** All traceability links. */
  readonly links: readonly Link[];
  /** Outgoing links per entry (entry -> targets). */
  readonly forward: Record<string, readonly Link[]>;
  /** Incoming links per entry (entry -> sources pointing to it). */
  readonly reverse: Record<string, readonly Link[]>;
  /** Diagnostics from parsing and validation. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Convert a {@linkcode CompileResult} to a plain JSON-serializable object.
 *
 * Maps are converted to `Record` objects keyed by display ID; arrays and
 * scalars pass through unchanged.
 *
 * @param result - The compiled project output
 * @returns A plain object safe for `JSON.stringify`
 */
export function serializeCompileResult(
  result: CompileResult,
): SerializedCompileResult {
  return {
    entries: Object.fromEntries(result.entries),
    links: result.links,
    forward: Object.fromEntries(result.forward),
    reverse: Object.fromEntries(result.reverse),
    diagnostics: result.diagnostics,
  };
}
