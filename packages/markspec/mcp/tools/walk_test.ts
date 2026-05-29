import { assertEquals } from "@std/assert";
import type { CompileResult, Entry, Link } from "../../core/mod.ts";
import { makeDisplayId } from "../../core/mod.ts";
import { walkLinks } from "./walk.ts";

/** Minimal Entry stub — only the fields walkLinks reads. */
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

/** Build a CompileResult from entries + links. */
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

Deno.test("walkLinks: forward satisfies includes start at depth 0", () => {
  const result = compiled(
    [entry("A_0001", "A"), entry("B_0001", "B")],
    [link("A_0001", "B_0001")],
  );
  const nodes = walkLinks(result, "A_0001", 10, "forward", "satisfies");
  assertEquals(nodes.map((n) => [n.displayId, n.depth]), [
    ["A_0001", 0],
    ["B_0001", 1],
  ]);
});

Deno.test("walkLinks: reverse direction follows incoming links", () => {
  const result = compiled(
    [entry("A_0001", "A"), entry("B_0001", "B")],
    [link("B_0001", "A_0001")], // B satisfies A
  );
  const nodes = walkLinks(result, "A_0001", 10, "reverse", "satisfies", {
    includeStart: false,
  });
  assertEquals(nodes.map((n) => n.displayId), ["B_0001"]);
});

Deno.test("walkLinks: respects maxDepth", () => {
  const result = compiled(
    [entry("A_0001", "A"), entry("B_0001", "B"), entry("C_0001", "C")],
    [link("A_0001", "B_0001"), link("B_0001", "C_0001")],
  );
  const nodes = walkLinks(result, "A_0001", 1, "forward", "satisfies");
  assertEquals(nodes.map((n) => n.displayId), ["A_0001", "B_0001"]);
});

Deno.test("walkLinks: cycle-safe", () => {
  const result = compiled(
    [entry("A_0001", "A"), entry("B_0001", "B")],
    [link("A_0001", "B_0001"), link("B_0001", "A_0001")],
  );
  const nodes = walkLinks(result, "A_0001", 10, "forward", "satisfies");
  assertEquals(nodes.map((n) => n.displayId), ["A_0001", "B_0001"]);
});

Deno.test("walkLinks: maxNodes caps emitted neighbours", () => {
  const result = compiled(
    [entry("A_0001", "A"), entry("B_0001", "B"), entry("C_0001", "C")],
    [link("B_0001", "A_0001"), link("C_0001", "A_0001")],
  );
  const nodes = walkLinks(result, "A_0001", 10, "reverse", "satisfies", {
    includeStart: false,
    maxNodes: 1,
  });
  assertEquals(nodes.length, 1);
});

Deno.test("walkLinks: unknown start id returns empty", () => {
  const result = compiled([entry("A_0001", "A")], []);
  assertEquals(walkLinks(result, "Z_9999", 10, "forward", "satisfies"), []);
});
