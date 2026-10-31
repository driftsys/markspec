/**
 * @module tests/e2e/cli_project_resolution_test
 *
 * E2E: the CLI finds the project of each file the same way as the LSP and
 * the MCP server (#845): walk up to the nearest `project.yaml`, else the
 * nearest `.markspec.yaml`.
 *
 * - Explicit file arguments resolve their project from the file's own
 *   directory, not from the current directory.
 * - Files from different projects are validated separately, each against
 *   its own profile.
 * - A bare invocation resolves the project from the current directory and
 *   accepts a `.markspec.yaml`-only project.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { basename, join } from "@std/path";
import { markspec, markspecInDir, markspecPersist } from "./helpers.ts";

/** A local profile that declares the `STK_{n:04d}` type and one text
 * attribute. */
function profileDeclaring(id: string, attribute: string): string {
  return `id: "@acme/${id}"
version: 0.1.0
markspec-schema: "1"
profile:
  attributes:
    - name: ${attribute}
      type: text
  types:
    stakeholder-requirement:
      extends: Requirement
      display-id-pattern: "STK_{n:04d}"
`;
}

/** One formatter-clean entry block that carries the given trailer line.
 * The ULIDs are the ones already used by the LSP e2e fixtures. */
function entryUsing(
  displayId: string,
  attributeLine: string,
  idSuffix = "F",
): string {
  return `# Requirements

- [${displayId}] A requirement

  The system shall respond within 200 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDE${idSuffix}
      ${attributeLine}
`;
}

/** A `.markspec.yaml`-only project (no `project.yaml`) whose local profile
 * declares `Priority`. */
const MARKSPEC_ONLY_PROJECT: Record<string, string> = {
  "proj/.markspec.yaml": "profiles:\n  - ./prof\nexclude:\n  - prof/\n",
  "proj/prof/markspec.yaml": profileDeclaring("prof", "Priority"),
  "proj/docs/req.md": entryUsing("STK_0001", "Priority: high"),
  "outside/.keep": "",
};

/** The duplicate display-ID / duplicate Id diagnostic codes. */
const DUPLICATE_CODES = ["MSL-R005", "MSL-R006", "MSL-I007", "MSL-I008"];

Deno.test("check <file>: .markspec.yaml-only project, run from the project root (#845)", async () => {
  const { code, stderr } = await markspec(["check", "docs/req.md"], {
    files: MARKSPEC_ONLY_PROJECT,
    cwd: "proj",
  });
  assertEquals(stderr.includes("MSL-R010"), false, stderr);
  assertEquals(code, 0, stderr);
});

Deno.test("check <file>: .markspec.yaml-only project, run from a subdirectory (#845)", async () => {
  const { code, stderr } = await markspec(["check", "req.md"], {
    files: MARKSPEC_ONLY_PROJECT,
    cwd: "proj/docs",
  });
  assertEquals(stderr.includes("MSL-R010"), false, stderr);
  assertEquals(code, 0, stderr);
});

Deno.test("check <file>: .markspec.yaml-only project, run from outside the project (#845)", async () => {
  const run = await markspecPersist(["--version"], {
    files: MARKSPEC_ONLY_PROJECT,
  });
  try {
    const { code, stderr } = await markspecInDir(
      join(run.dir, "outside"),
      ["check", join(run.dir, "proj", "docs", "req.md")],
    );
    assertEquals(stderr.includes("MSL-R010"), false, stderr);
    assertEquals(code, 0, stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("check <files>: files from two projects use their own profiles (#845)", async () => {
  const { code, stdout, stderr } = await markspec(
    ["check", "--format", "json", "a/req.md", "a/cross.md", "b/req.md"],
    {
      files: {
        "a/.markspec.yaml": "profiles:\n  - ./prof\n",
        "a/prof/markspec.yaml": profileDeclaring("pa", "Alpha"),
        "a/req.md": entryUsing("STK_0001", "Alpha: alpha value"),
        // `Beta` is declared only by project b's profile.
        "a/cross.md": entryUsing("STK_0002", "Beta: beta value", "G"),
        "b/.markspec.yaml": "profiles:\n  - ./prof\n",
        "b/prof/markspec.yaml": profileDeclaring("pb", "Beta"),
        // Same display ID and same Id as a/req.md: not a duplicate, the
        // two entries live in different projects.
        "b/req.md": entryUsing("STK_0001", "Beta: beta value"),
      },
    },
  );
  const diagnostics = JSON.parse(stdout) as Array<{
    code: string;
    location?: { file: string };
  }>;
  const codes = diagnostics.map((d) => d.code);
  for (const dup of DUPLICATE_CODES) {
    assertEquals(codes.includes(dup), false, `unexpected ${dup}: ${stdout}`);
  }
  const r010 = diagnostics.filter((d) => d.code === "MSL-R010");
  assertEquals(r010.length, 1, `expected one MSL-R010: ${stdout}`);
  assertEquals(r010[0].location?.file, join("a", "cross.md"));
  // MSL-R010 is a warning: a warning-only run exits 2.
  assertEquals(code, 2, stderr);
});

Deno.test("check: bare invocation in a .markspec.yaml-only project checks the whole project (#845)", async () => {
  const run = await markspecPersist(["check"], {
    files: MARKSPEC_ONLY_PROJECT,
    cwd: "proj",
  });
  try {
    assertStringIncludes(run.stderr, "checking 1 file(s) under");
    assertStringIncludes(run.stderr, join(basename(run.dir), "proj"));
    assertEquals(run.stderr.includes("no project root found"), false);
    assertEquals(run.code, 0, run.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("check: bare invocation outside any project names both root markers (#845)", async () => {
  const { code, stderr } = await markspec(["check"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no project root found");
  assertStringIncludes(stderr, "a project.yaml or .markspec.yaml");
});

Deno.test("lint <file>: .markspec.yaml-only project resolves the project from the file (#845)", async () => {
  const { code, stderr } = await markspec(["lint", "docs/req.md"], {
    files: MARKSPEC_ONLY_PROJECT,
    cwd: "proj",
  });
  assertEquals(stderr.includes("no project.yaml found"), false, stderr);
  assertEquals(code, 0, stderr);
});

Deno.test("fmt <file>: .markspec.yaml-only project loads its profile (#845)", async () => {
  // The profile delivers a document (ADR-030). `fmt` refuses to write a
  // delivered document (#700), which it can know only after it loaded the
  // profile of the file's project.
  const { code, stderr } = await markspec(
    ["fmt", "prof/reference/platform.md"],
    {
      files: {
        ".markspec.yaml": "profiles:\n  - ./prof\nexclude:\n  - prof/\n",
        "prof/markspec.yaml": `${profileDeclaring("prof", "Priority")}` +
          `  delivers:\n    - path: reference/platform.md\n      corpus: true\n`,
        "prof/reference/platform.md": entryUsing("STK_0009", "Priority: low"),
      },
    },
  );
  assertEquals(code, 1, stderr);
  assertStringIncludes(stderr, "read-only");
});
