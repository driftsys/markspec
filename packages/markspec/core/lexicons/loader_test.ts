/**
 * @module core/lexicons/loader_test
 *
 * Unit tests for the lexicon loader.
 */

import { assertEquals } from "@std/assert";
import { loadLexicon, parseLexiconText } from "./loader.ts";

Deno.test("parseLexiconText: strips comments and blank lines", () => {
  const text = `# header
Monday
Tuesday

# another comment
Wednesday
   # indented comment ignored
   Thursday
`;
  const set = parseLexiconText(text);
  assertEquals(set.has("Monday"), true);
  assertEquals(set.has("Tuesday"), true);
  assertEquals(set.has("Wednesday"), true);
  assertEquals(set.has("Thursday"), true);
  assertEquals(set.size, 4);
});

Deno.test("parseLexiconText: case-sensitive by default", () => {
  const set = parseLexiconText("Monday\nmonday\n");
  assertEquals(set.has("Monday"), true);
  assertEquals(set.has("monday"), true);
  assertEquals(set.size, 2);
});

Deno.test("loadLexicon: loads bundled capitalized-allow", () => {
  const set = loadLexicon("capitalized-allow");
  assertEquals(set.has("Monday"), true);
  assertEquals(set.has("France"), true);
});

Deno.test("loadLexicon: loads bundled sentence-abbrev", () => {
  const set = loadLexicon("sentence-abbrev");
  assertEquals(set.has("e.g."), true);
  assertEquals(set.has("Mr."), true);
});
