/**
 * @module tests/e2e/profile_pattern_validation_test
 *
 * E2E for #597 — a malformed `display-id-pattern` in a profile is reported as
 * a clean `PROFILE-TYPE-008` diagnostic at profile-load instead of throwing an
 * uncaught exception mid-validation (which crashed `markspec check`).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: pattern-validation-e2e\nversion: 0.1.0\n`;
const MARKSPEC_YAML = `profiles:\n  - ./profiles/acme\n`;

// `SWC_{x}_{x}` repeats the named placeholder `{x}` — building the recognizer
// regex would throw "Duplicate capture group name". Before #597 that surfaced
// as an uncaught engine error during classifyEntry.
const BAD_PROFILE_YAML = `id: "@acme/bad-pattern"
markspec-schema: "1"
version: 0.1.0
profile:
  types:
    sw-component:
      extends: SoftwareComponent
      display-id-pattern: "SWC_{x}_{x}"
      display-id-pattern-enforcement: off
`;

const COMPONENTS_MD = `# Components

- [SWC_LIGHT_CTRL] Light controller

  The light controller shall drive the exterior lamps.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

Deno.test("#597 e2e: malformed profile pattern → PROFILE-TYPE-008, not an uncaught crash", async () => {
  const { code, stderr } = await markspec(["check", "components.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": MARKSPEC_YAML,
      "profiles/acme/markspec.yaml": BAD_PROFILE_YAML,
      "components.md": COMPONENTS_MD,
    },
  });
  assertEquals(code, 1, stderr);
  assertStringIncludes(stderr, "PROFILE-TYPE-008");
  assertStringIncludes(stderr, "duplicate named placeholder");
  // The crux of #597: a clean MarkSpec diagnostic, never an engine-level
  // uncaught throw / stack trace.
  assertEquals(stderr.includes("Uncaught"), false, stderr);
});
