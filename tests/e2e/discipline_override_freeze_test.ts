// tests/e2e/discipline_override_freeze_test.ts

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const TIERED_PROFILE = {
  files: {
    "project.yaml": `name: slice3-tiered\nversion: 0.1.0\n`,
    ".markspec.yaml": `profiles:\n  - ./profiles/tiered\n`,
    "profiles/tiered/markspec.yaml": `id: slice3-tiered
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

function withRequirements(body: string): Record<string, string> {
  return { ...TIERED_PROFILE.files, "requirements.md": body };
}

Deno.test("Slice 3 E2E: Discipline: override beats type-based and shows in derivedDiscipline", async () => {
  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "requirements.md"],
    withRequirements(`# Requirements

- [SWR_0001] Should be software but author asserts hardware

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: SoftwareRequirement
      Discipline: hardware
`),
  );
  // Exit 0 because the conflict is a warning, not an error.
  assertEquals(code, 0, "compile should exit 0 (warning only)");
  const compiled = JSON.parse(stdout);
  const entry = compiled.entries["SWR_0001"];
  // Override wins for derivedDiscipline (channel 1 precedence).
  assertEquals(entry.derivedDiscipline, "hardware");
});

Deno.test("Slice 3 E2E: Discipline: override-vs-type conflict surfaces MSL-T028", async () => {
  const { stderr } = await markspec(
    ["check", "requirements.md"],
    withRequirements(`# Requirements

- [SWR_0001] Mismatched override

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: SoftwareRequirement
      Discipline: hardware
`),
  );
  assertStringIncludes(stderr, "MSL-T028");
});

Deno.test("Slice 3 E2E: Discipline: unknown kind fails with MSL-T025", async () => {
  const { code, stderr } = await markspec(
    ["check", "requirements.md"],
    withRequirements(`# Requirements

- [SWR_0001] Unknown kind asserted

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: SoftwareRequirement
      Discipline: nonsense
`),
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-T025");
  assertStringIncludes(stderr, "nonsense");
});

Deno.test("Slice 3 E2E: Discipline-frozen: malformed value fails with MSL-T026", async () => {
  const { code, stderr } = await markspec(
    ["check", "requirements.md"],
    withRequirements(`# Requirements

- [SWR_0001] Malformed freeze

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: SoftwareRequirement
      Discipline-frozen: software @ 2026-02-30
`),
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-T026");
});

Deno.test("Slice 3 E2E: Discipline-frozen: divergence from current derivation surfaces MSL-T030", async () => {
  const { stderr } = await markspec(
    ["check", "requirements.md"],
    withRequirements(`# Requirements

- [SWR_0001] Frozen as hardware but currently classifies as software

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: SoftwareRequirement
      Discipline-frozen: hardware @ 2026-01-15
`),
  );
  assertStringIncludes(stderr, "MSL-T030");
});

Deno.test("Slice 3 E2E: Discipline: and Discipline-frozen: disagreement surfaces MSL-T031", async () => {
  const { stderr } = await markspec(
    ["check", "requirements.md"],
    withRequirements(`# Requirements

- [SWR_0001] Override software, freeze hardware

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: SoftwareRequirement
      Discipline: software
      Discipline-frozen: hardware @ 2026-01-15
`),
  );
  assertStringIncludes(stderr, "MSL-T031");
});
