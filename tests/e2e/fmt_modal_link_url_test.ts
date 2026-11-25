/**
 * @module tests/e2e/fmt_modal_link_url_test
 *
 * E2E: `fmt` lowercases modal keywords in the prose of an entry body but
 * keeps link URLs, link titles, autolinks and image paths as written
 * (#1009). The visible text of a link is prose and is lowercased. After
 * `fmt`, a second `fmt` changes nothing, and bare `check` reports no
 * MSL-F010 and no MSL-F900.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT = {
  "project.yaml": "name: modal-link-url-e2e\nversion: 0.1.0\n",
};

const DOC = `- [REQ-0001] Body with links

  The system SHALL follow [SHALL](http://x.example/SHALL) and
  <http://x.example/MUST>.

  See [the rule](http://a.example/p "MAY") and ![SHALL](img/SHALL.png).

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

Deno.test("e2e: fmt keeps link URLs, titles, autolinks and image paths (#1009)", async () => {
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
        "The system shall follow [shall](http://x.example/SHALL) and",
        "<http://x.example/MUST>.",
        '[the rule](http://a.example/p "MAY")',
        "![SHALL](img/SHALL.png)",
      ]
    ) {
      assertStringIncludes(flat, text);
    }

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
