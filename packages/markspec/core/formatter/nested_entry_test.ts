/**
 * @module formatter/nested_entry_test
 *
 * An entry that holds a nested entry-shaped item (MSL-P024, #928) is left
 * unchanged by the entry-level formatter passes, also when other entries are
 * formatted. Tab-marker normalization and ADR-026 trace-value canonicalization
 * still apply to it.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { findAttributeBlockRange, format } from "./mod.ts";
import { parseMarkdown } from "../parser/markdown.ts";

const ID = "01HGW2Q8MNP3RSTVWXYZABCDEF";
const HOST = `- [REQ-001] Parent

  The parent SHALL   stay.


  - [REQ-003] Child

    Child body.

        Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`;
const SIBLING = `
- [REQ-009] Sibling

  The sibling SHALL be formatted.
`;

Deno.test("format: a sibling entry is formatted next to a nested-holding parent (#928)", () => {
  const result = format(HOST + SIBLING, {
    file: "n.md",
    generateUlid: () => ID,
  });
  assertEquals(result.output.startsWith(HOST), true, result.output);
  assertStringIncludes(result.output, "The sibling shall be formatted.");
  assertStringIncludes(result.output, `Id: ${ID}`);
  assertEquals(
    format(result.output, { file: "n.md", generateUlid: () => ID }).output,
    result.output,
  );
});

Deno.test("format: blank lines inside a nested-holding parent are not collapsed (#928)", () => {
  const result = format(HOST + SIBLING, { file: "n.md" });
  assertStringIncludes(result.output, "stay.\n\n\n  - [REQ-003]");
});

Deno.test("findAttributeBlockRange: a marker-only wrapper with two nested entries does not give B's trailer to the parent (#928)", () => {
  const text = `- [REQ-001] Parent

  Body.

  -
    - [REQ-003] A

      A body.

    - [REQ-004] B

      B body.

          Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
`;
  const lines = text.split("\n");
  const [entry] = parseMarkdown(text, { file: "n.md" }).entries;
  assertEquals(entry.nestedEntryLines, [
    { start: 5, end: 8 },
    { start: 10, end: 14 },
  ]);
  // Without both ranges, B's trailer would be read as the parent's.
  assertEquals(
    findAttributeBlockRange(
      lines,
      1,
      2,
      entry.endLine,
      [],
      entry.nestedEntryLines,
    ),
    undefined,
  );
});

Deno.test("findAttributeBlockRange: a nested item that splits the trailer gives no range (#928)", () => {
  const lines = [
    "- [REQ-001] Parent",
    "",
    "  Body.",
    "",
    "      Labels: A",
    "  - [REQ-003] Child",
    "",
    "    Child body.",
    "      Id: " + ID,
  ];
  assertEquals(
    findAttributeBlockRange(lines, 1, 2, 0, [], [{ start: 6, end: 8 }]),
    undefined,
  );
});
