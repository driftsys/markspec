/**
 * @module tests/e2e/display_id_pattern_unification_test
 *
 * E2E regression tests for #596 — the two `display-id-pattern` parsers
 * (classification vs minting) no longer disagree. The annex documents
 * `SRS_{n:4d}` (no leading zero) as valid; before the fix the mint parser
 * accepted it but the classification parser threw "invalid padding
 * specifier", crashing `markspec check`. A bare `{n}` was the mirror case:
 * classifiable but silently non-mintable.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: pattern-unification-e2e\nversion: 0.1.0\n`;

// `software-requirement` uses the documented non-leading-zero form
// `SRS_{n:4d}`; `note` uses a bare `{n}` (unpadded, mintable).
const PROFILE_YAML = `id: "@acme/pattern-unification"
version: 0.1.0
profile:
  types:
    software-requirement:
      extends: Requirement
      display-id-pattern: "SRS_{n:4d}"
      display-id-pattern-enforcement: error
    note:
      extends: Requirement
      display-id-pattern: "NOTE-{n}"
`;

const MARKSPEC_YAML = `profiles:\n  - ./profiles/acme\n`;

Deno.test("#596 e2e: SRS_{n:4d} pattern classifies without crashing check", async () => {
  const { code, stderr } = await markspec(["check", "requirements.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": MARKSPEC_YAML,
      "profiles/acme/markspec.yaml": PROFILE_YAML,
      "requirements.md": `# Requirements

- [SRS_0001] Sensor debouncing

  The sensor driver shall debounce raw inputs within 5 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  // Before #596: compileDisplayIdPattern("SRS_{n:4d}") threw, crashing check.
  assertEquals(code, 0, stderr);
  const mslT = stderr.split("\n").filter((l) => l.includes("MSL-T"));
  assertEquals(mslT, []);
});

Deno.test("#596 e2e: bare {n} type is mintable via next-id", async () => {
  const { code, stdout, stderr } = await markspec([
    "next-id",
    "note",
    "notes.md",
  ], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": MARKSPEC_YAML,
      "profiles/acme/markspec.yaml": PROFILE_YAML,
      "notes.md": `# Notes\n`,
    },
  });
  // Before #596: parseDisplayIdPattern("NOTE-{n}") returned undefined and
  // next-id exited 1 with "does not contain a recognised number placeholder".
  assertEquals(code, 0, stderr);
  assertStringIncludes(stdout, "NOTE-1");
});
