/**
 * @module mcp/uri
 *
 * The `markspec://` URI scheme used by the MCP server. Three resource
 * families:
 *
 * - `markspec://profile`               — the distilled profile manifest
 * - `markspec://entries`               — the entry index
 * - `markspec://entry/{displayId}`     — a single entry
 *
 * All helpers are pure and safe to import from any module.
 */

/** Canonical URI of the profile resource. */
export const PROFILE_URI = "markspec://profile";

/** Canonical URI of the entries-index resource. */
export const ENTRIES_URI = "markspec://entries";

/** Prefix for per-entry resource URIs. */
export const ENTRY_URI_PREFIX = "markspec://entry/";

/** Build an entry resource URI from a display ID. */
export function entryUri(displayId: string): string {
  return `${ENTRY_URI_PREFIX}${encodeURIComponent(displayId)}`;
}

/**
 * Extract the display ID from a `markspec://entry/...` URI.
 * Returns `undefined` for any URI that is not a non-empty entry URI.
 */
export function parseEntryUri(uri: string): string | undefined {
  if (!uri.startsWith(ENTRY_URI_PREFIX)) return undefined;
  const encoded = uri.slice(ENTRY_URI_PREFIX.length);
  if (encoded.length === 0) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

/** Check whether a URI is a well-formed entry URI. */
export function isEntryUri(uri: string): boolean {
  return parseEntryUri(uri) !== undefined;
}
