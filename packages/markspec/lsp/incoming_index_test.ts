/**
 * @module lsp/incoming_index_test
 *
 * Unit tests for {@linkcode buildIncomingCount} — pure helper that counts
 * incoming attribute references per display ID across the workspace.
 */

import { assertEquals } from "@std/assert";
import { buildIncomingCount } from "./incoming_index.ts";
import type { Attribute, DisplayId, Entry, Ulid } from "../core/mod.ts";

function fakeEntry(opts: {
  displayId: string;
  file?: string;
  line?: number;
  attrs?: Array<{ key: string; value: string }>;
}): Entry {
  const attrs: Attribute[] = (opts.attrs ?? []).map((a) => ({
    key: a.key,
    value: a.value,
  }));
  return {
    shape: "Authored",
    displayId: opts.displayId as DisplayId,
    title: "T",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF" as Ulid,
    body: "",
    rawAttributes: attrs,
    typedAttributes: new Map(),
    type: undefined,
    location: {
      file: opts.file ?? "/proj/r.md",
      line: opts.line ?? 1,
      column: 1,
    },
    labels: [],
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("buildIncomingCount: empty input returns empty map", () => {
  const count = buildIncomingCount([]);
  assertEquals(count.size, 0);
});

Deno.test("buildIncomingCount: counts incoming refs, skips self-reference and Id", () => {
  const target = fakeEntry({ displayId: "STK_001" });
  const child1 = fakeEntry({
    displayId: "SAD_A",
    attrs: [{ key: "Satisfies", value: "STK_001" }],
  });
  const child2 = fakeEntry({
    displayId: "SAD_B",
    attrs: [{ key: "Satisfies", value: "STK_001" }],
  });
  // Self-reference: STK_001's own Satisfies value lists itself.
  // The skip rule ensures this doesn't inflate its own count.
  const selfRef = fakeEntry({
    displayId: "STK_001",
    attrs: [{ key: "Satisfies", value: "STK_001" }],
  });
  // Id attribute shouldn't contribute even if the value matches a display ID.
  const idAttr = fakeEntry({
    displayId: "OTHER",
    attrs: [{ key: "Id", value: "STK_001" }],
  });

  const count = buildIncomingCount([target, child1, child2, selfRef, idAttr]);

  assertEquals(count.get("STK_001" as DisplayId), 2);
});

Deno.test("buildIncomingCount: counts across multiple targets", () => {
  const child = fakeEntry({
    displayId: "SAD_001",
    attrs: [
      { key: "Satisfies", value: "STK_A, STK_B" },
      { key: "Derived-from", value: "STK_A" },
    ],
  });
  const count = buildIncomingCount([child]);
  assertEquals(count.get("STK_A" as DisplayId), 2);
  assertEquals(count.get("STK_B" as DisplayId), 1);
});
