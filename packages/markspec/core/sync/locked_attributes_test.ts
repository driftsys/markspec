import { assertEquals } from "@std/assert";
import { inferLockedAttributes } from "./locked_attributes.ts";
import type { Mapping } from "./mapping.ts";

const M: Mapping = {
  schema: 1,
  system: "jira",
  direction: "bidirectional",
  identity: { externalIdScheme: "jira" },
  attributes: [
    {
      markspec: "Title",
      external: "summary",
      direction: "bidirectional",
      locked: false,
    },
    {
      markspec: "Labels",
      external: "labels",
      direction: "inbound",
      locked: true,
    },
    {
      markspec: "Derived-from",
      external: "parent",
      direction: "outbound",
      locked: false,
    },
  ],
  conflict: { default: "manual" },
  cache: { ttlMs: 15 * 60 * 1000 },
  sourcePath: "jira.yaml",
};

Deno.test("inferLockedAttributes: inbound + locked:true attrs are locked", () => {
  const locked = inferLockedAttributes(M);
  assertEquals(locked.has("Labels"), true);
});

Deno.test("inferLockedAttributes: outbound attrs are not locked", () => {
  const locked = inferLockedAttributes(M);
  assertEquals(locked.has("Derived-from"), false);
});

Deno.test("inferLockedAttributes: bidirectional without locked:true is not locked", () => {
  const locked = inferLockedAttributes(M);
  assertEquals(locked.has("Title"), false);
});

Deno.test("inferLockedAttributes: inbound system implies all mapped attrs locked", () => {
  // When the system itself is inbound, every attribute inherits inbound
  // direction unless the per-attribute mapping declared otherwise. The
  // `Mapping` model already substitutes the system direction into the
  // per-attribute `direction` field at parse time (see `parseMapping`),
  // so for this test the bidirectional/inbound/outbound per-attribute
  // values are preserved verbatim. The test fixture below simulates the
  // post-parse state where the system was declared `inbound` and the
  // per-attribute direction was not overridden.
  const inboundMap: Mapping = {
    ...M,
    direction: "inbound",
    attributes: M.attributes.map((a) =>
      a.direction === "bidirectional" ? { ...a, direction: "inbound" } : a
    ),
  };
  const locked = inferLockedAttributes(inboundMap);
  assertEquals(locked.has("Title"), true);
  assertEquals(locked.has("Labels"), true);
  // Outbound per-attribute override still wins.
  assertEquals(locked.has("Derived-from"), false);
});
