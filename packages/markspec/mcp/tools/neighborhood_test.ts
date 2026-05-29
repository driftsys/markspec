import { assertStringIncludes } from "@std/assert";
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
