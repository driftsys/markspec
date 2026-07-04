import { assertEquals } from "@std/assert";
import { findDuplicateDeclarations } from "./duplicates.ts";

Deno.test("findDuplicateDeclarations: empty registry → empty result", () => {
  assertEquals(findDuplicateDeclarations(new Map()), []);
});

Deno.test("findDuplicateDeclarations: single declaration per name → not a duplicate", () => {
  const registry = new Map([["a", ["decl-a"]]]);
  assertEquals(findDuplicateDeclarations(registry), []);
});

Deno.test("findDuplicateDeclarations: two+ declarations → first plus the rest, in order", () => {
  const registry = new Map([
    ["a", ["decl-a"]],
    ["b", ["b1", "b2", "b3"]],
  ]);
  assertEquals(findDuplicateDeclarations(registry), [
    { name: "b", first: "b1", duplicates: ["b2", "b3"] },
  ]);
});

Deno.test("findDuplicateDeclarations: predicate narrows which names are checked", () => {
  const registry = new Map([
    ["a.b", ["1", "2"]],
    ["plain", ["1", "2"]],
  ]);
  const dotted = findDuplicateDeclarations(
    registry,
    (name) => name.includes("."),
  );
  assertEquals(dotted.map((d) => d.name), ["a.b"]);
});
