/**
 * @module tests/e2e/fmt_attribute_value_unicode_space_test
 *
 * E2E: `fmt` keeps a U+FEFF or a non-breaking space (U+00A0) at the start
 * or end of a free-text attribute value (#990). Only ASCII spaces and tabs
 * around such a value are layout. A typed core value, such as an `Id:`, is
 * still trimmed of all whitespace, so an invisible character copied with it
 * does not break it. After `fmt`, a second `fmt` changes nothing, and bare
 * `check` reports no error and no MSL-F010.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT = {
  "project.yaml": "name: attribute-unicode-space-e2e\nversion: 0.1.0\n",
};

const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0xa0);

const DOC = `- [REQ-0001] Imported requirement

  The system shall keep imported values unchanged.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF${NBSP}
      Rationale: ${NBSP}kept as imported
      Notes: ${BOM}legacy value${NBSP}
`;

Deno.test("e2e: fmt keeps U+FEFF and U+00A0 around attribute values (#990)", async () => {
  const { dir, code, stderr } = await markspecPersist(["fmt", "req.md"], {
    ...PROJECT,
    "req.md": DOC,
  });
  try {
    assertEquals(code, 0, stderr);
    const out = await Deno.readTextFile(join(dir, "req.md"));
    assertStringIncludes(out, `      Notes: ${BOM}legacy value${NBSP}\n`);
    assertStringIncludes(out, `      Rationale: ${NBSP}kept as imported\n`);
    assertStringIncludes(out, `      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n`);

    const again = await markspecInDir(dir, ["fmt", "req.md"]);
    assertEquals(again.code, 0, again.stderr);
    assertEquals(await Deno.readTextFile(join(dir, "req.md")), out);

    const check = await markspecInDir(dir, ["check"]);
    assert(!check.stderr.includes("MSL-F010"), check.stderr);
    assert(!check.stderr.includes("error["), check.stderr);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
