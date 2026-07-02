/**
 * @module tests/e2e/doctor_toolchain_test
 *
 * E2E tests for `markspec doctor` toolchain version-skew (slice F).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: test-project\nversion: 0.1.0\n`;
const MARKSPEC_YAML = `profiles:\n  - ./profiles/test\n`;
const MINIMAL_PROFILE = `id: "@acme/test"\nversion: 0.2.0\n`;

/** A valid lockfile with the given toolchain floor (or no floor when undefined).
 * The edge hash is the canonical hash of an *empty* edge set — these projects
 * carry no entries, so an in-sync lockfile must record zero edges. A placeholder
 * hash here would trip `doctor`'s #658 lockfile-edge-drift check and mask the
 * toolchain-floor behaviour these tests target. */
const EMPTY_EDGES_HASH =
  "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";

function lockfile(floor: string | undefined): string {
  const toolchain = floor === undefined
    ? ""
    : `\n[meta.toolchain]\nmin-version = "${floor}"\n`;
  return `schema = 1

[meta]
markspec-schema = 1
locked-at = "2026-05-27T12:00:00Z"
${toolchain}
[generated-cache]
edges-hash = "${EMPTY_EDGES_HASH}"
edges-count = 0
`;
}

const baseFiles = {
  "project.yaml": PROJECT_YAML,
  ".markspec.yaml": MARKSPEC_YAML,
  "profiles/test/markspec.yaml": MINIMAL_PROFILE,
};

Deno.test("doctor: CLI below workspace floor exits 2 with warning", async () => {
  const { code, stderr } = await markspec(["doctor"], {
    files: { ...baseFiles, "markspec.lock": lockfile("99.0") },
  });
  assertEquals(code, 2);
  assertStringIncludes(stderr, "below workspace floor");
  assertStringIncludes(stderr, "99.0");
});

Deno.test("doctor: below floor JSON has belowFloor + diagnostic", async () => {
  const { code, stdout } = await markspec(["doctor", "--format", "json"], {
    files: { ...baseFiles, "markspec.lock": lockfile("99.0") },
  });
  assertEquals(code, 2);
  const data = JSON.parse(stdout);
  assertEquals(data.toolchain.belowFloor, true);
  assertEquals(data.toolchain.floor, "99.0");
  assertEquals(
    data.diagnostics.some((d: { code: string }) =>
      d.code === "toolchain-below-floor"
    ),
    true,
  );
});

Deno.test("doctor: CLI at/above floor exits 0 with check", async () => {
  const { code, stderr } = await markspec(["doctor"], {
    files: { ...baseFiles, "markspec.lock": lockfile("0.1") },
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "workspace floor 0.1");
});

Deno.test("doctor: lockfile without floor reports no floor, exits 0", async () => {
  const { code, stderr } = await markspec(["doctor"], {
    files: { ...baseFiles, "markspec.lock": lockfile(undefined) },
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "no workspace floor declared");
});

Deno.test("doctor: no lockfile reports no floor, JSON floor null", async () => {
  const { code, stdout } = await markspec(["doctor", "--format", "json"], {
    files: { ...baseFiles },
  });
  assertEquals(code, 0);
  const data = JSON.parse(stdout);
  assertEquals(data.toolchain.floor, null);
  assertEquals(data.toolchain.belowFloor, false);
  assertEquals(data.toolchain.cliVersion.length > 0, true);
});

Deno.test("doctor: present-but-malformed lockfile floor → no floor, exits 0", async () => {
  const malformed = `schema = 1

[meta]
markspec-schema = 1
locked-at = "2026-05-27T12:00:00Z"

[meta.toolchain]
min-version = "garbage"

[generated-cache]
edges-hash = "sha256:abc"
edges-count = 0
`;
  const { code, stderr } = await markspec(["doctor"], {
    files: { ...baseFiles, "markspec.lock": malformed },
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "no workspace floor declared");
});
