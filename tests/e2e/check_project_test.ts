/**
 * @module tests/e2e/check_project_test
 *
 * E2E: bare `markspec check` walks every relevant file under the project
 * root (gitignore-aware) and runs the validator in project-wide mode (so
 * MSL-L006 is meaningful). Explicit file args keep the file-local mode.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: check-project-e2e\nversion: 0.1.0\n`;

const PROFILE_YAML = `id: "@acme/check-project"
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

export const BASE_FILES = {
  "project.yaml": PROJECT_YAML,
  ".markspec.yaml": `profiles:\n  - ./profiles/p\n`,
  "profiles/p/markspec.yaml": PROFILE_YAML,
};

const CLEAN_REQ = `# Requirements

- [REQ-0001] Response time

  The system shall respond within 200 ms.

      Id: 01REQ000000000000000000001
      Type: requirement
`;

Deno.test("check: bare invocation walks project and flips MSL-L006 on", async () => {
  const files = {
    ...BASE_FILES,
    "docs/req.md": CLEAN_REQ,
    "docs/sreq.md": `# System Requirements

- [SREQ-0001] Derived response time

  The system shall forward responses within 100 ms.

      Id: 01SREQ00000000000000000001
      Type: system-requirement
      Satisfies: REQ-9999
`,
  };

  // File-local: MSL-L006 suppressed even when both files are passed.
  const fileLocal = await markspec(
    ["check", "docs/req.md", "docs/sreq.md"],
    { files },
  );
  assertEquals(
    fileLocal.stderr.split("\n").filter((l) => l.includes("MSL-L006")).length,
    0,
    `file-local should not emit MSL-L006; got: ${fileLocal.stderr}`,
  );

  // Bare: project-wide — MSL-L006 fires for the unresolved target.
  const all = await markspec(["check"], { files });
  assertStringIncludes(all.stderr, "MSL-L006");
  assertEquals(all.code, 2); // warnings only
});

Deno.test("check: bare invocation prints scope header, -q suppresses it", async () => {
  const files = { ...BASE_FILES, "docs/req.md": CLEAN_REQ };
  const loud = await markspec(["check"], { files });
  assertStringIncludes(loud.stderr, "file(s) under");
  const quiet = await markspec(["check", "-q"], { files });
  assertEquals(quiet.stderr.includes("file(s) under"), false);
});

Deno.test("check: gitignored files are not validated", async () => {
  const { code, stderr } = await markspec(["check"], {
    files: {
      ...BASE_FILES,
      ".gitignore": "drafts/\n",
      "docs/req.md": CLEAN_REQ,
      // Broken entry that would fail hard if it were scanned.
      "drafts/broken.md":
        `# Draft\n\n- [REQ-0001] Duplicate id\n\n  Dup.\n\n      Id: 01REQ000000000000000000001\n`,
    },
  });
  assertEquals(code, 0, `expected clean; stderr: ${stderr}`);
});

Deno.test("check: bare invocation without project root errors with hint", async () => {
  const { code, stderr } = await markspec(["check"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no project root found");
  assertStringIncludes(stderr, "markspec init");
});

Deno.test("check: clean project exits 0", async () => {
  const { code, stderr } = await markspec(["check"], {
    files: { ...BASE_FILES, "docs/req.md": CLEAN_REQ },
  });
  assertEquals(code, 0, `expected exit 0; stderr: ${stderr}`);
});
