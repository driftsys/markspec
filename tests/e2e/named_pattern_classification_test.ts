/**
 * @module tests/e2e/named_pattern_classification_test
 *
 * E2E tests for counter-less ("named") `display-id-pattern` classification
 * (issue #594). A type whose IDs are named, not numbered — e.g. components
 * `SWC_LIGHT_CTRL`, `HWC_PIU` — declares a pattern with no `{n}` counter so
 * it is classified by prefix without an explicit `Type:` trailer.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: named-types-e2e\nversion: 0.1.0\n`;

// `sw-component` / `hw-component` are deliberately named, not numbered:
// the pattern carries a literal prefix and a trailing `{name}` placeholder
// and no `{n}` counter. Enforcement is `off` — there is no counter to
// enforce; the pattern exists purely for prefix-based classification.
const PROFILE_YAML = `id: "@acme/named-types"
version: 0.1.0
profile:
  types:
    sw-component:
      extends: SoftwareComponent
      display-id-pattern: "SWC_{name}"
      display-id-pattern-enforcement: off
    hw-component:
      extends: HardwareComponent
      display-id-pattern: "HWC_{name}"
      display-id-pattern-enforcement: off
`;

Deno.test("named pattern e2e: underscore-bearing named ID classifies, no MSL-T", async () => {
  const { code, stderr } = await markspec(["check", "components.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/named\n`,
      "profiles/named/markspec.yaml": PROFILE_YAML,
      "components.md": `# Components

- [SWC_LIGHT_CTRL] Light controller

  The light controller shall drive the exterior lamps.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [SWC_DSG] Diagnostic supervisor

  The diagnostic supervisor shall report faults.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG

- [HWC_PIU] Power interface unit

  The power interface unit shall regulate the supply rail.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
`,
    },
  });
  assertEquals(code, 0);
  const mslT = stderr.split("\n").filter((l) => l.includes("MSL-T"));
  assertEquals(mslT, []);
});

Deno.test("named pattern e2e: ID not matching any named prefix still emits MSL-T003", async () => {
  const { code, stderr } = await markspec(["check", "components.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/named\n`,
      "profiles/named/markspec.yaml": PROFILE_YAML,
      "components.md": `# Components

- [FOO_BAR] An entry with no matching named prefix

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-T003");
});
