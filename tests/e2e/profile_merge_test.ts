/**
 * @module tests/e2e/profile_merge_test
 *
 * E2E tests for extends-chain + merge through `markspec validate`.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: phase3-e2e\nversion: 0.1.0\n`;

const BASE_YAML = `id: "@acme/phase3-base"
version: 1.0.0
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved, deprecated]
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
`;

const CHILD_VALID_YAML = `id: "@acme/phase3-child"
version: 1.0.0
extends: "../base"
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved]
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
`;

const CHILD_RELAX_YAML = `id: "@acme/phase3-bad-child"
version: 1.0.0
extends: "../base"
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved, deprecated, new-value]
`;

const REQ_MD = `# Example

- [REQ-0001] A requirement

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

Deno.test("profile merge e2e: valid two-tier chain loads cleanly", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/child\n`,
      "profiles/base/markspec.yaml": BASE_YAML,
      "profiles/child/markspec.yaml": CHILD_VALID_YAML,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 0);
  const lines = stderr.split("\n").filter((l) =>
    l.includes("PROFILE-LOAD") || l.includes("PROFILE-MERGE")
  );
  assertEquals(lines, []);
});

Deno.test("profile merge e2e: relaxation in child fails with PROFILE-MERGE-001", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/child\n`,
      "profiles/base/markspec.yaml": BASE_YAML,
      "profiles/child/markspec.yaml": CHILD_RELAX_YAML,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "PROFILE-MERGE-001");
});

Deno.test("profile merge e2e: direct extends cycle fails with PROFILE-LOAD-004", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/a\n`,
      "profiles/a/markspec.yaml":
        `id: "@acme/a"\nversion: 1.0.0\nextends: "../b"\n`,
      "profiles/b/markspec.yaml":
        `id: "@acme/b"\nversion: 1.0.0\nextends: "../a"\n`,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "PROFILE-LOAD-004");
});

Deno.test("profile merge e2e: unreachable parent in chain fails with PROFILE-LOAD-001", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/leaf\n`,
      "profiles/leaf/markspec.yaml":
        `id: "@acme/leaf"\nversion: 1.0.0\nextends: "../missing"\n`,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "PROFILE-LOAD-001");
});
