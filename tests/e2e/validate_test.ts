/**
 * @module tests/e2e/validate_test
 *
 * E2E tests for `markspec validate` subcommand.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Valid file
// ---------------------------------------------------------------------------

Deno.test("validate: valid file exits 0", async () => {
  const { code } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [SRS_BRK_0001] Sensor debouncing

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Labels: ASIL-B
`,
    },
  });
  assertEquals(code, 0);
});

// ---------------------------------------------------------------------------
// Core data model — core abstract types (ADR-003, spec §1.3)
// ---------------------------------------------------------------------------

Deno.test("validate: Type: Specification accepted in core-only mode", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [SRS_BRK_0001] Sensor debouncing

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Specification
      Labels: ASIL-B
`,
    },
  });
  assertEquals(code, 0, `expected exit 0, got ${code}; stderr: ${stderr}`);
});

Deno.test("validate: generated-origin attribute in source rejected with MSL-A030", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [SRS_BRK_0001] Title

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Superseded-by: 01HGW2Q8MNP3RSTVWXYZABCDEG
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-A030");
  assertStringIncludes(stderr, "Superseded-by");
});

Deno.test("validate: unknown Type value rejected with MSL-T020 in core-only mode", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [SRS_BRK_0001] Sensor debouncing

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: NotARealType
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-T020");
  assertStringIncludes(stderr, "NotARealType");
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

Deno.test("validate: missing Id exits 1", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [SRS_BRK_0001] Title

  Body text.

  Labels: ASIL-B
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-R003");
  assertStringIncludes(stderr, "missing Id");
});

Deno.test("validate: unresolved References citation exits 1 (MSL-T005)", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [SRS_BRK_0001] Title

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      References: UNKNOWN-STANDARD
      Labels: ASIL-B
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-T005");
  assertStringIncludes(stderr, "UNKNOWN-STANDARD");
});

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

Deno.test("validate: warning only exits 2", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [SRS_BRK_0001] Title

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      CustomKey: some value
      Labels: ASIL-B
`,
    },
  });
  assertEquals(code, 2);
  assertStringIncludes(stderr, "MSL-R010");
  assertStringIncludes(stderr, "CustomKey");
});

// ---------------------------------------------------------------------------
// --strict
// ---------------------------------------------------------------------------

Deno.test("validate: --strict promotes warning to error → exit 1", async () => {
  const { code } = await markspec(["validate", "--strict", "req.md"], {
    files: {
      "req.md": `# Test

- [SRS_BRK_0001] Title

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      CustomKey: some value
      Labels: ASIL-B
`,
    },
  });
  assertEquals(code, 1);
});

// ---------------------------------------------------------------------------
// --format json
// ---------------------------------------------------------------------------

Deno.test("validate: --format json outputs structured diagnostics", async () => {
  const { code, stdout } = await markspec(
    ["validate", "--format", "json", "req.md"],
    {
      files: {
        "req.md": `# Test

- [SRS_BRK_0001] Title

  Body text.

  Labels: ASIL-B
`,
      },
    },
  );
  assertEquals(code, 1);
  const parsed = JSON.parse(stdout);
  assertEquals(Array.isArray(parsed), true);
  assertEquals(parsed.length > 0, true);
  assertEquals(parsed[0].code, "MSL-R003");
});

// ---------------------------------------------------------------------------
// Source file validation
// ---------------------------------------------------------------------------

Deno.test("validate: valid Rust source file exits 0", async () => {
  const { code } = await markspec(["validate", "lib.rs"], {
    files: {
      "lib.rs": `/// [SRS_BRK_0001] Sensor debouncing
///
/// The sensor driver shall debounce.
///
/// Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
fn debounce() {}
`,
    },
  });
  assertEquals(code, 0);
});

Deno.test("validate: Rust source file missing Id exits 1", async () => {
  const { code, stderr } = await markspec(["validate", "lib.rs"], {
    files: {
      "lib.rs": `/// [SRS_BRK_0001] Sensor debouncing
///
/// The sensor driver shall debounce.
///
/// Labels: ASIL-B
fn debounce() {}
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-R003");
});

Deno.test("validate: mixed .md and .rs files — no error diagnostics", async () => {
  const { code } = await markspec(["validate", "req.md", "lib.rs"], {
    files: {
      "req.md": `# Test

- [SYS_BRK_0042] System requirement

  Body.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
`,
      "lib.rs": `/// [SRS_BRK_0001] Software requirement
///
/// Body.
///
/// Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
fn impl_debounce() {}
`,
    },
  });
  // Exit 0 when no errors; warnings (including MSL-R010 for unknown attrs)
  // produce exit 2, so the fixture uses only universal attributes.
  assertEquals(code, 0);
});

// ---------------------------------------------------------------------------
// No args
// ---------------------------------------------------------------------------

Deno.test("validate: no files exits 1", async () => {
  const { code, stderr } = await markspec(["validate"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no files specified");
});
