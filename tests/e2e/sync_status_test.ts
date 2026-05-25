/**
 * @module tests/e2e/sync_status_test
 *
 * Smoke tests for `markspec sync status` and `markspec sync show`.
 * Both tests exercise the CLI surface only — no imports from source modules.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

Deno.test("sync status: empty project exits 0", async () => {
  // No bindings, no mappings — sync status should produce no output and
  // exit 0. Full sync workflows are connector-side; this test confirms
  // the read-only surface works end-to-end without errors.
  const { code } = await markspec(["sync", "status"], {
    "project.yaml": "name: t\nversion: '0.0.0'\n",
    "reqs.md": "x\n",
  });
  assertEquals(code, 0);
});

Deno.test("sync show NONEXISTENT exits 1 with informative error", async () => {
  const { code, stderr } = await markspec(
    ["sync", "show", "NONEXISTENT"],
    {
      "project.yaml": "name: t\nversion: '0.0.0'\n",
      "reqs.md": "x\n",
    },
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "not bound");
});
