/**
 * @module tests/e2e/profile_loader_test
 *
 * E2E tests for .markspec.yaml-driven profile loading via `markspec validate`.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

// Minimal project.yaml the helper writes whenever we declare files.
const PROJECT_YAML = `name: phase2-e2e\nversion: 0.1.0\n`;

// Minimal profile that parses cleanly (inlined so the test is self-contained).
const MINIMAL_PROFILE = `id: "@acme/phase2-minimal"\nversion: 0.1.0\n`;

// Minimal markdown file for validate to process.
const REQ_MD =
  `# Example\n\n- [NOTE-001] A note\n\n  Body text.\n\n      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n`;

Deno.test("profile loader e2e: no .markspec.yaml — core-only mode, exit 0", async () => {
  const { code } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 0);
});

Deno.test("profile loader e2e: happy path with local profile — no profile errors", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/minimal\n`,
      "profiles/minimal/markspec.yaml": MINIMAL_PROFILE,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 0);
  // No profile-loader errors in stderr
  const lines = stderr.split("\n").filter((l) =>
    l.includes("PROFILE-LOAD") || l.includes("MARKSPEC-YAML")
  );
  assertEquals(lines, []);
});

Deno.test("profile loader e2e: missing specifier target fails with PROFILE-LOAD-001", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/does-not-exist\n`,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "PROFILE-LOAD-001");
});

Deno.test("profile loader e2e: multiple profiles fails with PROFILE-LOAD-006", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/a\n  - ./profiles/b\n`,
      "profiles/a/markspec.yaml": MINIMAL_PROFILE,
      "profiles/b/markspec.yaml": MINIMAL_PROFILE,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "PROFILE-LOAD-006");
});

Deno.test("profile loader e2e: malformed .markspec.yaml fails with MARKSPEC-YAML-002", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles: [\n  unclosed`,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MARKSPEC-YAML-002");
});

// MSL-A040 — profile must not redefine reserved core keys / types.
Deno.test("profile loader e2e: profile declaring attribute 'Id' fires MSL-A040", async () => {
  const profile = `id: "@acme/redefines-id"
version: 0.1.0
profile:
  attributes:
    - name: Id
      type: text
`;
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/bad\n`,
      "profiles/bad/markspec.yaml": profile,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-A040");
  assertStringIncludes(stderr, "Id");
});

Deno.test("profile loader e2e: profile declaring attribute 'Type' fires MSL-A040", async () => {
  const profile = `id: "@acme/redefines-type"
version: 0.1.0
profile:
  attributes:
    - name: Type
      type: text
`;
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/bad\n`,
      "profiles/bad/markspec.yaml": profile,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-A040");
  assertStringIncludes(stderr, "Type");
});

Deno.test("profile loader e2e: profile declaring core type name 'Requirement' fires MSL-A040", async () => {
  const profile = `id: "@acme/redefines-requirement"
version: 0.1.0
profile:
  types:
    Requirement:
      shape: identified
`;
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/bad\n`,
      "profiles/bad/markspec.yaml": profile,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-A040");
  assertStringIncludes(stderr, "Requirement");
});

Deno.test("profile loader e2e: unknown .markspec.yaml key warns but doesn't block", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/minimal\nbogus: true\n`,
      "profiles/minimal/markspec.yaml": MINIMAL_PROFILE,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "MARKSPEC-YAML-001");
  assertStringIncludes(stderr, "bogus");
});
