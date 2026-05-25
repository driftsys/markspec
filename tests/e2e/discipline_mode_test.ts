// tests/e2e/discipline_mode_test.ts

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

// Two-tier profile fixture using the .markspec.yaml activation layout
// (project.yaml + .markspec.yaml + profiles/<name>/markspec.yaml).
// Slice 3 noted: this is the ONLY working layout — flat `markspec.yaml`
// at root does not load the profile.
const TIERED_PROFILE = {
  files: {
    "project.yaml": `name: slice5-tiered\nversion: 0.1.0\n`,
    ".markspec.yaml": `profiles:\n  - ./profiles/tiered\n`,
    "profiles/tiered/markspec.yaml": `id: slice5-tiered
version: 0.0.1
markspec-schema: "1"
profile:
  types:
    SoftwareRequirement:
      extends: Requirement
      display-id-pattern: "SWR_{NNNN}"
      discipline: software
    HardwareRequirement:
      extends: Requirement
      display-id-pattern: "HWR_{NNNN}"
      discipline: hardware
`,
  },
};

const FLAT_PROFILE = {
  files: {
    "project.yaml": `name: slice5-flat\nversion: 0.1.0\n`,
    ".markspec.yaml": `profiles:\n  - ./profiles/flat\n`,
    "profiles/flat/markspec.yaml": `id: slice5-flat
version: 0.0.1
markspec-schema: "1"
profile:
  types:
    SystemRequirement:
      extends: Requirement
      display-id-pattern: "SYS_{NNNN}"
`,
  },
};

const DECLARED_FLAT_PROFILE = {
  files: {
    "project.yaml": `name: slice5-declared\nversion: 0.1.0\n`,
    ".markspec.yaml": `profiles:\n  - ./profiles/declared\n`,
    "profiles/declared/markspec.yaml": `id: slice5-declared
version: 0.0.1
markspec-schema: "1"
profile:
  discipline-mode: flat
  types:
    SystemRequirement:
      extends: Requirement
      display-id-pattern: "SYS_{NNNN}"
`,
  },
};

const INVALID_MODE_PROFILE = {
  files: {
    "project.yaml": `name: slice5-bad\nversion: 0.1.0\n`,
    ".markspec.yaml": `profiles:\n  - ./profiles/bad\n`,
    "profiles/bad/markspec.yaml": `id: slice5-bad
version: 0.0.1
markspec-schema: "1"
profile:
  discipline-mode: dual
`,
  },
};

function withRequirements(
  fixture: { files: Record<string, string> },
  body: string,
): Record<string, string> {
  return { ...fixture.files, "requirements.md": body };
}

Deno.test("Slice 5 E2E: doctor JSON reports inferred discipline mode (tiered)", async () => {
  const { code, stdout } = await markspec(
    ["doctor", "--format", "json"],
    TIERED_PROFILE.files,
  );
  assertEquals(code, 0);
  const out = JSON.parse(stdout);
  assertEquals(out.profile.disciplineMode.value, "tiered");
  assertEquals(out.profile.disciplineMode.origin, "inferred");
});

Deno.test("Slice 5 E2E: doctor text mentions inferred discipline mode (flat)", async () => {
  const { code, stderr } = await markspec(["doctor"], FLAT_PROFILE.files);
  assertEquals(code, 0);
  // Doctor writes its human output to stderr (clig.dev: data → stdout, messages → stderr).
  assertStringIncludes(stderr, "Discipline mode: flat (inferred)");
});

Deno.test("Slice 5 E2E: doctor shows (declared) when discipline-mode is explicit", async () => {
  const { stderr } = await markspec(["doctor"], DECLARED_FLAT_PROFILE.files);
  assertStringIncludes(stderr, "Discipline mode: flat (declared)");
});

Deno.test("Slice 5 E2E: PROFILE-DISCIPLINE-006 on invalid discipline-mode value", async () => {
  const { code, stderr } = await markspec(
    ["validate", "requirements.md"],
    withRequirements(INVALID_MODE_PROFILE, "# Empty\n"),
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "PROFILE-DISCIPLINE-006");
});

Deno.test("Slice 5 E2E: create emits mode hint when requesting an off-mode type", async () => {
  // In a tiered profile, the recommended scaffolds are SoftwareRequirement
  // and HardwareRequirement. Requesting bare 'Requirement' (a core type
  // that has no discipline:) is off-mode for tiered.
  // Note: this test exercises whichever signal the implementer wires up.
  // If 'Requirement' itself isn't an acceptable type for `create`, swap
  // to a profile-declared type that's known to be off-mode.
  const fixture = {
    files: {
      ...TIERED_PROFILE.files,
      "profiles/tiered/markspec.yaml":
        TIERED_PROFILE.files["profiles/tiered/markspec.yaml"] +
        `    BareRequirement:
      extends: Requirement
      display-id-pattern: "BAR_{NNNN}"
`,
      "requirements.md": "# Existing\n",
    },
  };
  const { stderr } = await markspec(
    ["create", "BareRequirement", "requirements.md"],
    fixture.files,
  );
  assertStringIncludes(stderr, "hint:");
  assertStringIncludes(stderr, "BareRequirement");
});
