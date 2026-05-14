/**
 * @module tests/e2e/hook_test
 *
 * E2E tests for `markspec hook <files...>` — composes
 * `format --check` and `validate` for use as a pre-commit hook.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

Deno.test("hook: clean files exit 0", async () => {
  const input = `# Test

- [REQ-001] My requirement

  The system shall debounce inputs.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const { code } = await markspec(["hook", "req.md"], {
    files: { "req.md": input },
  });
  assertEquals(code, 0);
});

Deno.test("hook: file needing format fails with code 1", async () => {
  // Missing Id — format would assign one (file is not clean).
  const input = `# Test

- [REQ-001] My requirement

  The system shall debounce inputs.
`;
  const { code, stderr } = await markspec(["hook", "req.md"], {
    files: { "req.md": input },
  });
  assertEquals(code, 1);
  // The format check stage emits a per-file "needs formatting" notice.
  assertStringIncludes(stderr, "needs formatting");
});

Deno.test("hook: file with validation error fails with code 1", async () => {
  const input = `# Test

- [REQ-001] My requirement

  The system shall debounce inputs.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: NotARealType
`;
  const { code, stderr } = await markspec(["hook", "req.md"], {
    files: { "req.md": input },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-T020");
});

Deno.test("hook: no files exit 0", async () => {
  const { code } = await markspec(["hook"], {
    files: {},
  });
  assertEquals(code, 0);
});
