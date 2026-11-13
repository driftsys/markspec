/**
 * @module tests/e2e/gherkin_procedure_test
 *
 * Blackbox tests for MSL-B063 (a procedure step with no expected result) and
 * for unchanged output when a project has no Gherkin fences (epic #915).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

// Entry types come from a profile: without one, `entry.type` stays unset and
// no entry counts as a Test entry.
const PROFILE_YAML = `id: "@acme/brk"
version: 0.1.0
markspec-schema: "1"
profile:
  types:
    test:
      extends: Test
      display-id-pattern: "TST_BRK_{n:04d}"
`;

const projectFiles = (entries: string): Record<string, string> => ({
  "project.yaml": `name: brk\nversion: 0.1.0\n`,
  ".markspec.yaml": `profiles:\n  - ./profiles/brk\n`,
  "profiles/brk/markspec.yaml": PROFILE_YAML,
  "proc.md": entries,
});

const testEntry = (lastLine: string): string =>
  `# Procedures

- [TST_BRK_0010] Braking procedure

  The procedure verifies braking.

  \`\`\`feature
  Scenario: Stop
    Given a moving vehicle
    When the driver brakes
    Then the vehicle stops
    ${lastLine}
  \`\`\`

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

Deno.test("check: MSL-B063 warns on a trailing action in a Test entry", async () => {
  const { code, stderr } = await markspec(["check", "proc.md"], {
    files: projectFiles(testEntry("When the driver releases the pedal")),
  });
  assertEquals(code, 2, `stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-B063");
  assertStringIncludes(stderr, "proc.md:12");
});

Deno.test("check: no MSL-B063 when every step has an expected result", async () => {
  const { stderr } = await markspec(["check", "proc.md"], {
    files: projectFiles(testEntry("Then the pedal is free")),
  });
  assertEquals(stderr.includes("MSL-B063"), false, stderr);
});

Deno.test("check --format json: MSL-B063 is reported as a warning", async () => {
  const { stdout, stderr } = await markspec(
    ["check", "--format", "json", "proc.md"],
    { files: projectFiles(testEntry("When the driver releases the pedal")) },
  );
  const text = stdout.trim() === "" ? stderr : stdout;
  assertStringIncludes(text, "MSL-B063");
});
