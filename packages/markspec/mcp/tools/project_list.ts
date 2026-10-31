/**
 * @module mcp/tools/project_list
 *
 * `project_list` MCP tool. Lists the MarkSpec projects the server answers
 * for, with the labels that the other tools accept as `project`.
 */

import type { McpWorkspace } from "../workspace.ts";

/**
 * Render one line per project:
 * `- <label> — <absolute root> — profile: <id | none> — <N entries | not compiled yet>`.
 * Never starts a compile.
 */
export function renderProjectList(workspace: McpWorkspace): Promise<string> {
  const lines = workspace.projects().map(({ label, project }) => {
    const tiers = project.profileChain?.tiers ?? [];
    const profile = tiers.length > 0 ? tiers[tiers.length - 1].id : "none";
    const count = project.compiledEntryCount?.();
    const status = count === undefined
      ? "not compiled yet"
      : `${count} entries`;
    return `- ${label} — ${project.projectRoot} — profile: ${profile} — ${status}\n`;
  });
  return Promise.resolve(lines.join(""));
}

/** Tool input schema. */
export const PROJECT_LIST_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

/** Tool descriptor metadata. */
export const PROJECT_LIST_DESCRIPTOR = {
  name: "project_list",
  description:
    `TRIGGER when: the workspace holds several MarkSpec projects, or a tool answer shows "## Project:" headings and you need the project labels. Returns one line per project: label, absolute root, active profile, and entry count once compiled.\n\nPass a label as the 'project' argument of any other MarkSpec tool to limit it to that project.\n\nSKIP when: returns "No MarkSpec project found" — this workspace doesn't use MarkSpec.`,
  inputSchema: PROJECT_LIST_INPUT_SCHEMA,
  annotations: {
    title: "List projects",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
