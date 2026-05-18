/**
 * @module tests/e2e/profile_types_test
 *
 * E2E tests for validator Stage 2 — entry classification through
 * `markspec validate`.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: phase5-e2e\nversion: 0.1.0\n`;

const PROFILE_YAML = `id: "@acme/phase5-typed"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: error
    note:
      extends: Item
      display-id-pattern: "NOTE-{n:03d}"
      display-id-pattern-enforcement: off
`;

Deno.test("profile types e2e: entry matching REQ pattern classifies cleanly", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/typed\n`,
      "profiles/typed/markspec.yaml": PROFILE_YAML,
      "req.md": `# Example

- [REQ-0001] A requirement

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 0);
  const msl_t = stderr.split("\n").filter((l) => l.includes("MSL-T"));
  assertEquals(msl_t, []);
});

Deno.test("profile types e2e: un-classified entry emits MSL-T003", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/typed\n`,
      "profiles/typed/markspec.yaml": PROFILE_YAML,
      "req.md": `# Example

- [FOO-001] An entry with no matching type

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-T003");
});

Deno.test("profile types e2e: explicit Type: attribute overrides display-ID inference", async () => {
  const { code } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/typed\n`,
      "profiles/typed/markspec.yaml": PROFILE_YAML,
      "req.md": `# Example

- [FOO-001] Explicitly typed as note

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: note
`,
    },
  });
  assertEquals(code, 0);
});

Deno.test("profile types e2e: explicit Type: unknown value emits MSL-T001", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/typed\n`,
      "profiles/typed/markspec.yaml": PROFILE_YAML,
      "req.md": `# Example

- [REQ-0001] Unknown type

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: bogus
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-T001");
});

Deno.test("profile types e2e: pattern-enforcement=error + mismatch emits MSL-T004 error", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/typed\n`,
      "profiles/typed/markspec.yaml": PROFILE_YAML,
      "req.md": `# Example

- [FOO-001] Requirement via explicit Type: but wrong display-ID form

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-T004");
});

Deno.test("profile types e2e: no .markspec.yaml — core-only mode, no MSL-T diagnostics", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "req.md": `# Example

- [FOO-001] An entry

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 0);
  const msl_t = stderr.split("\n").filter((l) => l.includes("MSL-T"));
  assertEquals(msl_t, []);
});
