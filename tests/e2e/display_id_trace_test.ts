/**
 * @module tests/e2e/display_id_trace_test
 *
 * E2E: profile trace relations accept a display ID (issue #593). A resolving
 * display ID validates clean; an unresolved one warns MSL-L006 (exit 2).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: disp-id-e2e\nversion: 0.1.0\n`;

const PROFILE_YAML = `id: "@acme/disp-id"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
    system-requirement:
      extends: Requirement
      display-id-pattern: "SREQ-{n:04d}"
      traceability:
        Satisfies:
          target: [requirement]
          cardinality: 0..3
          required: false
`;

const BASE_FILES = {
  "project.yaml": PROJECT_YAML,
  ".markspec.yaml": `profiles:\n  - ./profiles/disp\n`,
  "profiles/disp/markspec.yaml": PROFILE_YAML,
};

Deno.test("check: Satisfies a display ID that exists → clean (exit 0)", async () => {
  const { code, stderr } = await markspec(["check", "doc.md"], {
    files: {
      ...BASE_FILES,
      "doc.md": `# Reqs

- [REQ-0001] A requirement

  Body text.

      Id: 01REQ000000000000000000001
      Type: requirement

- [SREQ-0001] A system requirement

  Body text.

      Id: 01SREQ00000000000000000001
      Type: system-requirement
      Satisfies: REQ-0001
`,
    },
  });
  assertEquals(code, 0);
  // The regression: the display-ID value must NOT be rejected by the format
  // gate (MSL-A004), and the resolving target must not warn (MSL-L006).
  assertEquals(
    stderr.split("\n").filter((l) =>
      l.includes("MSL-A004") || l.includes("MSL-L006")
    ),
    [],
  );
});

Deno.test("check: Satisfies a display ID that does not exist → MSL-L006 (exit 2)", async () => {
  const { code, stderr } = await markspec(["check", "doc.md"], {
    files: {
      ...BASE_FILES,
      "doc.md": `# Reqs

- [SREQ-0001] A system requirement

  Body text.

      Id: 01SREQ00000000000000000001
      Type: system-requirement
      Satisfies: REQ-9999
`,
    },
  });
  assertEquals(code, 2); // warning-only → exit 2
  assertStringIncludes(stderr, "MSL-L006");
  assertStringIncludes(stderr, "REQ-9999");
});
