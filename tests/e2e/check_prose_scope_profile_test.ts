/**
 * @module tests/e2e/check_prose_scope_profile_test
 *
 * E2E: bare `markspec check` runs the prose rules on an entry that only a
 * profile display-ID pattern types, as `markspec lint` does (#1039). Before
 * the fix, `check` passed unclassified entries to the prose gate and the
 * pattern-only entry never entered the prose scope.
 */

import { assertEquals } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROFILE = `markspec-schema: "1"
id: "@acme/check-prose-scope"
version: 0.1.0
profile:
  types:
    stakeholder-requirement:
      extends: Requirement
      display-id-pattern: "STK_{n:4d}"
`;

const DOC = `# Test

- [STK_0001] Explicit profile type

  The system should log faults.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: stakeholder-requirement

- [STK_0002] Display-ID pattern only

  The system should log faults.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`;

Deno.test("check (bare): MSL-Q201 fires for a pattern-only profile Requirement subtype (#1039)", async () => {
  const { stdout, stderr } = await markspec(["check", "--format", "json"], {
    files: {
      "project.yaml": "name: check-prose-scope\nversion: 0.1.0\n",
      ".markspec.yaml": "profiles:\n  - ./profiles/p\n",
      "profiles/p/markspec.yaml": PROFILE,
      "stk.md": DOC,
    },
  });
  const lines = DOC.split("\n");
  const diagnostics = JSON.parse(stdout) as {
    code: string;
    location?: { file: string; line: number };
  }[];
  const q201 = diagnostics
    .filter((d) =>
      d.code === "MSL-Q201" && /[\\/]stk\.md$/.test(d.location?.file ?? "")
    )
    .map((d) => /\[([^\]]+)\]/.exec(lines[d.location!.line - 1])?.[1] ?? "?")
    .sort();
  assertEquals(q201, ["STK_0001", "STK_0002"], stderr);
});

Deno.test("check (bare): a prose warning on a pattern-only profile Requirement subtype exits 2 (#1039)", async () => {
  // MSL-Q200 is a warning. The only entry is typed by the display-ID
  // pattern, so the warning exists only when the prose scope sees the entry.
  const doc = `# Test

- [STK_0001] Display-ID pattern only

  The system shall log faults and shall retry the write.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const { code, stdout, stderr } = await markspec(
    ["check", "--format", "json"],
    {
      files: {
        "project.yaml": "name: check-prose-scope\nversion: 0.1.0\n",
        ".markspec.yaml": "profiles:\n  - ./profiles/p\n",
        "profiles/p/markspec.yaml": PROFILE,
        "stk.md": doc,
      },
    },
  );
  const codes = (JSON.parse(stdout) as { code: string; severity: string }[])
    .filter((d) => d.severity !== "info").map((d) => d.code);
  assertEquals(codes.includes("MSL-Q200"), true, stderr);
  assertEquals(code, 2, stderr);
});
