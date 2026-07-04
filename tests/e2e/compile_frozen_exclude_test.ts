/**
 * @module tests/e2e/compile_frozen_exclude_test
 *
 * E2E: `markspec compile --frozen` must collect the same file set
 * `markspec lock` pinned — honoring `project.yaml` `exclude:`. An entry
 * living in an excluded directory must not be counted by `--frozen`, or
 * its edges spuriously drift the frozen check against the lockfile
 * (which never counted them). Regression guard for the #684 shared
 * collector closing this parity gap.
 */

import { assertEquals } from "@std/assert";
import { markspecInDir, markspecPersist } from "./helpers.ts";
import { CLEAN_REQ } from "./check_project_test.ts";

const PROJECT_WITH_EXCLUDE = `name: frozen-exclude-e2e\nversion: 0.1.0\n`;

const PROFILE_YAML = `id: "@acme/frozen-exclude"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
    system-requirement:
      extends: Requirement
      display-id-pattern: "SREQ-{n:04d}"
      traceability:
        Satisfies:
          target: [requirement]
          cardinality: 0..3
          required: false
`;

/** A system requirement (with a trace edge) that lives in an EXCLUDED dir. */
const EXCLUDED_SREQ = `# System Requirements

- [SREQ-0001] Derived response time

  The system shall forward responses within 100 ms.

      Id: 01SREQ00000000000000000001
      Type: system-requirement
      Satisfies: REQ-0001
`;

Deno.test("compile --frozen honors project.yaml exclude (no spurious lock drift)", async () => {
  const files = {
    "project.yaml": PROJECT_WITH_EXCLUDE,
    ".markspec.yaml": `profiles:\n  - ./profiles/p\nexclude:\n  - excluded/\n`,
    "profiles/p/markspec.yaml": PROFILE_YAML,
    "docs/req.md": CLEAN_REQ,
    // Its trace edge (SREQ-0001 → REQ-0001) must NOT be pinned or checked —
    // it is under an excluded path.
    "excluded/sreq.md": EXCLUDED_SREQ,
  };
  const run = await markspecPersist(["lock"], {
    files,
    permissions: ["--allow-net", "--allow-env", "--allow-run"],
  });
  try {
    assertEquals(run.code, 0, `lock failed: ${run.stderr}`);

    // `lock` pinned WITHOUT the excluded entry's edge. `compile --frozen`
    // must collect the same set — if it includes the excluded entry, its
    // edge drifts the canonical hash and checkDrift emits MSL-L212 (exit 1).
    const frozen = await markspecInDir(
      run.dir,
      ["compile", "--frozen", "docs/req.md"],
      ["--allow-net", "--allow-env", "--allow-run"],
    );
    assertEquals(
      frozen.stderr.includes("MSL-L212"),
      false,
      `unexpected frozen drift: ${frozen.stderr}`,
    );
    assertEquals(frozen.code, 0, frozen.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
