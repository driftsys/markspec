import { assertEquals, assertStringIncludes } from "@std/assert";
import type { CompileResult, Entry, Link } from "../../core/mod.ts";
import { makeDisplayId } from "../../core/mod.ts";
import { MAX_NODES, renderNeighborhood } from "./neighborhood.ts";

function entry(displayId: string, title: string): Entry {
  return { displayId: makeDisplayId(displayId), title } as unknown as Entry;
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

Deno.test("renderNeighborhood: shows parents (up) and children (down)", () => {
  // SWE satisfies SYS (SYS is parent); TST satisfies SWE (TST is child)
  const result = compiled(
    [
      entry("SWE_0001", "Mid"),
      entry("SYS_0001", "Up"),
      entry("TST_0001", "Down"),
    ],
    [link("SWE_0001", "SYS_0001"), link("TST_0001", "SWE_0001")],
  );
  const text = renderNeighborhood(result, "SWE_0001", 5);
  assertStringIncludes(text, "Parents (up)");
  assertStringIncludes(text, "SYS_0001");
  assertStringIncludes(text, "Children (down)");
  assertStringIncludes(text, "TST_0001");
});

Deno.test("renderNeighborhood: unknown id returns not-found", () => {
  const result = compiled([entry("SWE_0001", "Mid")], []);
  assertStringIncludes(
    renderNeighborhood(result, "NOPE_9999", 5),
    "No entry with display ID NOPE_9999",
  );
});

Deno.test("renderNeighborhood: leaf entry reports no parents/children", () => {
  const result = compiled([entry("SWE_0001", "Mid")], []);
  const text = renderNeighborhood(result, "SWE_0001", 5);
  assertStringIncludes(text, "No parents");
  assertStringIncludes(text, "No children");
});

Deno.test("renderNeighborhood: appends truncation note when node cap is hit", () => {
  const entries = [entry("SWE_0001", "Mid")];
  const links: Link[] = [];
  for (let i = 0; i < MAX_NODES + 5; i++) {
    const id = `TST_${String(i).padStart(4, "0")}`;
    entries.push(entry(id, `t${i}`));
    links.push(link(id, "SWE_0001")); // each is a child
  }
  const text = renderNeighborhood(compiled(entries, links), "SWE_0001", 5);
  assertStringIncludes(text, "truncated");
});

// --- Issue #593: trace targets render as display IDs, never ULIDs ---

Deno.test(
  "entry_neighborhood: renders neighbors as display IDs, never ULIDs (issue #593)",
  () => {
    // Neighbors carry known ULID ids. renderNeighborhood must identify them
    // by displayId in the output, never by these ULIDs.
    const TARGET_ULID = "01J0000000000000000000TGT1";
    const CHILD_ULID = "01J0000000000000000000CHD1";
    const result = compiled(
      [
        entry("SWE_0001", "Mid"),
        { ...entry("SYS_0001", "Up"), id: TARGET_ULID } as unknown as Entry,
        { ...entry("TST_0001", "Down"), id: CHILD_ULID } as unknown as Entry,
      ],
      [link("SWE_0001", "SYS_0001"), link("TST_0001", "SWE_0001")],
    );
    const md = renderNeighborhood(result, "SWE_0001", 5);
    assertStringIncludes(md, "SYS_0001");
    assertStringIncludes(md, "TST_0001");
    // Neither neighbor's ULID may appear — neighbors are identified by
    // display ID only. These assertions would fail if renderNeighborhood
    // ever emitted the `id` fields instead of `displayId`.
    assertEquals(md.includes(TARGET_ULID), false);
    assertEquals(md.includes(CHILD_ULID), false);
  },
);
