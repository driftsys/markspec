// tests/e2e/discipline_format_test.ts

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

Deno.test("Slice 3 E2E format: bare Discipline-frozen: stamps today's date", async () => {
  const input = `# Test

- [REQ_001] Title

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Discipline-frozen: software
`;
  const r1 = await markspec(["format", "requirements.md"], {
    "requirements.md": input,
  });
  assertEquals(r1.code, 0);
  assertStringIncludes(r1.stderr, "stamped Discipline-frozen:");
});
