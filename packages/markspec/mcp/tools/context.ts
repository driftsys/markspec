/**
 * @module mcp/tools/context
 *
 * `entry_context` MCP tool. Walks the `satisfies` edges upward from a given
 * entry and renders the chain as a nested Markdown list.
 */

import type { CompileResult } from "../../core/mod.ts";
import { makeDisplayId } from "../../core/mod.ts";
import { entryUri } from "../uri.ts";

/** One entry in the context chain. */
export interface ContextNode {
  readonly displayId: string;
  readonly title: string;
  /** Hops from the start entry — 0 means the start entry itself. */
  readonly depth: number;
}

/**
 * BFS walk of the `satisfies` edge upward from `startId`.
 * Stops at `maxDepth` hops or when no outgoing satisfies links remain.
 * Cycle-safe via visited set.
 */
export function walkContext(
  result: CompileResult,
  startId: string,
  maxDepth: number,
): ContextNode[] {
  const brandedStart = makeDisplayId(startId);
  const start = result.entries.get(brandedStart);
  if (!start) return [];

  const out: ContextNode[] = [
    { displayId: startId, title: start.title, depth: 0 },
  ];
  const visited = new Set<string>([startId]);
  let frontier = [brandedStart];
  let depth = 0;

  while (depth < maxDepth && frontier.length > 0) {
    const next: typeof frontier = [];
    for (const id of frontier) {
      const links = result.forward.get(id) ?? [];
      for (const link of links) {
        if (link.kind !== "satisfies") continue;
        if (visited.has(link.to)) continue;
        visited.add(link.to);
        const target = result.entries.get(link.to);
        if (!target) continue;
        out.push({
          displayId: link.to,
          title: target.title,
          depth: depth + 1,
        });
        next.push(link.to);
      }
    }
    frontier = next;
    depth++;
  }

  return out;
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
    if (node.depth === 0) {
      lines.push(`${indent}- **${node.displayId}** — ${node.title}`);
    } else {
      lines.push(
        `${indent}- satisfies → [${node.displayId}](${
          entryUri(node.displayId)
        }) — ${node.title}`,
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
    "Walk the satisfies-chain upward from one entry to discover what higher-level requirements it implements. Returns a nested Markdown list with markspec://entry/{id} links. " +
    "Use to answer 'why does this entry exist' or 'what does this trace up to'. " +
    "For the opposite direction (what depends on this entry), read markspec://entry/{id} and inspect its Incoming Links section. " +
    "Depth defaults to 10; lower it (2–3) for quick orientation, raise it only when full transitive context is needed.",
  inputSchema: ENTRY_CONTEXT_INPUT_SCHEMA,
  annotations: {
    title: "Trace satisfies chain",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
