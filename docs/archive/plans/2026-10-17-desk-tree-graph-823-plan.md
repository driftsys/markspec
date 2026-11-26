# Desk product tree as nodes and edges (#823) — plan

Issue: driftsys/markspec#823 (epic #826). Branch: `fix/desk-tree-graph-823`.

## Spec

**Goal:** `buildProductTree` (`packages/markspec/desk/api.ts`) expands the
traceability DAG into a nested tree by recursing from every root, so an entry
with two parents is rebuilt under each parent with its whole subtree. Output
size grows with the number of root-to-leaf paths, which is exponential in depth
on diamond-shaped traceability. After this change, `GET /api/v1/tree` returns a
flat graph whose size is O(entries + tree links), and the UI expands it lazily.

**Decisions (approved by the user):**

1. New response shape (`ProductTree`):

   ```jsonc
   {
     "apiVersion": 2,
     "project": { "name": "…" }, // name omitted when absent (unchanged)
     "roots": ["STK_0001"], // display IDs
     "nodes": [{
       "displayId": "…",
       "title": "…",
       "type": "…",
       "kind": "…",
       "origin": "…",
     }],
     "edges": [
       { "from": "SYS_0001", "to": "STK_0001", "relation": "satisfies" },
     ],
   }
   ```

   - `nodes`: exactly one node per entry in the compiled graph, sorted by
     display ID (the existing locale-independent `compareIds`). Node fields:
     `displayId`, `title`, optional `type`, optional `kind` (`coreKindOf`),
     optional `origin` (`formatEntryOrigin`). Optional fields are absent, not
     `null` (existing `compact`). No `children`, no `relation` on nodes.
   - `edges`: one edge per (child, parent) pair. `from` is the child (the
     refining or verifying entry), `to` is the parent (the link target),
     `relation` is the link kind. A tree link is a link whose kind is in the
     existing `TREE_LINK_KINDS` (`satisfies`, `derived-from`, `verifies`), whose
     both ends are entries in the graph, and whose ends differ. When several
     tree links join the same child to the same parent, keep one edge: the one
     whose kind ranks first (refinement `satisfies`/`derived-from` rank 0,
     `verifies` rank 1), ties broken by kind name with `compareIds`.
   - `edges` sort order: by `to` (compareIds), then kind rank (refinement before
     verification), then `from` (compareIds), then `relation` (compareIds). This
     is the existing sibling order, grouped by parent.
   - `roots`: entries that have no outgoing tree link, sorted by display ID,
     followed by cycle roots: walking entries in display-ID order, any entry not
     reachable from the roots so far (reachability follows edges from parent
     `to` down to child `from`) becomes a root, and everything it reaches is
     marked reached. This preserves today's rule that no entry silently drops
     out when every parent chain loops back on itself.
2. `DESK_API_VERSION` goes from `1` to `2` (the constant's doc comment says it
   is bumped on a breaking change; the shape change is breaking).
3. Build in linear time: one pass to build nodes, one pass over the forward link
   map to collect edges, one BFS/DFS with a visited set for reachability. No
   recursion over paths; no per-path `Set` copies.

**Alternatives considered:**

- Keep the nested tree and emit each shared subtree once with
  `{ displayId, ref: true }` stubs elsewhere: rejected. The UI would still walk
  a recursive shape, and which parent holds the full subtree depends on sort
  order, so the output is harder to reason about.
- Keep `apiVersion: 1`: rejected. The constant exists to signal breaking
  changes, and the handshake carries it so the shell can detect a mismatch.

## Global Constraints

- `packages/markspec/desk/api.ts` uses Web APIs only (no `Deno.*`).
- Output is deterministic: the same compiled graph always produces identical
  JSON.
- `deno fmt` for TypeScript; `dprint fmt` for Markdown/JSON. Both must pass.
- Doc comments (`/** */`) on every exported item. Code comments and docs in
  plain, literal English (no idioms).
- Never hand-write an `Id:` value in MarkSpec entries.
- Commit with Conventional Commits, scope `cli`. One commit. Do not push.

## Task 1: Nodes-and-edges product tree

**Files:** `packages/markspec/desk/api.ts`,
`packages/markspec/desk/api_test.ts`, `tests/e2e/desk_test.ts`,
`packages/markspec/desk/server.ts` (doc comment only), `schemas/desk-api.json`.

- `api.ts`: replace `TreeNode` with a `ProductNode` interface (`displayId`,
  `title`, `type?`, `kind?`, `origin?`), add a `ProductEdge` interface (`from`,
  `to`, `relation`), and change `ProductTree` to
  `{ apiVersion, project, roots: readonly string[], nodes: readonly ProductNode[], edges: readonly ProductEdge[] }`.
  Rewrite `buildProductTree` per decisions 1 and 3; update its doc comment and
  the module doc. Bump `DESK_API_VERSION` to `2`.
- `server.ts`: update the handshake example in the module doc comment to
  `"apiVersion":2`.
- `schemas/desk-api.json`: replace the `TreeNode` schema with `ProductNode` and
  `ProductEdge`, update `ProductTree` (`roots`, `nodes`, `edges`; `required`
  lists), and update any `apiVersion` example or description that says `1`.
  Leave no unreferenced schema component.
- Tests (TDD — update/write tests first), in `api_test.ts`, following its
  existing fixtures and helpers:
  1. Rewrite the existing "tree reads the product top-down" test against the new
     shape: assert `roots`, the edges under the stakeholder root with their
     relations (refinement before verification), and a node's `kind`.
  2. Keep the determinism test (identical JSON twice).
  3. Rewrite the link-cycle test: every entry of a cycle appears in `nodes`, and
     the lowest display ID of an unreached cycle is in `roots`.
  4. New: an entry with two parents appears once in `nodes` and has two edges.
  5. New: duplicate links between the same child and parent with `satisfies` and
     `verifies` produce one edge with `relation: "satisfies"`.
  6. New: deep diamond fixture — 10 levels, each level has 2 entries, and every
     entry at level n+1 satisfies both entries at level n (build the Markdown
     programmatically). Assert `nodes.length === 20`, `edges.length === 36` (9
     level pairs × 4 links), and `roots` equals the two level-0 IDs. The old
     code would produce 2^10 copies of the leaves.
  7. Links to entries outside the graph and self-links produce no edge.
- `tests/e2e/desk_test.ts`: update the handshake assertion to `apiVersion === 2`
  and the tree assertion to read `roots` (and/or `nodes`) in the new shape.

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi --allow-net packages/markspec/desk/ tests/e2e/desk_test.ts`,
`deno check packages/markspec/main.ts packages/markspec/desk/server.ts`,
`deno lint`, `deno fmt --check`, `dprint check`.
