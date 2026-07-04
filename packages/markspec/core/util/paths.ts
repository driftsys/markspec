/**
 * @module util/paths
 *
 * Path-containment guard shared by every loader that joins an
 * externally-controlled relative path onto a trusted base directory
 * (upstream snapshot cache, profile `delivers:` lists).
 */

/** Absolute path prefix — POSIX `/…` or a Windows drive letter (`C:\…` /
 * `C:/…`). */
const ABSOLUTE_PATH_RE = /^(\/|[A-Za-z]:[\\/])/;

/** A `..` path segment anywhere in the string, POSIX or Windows separators. */
const PARENT_SEGMENT_RE = /(^|[\\/])\.\.([\\/]|$)/;

/**
 * Reject an externally-controlled relative path that could escape its
 * base directory when joined as `${base}/${relPath}` — an absolute path
 * or any `..` segment both qualify.
 */
export function isUnsafeRelPath(relPath: string): boolean {
  return ABSOLUTE_PATH_RE.test(relPath) || PARENT_SEGMENT_RE.test(relPath);
}
