/**
 * Display-ID token characters are ASCII letters, digits, dots, slashes,
 * underscores and hyphens. The LSP reads the whole token under the cursor,
 * including trailing characters in this set, then applies DISPLAY_ID_TOKEN_RE.
 * The renderer scans whole runs of the same characters and resolves each
 * against the known IDs: exact match first, then split on slashes only if
 * every segment is nonempty and a known ID. If neither resolves, remove one
 * trailing period and repeat, leaving the removed period outside the link.
 * A token with a trailing hyphen, such as SYS_A-, does not link SYS_A.
 * With only A/B and C known, A/B/C links nothing: slash segments are not
 * recursively grouped. A known short ID links wherever it stands alone.
 * These recognition rules do not constrain the parser's entry IDs.
 */
export const DISPLAY_ID_CHAR_RE = /[A-Za-z0-9._/-]/;

/**
 * An LSP display-ID token starts with an ASCII letter or digit and contains
 * at least three characters. Any display-ID character may end the token.
 */
export const DISPLAY_ID_TOKEN_RE: RegExp = new RegExp(
  `^[A-Za-z0-9]${DISPLAY_ID_CHAR_RE.source}{2,}$`,
);
