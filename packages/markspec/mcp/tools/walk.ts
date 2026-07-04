/**
 * @module mcp/tools/walk
 *
 * Direction-parameterised breadth-first walk over the compiled traceability
 * graph. Shared by `entry_context` (forward `satisfies`, the upward chain)
 * and `entry_neighborhood` (both directions). Cycle-safe; bounded by depth
 * and an optional node cap.
 */

import type {
  CompileResult,
  DisplayId,
  Link,
  LinkKind,
} from "../../core/mod.ts";
import { formatEntryOrigin, makeDisplayId } from "../../core/mod.ts";

/** One visited node — display ID, title, and hops from the start (0 = start). */
export interface WalkNode {
  readonly displayId: string;
  readonly title: string;
  readonly depth: number;
  /** `"<id>@<version>"` when the node was hydrated from a profile-delivered
   * corpus (ADR-030) or a locked upstream (federated-upstream slice 5).
   * Absent for project-authored nodes. */
  readonly origin?: string;
}

/** Which adjacency map to traverse: outgoing (`forward`) or incoming (`reverse`). */
export type WalkDirection = "forward" | "reverse";

/** Options for {@linkcode walkLinks}. */
export interface WalkOptions {
  /** Include the start entry as a depth-0 node. Default `true`. */
  readonly includeStart?: boolean;
  /** Cap on neighbour nodes emitted (excludes the start node). Default unbounded. */
  readonly maxNodes?: number;
}

/**
 * BFS from `startId` following links of `kind` in `direction`, up to
 * `maxDepth` hops. Returns nodes in BFS order. Cycle-safe via a visited set.
 * Returns `[]` when `startId` is not in the graph.
 */
export function walkLinks(
  result: CompileResult,
  startId: string,
  maxDepth: number,
  direction: WalkDirection,
  kind: LinkKind,
  options: WalkOptions = {},
): WalkNode[] {
  const includeStart = options.includeStart ?? true;
  const maxNodes = options.maxNodes ?? Infinity;

  const brandedStart = makeDisplayId(startId);
  const start = result.entries.get(brandedStart);
  if (!start) return [];

  const adjacency = direction === "forward" ? result.forward : result.reverse;
  const neighbourOf = (link: Link): DisplayId =>
    direction === "forward" ? link.to : link.from;

  const out: WalkNode[] = [];
  if (includeStart) {
    out.push({
      displayId: startId,
      title: start.title,
      depth: 0,
      ...(start.origin ? { origin: formatEntryOrigin(start.origin) } : {}),
    });
  }

  const visited = new Set<DisplayId>([brandedStart]);
  let frontier: DisplayId[] = [brandedStart];
  let depth = 0;
  let emitted = 0;

  while (depth < maxDepth && frontier.length > 0 && emitted < maxNodes) {
    const next: DisplayId[] = [];
    for (const id of frontier) {
      const links = adjacency.get(id) ?? [];
      for (const link of links) {
        if (link.kind !== kind) continue;
        const neighbour = neighbourOf(link);
        if (visited.has(neighbour)) continue;
        visited.add(neighbour);
        const target = result.entries.get(neighbour);
        if (!target) continue;
        out.push({
          displayId: neighbour,
          title: target.title,
          depth: depth + 1,
          ...(target.origin
            ? { origin: formatEntryOrigin(target.origin) }
            : {}),
        });
        next.push(neighbour);
        emitted++;
        if (emitted >= maxNodes) break;
      }
      if (emitted >= maxNodes) break;
    }
    frontier = next;
    depth++;
  }

  return out;
}
