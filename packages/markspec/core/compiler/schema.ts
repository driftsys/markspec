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
  const rawEntries = Object.fromEntries(result.entries);
  const entries: Record<string, Entry> = {};
  for (const [key, entry] of Object.entries(rawEntries)) {
    entries[key] = serializeEntry(entry);
  }
  return {
    entries,
    links: result.links,
    forward: Object.fromEntries(result.forward),
    reverse: Object.fromEntries(result.reverse),
    diagnostics: result.diagnostics,
  };
}

/**
 * Convert an {@linkcode Entry} to a JSON-safe form by replacing
 * `typedAttributes` (a `ReadonlyMap`) with a plain object, and stripping
 * `properties.sync` (privacy rule — never publish connector state).
 */
export function serializeEntry(entry: Entry): Entry {
  let result: Entry = entry;

  if (entry.typedAttributes && entry.typedAttributes.size > 0) {
    const typedObj = Object.fromEntries(entry.typedAttributes);
    result = {
      ...result,
      typedAttributes: typedObj as unknown as Entry["typedAttributes"],
    };
  }

  if (result.properties?.sync !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { sync: _sync, ...rest } = result.properties;
    const strippedProperties = Object.keys(rest).length > 0 ? rest : undefined;
    result = { ...result, properties: strippedProperties };
  }

  return result;
}
