/**
 * @module tests/e2e/fmt_feature_fence_test
 *
 * E2E: `fmt` rewrites a `feature` fence in an entry body to `gherkin` with
 * no MSL-F900 (#1011). After `fmt`, `fmt --check` exits 0 and bare `check`
 * exits 0 with no MSL-F900 and no MSL-F010.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

const DOC = `- [REQ-0001] Acting requirement

  The system shall act.

  \`\`\`feature
  Feature: F
    Scenario: S
      Given a
      When b
      Then c
  \`\`\`

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

Deno.test("e2e: fmt rewrites a feature fence in an entry body to gherkin (#1011)", async () => {
  const { dir, code, stderr } = await markspecPersist(["fmt", "req.md"], {
    "project.yaml": "name: feature-fence-e2e\nversion: 0.1.0\n",
    "req.md": DOC,
  });
  try {
    assertEquals(code, 0, stderr);
    assert(!stderr.includes("MSL-F900"), stderr);
    const out = await Deno.readTextFile(join(dir, "req.md"));
    assertStringIncludes(out, "```gherkin\n  Feature: F");
    assert(!out.includes("```feature"), out);

    const recheck = await markspecInDir(dir, ["fmt", "--check", "req.md"]);
    assertEquals(recheck.code, 0, recheck.stderr);

    const check = await markspecInDir(dir, ["check"]);
    assertEquals(check.code, 0, check.stderr);
    assert(!check.stderr.includes("MSL-F900"), check.stderr);
    assert(!check.stderr.includes("MSL-F010"), check.stderr);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
