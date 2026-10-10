/**
 * @module tests/e2e/check_profile_types_test
 *
 * E2E: `markspec check` resolves an entry's profile type — and therefore its
 * `extends:` core type — before evaluating per-type attribute compatibility
 * (MSL-T022 / MSL-T024). Entries classified purely by `display-id-pattern`
 * (no explicit `Type:`) carrying `Satisfies:` / `Derived-from:` used to fire
 * MSL-T024 ("core type could not be resolved") on every entry, while
 * `compile` on the same files classified them cleanly.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROFILE_YAML = `id: "@acme/brk"
version: 0.1.0
markspec-schema: "1"
profile:
  types:
    stakeholder-requirement:
      extends: Requirement
      display-id-pattern: "STK_BRK_{n:04d}"
    system-requirement:
      extends: Requirement
      display-id-pattern: "SYS_BRK_{n:04d}"
      traceability:
        Satisfies:
          target: [stakeholder-requirement]
          cardinality: 0..3
          required: false
        Derived-from:
          target: [stakeholder-requirement]
          cardinality: 0..3
          required: false
    hazard:
      extends: Risk
      display-id-pattern: "HAZ_BRK_{n:04d}"
      traceability:
        Derived-from:
          target: [stakeholder-requirement]
          cardinality: 0..3
          required: false
    system-test:
      extends: Test
      display-id-pattern: "SIT_BRK_{n:04d}"
      traceability:
        Verifies:
          target: [system-requirement]
          cardinality: 0..3
          required: false
`;

const BASE_FILES = {
  "project.yaml": `name: brk\nversion: 0.1.0\n`,
  ".markspec.yaml": `profiles:\n  - ./profiles/brk\n`,
  "profiles/brk/markspec.yaml": PROFILE_YAML,
};

const REQUIREMENTS_MD = `# Requirements

- [STK_BRK_0001] Stop the vehicle

  The vehicle shall stop when the brake pedal is pressed.

      Id: 01STK00000000000000000001A

- [SYS_BRK_0001] Brake actuation

  The system shall actuate the brakes within 100 ms.

      Id: 01SYS00000000000000000001A
      Derived-from: STK_BRK_0001
      Satisfies: STK_BRK_0001

- [HAZ_BRK_0001] Unintended braking

  Spurious brake actuation at speed.

      Id: 01HAZ00000000000000000001A
      Derived-from: STK_BRK_0001

- [SIT_BRK_0001] Brake actuation latency

  Press the pedal and measure actuation latency.

      Id: 01TST00000000000000000001A
      Verifies: SYS_BRK_0001
`;

function linesWith(stderr: string, code: string): string[] {
  return stderr.split("\n").filter((l) => l.includes(code));
}

Deno.test("check: pattern-classified profile types emit no MSL-T024", async () => {
  const files = { ...BASE_FILES, "docs/requirements.md": REQUIREMENTS_MD };

  // Bare (project-wide) and explicit-file (file-local) scopes both run the
  // validator pipeline — neither may report an unresolved core type.
  for (const args of [["check"], ["check", "docs/requirements.md"]]) {
    const { code, stderr } = await markspec(args, { files });
    assertEquals(
      linesWith(stderr, "MSL-T024"),
      [],
      `${args.join(" ")}: unexpected MSL-T024; stderr: ${stderr}`,
    );
    assertEquals(
      linesWith(stderr, "MSL-T022"),
      [],
      `${args.join(" ")}: unexpected MSL-T022; stderr: ${stderr}`,
    );
    assertEquals(code, 0, `${args.join(" ")}: stderr: ${stderr}`);
  }
});

Deno.test("check: per-type attributes are validated against the profile type's core type", async () => {
  // `Mitigated-by:` belongs to core Risk, not Requirement. With the profile
  // type resolved first, the system-requirement is checked as a Requirement
  // and the misplaced attribute is reported (MSL-T022), not hidden behind
  // an "unresolved type" MSL-T024 or a late-stage attribute inference.
  const files = {
    ...BASE_FILES,
    "docs/requirements.md": `# Requirements

- [SYS_BRK_0001] Brake actuation

  The system shall actuate the brakes within 100 ms.

      Id: 01SYS00000000000000000001A
      Mitigated-by: SYS_BRK_0002
`,
  };

  const { stderr } = await markspec(["check"], { files });
  assertEquals(linesWith(stderr, "MSL-T024"), [], `stderr: ${stderr}`);
  const t022 = linesWith(stderr, "MSL-T022");
  assertEquals(t022.length, 1, `stderr: ${stderr}`);
  assertStringIncludes(
    t022[0],
    "'Mitigated-by' is not valid on Type: Requirement",
  );
});
