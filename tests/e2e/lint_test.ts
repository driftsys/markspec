/**
 * @module tests/e2e/lint_test
 *
 * Blackbox E2E tests for `markspec lint`. Runs the CLI binary against
 * fixture files and asserts exit codes, stdout, and stderr.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PROJECT_YAML = `name: test-project
version: 0.0.1
`;

/** A clean requirement with no lint issues. */
const CLEAN_FIXTURE =
  `- [REQ-001] System shall process sensor data within 100 milliseconds

  The system shall receive sensor readings from all active channels and
  process each reading within the required latency budget for real-time
  control operation.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Requirement
`;

/** A fixture that triggers Q302 ('some') and Q303 ('as appropriate'). */
const VAGUE_FIXTURE = `- [REQ-001] System shall handle sensor data

  The system shall use some requirements that should be adequate for
  the task and respond as appropriate to each situation.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Requirement
`;

/** A fixture with a title that is too short (< 3 chars). */
const SHORT_TITLE_FIXTURE = `- [REQ-001] Hi

  The system shall receive sensor readings from all active channels and
  process each reading within the required latency budget for real-time
  control operation.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Requirement
`;

// ---------------------------------------------------------------------------
// 1. Clean fixture exits 0 with valid JSON object output
// ---------------------------------------------------------------------------

Deno.test("lint: clean fixture exits 0 and stdout is valid JSON object", async () => {
  const { code, stdout } = await markspec(
    ["lint", "--format", "json", "req.md"],
    { files: { "project.yaml": PROJECT_YAML, "req.md": CLEAN_FIXTURE } },
  );
  assertEquals(code, 0);
  const parsed = JSON.parse(stdout) as {
    diagnostics: unknown[];
    score: unknown;
  };
  assertEquals(Array.isArray(parsed.diagnostics), true);
  assertEquals(typeof parsed.score, "object");
});

// ---------------------------------------------------------------------------
// 2. Vague fixture triggers MSL-Q302 and MSL-Q303
// ---------------------------------------------------------------------------

Deno.test("lint: vague fixture triggers MSL-Q302 and MSL-Q303", async () => {
  const { code, stdout } = await markspec(
    ["lint", "--format", "json", "req.md"],
    { files: { "project.yaml": PROJECT_YAML, "req.md": VAGUE_FIXTURE } },
  );
  // Exit 2 = warnings present
  assertEquals(code, 2);
  const parsed = JSON.parse(stdout) as { diagnostics: Array<{ code: string }> };
  assertEquals(parsed.diagnostics.some((d) => d.code === "MSL-Q302"), true);
  assertEquals(parsed.diagnostics.some((d) => d.code === "MSL-Q303"), true);
});

// ---------------------------------------------------------------------------
// 3. Short title triggers MSL-Q400
// ---------------------------------------------------------------------------

Deno.test("lint: entry with title < 3 chars triggers MSL-Q400", async () => {
  const { stdout } = await markspec(
    ["lint", "--format", "json", "req.md"],
    { files: { "project.yaml": PROJECT_YAML, "req.md": SHORT_TITLE_FIXTURE } },
  );
  // Q400 is info-severity so exit is 0, but the diagnostic appears in JSON
  const parsed = JSON.parse(stdout) as { diagnostics: Array<{ code: string }> };
  assertEquals(parsed.diagnostics.some((d) => d.code === "MSL-Q400"), true);
});

// ---------------------------------------------------------------------------
// 4. --strict promotes warnings to errors → exits 1
// ---------------------------------------------------------------------------

Deno.test("lint: --strict promotes warnings to errors (exits 1)", async () => {
  const { code } = await markspec(
    ["lint", "--format", "json", "--strict", "req.md"],
    { files: { "project.yaml": PROJECT_YAML, "req.md": VAGUE_FIXTURE } },
  );
  assertEquals(code, 1);
});

// ---------------------------------------------------------------------------
// 5. JSON output includes slug and group fields
// ---------------------------------------------------------------------------

