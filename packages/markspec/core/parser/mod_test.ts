/**
 * @module parser/mod_test
 *
 * Unit tests for {@linkcode parseFile} — the extension-dispatching entry
 * point over the Markdown and source parsers.
 */

import { assertEquals } from "@std/assert";
import { parseFile } from "./mod.ts";

Deno.test("parseFile: locations stay file-relative after YAML front matter", async () => {
  const md = `---
document-id: DOC-1
---

# Test

- [REQ-001] Valid title

  Body text.

      Id:
`;
  const { entries, diagnostics } = await parseFile(md, { file: "a.md" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].location.line, 7);
  const p021 = diagnostics.filter((d) => d.code === "MSL-P021");
  assertEquals(p021.length, 1);
  assertEquals(p021[0].location, { file: "a.md", line: 11, column: 7 });
});
