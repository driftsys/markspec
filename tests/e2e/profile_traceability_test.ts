/**
 * @module tests/e2e/profile_traceability_test
 *
 * E2E tests for validator Stage 4 — traceability rules through
 * `markspec validate`.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: phase7-e2e\nversion: 0.1.0\n`;

const PROFILE_YAML = `id: "@acme/phase7-traceable"
version: 0.1.0
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
    test:
      shape: identified
      display-id-pattern: "TEST-{n:04d}"
      traceability:
        Verifies:
          target: [requirement]
          cardinality: 1..2
          required: true
`;

const BASE_FILES = {
  "project.yaml": PROJECT_YAML,
  ".markspec.yaml": `profiles:\n  - ./profiles/traceable\n`,
  "profiles/traceable/markspec.yaml": PROFILE_YAML,
};

Deno.test("traceability e2e: test entry Verifies a requirement → clean", async () => {
  const { code, stderr } = await markspec(["validate", "doc.md"], {
    files: {
      ...BASE_FILES,
      "doc.md": `# Example

- [REQ-0001] A requirement

      Id: 01REQ000000000000000000001

- [TEST-0001] A test

      Id: 01TEST00000000000000000001
      Verifies: 01REQ000000000000000000001
`,
    },
  });
  assertEquals(code, 0);
  const msl_l = stderr.split("\n").filter((l) => l.includes("MSL-L"));
  assertEquals(msl_l, []);
});

Deno.test("traceability e2e: test entry missing Verifies → MSL-L001", async () => {
  const { code, stderr } = await markspec(["validate", "doc.md"], {
    files: {
      ...BASE_FILES,
      "doc.md": `# Example

- [TEST-0001] A test with no Verifies

      Id: 01TEST00000000000000000001
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-L001");
  assertStringIncludes(stderr, "Verifies");
});

Deno.test("traceability e2e: Verifies too many targets → MSL-L002", async () => {
  const { code, stderr } = await markspec(["validate", "doc.md"], {
    files: {
      ...BASE_FILES,
      "doc.md": `# Example

- [REQ-0001] First

      Id: 01REQ000000000000000000001

- [REQ-0002] Second

      Id: 01REQ000000000000000000002

- [REQ-0003] Third

      Id: 01REQ000000000000000000003

- [TEST-0001] A test

      Id: 01TEST00000000000000000001
      Verifies: 01REQ000000000000000000001
      Verifies: 01REQ000000000000000000002
      Verifies: 01REQ000000000000000000003
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-L002");
});

Deno.test("traceability e2e: Verifies points at a non-requirement → MSL-L004", async () => {
  const { code, stderr } = await markspec(["validate", "doc.md"], {
    files: {
      ...BASE_FILES,
      "doc.md": `# Example

- [TEST-0002] Another test

      Id: 01TEST00000000000000000002

- [TEST-0001] A test verifying the wrong type

      Id: 01TEST00000000000000000001
      Verifies: 01TEST00000000000000000002
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-L004");
  assertStringIncludes(stderr, "TEST-0002");
});

Deno.test("traceability e2e: comma-separated Verifies is split by Stage 2.5", async () => {
  const { code, stderr } = await markspec(["validate", "doc.md"], {
    files: {
      ...BASE_FILES,
      "doc.md": `# Example

- [REQ-0001] First

      Id: 01REQ000000000000000000001

- [REQ-0002] Second

      Id: 01REQ000000000000000000002

- [TEST-0001] A test verifying two reqs via CSV syntax

      Id: 01TEST00000000000000000001
      Verifies: 01REQ000000000000000000001, 01REQ000000000000000000002
`,
    },
  });
  assertEquals(code, 0);
  const msl = stderr.split("\n").filter((l) =>
    l.includes("MSL-A004") || l.includes("MSL-L004") || l.includes("MSL-L003")
  );
  assertEquals(msl, []);
});

Deno.test("traceability e2e: no profile → Stage 4 silent", async () => {
  const { code, stderr } = await markspec(["validate", "doc.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "doc.md": `# Example

- [TEST-0001] A test

      Id: 01TEST00000000000000000001
`,
    },
  });
  assertEquals(code, 0);
  const msl_l = stderr.split("\n").filter((l) => l.includes("MSL-L"));
  assertEquals(msl_l, []);
});
