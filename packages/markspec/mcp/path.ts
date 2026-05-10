/**
 * @module mcp/path
 *
 * Path normalization helpers for MCP responses. The MCP server should never
 * leak the user's home directory in rendered output — paths are reported
 * relative to the project root.
 */

/**
 * Return `absolute` rewritten relative to `projectRoot`. When `projectRoot`
 * is undefined or `absolute` does not live under it, the original path is
 * returned unchanged.
 */
export function relativeToRoot(
  absolute: string,
  projectRoot: string | undefined,
): string {
  if (!projectRoot) return absolute;
  const root = projectRoot.endsWith("/") ? projectRoot : projectRoot + "/";
  if (absolute === projectRoot) return ".";
  if (absolute.startsWith(root)) return absolute.slice(root.length);
  return absolute;
}
