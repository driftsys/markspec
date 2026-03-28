/**
 * @module tests/e2e/report_test
 *
 * E2E tests for `markspec report` subcommand.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const FIXTURE = {
  "project.yaml": "name: test-project\n",
  "req.md": `# Requirements

- [STK_BRK_0001] Stakeholder requirement

  Emergency braking.

  Id: STK_01HGW2Q8MNP3\\
  Labels: ASIL-B

- [SYS_BRK_0042] System requirement

  Threat assessment.

  Id: SYS_01HGW2R9QLP4\\
  Satisfies: STK_BRK_0001\\
  Labels: ASIL-B

- [SRS_BRK_0001] Software requirement

  Sensor debouncing.

  Id: SRS_01HGW2S0ABC5\\
  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B
`,
};

// ---------------------------------------------------------------------------
// Traceability
// ---------------------------------------------------------------------------

Deno.test("report: traceability produces Markdown table", async () => {
  const { code, stdout } = await markspec(
    ["report", "traceability", "req.md"],
    { files: FIXTURE },
  );
  assertEquals(code, 0);
  assertStringIncludes(stdout, "| ID |");
  assertStringIncludes(stdout, "STK_BRK_0001");
  assertStringIncludes(stdout, "SRS_BRK_0001");
});

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

Deno.test("report: coverage produces summary", async () => {
  const { code, stdout } = await markspec(
    ["report", "coverage", "req.md"],
    { files: FIXTURE },
  );
  assertEquals(code, 0);
  assertStringIncludes(stdout, "Total entries");
  assertStringIncludes(stdout, "3");
});

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

Deno.test("report: --format json outputs parseable JSON", async () => {
  const { code, stdout } = await markspec(
    ["report", "traceability", "--format", "json", "req.md"],
    { files: FIXTURE },
  );
  assertEquals(code, 0);
  const parsed = JSON.parse(stdout);
  assertEquals(Array.isArray(parsed), true);
  assertEquals(parsed.length, 3);
});

Deno.test("report: --format csv outputs CSV", async () => {
  const { code, stdout } = await markspec(
    ["report", "traceability", "--format", "csv", "req.md"],
    { files: FIXTURE },
  );
  assertEquals(code, 0);
  assertStringIncludes(stdout, "ID,Title,Type");
  assertStringIncludes(stdout, "SRS_BRK_0001");
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

Deno.test("report: --scope filters by domain", async () => {
  const files = {
    ...FIXTURE,
    "steer.md": `# Steering

- [SRS_STEER_0001] Steering req

  Body.

  Id: SRS_01HGW2T1DEF6\\
  Labels: ASIL-A
`,
  };
  const { code, stdout } = await markspec(
    ["report", "traceability", "--format", "json", "--scope", "BRK", "req.md", "steer.md"],
    { files },
  );
  assertEquals(code, 0);
  const parsed = JSON.parse(stdout);
  // Should only include BRK entries, not STEER
  for (const row of parsed) {
    assertStringIncludes(row.id, "BRK");
  }
});
