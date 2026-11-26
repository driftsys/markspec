/**
 * @module tests/e2e/lint_q500_keywords_test
 *
 * E2E: MSL-Q500 never reports a modal or EARS keyword as an undefined term,
 * whether `fmt` left it lowercase or uppercased it under `rfc8174`. A real
 * undefined term in the same text is still reported.
 */

import { assert, assertEquals } from "@std/assert";
import { markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT = {
  "project.yaml": "name: q500-e2e\nversion: 0.1.0\n",
  ".markspec.yaml": "profiles:\n  - ./profiles/p\n",
  "profiles/p/markspec.yaml": `markspec-schema: "1"
id: "@acme/q500"
version: 0.1.0
profile:
  conventions:
    modal-keywords:
      casing: rfc8174
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`,
};

const DOC = `- [REQ-0001] Wording

  The BrakeController shall apply pressure. It must not stall.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
`;

Deno.test("e2e: lint skips uppercased modal keywords under rfc8174 but reports a real undefined term", async () => {
  const { dir, code, stderr } = await markspecPersist(["fmt", "req.md"], {
    ...PROJECT,
    "req.md": DOC,
  });
  try {
    assertEquals(code, 0, stderr);
    assert((await Deno.readTextFile(`${dir}/req.md`)).includes("SHALL"));
    const lint = await markspecInDir(dir, ["lint", "req.md"]);
    const output = lint.stdout + lint.stderr;
    assert(output.includes("MSL-Q500"), output);
    assert(output.includes("'BrakeController'"), output);
    assert(!output.includes("'BrakeController SHALL'"), output);
    assert(!output.includes("'SHALL'"), output);
    assert(!output.includes("'MUST NOT'"), output);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
