/**
 * @module tests/e2e/fmt_reference_label_table_casing_test
 *
 * E2E: `fmt` keeps a modal keyword used as a reference-link label (#1014)
 * and lowercases one in a table header (#1015), with no MSL-F900. After
 * `fmt`, `fmt --check` exits 0 and bare `check` reports no MSL-F010.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT = {
  "project.yaml": "name: label-casing-e2e\nversion: 0.1.0\n",
};

const DOC = `- [REQ-0001] Reference labels

  See [SHALL] and [the rule][MUST].

  [SHALL]: http://x.example/
  [MUST]: http://y.example/

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [REQ-0002] Table header

  | SHALL |
  |---|
  | x |

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`;

Deno.test("e2e: fmt keeps reference labels and cases a table header (#1014, #1015)", async () => {
  const { dir, code, stderr } = await markspecPersist(["fmt", "req.md"], {
    ...PROJECT,
    "req.md": DOC,
  });
  try {
    assertEquals(code, 0, stderr);
    assert(!stderr.includes("MSL-F900"), stderr);
    const out = await Deno.readTextFile(join(dir, "req.md"));
    assertStringIncludes(out, "See [SHALL] and [the rule][MUST].");
    assertStringIncludes(out, "| shall |");

    const recheck = await markspecInDir(dir, ["fmt", "--check", "req.md"]);
    assertEquals(recheck.code, 0, recheck.stderr);

    const check = await markspecInDir(dir, ["check"]);
    assert(!check.stderr.includes("MSL-F010"), check.stderr);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
