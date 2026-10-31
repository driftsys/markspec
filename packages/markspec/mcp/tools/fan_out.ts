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
 * - Several → `render` runs for every project at the same time; each
 *   non-empty text goes under a `## Project: <label>` heading, in label
 *   order, sections separated by a blank line; `emptyText` when every text is
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
  // Render every project at the same time; the sections keep label order.
  const texts = await Promise.all(selected.map(async (wp) => {
    try {
      return await render(wp);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}\n`;
    }
  }));
  const sections: string[] = [];
  selected.forEach((wp, i) => {
    const text = texts[i];
    if (text === undefined) return;
    const body = text.endsWith("\n") ? text : `${text}\n`;
    sections.push(`## Project: ${wp.label}\n\n${body}`);
  });
  return sections.length === 0 ? emptyText : sections.join("\n");
}

/** Read the optional `project` tool argument as a label. */
export function projectArgOf(
  // deno-lint-ignore no-explicit-any
  args: any,
): string | undefined {
  return args?.project !== undefined && args.project !== null
    ? String(args.project)
    : undefined;
}

/** JSON Schema of the optional `project` argument every tool accepts. */
export const PROJECT_ARG_SCHEMA = {
  type: "string",
  description: "Limit to one project; a label from project_list.",
} as const;
