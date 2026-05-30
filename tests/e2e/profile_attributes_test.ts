/**
 * @module tests/e2e/profile_attributes_test
 *
 * E2E tests for validator Stage 3 — typed attribute validation through
 * `markspec validate`.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: phase6-e2e\nversion: 0.1.0\n`;

const PROFILE_YAML = `id: "@acme/phase6-attributed"
version: 0.1.0
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved]
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
      required: [Rationale]
      attributes:
        - name: Rationale
          type: text
          cardinality: 1..1
        - name: Count
          type: integer
          cardinality: 0..1
        - name: Owners
          type: tag-list
          cardinality: 2..3
`;

const BASE_FILES = {
  "project.yaml": PROJECT_YAML,
  ".markspec.yaml": `profiles:\n  - ./profiles/attributed\n`,
  "profiles/attributed/markspec.yaml": PROFILE_YAML,
};

Deno.test("profile attributes e2e: happy path — all required present, types valid", async () => {
  const { code, stderr } = await markspec(["check", "req.md"], {
    files: {
      ...BASE_FILES,
      "req.md": `# Example

- [REQ-0001] A requirement

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Rationale: Needed for safety
      Count: 42
      Owners: alice
      Owners: bob
      Status: draft
`,
    },
  });
  // No Stage-3 MSL-A diagnostics expected, and the pipeline suppresses
  // Stage-1 MSL-R010 warnings for profile-declared attributes, so exit
  // code should be 0.
  assertEquals(code, 0);
  const msl_a = stderr.split("\n").filter((l) => l.includes("MSL-A"));
  assertEquals(msl_a, []);
});

Deno.test("profile attributes e2e: missing required → MSL-A001", async () => {
  const { code, stderr } = await markspec(["check", "req.md"], {
    files: {
      ...BASE_FILES,
      "req.md": `# Example

- [REQ-0001] Missing rationale

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-A001");
  assertStringIncludes(stderr, "Rationale");
});

Deno.test("profile attributes e2e: cardinality upper exceeded → MSL-A002", async () => {
  const { code, stderr } = await markspec(["check", "req.md"], {
    files: {
      ...BASE_FILES,
      "req.md": `# Example

- [REQ-0001] Too many owners

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Rationale: needed
      Owners: a
      Owners: b
      Owners: c
      Owners: d
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-A002");
});

Deno.test("profile attributes e2e: cardinality lower unmet → MSL-A003", async () => {
  const { code, stderr } = await markspec(["check", "req.md"], {
    files: {
      ...BASE_FILES,
      "req.md": `# Example

- [REQ-0001] Too few owners

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Rationale: needed
      Owners: single
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-A003");
});

Deno.test("profile attributes e2e: value-type mismatch → MSL-A004", async () => {
  const { code, stderr } = await markspec(["check", "req.md"], {
    files: {
      ...BASE_FILES,
      "req.md": `# Example

- [REQ-0001] Count must be integer

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Rationale: needed
      Count: not-an-integer
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-A004");
});

Deno.test("profile attributes e2e: unknown attribute → MSL-A005 warning", async () => {
  const { code, stderr } = await markspec(["check", "req.md"], {
    files: {
      ...BASE_FILES,
      "req.md": `# Example

- [REQ-0001] Unknown attribute

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Rationale: needed
      Bogus: value
`,
    },
  });
  assertStringIncludes(stderr, "MSL-A005");
  assertStringIncludes(stderr, "Bogus");
  // Warning-only — exit depends on CLI convention. Accept 0 or 2.
  if (code !== 2 && code !== 0) {
    throw new Error(`expected code 0 or 2 for warning-only, got ${code}`);
  }
});

Deno.test("profile attributes e2e: enum type-mismatch → MSL-A004 on Status", async () => {
  const { code, stderr } = await markspec(["check", "req.md"], {
    files: {
      ...BASE_FILES,
      "req.md": `# Example

- [REQ-0001] Bad status

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Rationale: needed
      Status: rejected
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-A004");
});

Deno.test("profile attributes e2e: no profile → no MSL-A diagnostics (core-only)", async () => {
  const { code, stderr } = await markspec(["check", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "req.md": `# Example

- [REQ-0001] No profile

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 0);
  const msl_a = stderr.split("\n").filter((l) => l.includes("MSL-A"));
  assertEquals(msl_a, []);
});
