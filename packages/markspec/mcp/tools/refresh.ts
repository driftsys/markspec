/**
 * @module mcp/tools/refresh
 *
 * `markspec_refresh` MCP tool. Re-runs project discovery, so projects added
 * or removed since startup are picked up, then forces an unconditional
 * recompile of each selected project. Returns a one-line Markdown
 * confirmation per project (under a `## Project: <label>` heading when
 * several projects answer). Used by agents that have just edited files and
 * want to guarantee freshness without relying on the mtime check.
 */

import { PROJECT_ARG_SCHEMA } from "./fan_out.ts";

/** Render a refresh confirmation. */
export function renderRefresh(entries: number, links: number): string {
  return `Refreshed. ${entries} entries, ${links} links.\n`;
}

/** Tool input schema. */
export const REFRESH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    project: PROJECT_ARG_SCHEMA,
  },
  additionalProperties: false,
} as const;

/** Tool descriptor metadata. */
export const REFRESH_DESCRIPTOR = {
  name: "markspec_refresh",
  description:
    `TRIGGER when: files were modified outside this MCP session (CLI commands, editor saves, git checkout, branch switch) and subsequent reads need to see fresh state. PREFER over: re-running validate or entry_search hoping to see fresh data — this guarantees the cache picks up disk changes.\n\nDo NOT call between back-to-back reads — the cache is already coherent within a session. Unnecessary calls slow down subsequent tool calls.\n\nAlso picks up projects added or removed since startup. Returns a one-line confirmation with entry and link counts, one per project.\n\nOptional 'project' limits the answer to one project label from project_list.`,
  inputSchema: REFRESH_INPUT_SCHEMA,
  annotations: {
    title: "Refresh compile cache",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
