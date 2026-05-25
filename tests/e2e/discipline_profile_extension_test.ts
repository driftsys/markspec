/**
 * @module tests/e2e/discipline_profile_extension_test
 *
 * E2E tests for profile extension of the discipline registry (ADR-017 Slice 2).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const TIERED_PROFILE = {
  files: {
    "project.yaml": `name: tiered-test\nversion: 0.1.0\n`,
    ".markspec.yaml": `profiles:\n  - ./profiles/tiered\n`,
    "profiles/tiered/markspec.yaml": `id: tiered
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
    "requirements.md": `# Requirements

- [SWR_0001] Brake controller debounces pedal input

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: SoftwareRequirement

- [HWR_0001] Brake actuator delivers force within 12kN

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Type: HardwareRequirement
`,
  },
};

const FIRMWARE_PROFILE = {
  files: {
    "project.yaml": `name: firmware-test\nversion: 0.1.0\n`,
    ".markspec.yaml": `profiles:\n  - ./profiles/firmware\n`,
    "profiles/firmware/markspec.yaml": `id: firmware-test
version: 0.0.1
markspec-schema: "1"
profile:
  kinds:
    firmware:
      description: Embedded firmware modules
  types:
    FirmwareUnit:
      extends: SoftwareUnit
      display-id-pattern: "FWU_{NNNN}"
      discipline: firmware
    InheritedSwUnit:
      extends: SoftwareUnit
      display-id-pattern: "INH_{NNNN}"
      # no discipline — auto-inherits 'software' from SoftwareUnit
`,
    "units.md": `# Units

- [FWU_0001] Bootloader firmware

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
      Type: FirmwareUnit

- [INH_0001] Auto-inherited software unit

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEI
      Type: InheritedSwUnit
`,
  },
};

const UNKNOWN_KIND_PROFILE = {
  files: {
    "project.yaml": `name: bad-test\nversion: 0.1.0\n`,
    ".markspec.yaml": `profiles:\n  - ./profiles/bad\n`,
    "profiles/bad/markspec.yaml": `id: bad
version: 0.0.1
markspec-schema: "1"
profile:
  types:
    BadType:
      extends: Requirement
      display-id-pattern: "BAD_{NNNN}"
      discipline: nonsense
`,
    "empty.md": `# Placeholder\n`,
  },
};

const RESERVED_KIND_PROFILE = {
  files: {
    "project.yaml": `name: reserved-test\nversion: 0.1.0\n`,
    ".markspec.yaml": `profiles:\n  - ./profiles/reserved\n`,
    "profiles/reserved/markspec.yaml": `id: reserved
version: 0.0.1
markspec-schema: "1"
profile:
  kinds:
    mixed:
      description: reserved sentinel
`,
    "empty.md": `# Placeholder\n`,
  },
};

Deno.test("Slice 2 E2E: tiered profile drives channel-3 classification via discipline:", async () => {
  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "requirements.md"],
    TIERED_PROFILE,
  );
  assertEquals(code, 0);
  const compiled = JSON.parse(stdout);
  const byId = compiled.entries as Record<
    string,
    { derivedDiscipline?: string }
  >;
  assertEquals(byId["SWR_0001"]?.derivedDiscipline, "software");
  assertEquals(byId["HWR_0001"]?.derivedDiscipline, "hardware");
});

Deno.test("Slice 2 E2E: profile-declared kinds and auto-inheritance", async () => {
  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "units.md"],
    FIRMWARE_PROFILE,
  );
  assertEquals(code, 0);
  const compiled = JSON.parse(stdout);
  const byId = compiled.entries as Record<
    string,
    { derivedDiscipline?: string }
  >;
  // Profile-declared kind + explicit discipline:
  assertEquals(byId["FWU_0001"]?.derivedDiscipline, "firmware");
  // Auto-inheritance: no explicit discipline → inherits 'software' from SoftwareUnit.
  assertEquals(byId["INH_0001"]?.derivedDiscipline, "software");
});

Deno.test("Slice 2 E2E: unknown kind referenced by discipline: fails the load", async () => {
  const { code, stderr } = await markspec(
    ["compile", "--format", "json", "empty.md"],
    UNKNOWN_KIND_PROFILE,
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "PROFILE-DISCIPLINE-004");
  assertStringIncludes(stderr, "nonsense");
});

Deno.test("Slice 2 E2E: reserved kind name 'mixed' fails the load", async () => {
  const { code, stderr } = await markspec(
    ["compile", "--format", "json", "empty.md"],
    RESERVED_KIND_PROFILE,
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "PROFILE-DISCIPLINE-002");
});
