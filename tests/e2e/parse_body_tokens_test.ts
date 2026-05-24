/**
 * @module tests/e2e/parse_body_tokens_test
 *
 * Confirms Entry.bodyTokens flows through the CLI's compile output
 * (the `markspec compile` JSON path).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

Deno.test("compile: bodyTokens surface in JSON output", async () => {
  const md = `- [REQ-1] Title

  The driver shall debounce $Sensor inputs.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "requirements.md"],
    {
      "requirements.md": md,
      "project.yaml": "name: test\nversion: 0.1.0\n",
    },
  );
  assertEquals(code, 0);
  assertStringIncludes(stdout, '"kind": "modal"');
  assertStringIncludes(stdout, '"kind": "entity-ref"');
});
