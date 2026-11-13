/**
 * @module tests/e2e/gherkin_role_test
 *
 * Blackbox tests for MSL-B064 (a criteria scenario with no outcome step) and
 * for unchanged output when a project has no Gherkin fences (epic #915).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import { markspec } from "./helpers.ts";

const PROFILE_YAML = `id: "@acme/brk"
version: 0.1.0
markspec-schema: "1"
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ_BRK_{n:04d}"
`;

const projectFiles = (entries: string): Record<string, string> => ({
  "project.yaml": `name: brk\nversion: 0.1.0\n`,
  ".markspec.yaml": `profiles:\n  - ./profiles/brk\n`,
  "profiles/brk/markspec.yaml": PROFILE_YAML,
  "req.md": entries,
});

const requirement = (lastLine: string): string =>
  `# Requirements

- [REQ_BRK_0010] Braking criterion

  The system shall stop the vehicle.

  \`\`\`feature
  Scenario: Stop
    Given a moving vehicle
    When the driver brakes
    ${lastLine}
  \`\`\`

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

Deno.test("check: MSL-B064 warns on a Requirement scenario with no Then", async () => {
  const { code, stderr } = await markspec(["check", "req.md"], {
    files: projectFiles(requirement("And the pedal is pressed")),
  });
  assertEquals(code, 2, `stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-B064");
  assertStringIncludes(stderr, "req.md:8");
});

Deno.test("check: no MSL-B064 when the scenario has a Then step", async () => {
  const { code, stderr } = await markspec(["check", "req.md"], {
    files: projectFiles(requirement("Then the vehicle stops")),
  });
  assertEquals(code, 0, stderr);
  assertEquals(stderr.includes("MSL-B064"), false, stderr);
});

const PLAIN = `# Requirements

- [REQ_BRK_0010] Braking criterion

  The system shall stop the vehicle.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

// Regression guard: a project without a feature fence must give the same
// output as before the block-role checks existed. The snapshots were
// generated with the CLI of origin/main.
Deno.test("check --format json: unchanged output without a feature fence", async (t) => {
  const { code, stdout, stderr } = await markspec(
    ["check", "--format", "json", "req.md"],
    { files: projectFiles(PLAIN) },
  );
  assertEquals(code, 0, stderr);
  await assertSnapshot(t, stdout);
});

Deno.test("compile --format json: unchanged output without a feature fence", async (t) => {
  const { code, stdout, stderr } = await markspec(
    ["compile", "--format", "json", "req.md"],
    { files: projectFiles(PLAIN) },
  );
  assertEquals(code, 0, stderr);
  // Normalise temp-dir paths and file modification times.
  const normalised = stdout
    .replace(
      /\/(?:private\/)?(?:var|tmp)[^"\s]*?\/(req\.md|[\w.-]+)(?=["\s])/g,
      "<tmp>/$1",
    )
    .replace(/"mtime":\s*"[^"]*"/g, '"mtime": "<mtime>"');
  await assertSnapshot(t, normalised);
});
