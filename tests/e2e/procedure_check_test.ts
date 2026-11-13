/**
 * @module tests/e2e/procedure_check_test
 *
 * E2E acceptance test for MSL-B063 (epic #915): `markspec check` warns
 * about a procedure step with no expected result, in a Test entry whose
 * type comes only from its display-ID prefix.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROFILE_YAML = `id: "@acme/brk"
version: 0.1.0
markspec-schema: "1"
profile:
  types:
    test:
      extends: Test
      display-id-pattern: "TST_BRK_{n:04d}"
`;

const ENTRIES_MD = `# Braking

- [TST_BRK_0010] Braking procedure

  Verify braking.

  \`\`\`feature
  Scenario: Stop
    Given a moving vehicle
    When the driver brakes
    Then the vehicle stops
    When the driver releases the pedal
  \`\`\`

      Id: 01TST00000000000000000010A
`;

Deno.test({
  name: "procedure check: trailing action warns MSL-B063 with prefix typing",
  fn: async () => {
    const { code, stderr } = await markspec(["check", "docs/braking.md"], {
      "project.yaml": `name: brk\nversion: 0.1.0\n`,
      ".markspec.yaml": `profiles:\n  - ./profiles/brk\n`,
      "profiles/brk/markspec.yaml": PROFILE_YAML,
      "docs/braking.md": ENTRIES_MD,
    });
    assertStringIncludes(stderr, "MSL-B063");
    assertStringIncludes(stderr, "add a Then step after the last action");
    assertEquals(code, 2);
  },
});