Deno.test("lint: JSON output includes slug, group, scoreContribution", async () => {
  const { code, stdout } = await markspec(
    ["lint", "--format", "json", "req.md"],
    { files: { "project.yaml": PROJECT_YAML, "req.md": VAGUE_FIXTURE } },
  );
  assertEquals(code, 2);
  const parsed = JSON.parse(stdout) as {
    diagnostics: Array<
      { code: string; slug: string; group: string; scoreContribution: number }
    >;
  };
  const q302 = parsed.diagnostics.find((d) => d.code === "MSL-Q302");
  assertEquals(q302 !== undefined, true);
  assertEquals(typeof q302!.slug, "string");
  assertEquals(typeof q302!.group, "string");
  assertEquals(typeof q302!.scoreContribution, "number");
});

// ---------------------------------------------------------------------------
// 6. Regression: markspec validate output unchanged (no MSL-Q codes in validate)
// ---------------------------------------------------------------------------

Deno.test("lint: markspec validate does not emit MSL-Q codes", async () => {
  const { code, stderr } = await markspec(
    ["check", "req.md"],
    { files: { "req.md": VAGUE_FIXTURE } },
  );
  // validate should exit 0 (no structural errors in the fixture)
  assertEquals(code, 0);
  // No MSL-Q codes in validate output
  assertEquals(stderr.includes("MSL-Q"), false);
});

// ---------------------------------------------------------------------------
// 7. Score rollup: JSON output contains score with bands + anti-pattern note
// ---------------------------------------------------------------------------

Deno.test("lint: JSON output contains score rollup with bands and anti-pattern note", async () => {
  const { stdout } = await markspec(
    ["lint", "--format", "json", "req.md"],
    { files: { "project.yaml": PROJECT_YAML, "req.md": VAGUE_FIXTURE } },
  );
  const parsed = JSON.parse(stdout) as {
    score: {
      rollup: { bandCounts: Record<string, number>; mean: number };
      antiPatternNote: string;
    };
  };
  const { score } = parsed;
  assertEquals(typeof score.rollup.mean, "number");
  assertEquals(typeof score.rollup.bandCounts["0"], "number");
  assertEquals(typeof score.rollup.bandCounts["1-3"], "number");
  assertEquals(typeof score.rollup.bandCounts["4-7"], "number");
  assertEquals(typeof score.rollup.bandCounts["8-15"], "number");
  assertEquals(typeof score.rollup.bandCounts["16+"], "number");
  assertEquals(
    score.antiPatternNote,
    "Optimize the requirements, not the score. The score is a smoke detector, not a KPI.",
  );
});

// ---------------------------------------------------------------------------
// 8. Score rollup: text output includes score summary line
// ---------------------------------------------------------------------------

Deno.test("lint: text output includes score summary in stderr", async () => {
  const { stderr } = await markspec(
    ["lint", "req.md"],
    { files: { "project.yaml": PROJECT_YAML, "req.md": VAGUE_FIXTURE } },
  );
  assertStringIncludes(stderr, "Score:");
  assertStringIncludes(stderr, "Mean:");
  assertStringIncludes(stderr, "smoke detector");
});

// ---------------------------------------------------------------------------
// 9. Score rollup: perEntry shape is correct
// ---------------------------------------------------------------------------

Deno.test("lint: JSON score.perEntry has correct shape", async () => {
  const { stdout } = await markspec(
    ["lint", "--format", "json", "req.md"],
    { files: { "project.yaml": PROJECT_YAML, "req.md": VAGUE_FIXTURE } },
  );
  const parsed = JSON.parse(stdout) as {
    score: {
      perEntry: Array<{
        entryId: string;
        displayId: string;
        score: number;
        contributions: Array<
          { code: string; weight: number; occurrences: number }
        >;
      }>;
    };
  };
  assertEquals(parsed.score.perEntry.length > 0, true);
  const entry = parsed.score.perEntry[0];
  assertEquals(typeof entry.displayId, "string");
  assertEquals(typeof entry.score, "number");
  assertEquals(Array.isArray(entry.contributions), true);
});
