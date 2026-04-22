/**
 * @module tests/e2e/profile_inverses_test
 *
 * Blackbox E2E tests for generated inverse attributes in compiled output.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { assertNotMatch } from "@std/assert/not-match";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: phase8-inverse-e2e\nversion: 0.1.0\n`;

const PROFILE_YAML = `id: "@acme/phase8-inverse"
version: 0.1.0
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
    test:
      shape: identified
      display-id-pattern: "TEST-{n:04d}"
      attributes:
        - name: Verifies
          type: id-list
          inverse:
            name: Verified-by
            category: requirement
`;

const BASE_FILES = {
  "project.yaml": PROJECT_YAML,
  ".markspec.yaml": `profiles:\n  - ./profiles/inverse\n`,
  "profiles/inverse/markspec.yaml": PROFILE_YAML,
};

const DOC_MD = `# Inverses

- [REQ-0001] A requirement

  Id: 01REQ000000000000000000001\\

- [TEST-0001] A test

  Id: 01TEST00000000000000000001\\
  Verifies: 01REQ000000000000000000001\\
`;

Deno.test("compile e2e: generated inverse Verified-by appears on requirement", async () => {
  const { code, stdout, stderr } = await markspec(
    ["compile", "--format", "json", "doc.md"],
    {
      files: {
        ...BASE_FILES,
        "doc.md": DOC_MD,
      },
    },
  );

  assertEquals(code, 0, `expected exit 0, stderr: ${stderr}`);
  assertStringIncludes(stdout, "Verified-by");
  assertStringIncludes(stdout, "01TEST00000000000000000001");
});

Deno.test("compile e2e: no profile → no generated inverses", async () => {
  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "doc.md"],
    {
      files: {
        "project.yaml": PROJECT_YAML,
        "doc.md": DOC_MD,
      },
    },
  );

  assertEquals(code, 0);
  assertNotMatch(stdout, /Verified-by/);
});

Deno.test("compile e2e: MSL-L005 warning on authored-vs-generated mismatch", async () => {
  const docWithAuthored = `# Mismatch

- [REQ-0001] A requirement

  Id: 01REQ000000000000000000001\\
  Verified-by: 01WRONG0000000000000000001\\

- [TEST-0001] A test

  Id: 01TEST00000000000000000001\\
  Verifies: 01REQ000000000000000000001\\
`;

  const { stderr } = await markspec(
    ["compile", "--format", "json", "doc.md"],
    {
      files: {
        ...BASE_FILES,
        "doc.md": docWithAuthored,
      },
    },
  );

  assertStringIncludes(stderr, "MSL-L005");
});
