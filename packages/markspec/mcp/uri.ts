/**
 * @module mcp/uri
 *
 * The `markspec://` URI scheme used by the MCP server. Five resource
 * families:
 *
 * - `markspec://profile`                    — the distilled profile manifest
 * - `markspec://entries`                    — the entry index
 * - `markspec://entry/{displayId}`          — a single entry
 * - `markspec://profile/{kind}/{name}`      — a profile element detail
 * - `markspec://delivered/{profileId}/{path}` — a profile-delivered document
 *   (ADR-030)
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

import type { ProfileElementKind } from "../core/mod.ts";

/** Prefix for profile detail resource URIs. */
export const PROFILE_DETAIL_URI_PREFIX = "markspec://profile/";

/**
 * Map between URI kind segment and ProfileElementKind.
 * `label-concern` is shortened to `label` in URIs for readability.
 */
const KIND_TO_SEGMENT: Record<ProfileElementKind, string> = {
  "type": "type",
  "attribute": "attribute",
  "relation": "relation",
  "label-concern": "label",
  "convention": "convention",
};

const SEGMENT_TO_KIND: Record<string, ProfileElementKind> = {
  "type": "type",
  "attribute": "attribute",
  "relation": "relation",
  "label": "label-concern",
  "convention": "convention",
};

/** Build a profile element detail URI: `markspec://profile/<kind-segment>/<name>`. */
export function profileDetailUri(
  kind: ProfileElementKind,
  name: string,
): string {
  const segment = KIND_TO_SEGMENT[kind];
  return `${PROFILE_DETAIL_URI_PREFIX}${segment}/${encodeURIComponent(name)}`;
}

/** Parse a profile detail URI. Returns `{kind, name}` or undefined. */
export function parseProfileDetailUri(
  uri: string,
): { kind: ProfileElementKind; name: string } | undefined {
  if (!uri.startsWith(PROFILE_DETAIL_URI_PREFIX)) return undefined;
  const rest = uri.slice(PROFILE_DETAIL_URI_PREFIX.length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx < 0) return undefined;
  const segment = rest.slice(0, slashIdx);
  const encoded = rest.slice(slashIdx + 1);
  if (encoded.length === 0) return undefined;
  const kind = SEGMENT_TO_KIND[segment];
  if (!kind) return undefined;
  try {
    return { kind, name: decodeURIComponent(encoded) };
  } catch {
    return undefined;
  }
}

/** Check whether a URI is a profile element detail URI (not the overview). */
export function isProfileDetailUri(uri: string): boolean {
  return parseProfileDetailUri(uri) !== undefined;
}

// ---------------------------------------------------------------------------
// Delivered-document URIs (ADR-030)
// ---------------------------------------------------------------------------

/** Prefix for delivered-document resource URIs (ADR-030). */
export const DELIVERED_URI_PREFIX = "markspec://delivered/";

/** Build a delivered-document URI: profileId segment + encoded relative path. */
export function deliveredUri(profileId: string, path: string): string {
  return `${DELIVERED_URI_PREFIX}${encodeURIComponent(profileId)}/` +
    encodeURIComponent(path);
}

/** Parse a delivered-document URI. Returns `{profileId, path}` or undefined. */
export function parseDeliveredUri(
  uri: string,
): { profileId: string; path: string } | undefined {
  if (!uri.startsWith(DELIVERED_URI_PREFIX)) return undefined;
  const rest = uri.slice(DELIVERED_URI_PREFIX.length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx <= 0 || slashIdx === rest.length - 1) return undefined;
  try {
    return {
      profileId: decodeURIComponent(rest.slice(0, slashIdx)),
      path: decodeURIComponent(rest.slice(slashIdx + 1)),
    };
  } catch {
    return undefined;
  }
}

/** Check whether a URI is a delivered-document URI. */
export function isDeliveredUri(uri: string): boolean {
  return parseDeliveredUri(uri) !== undefined;
}
