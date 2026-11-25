/**
 * @module tests/e2e/fmt_verbatim_body_nodes_test
 *
 * E2E: `fmt` keeps the text of captions, figures, math and fenced code in
 * an entry body (#1008): every line and link URL of a multi-line caption,
 * a figure title, TeX escapes in math, and the info string of a code fence.
 * After `fmt`, `fmt --check` exits 0, and bare `check` reports no MSL-F010
 * and no MSL-F900.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT = {
  "project.yaml": "name: verbatim-body-e2e\nversion: 0.1.0\n",
};

const DOC = `- [REQ-0001] Body with captions, a figure, math and code

  Table: see [the spec](http://a.example/p) and _this_
  second line kept.

  | a | b |
  | - | - |
  | 1 | 2 |

  ![a diagram](p.png "The title")

  $$
  a \\\\ b \\_c
  $$

  \`\`\`js title=x
  const a = 1;
  \`\`\`

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

Deno.test("e2e: fmt keeps caption lines, links, figure titles, TeX escapes and info strings (#1008)", async () => {
  const { dir, code, stderr } = await markspecPersist(["fmt", "req.md"], {
    ...PROJECT,
    "req.md": DOC,
  });
  try {
    assertEquals(code, 0, stderr);
    assert(!stderr.includes("MSL-F900"), stderr);
    const out = await Deno.readTextFile(join(dir, "req.md"));
    // Whitespace runs collapsed, so a re-wrap by the prose pass does not
    // matter.
    const flat = out.replace(/\s+/g, " ");
    for (
      const text of [
        "Table: see [the spec](http://a.example/p) and _this_",
        "second line kept.",
        '![a diagram](p.png "The title")',
        "a \\\\ b \\_c",
        "```js title=x",
      ]
    ) {
      assertStringIncludes(flat, text);
    }

    const recheck = await markspecInDir(dir, ["fmt", "--check", "req.md"]);
    assertEquals(recheck.code, 0, recheck.stderr);

    const again = await markspecInDir(dir, ["fmt", "req.md"]);
    assertEquals(again.code, 0, again.stderr);
    assertEquals(await Deno.readTextFile(join(dir, "req.md")), out);

    const check = await markspecInDir(dir, ["check"]);
    assert(!check.stderr.includes("MSL-F010"), check.stderr);
    assert(!check.stderr.includes("MSL-F900"), check.stderr);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
