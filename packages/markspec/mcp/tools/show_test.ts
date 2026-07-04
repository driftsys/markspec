import { assertEquals, assertStringIncludes } from "@std/assert";
import type { CompileResult, Entry, Link } from "../../core/mod.ts";
import { makeDisplayId } from "../../core/mod.ts";
import { renderShow } from "./show.ts";

function entry(displayId: string, title: string, body = "Body."): Entry {
  return {
    displayId: makeDisplayId(displayId),
    title,
    body,
    shape: "identified",
    rawAttributes: [],
    type: undefined,
    location: { file: "x.md", line: 1, column: 1 },
  } as unknown as Entry;
}

function link(from: string, to: string, kind = "satisfies"): Link {
  return {
    from: makeDisplayId(from),
    to: makeDisplayId(to),
    kind,
    location: { file: "x.md", line: 1, column: 1 },
  } as unknown as Link;
}

function compiled(entries: Entry[], links: Link[]): CompileResult {
  const entryMap = new Map(entries.map((e) => [e.displayId, e]));
  const forward = new Map<string, Link[]>();
  const reverse = new Map<string, Link[]>();
  for (const l of links) {
    (forward.get(l.from) ?? forward.set(l.from, []).get(l.from)!).push(l);
    (reverse.get(l.to) ?? reverse.set(l.to, []).get(l.to)!).push(l);
  }
  return {
    entries: entryMap,
    links,
    forward,
    reverse,
  } as unknown as CompileResult;
}

Deno.test("renderShow: renders entry with outgoing + incoming links", () => {
  const result = compiled(
    [
      entry("SWE_0001", "Child"),
      entry("SYS_0001", "Parent"),
      entry("TST_0001", "Test"),
    ],
    [link("SWE_0001", "SYS_0001"), link("TST_0001", "SWE_0001", "verifies")],
  );
  const text = renderShow(result, "SWE_0001", undefined);
  assertStringIncludes(text, "SWE_0001 — Child");
  assertStringIncludes(text, "Outgoing links");
  assertStringIncludes(text, "SYS_0001");
  assertStringIncludes(text, "Incoming links");
  assertStringIncludes(text, "TST_0001");
});

Deno.test("renderShow: unknown id returns a not-found message, not a throw", () => {
  const result = compiled([entry("SWE_0001", "Child")], []);
  const text = renderShow(result, "NOPE_9999", undefined);
  assertStringIncludes(text, "No entry with display ID NOPE_9999");
});

Deno.test("renderShow: empty graph", () => {
  const result = compiled([], []);
  assertEquals(
    renderShow(result, "X_0001", undefined),
    "No entry with display ID X_0001.\n",
  );
});

// --- Issue #593: trace targets render as display IDs, never ULIDs ---

Deno.test(
  "entry_show: renders trace targets as display IDs, never ULIDs (issue #593)",
  () => {
    // The target carries a known ULID id. renderShow must reference the
    // target by its displayId in the link list, not by this ULID.
    const TARGET_ULID = "01J0000000000000000000TGT1";
    const target = {
      ...entry("SYS_0001", "Target"),
      id: TARGET_ULID,
    };
    const result = compiled(
      [
        entry("SWE_0001", "Source"),
        target as unknown as ReturnType<typeof entry>,
      ],
      [link("SWE_0001", "SYS_0001")],
    );
    const md = renderShow(result, "SWE_0001", undefined);
    assertStringIncludes(md, "SYS_0001");
    // The target's ULID must not appear in the output — link targets are
    // always identified by display ID. This assertion would fail if
    // renderShow ever emitted the target's `id` field instead of `displayId`.
    assertEquals(md.includes(TARGET_ULID), false);
  },
);

Deno.test("renderShow: upstream entry surfaces the 'from upstream' origin", () => {
  const upstream = {
    ...entry("PRODUCT_STK_0001", "Product req"),
    origin: { kind: "upstream", upstreamId: "product", version: "v2.1.0" },
    location: { file: "docs/product/stk.md", line: 12, column: 1 },
  } as unknown as Entry;
  const result = compiled([upstream], []);
  const md = renderShow(result, "PRODUCT_STK_0001", undefined);
  assertStringIncludes(
    md,
    "**Origin**: from upstream product@v2.1.0 (read-only)",
  );
});
