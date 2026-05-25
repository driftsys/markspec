/**
 * @module core/lint/glossary_test
 *
 * Tests for the glossary-only subset resolver (Slice 4).
 */

import { assertEquals } from "@std/assert";
import { buildGlossaryIndex } from "./glossary.ts";
import { parseFile } from "../parser/mod.ts";

Deno.test("glossary index: indexes in-entry DefinitionList terms", async () => {
  const md = `
- [STK_0001] Test entry

  Body paragraph.

  Foo
  : the foo concept

  Bar Baz
  : another concept

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const { entries } = await parseFile(md, { file: "/x.md" });
  const idx = await buildGlossaryIndex(
    entries,
    () => Promise.resolve(undefined),
  );
  assertEquals(idx.has("foo"), true);
  assertEquals(idx.has("bar-baz"), true);
  assertEquals(idx.has("nope"), false);
});

Deno.test("glossary index: indexes glossary file H3 terms + aliases", async () => {
  const entries: never[] = [];
  const glossaryMd = `<!-- markspec:glossary -->
# Glossary

## A

### Automotive Safety Integrity Level (ASIL)

Body.

### Active Distance Sensor

Body.
`;
  const idx = await buildGlossaryIndex(entries, (path) => {
    if (path === "/glossary.md") {
      return Promise.resolve({ content: glossaryMd, file: "/glossary.md" });
    }
    return Promise.resolve(undefined);
  }, ["/glossary.md"]);
  assertEquals(idx.has("automotive-safety-integrity-level"), true);
  assertEquals(idx.has("asil"), true); // R4-g alias
  assertEquals(idx.has("active-distance-sensor"), true);
});

Deno.test("glossary index: empty inputs → empty index", async () => {
  const idx = await buildGlossaryIndex([], () => Promise.resolve(undefined));
  assertEquals(idx.has("anything"), false);
  assertEquals(idx.size(), 0);
});

Deno.test("glossary index: missing glossary file is silent (returns undefined reader)", async () => {
  // Reader returns undefined for paths that don't exist. The index
  // should not throw — missing files just contribute nothing.
  const idx = await buildGlossaryIndex(
    [],
    () => Promise.resolve(undefined),
    ["/missing.md"],
  );
  assertEquals(idx.size(), 0);
});
