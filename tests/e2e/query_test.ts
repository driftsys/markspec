import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Fixtures shared across tests
// ---------------------------------------------------------------------------

const PROJECT_YAML = "name: test-project\n";

const REQUIREMENTS = `# Requirements

- [SYS_BRK_0042] System braking requirement

  The system shall provide emergency braking capability.

  Id: SYS_01HGW2Q8MNP3

- [SRS_BRK_0001] Sensor input debouncing

  The sensor driver shall debounce raw inputs to eliminate electrical noise.

  Id: SRS_01HGW2R9QLP4\\
  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B
`;

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

Deno.test("show: displays entry details by ID", async () => {
  const { code, stdout } = await markspec(
    ["show", "SRS_BRK_0001", "reqs.md"],
    { "project.yaml": PROJECT_YAML, "reqs.md": REQUIREMENTS },
  );

  assertEquals(code, 0);
  assertStringIncludes(stdout, "SRS_BRK_0001");
  assertStringIncludes(stdout, "Sensor input debouncing");
  assertStringIncludes(stdout, "Satisfies");
  assertStringIncludes(stdout, "SYS_BRK_0042");
});

Deno.test("show: exits 1 for nonexistent entry", async () => {
  const { code, stderr } = await markspec(
    ["show", "NONEXISTENT", "reqs.md"],
    { "project.yaml": PROJECT_YAML, "reqs.md": REQUIREMENTS },
  );

  assertEquals(code, 1);
  assertStringIncludes(stderr, "entry not found");
  assertStringIncludes(stderr, "NONEXISTENT");
});

// ---------------------------------------------------------------------------
// context
// ---------------------------------------------------------------------------

Deno.test("context: shows Satisfies chain upward", async () => {
  const { code, stdout } = await markspec(
    ["context", "SRS_BRK_0001", "reqs.md"],
    { "project.yaml": PROJECT_YAML, "reqs.md": REQUIREMENTS },
  );

  assertEquals(code, 0);
  assertStringIncludes(stdout, "SRS_BRK_0001");
  assertStringIncludes(stdout, "SYS_BRK_0042");
});

Deno.test("context: respects --depth 0 showing only the entry itself", async () => {
  const { code, stdout } = await markspec(
    ["context", "SRS_BRK_0001", "--depth", "0", "reqs.md"],
    { "project.yaml": PROJECT_YAML, "reqs.md": REQUIREMENTS },
  );

  assertEquals(code, 0);
  assertStringIncludes(stdout, "SRS_BRK_0001");
  // SYS_BRK_0042 should NOT appear since depth is 0
  assertEquals(stdout.includes("SYS_BRK_0042"), false);
});

// ---------------------------------------------------------------------------
// dependents
// ---------------------------------------------------------------------------

Deno.test("dependents: lists entries that reference the given ID", async () => {
  const { code, stdout } = await markspec(
    ["dependents", "SYS_BRK_0042", "reqs.md"],
    { "project.yaml": PROJECT_YAML, "reqs.md": REQUIREMENTS },
  );

  assertEquals(code, 0);
  assertStringIncludes(stdout, "SRS_BRK_0001");
  assertStringIncludes(stdout, "satisfies");
});
