/**
 * @module mcp/tools/neighborhood
 *
 * `entry_neighborhood` MCP tool. Renders the bounded trace neighbourhood of an
 * entry: its parents (forward `satisfies`, up the hierarchy) and children
 * (reverse `satisfies`, down the hierarchy), each as a nested Markdown tree.
 * Bounded by `depth` and a node cap so output stays within context budget.
 */

import type { CompileResult } from "../../core/mod.ts";
import { makeDisplayId } from "../../core/mod.ts";
import { entryUri } from "../uri.ts";
import { walkLinks, type WalkNode } from "./walk.ts";

/** Cap on neighbour nodes emitted per direction. Keeps tool output bounded. */
export const MAX_NODES = 200;

/**
 * Render one direction's nodes as a nested Markdown list. Callers guard the
 * empty case (with direction-specific wording), so `nodes` is always non-empty.
 * `depth - 1` indents: depth-1 nodes (immediate neighbours) sit at the top level.
 */
function renderBranch(nodes: readonly WalkNode[], arrow: string): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    const indent = "  ".repeat(node.depth - 1);
    lines.push(
      `${indent}- ${arrow} [${node.displayId}](${
        entryUri(node.displayId)
      }) — ${node.title}`,
    );
  }
  return lines;
}

/**
 * Render the parent + child neighbourhood of `id` to depth `maxDepth`.
 * Returns a not-found message when `id` is absent from the graph.
 */
export function renderNeighborhood(
  result: CompileResult,
  id: string,
  maxDepth: number,
): string {
  const start = result.entries.get(makeDisplayId(id));
  if (!start) return `No entry with display ID ${id}.\n`;

  const parents = walkLinks(result, id, maxDepth, "forward", "satisfies", {
    includeStart: false,
    maxNodes: MAX_NODES,
  });
  const children = walkLinks(result, id, maxDepth, "reverse", "satisfies", {
    includeStart: false,
    maxNodes: MAX_NODES,
  });

  const lines: string[] = [
    `# Neighbourhood of [${id}](${entryUri(id)}) — ${start.title}`,
    "",
    "## Parents (up)",
    "",
    ...(parents.length === 0
      ? ["_No parents._"]
      : renderBranch(parents, "satisfies →")),
    "",
    "## Children (down)",
    "",
    ...(children.length === 0
      ? ["_No children._"]
      : renderBranch(children, "← satisfied by")),
  ];

  if (parents.length >= MAX_NODES || children.length >= MAX_NODES) {
    lines.push(
      "",
      `_Note: neighbourhood truncated at ${MAX_NODES} nodes per direction; narrow with a lower depth._`,
    );
  }

  return lines.join("\n") + "\n";
}

/** Tool input schema. */
export const ENTRY_NEIGHBORHOOD_INPUT_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
    depth: { type: "integer", minimum: 0, maximum: 50 },
  },
  required: ["id"],
  additionalProperties: false,
} as const;

/** Tool descriptor metadata. */
export const ENTRY_NEIGHBORHOOD_DESCRIPTOR = {
  name: "entry_neighborhood",
  description:
    `TRIGGER when: user asks "what depends on X", "what's around X", "show the parents and children of X", "the trace neighbourhood of X", or wants both directions of the satisfies hierarchy at once. PREFER over: 'markspec dependents' / 'markspec compile' — this walks the compiled graph deterministically.\n\nReturns two nested Markdown trees (Parents up / Children down) with markspec://entry/{id} links. Depth defaults to 3; raise for deeper transitive context. For the UPWARD chain only use entry_context; for one entry's detail use entry_show.`,
  inputSchema: ENTRY_NEIGHBORHOOD_INPUT_SCHEMA,
  annotations: {
    title: "Entry trace neighbourhood",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
