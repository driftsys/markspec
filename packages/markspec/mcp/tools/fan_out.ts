/**
 * @module mcp/tools/fan_out
 *
 * Runs one tool's rendering over the projects a call selects and combines
 * the results. With one selected project the output is exactly that
 * project's text, so a single-project server answers as it always did.
 */

import type { McpWorkspace, WorkspaceProject } from "../workspace.ts";

/**
 * Render a tool result for every project selected by `projectArg`.
 *
 * - Unknown `projectArg` → the workspace's error text.
 * - One selected project → `render`'s text, or `emptyText` when it returns
 *   `undefined`.
 * - Several → each non-empty text under a `## Project: <label>` heading,
 *   sections separated by a blank line; `emptyText` when every text is
 *   empty. When `render` throws for one project, that project's section
 *   holds `Error: <message>` and the other projects still answer. With one
 *   selected project the error propagates to the caller.
 */
export async function perProject(
  workspace: McpWorkspace,
  projectArg: string | undefined,
  render: (wp: WorkspaceProject) => Promise<string | undefined>,
  emptyText: string,
): Promise<string> {
  const selected = workspace.select(projectArg);
  if (typeof selected === "string") return selected;
  if (selected.length === 1) return (await render(selected[0])) ?? emptyText;
  const sections: string[] = [];
  for (const wp of selected) {
    let text: string | undefined;
    try {
      text = await render(wp);
    } catch (err) {
      text = `Error: ${err instanceof Error ? err.message : String(err)}\n`;
    }
    if (text === undefined) continue;
    const body = text.endsWith("\n") ? text : `${text}\n`;
    sections.push(`## Project: ${wp.label}\n\n${body}`);
  }
  return sections.length === 0 ? emptyText : sections.join("\n");
}

/** Read the optional `project` tool argument as a label. */
export function projectArgOf(
  // deno-lint-ignore no-explicit-any
  args: any,
): string | undefined {
  return args?.project !== undefined ? String(args.project) : undefined;
}

/** JSON Schema of the optional `project` argument every tool accepts. */
export const PROJECT_ARG_SCHEMA = {
  type: "string",
  description: "Limit to one project; a label from project_list.",
} as const;
