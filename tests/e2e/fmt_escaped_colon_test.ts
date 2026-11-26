/**
 * @module tests/e2e/fmt_escaped_colon_test
 *
 * E2E: `fmt` keeps every line of an entry-body paragraph whose second line
 * starts with an encoded (`&#58;`) or escaped (`\:`) colon (#989). Such a
 * colon is prose, not a definition-list marker. After `fmt`, `fmt --check`
 * exits 0 and bare `check` reports no MSL-F010.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT = {
  "project.yaml": "name: escaped-colon-e2e\nversion: 0.1.0\n",
};

/** The issue's input, with `colon` as the start of the second body line. */
function doc(colon: string): string {
  return `- [REQ-0001] Imported paragraph

  Term
  ${colon} first line
  second line.
  third line shall stay.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
}

for (const colon of ["&#58;", "\\:", ":"]) {
  Deno.test(`e2e: fmt keeps every line after a '${colon}' line in an entry body (#989)`, async () => {
    const { dir, code, stderr } = await markspecPersist(["fmt", "req.md"], {
      ...PROJECT,
      "req.md": doc(colon),
    });
    try {
      assertEquals(code, 0, stderr);
      const out = await Deno.readTextFile(join(dir, "req.md"));
      for (
        const words of [
          "Term",
          "first line",
          "second line.",
          "third line shall stay.",
        ]
      ) {
        assertStringIncludes(out, words);
      }
      if (colon !== ":") assertStringIncludes(out, `${colon} first line`);
      // A literal colon is a definition-list marker: the prose pass must not
      // join the term and the definition into one paragraph (#1010).
      if (colon === ":") {
        assertStringIncludes(out, "\n  Term\n  : first line\n");
      }

      const recheck = await markspecInDir(dir, ["fmt", "--check", "req.md"]);
      assertEquals(recheck.code, 0, recheck.stderr);

      const check = await markspecInDir(dir, ["check"]);
      assert(!check.stderr.includes("MSL-F010"), check.stderr);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
}
