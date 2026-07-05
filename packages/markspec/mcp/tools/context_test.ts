/**
 * @module mcp/tools/context_test
 *
 * Unit tests for entry_context (Satisfies-chain walk).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { CompileResult, DisplayId, Entry, Link } from "../../core/mod.ts";
import { makeDisplayId } from "../../core/mod.ts";
import {
  ENTRY_CONTEXT_DESCRIPTOR,
  renderContext,
  walkContext,
} from "./context.ts";

function mk(displayId: string, title: string, id?: string): Entry {
  return {
    displayId: makeDisplayId(displayId),
    title,
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "/proj/x.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
    ...(id !== undefined ? { id } : {}),
  };
}

function buildResult(
  entries: Entry[],
  edges: { from: string; to: string; kind: Link["kind"] }[],
): CompileResult {
  const entryMap = new Map<DisplayId, Entry>();
  for (const e of entries) entryMap.set(e.displayId, e);

  const links: Link[] = edges.map((e) => ({
    from: makeDisplayId(e.from),
    to: makeDisplayId(e.to),
    kind: e.kind,
    location: { file: "/x", line: 1, column: 1 },
  }));

  const forward = new Map<DisplayId, Link[]>();
  for (const link of links) {
    const list = forward.get(link.from) ?? [];
    list.push(link);
    forward.set(link.from, list);
  }

  return {
    entries: entryMap,
    links,
    forward,
    reverse: new Map(),
    documents: new Map(),
    diagnostics: [],
    typeRegistry: { bindings: new Map(), typedefs: new Map() },
  };
}

Deno.test("walkContext: depth 0 is just the start entry", () => {
  const result = buildResult(
    [mk("STK_0001", "Top")],
    [],
  );
  const chain = walkContext(result, "STK_0001", 10);
  assertEquals(chain.length, 1);
  assertEquals(chain[0].displayId, "STK_0001");
  assertEquals(chain[0].depth, 0);
});

Deno.test("walkContext: walks satisfies edges upward", () => {
  const result = buildResult(
    [mk("SRS_0001", "SRS"), mk("SYS_0001", "SYS"), mk("STK_0001", "STK")],
    [
      { from: "SRS_0001", to: "SYS_0001", kind: "satisfies" },
      { from: "SYS_0001", to: "STK_0001", kind: "satisfies" },
    ],
  );
  const chain = walkContext(result, "SRS_0001", 10);
  assertEquals(chain.map((c) => c.displayId), [
    "SRS_0001",
    "SYS_0001",
    "STK_0001",
  ]);
});

Deno.test("walkContext: ignores non-satisfies edges", () => {
  const result = buildResult(
    [mk("SRS_0001", "SRS"), mk("SYS_0001", "SYS")],
    [{ from: "SRS_0001", to: "SYS_0001", kind: "derived-from" }],
  );
  const chain = walkContext(result, "SRS_0001", 10);
  assertEquals(chain.length, 1);
});

Deno.test("walkContext: stops at depth limit", () => {
  const result = buildResult(
    [mk("A_0001", "A"), mk("B_0001", "B"), mk("C_0001", "C")],
    [
      { from: "A_0001", to: "B_0001", kind: "satisfies" },
      { from: "B_0001", to: "C_0001", kind: "satisfies" },
    ],
  );
  const chain = walkContext(result, "A_0001", 1);
  assertEquals(chain.map((c) => c.displayId), ["A_0001", "B_0001"]);
});

Deno.test("walkContext: handles cycles", () => {
  const result = buildResult(
    [mk("A_0001", "A"), mk("B_0001", "B")],
    [
      { from: "A_0001", to: "B_0001", kind: "satisfies" },
      { from: "B_0001", to: "A_0001", kind: "satisfies" },
    ],
  );
  const chain = walkContext(result, "A_0001", 10);
  assertEquals(chain.length, 2);
});

Deno.test("renderContext: nested list with indentation", () => {
  const md = renderContext(
    [
      { displayId: "A_0001", title: "A", depth: 0 },
      { displayId: "B_0001", title: "B", depth: 1 },
      { displayId: "C_0001", title: "C", depth: 2 },
    ],
    "A_0001",
  );
  assertStringIncludes(md, "# Context for [A_0001]");
  assertStringIncludes(md, "- **A_0001** — A");
  assertStringIncludes(
    md,
    "  - satisfies → [B_0001](markspec://entry/B_0001) — B",
  );
  assertStringIncludes(
    md,
    "    - satisfies → [C_0001](markspec://entry/C_0001) — C",
  );
});

Deno.test("ENTRY_CONTEXT_DESCRIPTOR.description: has TRIGGER and PREFER blocks", () => {
  const desc = ENTRY_CONTEXT_DESCRIPTOR.description;
  assertStringIncludes(desc, "TRIGGER when:");
  assertStringIncludes(desc, "PREFER over:");
});

Deno.test("ENTRY_CONTEXT_DESCRIPTOR.description: names satisfies-chain intent verbs", () => {
  const desc = ENTRY_CONTEXT_DESCRIPTOR.description;
  assertStringIncludes(desc, "satisfy");
  assertStringIncludes(desc, "trace");
  assertStringIncludes(desc, "implement");
});

Deno.test("ENTRY_CONTEXT_DESCRIPTOR.description: points at Incoming links for opposite direction", () => {
  assertStringIncludes(
    ENTRY_CONTEXT_DESCRIPTOR.description,
    "Incoming links",
  );
});

// --- Issue #593: trace targets render as display IDs, never ULIDs ---

Deno.test(
  "entry_context: resolves a display-ID-authored satisfies chain (issue #593)",
  () => {
    // The target carries a known ULID id. renderContext renders nodes by
    // displayId only — the ULID must not appear in the output.
    const TARGET_ULID = "01J0000000000000000000TGT1";
    const result = buildResult(
      [
        mk("SWE_0001", "Source"),
        mk("SYS_0001", "Target", TARGET_ULID),
      ],
      [{ from: "SWE_0001", to: "SYS_0001", kind: "satisfies" }],
    );
    const chain = walkContext(result, "SWE_0001", 10);
    assertEquals(chain.map((n) => n.displayId), ["SWE_0001", "SYS_0001"]);
    const md = renderContext(chain, "SWE_0001");
    assertStringIncludes(md, "SYS_0001");
    // The target's ULID must not appear — nodes are identified by display
    // ID, never by the internal ULID. This assertion would fail if
    // renderContext ever emitted the `id` field instead of `displayId`.
    assertEquals(md.includes(TARGET_ULID), false);
  },
);

// --- federated-upstream slice 5: origin badge in the context chain ---

Deno.test(
  "renderContext: upstream parent in the chain shows its origin badge (slice 5)",
  () => {
    const upstreamParent = {
      ...mk("PRODUCT_SYS_0001", "Product system req"),
      origin: { kind: "upstream", upstreamId: "product", version: "v2.1.0" },
    } as unknown as Entry;
    const result = buildResult(
      [mk("SWE_0001", "Local child"), upstreamParent],
      [{ from: "SWE_0001", to: "PRODUCT_SYS_0001", kind: "satisfies" }],
    );
    const chain = walkContext(result, "SWE_0001", 10);
    const md = renderContext(chain, "SWE_0001");
    assertStringIncludes(md, "PRODUCT_SYS_0001");
    assertStringIncludes(md, "— from product@v2.1.0");
  },
);
