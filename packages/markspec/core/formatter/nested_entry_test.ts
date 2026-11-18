/**
 * @module formatter/nested_entry_test
 *
 * An entry that holds a nested entry-shaped item (MSL-P024, #928) is left
 * unchanged by every formatter pass, also when other entries are formatted.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { format } from "./mod.ts";

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
