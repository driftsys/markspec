/**
 * @module mcp/path
 *
 * Path normalization helpers for MCP responses. The MCP server should never
 * leak the user's home directory in rendered output — paths are reported
 * relative to the project root.
 */

import { SEPARATOR } from "@std/path";

/**
 * Return `absolute` rewritten relative to `projectRoot`. When `projectRoot`
 * is undefined or `absolute` does not live under it, the original path is
 * returned unchanged. Uses the host platform's separator so the prefix
 * comparison works on Windows (`\`) as well as POSIX (`/`).
 */
export function relativeToRoot(
  absolute: string,
  projectRoot: string | undefined,
): string {
  if (!projectRoot) return absolute;
  const root = projectRoot.endsWith(SEPARATOR)
    ? projectRoot
    : projectRoot + SEPARATOR;
  if (absolute === projectRoot) return ".";
  if (absolute.startsWith(root)) return absolute.slice(root.length);
  return absolute;
}
