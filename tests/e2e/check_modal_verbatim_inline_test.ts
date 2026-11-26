/**
 * @module tests/e2e/check_modal_verbatim_inline_test
 *
 * E2E: after `fmt`, `check` reports no MSL-M060 for modal keywords that
 * `fmt` keeps (inline code, link URLs, titles, images), no MSL-Q500 for
 * link syntax, and no MSL-F010 (#1017).
 */

import { assert, assertEquals } from "@std/assert";
import { markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT = {
  "project.yaml": "name: modal-verbatim-e2e\nversion: 0.1.0\n",
};

const DOC = `- [REQ-0001] Verbatim modals

  The system shall use \`SHALL\` here and follow [shall](http://x.example/SHALL).

  See [the rule](http://a.example/p "MAY") and ![SHALL](img/SHALL.png).

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

Deno.test("e2e: check after fmt reports no M060 or Q500 for verbatim inline (#1017)", async () => {
  const { dir, code, stderr } = await markspecPersist(["fmt", "req.md"], {
    ...PROJECT,
    "req.md": DOC,
  });
  try {
    assertEquals(code, 0, stderr);
    const check = await markspecInDir(dir, ["check"]);
    assert(!check.stderr.includes("MSL-M060"), check.stderr);
    assert(!check.stderr.includes("MSL-F010"), check.stderr);
    assert(!/MSL-Q500[^\n]*(MAY|SHALL)/.test(check.stderr), check.stderr);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
