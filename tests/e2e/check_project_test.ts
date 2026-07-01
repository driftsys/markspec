/**
 * @module tests/e2e/check_project_test
 *
 * E2E: bare `markspec check` walks every relevant file under the project
 * root (gitignore-aware) and runs the validator in project-wide mode (so
 * MSL-L006 is meaningful). Explicit file args keep the file-local mode.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec, markspecInDir, markspecPersist } from "./helpers.ts";

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

export const CLEAN_REQ = `# Requirements

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

Deno.test("check: unformatted file fails the gate with MSL-F010", async () => {
  const { code, stderr } = await markspec(["check"], {
    files: {
      ...BASE_FILES,
      // Missing Id: — `markspec fmt` would stamp it, so this is drift.
      "docs/unformatted.md": `# Doc

- [REQ-0002] Unformatted

  The system shall respond within 200 ms.

      Type: requirement
`,
    },
  });
  assertStringIncludes(stderr, "MSL-F010");
  assertStringIncludes(stderr, "markspec fmt");
  assertEquals(code, 1); // error severity blocks
});

Deno.test("check: formatted project does not emit MSL-F010", async () => {
  const { code, stderr } = await markspec(["check"], {
    files: { ...BASE_FILES, "docs/req.md": CLEAN_REQ },
  });
  assertEquals(stderr.includes("MSL-F010"), false, stderr);
  assertEquals(code, 0, stderr);
});

Deno.test("check: lockfile edge drift fails with MSL-L212", async () => {
  // 1. Build a project and generate a lockfile that pins its edges.
  const run = await markspecPersist(["lock"], {
    files: {
      ...BASE_FILES,
      "docs/req.md": CLEAN_REQ,
      "docs/sreq.md": `# System Requirements

- [SREQ-0001] Derived response time

  The system shall forward responses within 100 ms.

      Id: 01SREQ00000000000000000001
      Type: system-requirement
      Satisfies: REQ-0001
`,
    },
    permissions: ["--allow-net", "--allow-env", "--allow-run"],
  });
  try {
    assertEquals(run.code, 0, `lock failed: ${run.stderr}`);

    // 2. In-sync project: check passes the lockfile gate.
    const clean = await markspecInDir(run.dir, ["check"]);
    assertEquals(clean.stderr.includes("MSL-L212"), false, clean.stderr);

    // 3. Change the traceability graph without re-locking.
    const sreqPath = `${run.dir}/docs/sreq.md`;
    const content = await Deno.readTextFile(sreqPath);
    await Deno.writeTextFile(
      sreqPath,
      content.replace("Satisfies: REQ-0001", ""),
    );
    const drifted = await markspecInDir(run.dir, ["check"]);
    assertStringIncludes(drifted.stderr, "MSL-L212");
    assertEquals(drifted.code, 1);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("check: malformed lockfile is an error", async () => {
  const { code, stderr } = await markspec(["check"], {
    files: {
      ...BASE_FILES,
      "docs/req.md": CLEAN_REQ,
      "markspec.lock": "this is not toml {{{",
    },
  });
  assertEquals(code, 1, stderr);
});

Deno.test("check: lockfile gate skipped in file-local mode", async () => {
  const { code, stderr } = await markspec(["check", "docs/req.md"], {
    files: {
      ...BASE_FILES,
      "docs/req.md": CLEAN_REQ,
      "markspec.lock": "this is not toml {{{",
    },
  });
  assertEquals(stderr.includes("MSL-L2"), false, stderr);
  assertEquals(code, 0, stderr);
});
