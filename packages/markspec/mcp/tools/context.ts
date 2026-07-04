/**
 * @module mcp/tools/context
 *
 * `entry_context` MCP tool. Walks the `satisfies` edges upward from a given
 * entry and renders the chain as a nested Markdown list.
 */

import type { CompileResult } from "../../core/mod.ts";
import { entryUri } from "../uri.ts";
import { walkLinks, type WalkNode } from "./walk.ts";

/** One entry in the context chain. Re-exported from the shared walk module. */
export type ContextNode = WalkNode;

/**
 * BFS walk of the `satisfies` edge upward from `startId`.
 * Stops at `maxDepth` hops or when no outgoing satisfies links remain.
 * Cycle-safe. Delegates to the shared {@linkcode walkLinks}.
 */
export function walkContext(
  result: CompileResult,
  startId: string,
  maxDepth: number,
): ContextNode[] {
  return walkLinks(result, startId, maxDepth, "forward", "satisfies");
}

/** Render a context chain as nested Markdown. */
export function renderContext(
  chain: readonly ContextNode[],
  startId: string,
): string {
  if (chain.length === 0) {
    return `# Context for ${startId}\n\nNo entry with display ID ${startId}.\n`;
  }
  const start = chain[0];
  const lines: string[] = [
    `# Context for [${start.displayId}](${entryUri(start.displayId)})`,
    "",
  ];
  for (const node of chain) {
    const indent = "  ".repeat(node.depth);
    const originSuffix = node.origin ? ` — from ${node.origin}` : "";
    if (node.depth === 0) {
      lines.push(
        `${indent}- **${node.displayId}** — ${node.title}${originSuffix}`,
      );
    } else {
      lines.push(
        `${indent}- satisfies → [${node.displayId}](${
          entryUri(node.displayId)
        }) — ${node.title}${originSuffix}`,
      );
    }
  }
  return lines.join("\n") + "\n";
}

/** Tool input schema. */
export const ENTRY_CONTEXT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
    depth: { type: "integer", minimum: 0, maximum: 50 },
  },
  required: ["id"],
  additionalProperties: false,
} as const;

/** Tool descriptor metadata. */
export const ENTRY_CONTEXT_DESCRIPTOR = {
  name: "entry_context",
  description:
    `TRIGGER when: user asks "what does this requirement satisfy", "why does this spec exist", "what does this trace up to", "what does X implement", "what higher-level requirement covers Y", or wants the upward chain from any display ID to its parents. PREFER over: grep'ing Satisfies: lines across files — this walks the compiled graph deterministically.\n\nThis is the UPWARD satisfies chain only. For both directions (parents and children) use entry_neighborhood; for what depends on this entry use entry_neighborhood or entry_show's "Incoming links".\n\nReturns a nested Markdown list with markspec://entry/{id} links. Depth defaults to 10; lower to 2–3 for quick orientation, raise only for full transitive context.`,
  inputSchema: ENTRY_CONTEXT_INPUT_SCHEMA,
  annotations: {
    title: "Trace satisfies chain",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
