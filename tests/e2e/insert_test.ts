/**
 * @module tests/e2e/insert_test
 *
 * E2E tests for `markspec insert <type> <file>` — the agent write
 * path. Appends a scaffolded entry block to an existing file.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: phase5-e2e\nversion: 0.1.0\n`;

const PROFILE_YAML = `id: "@acme/phase5-typed"
version: 0.1.0
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
`;

const BASE_FILES = {
  "project.yaml": PROJECT_YAML,
  ".markspec.yaml": `profiles:\n  - ./profiles/typed\n`,
  "profiles/typed/markspec.yaml": PROFILE_YAML,
};

const ULID_RE = /Id: [0-9A-HJKMNP-TV-Z]{26}/;

Deno.test("insert: appends a new entry to the target file", async () => {
  const initial = `# Requirements

- [REQ-0001] First

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const { code, stderr } = await markspec(
    ["insert", "requirement", "req.md"],
    {
      files: {
        ...BASE_FILES,
        "req.md": initial,
      },
    },
  );
  assertEquals(code, 0, `expected exit 0; stderr: ${stderr}`);

  // Re-run to validate; should still be 0 errors. We can't easily
  // read the file back through the helper, so assert via a follow-up
  // validate run on the modified file inside the helper's temp dir.
  // Instead, assert the success message + new display ID surfaced.
  assertStringIncludes(stderr, "REQ-0002");
  assertStringIncludes(stderr, "req.md");
});

Deno.test("insert: starts from REQ-0001 when target file is empty/no entries", async () => {
  const { code, stderr } = await markspec(
    ["insert", "requirement", "req.md"],
    {
      files: {
        ...BASE_FILES,
        "req.md": `# Empty\n`,
      },
    },
  );
  assertEquals(code, 0);
  assertStringIncludes(stderr, "REQ-0001");
});

Deno.test("insert: emits a real ULID (not a placeholder)", async () => {
  const { code, stdout, stderr } = await markspec(
    ["insert", "requirement", "req.md", "--print"],
    {
      files: {
        ...BASE_FILES,
        "req.md": `# Empty\n`,
      },
    },
  );
  assertEquals(code, 0, `expected exit 0; stderr: ${stderr}`);
  // --print echoes the inserted block to stdout for inspection.
  assert(ULID_RE.test(stdout), `expected a ULID in stdout, got: ${stdout}`);
});

Deno.test("insert: unknown type fails with error", async () => {
  const { code, stderr } = await markspec(
    ["insert", "no-such-type", "req.md"],
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

Deno.test("insert: target file missing fails with error", async () => {
  const { code, stderr } = await markspec(
    ["insert", "requirement", "does-not-exist.md"],
    {
      files: BASE_FILES,
    },
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "does-not-exist.md");
});
