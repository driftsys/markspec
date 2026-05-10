/**
 * @module mcp/tools/refresh
 *
 * `markspec_refresh` MCP tool. Forces an unconditional recompile of the
 * project, returning a one-line Markdown confirmation. Used by agents that
 * have just edited files and want to guarantee freshness without relying on
 * the mtime check.
 */

/** Render a refresh confirmation. */
export function renderRefresh(entries: number, links: number): string {
  return `Refreshed. ${entries} entries, ${links} links.\n`;
}

/** Tool input schema. */
export const REFRESH_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

/** Tool descriptor metadata. */
export const REFRESH_DESCRIPTOR = {
  name: "markspec_refresh",
  description:
    "Force-invalidate the MarkSpec compile cache. Use after editing files to guarantee subsequent reads see the new state.",
  inputSchema: REFRESH_INPUT_SCHEMA,
};
