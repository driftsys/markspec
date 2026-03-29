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

  Id: SRS_01HGW2Q8MNP3\\
  Labels: ASIL-B
`,
    },
  });
  assertEquals(code, 0);
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

Deno.test("validate: broken Satisfies reference exits 1", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [SRS_BRK_0001] Title

  Body text.

  Id: SRS_01HGW2Q8MNP3\\
  Satisfies: SYS_BRK_9999\\
  Labels: ASIL-B
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-T001");
  assertStringIncludes(stderr, "SYS_BRK_9999");
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

  Id: SRS_01HGW2Q8MNP3\\
  CustomKey: some value\\
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

  Id: SRS_01HGW2Q8MNP3\\
  CustomKey: some value\\
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
/// Id: SRS_01HGW2Q8MNP3A1B2C3D4E5
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

Deno.test("validate: mixed .md and .rs files", async () => {
  const { code } = await markspec(["validate", "req.md", "lib.rs"], {
    files: {
      "req.md": `# Test

- [SYS_BRK_0042] System requirement

  Body.

  Id: SYS_01HGW2Q8MNP3A1B2C3D4E5
`,
      "lib.rs": `/// [SRS_BRK_0001] Software requirement
///
/// Body.
///
/// Id: SRS_01HGW2R9QLP4A1B2C3D4E5\\
/// Satisfies: SYS_BRK_0042
fn impl_debounce() {}
`,
    },
  });
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
