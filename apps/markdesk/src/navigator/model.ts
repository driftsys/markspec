import type { ProductNode, ProductTree } from "../api/client";

/** Children of one entry, split by relation. */
export interface NavigatorChildren {
  refining: string[];
  verifying: string[];
}

/** Read-only view of a product tree prepared for the navigator. */
export interface NavigatorModel {
  roots: string[];
  node(id: string): ProductNode;
  children(id: string): NavigatorChildren;
}

const NUMBER_RUN = /(\d+)/;

/**
 * Natural order for display IDs: digit runs compare as numbers, so `SRS_2`
 * sorts before `SRS_10`. Ties fall back to plain string order.
 */
export function compareDisplayIds(a: string, b: string): number {
  const left = a.split(NUMBER_RUN);
  const right = b.split(NUMBER_RUN);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    if (left[i] === right[i]) continue;
    if (i % 2 === 1) {
      const diff = Number(left[i]) - Number(right[i]);
      if (diff !== 0) return diff;
    } else {
      return left[i] < right[i] ? -1 : 1;
    }
  }
  if (left.length !== right.length) return left.length - right.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Index a product tree. Edges point from child to parent. */
export function buildNavigatorModel(tree: ProductTree): NavigatorModel {
  const nodes = new Map(tree.nodes.map((n) => [n.displayId, n]));
  const kids = new Map<string, NavigatorChildren>();
  for (const edge of tree.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    let entry = kids.get(edge.to);
    if (!entry) {
      entry = { refining: [], verifying: [] };
      kids.set(edge.to, entry);
    }
    (edge.relation === "verifies" ? entry.verifying : entry.refining)
      .push(edge.from);
  }
  for (const entry of kids.values()) {
    entry.refining.sort(compareDisplayIds);
    entry.verifying.sort(compareDisplayIds);
  }
  const none: NavigatorChildren = { refining: [], verifying: [] };
  return {
    roots: [...tree.roots].sort(compareDisplayIds),
    node(id) {
      const found = nodes.get(id);
      if (!found) throw new Error(`Unknown entry ${id}`);
      return found;
    },
    children: (id) => kids.get(id) ?? none,
  };
}
