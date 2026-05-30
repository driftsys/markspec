/**
 * @module mcp/tools/show
 *
 * `entry_show` MCP tool. Renders one entry's full detail (body, outgoing and
 * incoming links) by display ID — the `markspec://entry/{id}` resource exposed
 * as a tool, because tool-using agents reliably reach for tools over resources.
 */

import type { CompileResult } from "../../core/mod.ts";
import { makeDisplayId } from "../../core/mod.ts";
import { renderEntry } from "../resources/entry.ts";

/**
 * Render one entry's detail to Markdown. Returns a plain "not found" message
 * (not a thrown error) when no entry matches, so the agent can retry with a
 * corrected ID.
 */
export function renderShow(
  result: CompileResult,
  id: string,
  projectRoot: string | undefined,
): string {
  const displayId = makeDisplayId(id);
  const entry = result.entries.get(displayId);
  if (!entry) return `No entry with display ID ${id}.\n`;
  const titles = new Map<string, string>();
  for (const [eid, e] of result.entries) titles.set(eid, e.title);
  return renderEntry(
    entry,
    result.forward.get(displayId) ?? [],
    result.reverse.get(displayId) ?? [],
    titles,
    projectRoot,
  );
}

/** Tool input schema. */
export const ENTRY_SHOW_INPUT_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
  },
  required: ["id"],
  additionalProperties: false,
} as const;

/** Tool descriptor metadata. */
export const ENTRY_SHOW_DESCRIPTOR = {
  name: "entry_show",
  description:
    `TRIGGER when: user asks to "show", "open", "display", or "give me the full text of" a display ID, or "what does X say", "what are the details of X". PREFER over: Read, grep, or 'markspec show' — this returns the compiled entry (body, outgoing links, and the "Incoming links" that depend on it) in one call.\n\nReturns Markdown with markspec://entry/{id} cross-links. For the trace neighbourhood around the entry use entry_neighborhood; for just the upward chain use entry_context.`,
  inputSchema: ENTRY_SHOW_INPUT_SCHEMA,
  annotations: {
    title: "Show entry detail",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
