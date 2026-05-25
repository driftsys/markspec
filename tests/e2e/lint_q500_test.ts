/**
 * @module tests/e2e/lint_q500_test
 *
 * Blackbox E2E tests for the MSL-Q500 xref-glossary-undefined rule.
 * Runs the CLI binary against fixture files and asserts JSON output.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: test-project
version: 0.0.1
`;

// ---------------------------------------------------------------------------
// Q500: undefined PascalCase fires
// ---------------------------------------------------------------------------

Deno.test("Q500 e2e: undefined PascalCase fires", async () => {
  const { stdout } = await markspec(
    ["lint", "--format", "json", "requirements.md"],
    {
      files: {
        "project.yaml": PROJECT_YAML,
        "requirements.md": `- [STK_BRK_0001] Emergency response

  The BrakeController shall apply pressure within 200 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Requirement
`,
      },
    },
  );
  const parsed = JSON.parse(stdout) as {
    diagnostics: Array<{ code: string; message: string }>;
  };
  const q500 = parsed.diagnostics.find((d) => d.code === "MSL-Q500");
  assertEquals(q500 !== undefined, true);
  assertStringIncludes(q500!.message, "BrakeController");
});

// ---------------------------------------------------------------------------
// Q500: silent when DefinitionList defines it
// ---------------------------------------------------------------------------

Deno.test("Q500 e2e: silent when DefinitionList defines it", async () => {
  const { stdout } = await markspec(
    ["lint", "--format", "json", "requirements.md"],
    {
      files: {
        "project.yaml": PROJECT_YAML,
        "requirements.md": `- [STK_BRK_0001] Emergency response

  Brake Controller
  : the ECU responsible for brake actuation

  The Brake Controller shall apply pressure.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Requirement
`,
      },
    },
  );
  const parsed = JSON.parse(stdout) as { diagnostics: Array<{ code: string }> };
  const q500s = parsed.diagnostics.filter((d) => d.code === "MSL-Q500");
  assertEquals(q500s.length, 0);
});

// ---------------------------------------------------------------------------
// Q500: exit code is 2 for warnings (without --strict)
// ---------------------------------------------------------------------------

Deno.test("Q500 e2e: exit code is 2 for warnings without --strict", async () => {
  const { code } = await markspec(
    ["lint", "--format", "json", "requirements.md"],
    {
      files: {
        "project.yaml": PROJECT_YAML,
        "requirements.md": `- [STK_BRK_0001] Emergency response

  The BrakeController shall apply pressure within 200 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Requirement
`,
      },
    },
  );
  // Exit 2 = warnings present (no --strict, so not promoted to errors)
  assertEquals(code, 2);
});

// ---------------------------------------------------------------------------
// Q500: --strict promotes to error → exit code 1
// ---------------------------------------------------------------------------

Deno.test("Q500 e2e: --strict promotes warning to error → exit 1", async () => {
  const { code } = await markspec(
    ["lint", "--format", "json", "--strict", "requirements.md"],
    {
      files: {
        "project.yaml": PROJECT_YAML,
        "requirements.md": `- [STK_BRK_0001] Emergency response

  The BrakeController shall apply pressure within 200 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Requirement
`,
      },
    },
  );
  // Exit 1 = errors present (promoted by --strict)
  assertEquals(code, 1);
});
