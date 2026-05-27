/**
 * @module tests/e2e/score_test
 *
 * Blackbox E2E tests for `markspec score`. Invokes the CLI via the
 * shared markspec() helper.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

Deno.test("score --text --format json: prints structured result", async () => {
  const { code, stdout, stderr } = await markspec([
    "score",
    "--text",
    "The system SHALL stop within 200 ms.",
    "--format",
    "json",
  ]);
  assertEquals(code, 0, `stderr: ${stderr}`);
  const parsed = JSON.parse(stdout);
  assertEquals(parsed.id, "EXT_0001");
  assertEquals(typeof parsed.score, "number");
  assertEquals(typeof parsed.warningCount, "number");
  assertEquals(typeof parsed.infoCount, "number");
  assertEquals(Array.isArray(parsed.contributions), true);
  assertEquals(Array.isArray(parsed.diagnostics), true);
});

Deno.test("score --text: caller-supplied id is echoed", async () => {
  const { code, stdout } = await markspec([
    "score",
    "--text",
    "The system shall be fast.",
    "--id",
    "DOORS-001",
    "--format",
    "json",
  ]);
  assertEquals(code, 0);
  const parsed = JSON.parse(stdout);
  assertEquals(parsed.id, "DOORS-001");
});

Deno.test("score: missing --text exits 1 with error message", async () => {
  const { code, stderr } = await markspec(["score"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "error: --text is required");
});
