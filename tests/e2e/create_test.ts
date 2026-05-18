/**
 * @module tests/e2e/create_test
 *
 * E2E tests for `markspec create <type> <paths...>` — scaffolds a
 * new entry block on stdout, using the active profile's
 * display-id-pattern and the next available number.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: phase5-e2e\nversion: 0.1.0\n`;

const PROFILE_YAML = `id: "@acme/phase5-typed"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`;

const BASE_FILES = {
  "project.yaml": PROJECT_YAML,
  ".markspec.yaml": `profiles:\n  - ./profiles/typed\n`,
  "profiles/typed/markspec.yaml": PROFILE_YAML,
};

const ULID_RE = /Id: [0-9A-HJKMNP-TV-Z]{26}/;

Deno.test("create: empty project scaffolds REQ-0001 with assigned ULID", async () => {
  const { code, stdout } = await markspec(
    ["create", "requirement", "req.md"],
    {
      files: {
        ...BASE_FILES,
        "req.md": `# Empty\n`,
      },
    },
  );
  assertEquals(code, 0);
  assertStringIncludes(stdout, "REQ-0001");
  // ULID is stamped, not a placeholder.
  assertEquals(
    ULID_RE.test(stdout),
    true,
    `expected an Id: with a real ULID, got: ${stdout}`,
  );
});

Deno.test("create: with existing entries, scaffolds the next display ID", async () => {
  const { code, stdout } = await markspec(
    ["create", "requirement", "req.md"],
    {
      files: {
        ...BASE_FILES,
        "req.md": `# Example

- [REQ-0001] First

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [REQ-0002] Second

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`,
      },
    },
  );
  assertEquals(code, 0);
  assertStringIncludes(stdout, "REQ-0003");
});

Deno.test("create: unknown type fails with error", async () => {
  const { code, stderr } = await markspec(
    ["create", "no-such-type", "req.md"],
    {
      files: {
        ...BASE_FILES,
        "req.md": `# Empty\n`,
      },
    },
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no-such-type");
});

Deno.test("create: emits a complete entry block (title line + body + Id trailer)", async () => {
  const { code, stdout } = await markspec(
    ["create", "requirement", "req.md"],
    {
      files: {
        ...BASE_FILES,
        "req.md": `# Empty\n`,
      },
    },
  );
  assertEquals(code, 0);
  // Title-line bullet.
  assertStringIncludes(stdout, "- [REQ-0001]");
  // Trailer with Id stamped.
  assertStringIncludes(stdout, "Id: ");
  // Type attribute reflects the profile-declared name.
  assertStringIncludes(stdout, "Type: requirement");
});
