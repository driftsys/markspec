/**
 * @module mcp/path
 *
 * Path normalization helpers for MCP responses. The MCP server should never
 * leak the user's home directory in rendered output — paths are reported
 * relative to the project root.
 */

import { SEPARATOR } from "@std/path";

/**
 * True when the host filesystem is case-insensitive. Detected via
 * `@std/path`'s `SEPARATOR` — `\\` only on Windows. macOS APFS is also
 * case-insensitive by default but tooling overwhelmingly treats it as
 * case-sensitive, so we follow Deno's convention and only relax case
 * on Windows.
 */
const CASE_INSENSITIVE = SEPARATOR === "\\";

function pathEqual(a: string, b: string): boolean {
  return CASE_INSENSITIVE ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function pathStartsWith(path: string, prefix: string): boolean {
  if (path.length < prefix.length) return false;
  if (!CASE_INSENSITIVE) return path.startsWith(prefix);
  return path.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
}

/**
 * Return `absolute` rewritten relative to `projectRoot`. When `projectRoot`
 * is undefined or `absolute` does not live under it, the original path is
 * returned unchanged. Uses the host platform's separator so the prefix
 * comparison works on Windows (`\`) as well as POSIX (`/`). On Windows,
 * the prefix comparison is also case-insensitive — `C:\Proj` matches
 * `c:\proj` — because the Windows filesystem treats them as the same path.
 */
export function relativeToRoot(
  absolute: string,
  projectRoot: string | undefined,
): string {
  if (!projectRoot) return absolute;
  const root = projectRoot.endsWith(SEPARATOR)
    ? projectRoot
    : projectRoot + SEPARATOR;
  if (pathEqual(absolute, projectRoot)) return ".";
  if (pathStartsWith(absolute, root)) return absolute.slice(root.length);
  return absolute;
}
