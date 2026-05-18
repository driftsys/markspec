/**
 * @module tests/e2e/next_id_test
 *
 * E2E tests for `markspec next-id <type> <paths...>` — prints the next
 * available display ID for a profile-declared type by scanning the
 * project's existing entries.
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
    note:
      extends: Item
      display-id-pattern: "NOTE-{n:03d}"
`;

const BASE_FILES = {
  "project.yaml": PROJECT_YAML,
  ".markspec.yaml": `profiles:\n  - ./profiles/typed\n`,
  "profiles/typed/markspec.yaml": PROFILE_YAML,
};

Deno.test("next-id: empty project returns REQ-0001 for requirement type", async () => {
  const { code, stdout } = await markspec(
    ["next-id", "requirement", "req.md"],
    {
      files: {
        ...BASE_FILES,
        "req.md": `# Empty\n`,
      },
    },
  );
  assertEquals(code, 0);
  assertEquals(stdout.trim(), "REQ-0001");
});

Deno.test("next-id: with existing REQ entries returns next number", async () => {
  const { code, stdout } = await markspec(
    ["next-id", "requirement", "req.md"],
    {
      files: {
        ...BASE_FILES,
        "req.md": `# Example

- [REQ-0001] First

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [REQ-0003] Third

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`,
      },
    },
  );
  assertEquals(code, 0);
  // Max of {0001, 0003} = 3 → next is 0004 (gaps preserved).
  assertEquals(stdout.trim(), "REQ-0004");
});

Deno.test("next-id: NOTE-{n:03d} pattern uses 3-digit padding", async () => {
  const { code, stdout } = await markspec(["next-id", "note", "req.md"], {
    files: {
      ...BASE_FILES,
      "req.md": `# Example

- [NOTE-005] An existing note

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 0);
  assertEquals(stdout.trim(), "NOTE-006");
});

Deno.test("next-id: unknown type fails with error", async () => {
  const { code, stderr } = await markspec(
    ["next-id", "no-such-type", "req.md"],
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

Deno.test("next-id: --format json emits a JSON object", async () => {
  const { code, stdout } = await markspec(
    ["next-id", "requirement", "--format", "json", "req.md"],
    {
      files: {
        ...BASE_FILES,
        "req.md": `# Empty\n`,
      },
    },
  );
  assertEquals(code, 0);
  const parsed = JSON.parse(stdout);
  assertEquals(parsed.type, "requirement");
  assertEquals(parsed.displayId, "REQ-0001");
});
