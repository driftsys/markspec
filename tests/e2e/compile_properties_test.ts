/**
 * @module tests/e2e/compile_properties_test
 *
 * E2E tests for `properties.file.*` population on compiled entries.
 * Verifies that every compiled entry carries its source file path and
 * last-modified timestamp when compiled via the CLI.
 */

import { assertEquals, assertMatch } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: test-project\nversion: 0.1.0\n`;

const SAMPLE_MD = `- [STK_0001] The system shall be fast

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

Deno.test("compile: properties.file.path present in --format json output", async () => {
  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "req.md"],
    { files: { "project.yaml": PROJECT_YAML, "req.md": SAMPLE_MD } },
  );
  assertEquals(code, 0);
  const parsed = JSON.parse(stdout);
  const entry = parsed.entries["STK_0001"];
  assertEquals(typeof entry.properties?.file?.path, "string");
});

Deno.test("compile: properties.file.mtime is a valid ISO 8601 timestamp", async () => {
  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "req.md"],
    { files: { "project.yaml": PROJECT_YAML, "req.md": SAMPLE_MD } },
  );
  assertEquals(code, 0);
  const parsed = JSON.parse(stdout);
  const mtime = parsed.entries["STK_0001"]?.properties?.file?.mtime;
  assertMatch(mtime, /^\d{4}-\d{2}-\d{2}T/);
});

Deno.test("export json: properties.file.* fields present in output", async () => {
  const { code, stdout } = await markspec(
    ["export", "json", "req.md"],
    { files: { "project.yaml": PROJECT_YAML, "req.md": SAMPLE_MD } },
  );
  assertEquals(code, 0);
  const parsed = JSON.parse(stdout);
  const entry = parsed.entries["STK_0001"];
  assertEquals(typeof entry.properties?.file?.path, "string");
  assertMatch(entry.properties?.file?.mtime, /^\d{4}-\d{2}-\d{2}T/);
});
