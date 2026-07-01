/**
 * @module tests/e2e/lint_default_scope_test
 *
 * E2E: bare `markspec lint` lints every relevant file under the project
 * root (gitignore-aware).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: lint-scope-e2e\nversion: 0.1.0\n`;

// "as appropriate" is an INCOSE vague-term finding (MSL-Q3xx warning).
const VAGUE = `# Doc

- [REQ-0001] A requirement

  The system shall respond as appropriate.

      Id: 01REQ000000000000000000001
`;

Deno.test("lint: bare invocation lints the whole project", async () => {
  const { code, stderr } = await markspec(["lint"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "docs/req.md": VAGUE,
      ".gitignore": "drafts/\n",
      "drafts/ignored.md": VAGUE,
    },
  });
  // Warning-only run exits 2; the finding comes from the tracked file
  // and the gitignored copy contributes nothing.
  assertEquals(code, 2, `stderr: ${stderr}`);
  assertStringIncludes(stderr, "docs/req.md");
  assertEquals(stderr.includes("drafts/ignored.md"), false);
});

Deno.test("lint: bare invocation outside a project errors with hint", async () => {
  const { code, stderr } = await markspec(["lint"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no project root found");
});
