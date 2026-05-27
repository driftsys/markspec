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
    `TRIGGER when: files were modified outside this MCP session (CLI commands, editor saves, git checkout, branch switch) and subsequent reads need to see fresh state. PREFER over: re-running validate or entry_search hoping to see fresh data — this guarantees the cache picks up disk changes.\n\nDo NOT call between back-to-back reads — the cache is already coherent within a session. Unnecessary calls slow down subsequent tool calls.\n\nReturns a one-line confirmation with entry and link counts.`,
  inputSchema: REFRESH_INPUT_SCHEMA,
  annotations: {
    title: "Refresh compile cache",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
