/**
 * @module schema
 *
 * Serialization helper that converts {@linkcode CompileResult} (which uses
 * Maps) to a plain JSON-serializable object suitable for export and
 * interchange.
 */

import type { CompileResult } from "./mod.ts";
import type { Diagnostic, Entry, EntryOrigin, Link } from "../model/mod.ts";
import type { RegistryBinding, RegistryTypedef } from "../typl/mod.ts";

/**
 * JSON-serializable form of {@linkcode Entry}.
 *
 * Identical to `Entry` except `typedAttributes` is a plain
 * `Record<string, readonly string[]>` instead of a `ReadonlyMap` — Maps are
 * not JSON-serializable. All other fields are passed through unchanged.
 *
 * `origin` (ADR-029) is restated explicitly here — rather than relying on
 * the `Omit<Entry, ...>` passthrough — so the field-presence contract is
 * documented at the serialization boundary: present verbatim on entries
 * injected from a profile-delivered corpus, absent (not `null`) on
 * project-authored entries.
 */
export type SerializedEntry = Omit<Entry, "typedAttributes"> & {
  readonly typedAttributes?: Record<string, readonly string[]>;
  readonly origin?: EntryOrigin;
};

/**
 * Serialized form of the {@linkcode TypeRegistry}.
 *
 * `ReadonlyMap` fields are converted to plain objects so the result is
 * JSON-serializable.
 */
export interface SerializedTypeRegistry {
  /** Keyed by $Name (including leading `$`). */
  readonly bindings: Record<string, readonly RegistryBinding[]>;
  /** Keyed by typedef name (no `$`). */
  readonly typedefs: Record<string, readonly RegistryTypedef[]>;
}

/**
 * Serialized form of {@linkcode CompileResult}.
 *
 * All `ReadonlyMap` fields are converted to plain objects keyed by display ID.
 * Arrays and scalar fields are passed through unchanged.
 */
export interface SerializedCompileResult {
  /** Entries keyed by display ID. */
  readonly entries: Record<string, SerializedEntry>;
  /** All traceability links. */
  readonly links: readonly Link[];
  /** Outgoing links per entry (entry -> targets). */
  readonly forward: Record<string, readonly Link[]>;
  /** Incoming links per entry (entry -> sources pointing to it). */
  readonly reverse: Record<string, readonly Link[]>;
  /** Diagnostics from parsing and validation. */
  readonly diagnostics: readonly Diagnostic[];
  /** Corpus-wide typl type registry. */
  readonly typeRegistry: SerializedTypeRegistry;
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
  const entries: Record<string, SerializedEntry> = {};
  for (const [key, entry] of result.entries) {
    entries[key] = serializeEntry(entry);
  }
  return {
    entries,
    links: result.links,
    forward: Object.fromEntries(result.forward),
    reverse: Object.fromEntries(result.reverse),
    diagnostics: result.diagnostics,
    typeRegistry: serializeTypeRegistry(result.typeRegistry),
  };
}

/**
 * Convert the {@linkcode TypeRegistry} Maps to plain objects for
 * JSON serialization. `ReadonlyMap` serializes as `{}` in `JSON.stringify`,
 * so explicit conversion is required.
 */
function serializeTypeRegistry(
  registry: CompileResult["typeRegistry"],
): SerializedTypeRegistry {
  return {
    bindings: Object.fromEntries(registry.bindings),
    typedefs: Object.fromEntries(registry.typedefs),
  };
}

/**
 * Convert an {@linkcode Entry} to a JSON-safe {@linkcode SerializedEntry} by
 * replacing `typedAttributes` (a `ReadonlyMap`) with a plain
 * `Record<string, readonly string[]>`, and stripping `properties.sync`
 * (privacy rule — never publish connector state).
 */
export function serializeEntry(entry: Entry): SerializedEntry {
  // Replace the ReadonlyMap with a plain Record when populated; omit when empty
  // so JSON output stays compact.
  const typedAttributes: Record<string, readonly string[]> | undefined =
    entry.typedAttributes && entry.typedAttributes.size > 0
      ? Object.fromEntries(entry.typedAttributes)
      : undefined;

  // Strip properties.sync (connector state must not be published).
  let properties = entry.properties;
  if (properties?.sync !== undefined) {
    const { sync: _sync, ...rest } = properties;
    properties = Object.keys(rest).length > 0 ? rest : undefined;
  }

  // Pull `origin` (ADR-029) out of the spread so the key is entirely
  // absent — not `origin: undefined` — on entries that did not come
  // from a delivered corpus, matching the serialized-field-presence
  // contract. Object rest destructuring drops the named key regardless
  // of its value, unlike `...entry` alone.
  const { origin, ...rest } = entry;

  return {
    ...rest,
    typedAttributes,
    properties,
    ...(origin ? { origin } : {}),
  };
}
