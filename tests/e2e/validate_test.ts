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

Deno.test("validate: display-ID containing :: emits MSL-T021 inference warning", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [braking::controller::debounce] Debounce function

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(
    code,
    2,
    `expected exit 2 (warning), got ${code}; stderr: ${stderr}`,
  );
  assertStringIncludes(stderr, "MSL-T021");
});

Deno.test("validate: lowercase Type: in core-only mode rejected with MSL-T023", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [SRS_BRK_0001] Title

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-T023");
  assertStringIncludes(stderr, "requirement");
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
// Per-type attribute compatibility — spec §1.6, MSL-T022
// ---------------------------------------------------------------------------

Deno.test("validate: Allocated-to on a Component fires MSL-T022 warning", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [comp-1] My component

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Component
      Allocated-to: 01HGW2Q8MNP3RSTVWXYZABCDEG
`,
    },
  });
  assertEquals(
    code,
    2,
    `expected exit 2 (warning), got ${code}; stderr: ${stderr}`,
  );
  assertStringIncludes(stderr, "MSL-T022");
  assertStringIncludes(stderr, "Allocated-to");
  // The attr is core-known; MSL-R010 should NOT also fire on it.
  assertEquals(
    /MSL-R010[^\n]*Allocated-to/.test(stderr),
    false,
    `MSL-R010 should be suppressed for core-typed attributes; stderr: ${stderr}`,
  );
});

Deno.test("validate: Satisfies on a Requirement passes (inherits Specification)", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001] First requirement

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Requirement
      Satisfies: 01HGW2Q8MNP3RSTVWXYZABCDEG

- [REQ-002] Parent requirement

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Type: Requirement
`,
    },
  });
  assertEquals(code, 0, `expected exit 0, got ${code}; stderr: ${stderr}`);
});

Deno.test("validate: License on a SoftwareComponent passes (own attribute)", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [sw-1] My package

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: SoftwareComponent
      License: Apache-2.0
`,
    },
  });
  assertEquals(code, 0, `expected exit 0, got ${code}; stderr: ${stderr}`);
});

Deno.test("validate: License on a Specification fires MSL-T022 warning", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [spec-1] My specification

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Specification
      License: Apache-2.0
`,
    },
  });
  assertEquals(
    code,
    2,
    `expected exit 2 (warning), got ${code}; stderr: ${stderr}`,
  );
  assertStringIncludes(stderr, "MSL-T022");
  assertStringIncludes(stderr, "License");
});

// ---------------------------------------------------------------------------
// Cross-file trace — link target type compatibility (spec §4.8, MSL-R083)
// ---------------------------------------------------------------------------

Deno.test("validate: Satisfies target of type Component fires MSL-R083", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001] My requirement

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Requirement
      Satisfies: 01HGW2Q8MNP3RSTVWXYZABCDEG

- [comp-1] My component

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Type: Component
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-R083");
  assertStringIncludes(stderr, "Satisfies");
});

Deno.test("validate: Satisfies target of type Requirement passes (R083 OK)", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001] First

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Requirement
      Satisfies: 01HGW2Q8MNP3RSTVWXYZABCDEG

- [REQ-002] Parent

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Type: Requirement
`,
    },
  });
  assertEquals(code, 0, `expected exit 0, got ${code}; stderr: ${stderr}`);
});

Deno.test("validate: Supersedes target with mismatched shape fires MSL-R084", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001] Authored requirement that supersedes a reference

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Supersedes: https://example.com/external-spec

- [external-spec] External standard cited as the predecessor

      Id: https://example.com/external-spec
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-R084");
});

Deno.test("validate: Supersedes target with same shape passes", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-002] Newer

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Supersedes: 01HGW2Q8MNP3RSTVWXYZABCDEG

- [REQ-001] Older

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`,
    },
  });
  assertEquals(code, 0, `expected exit 0, got ${code}; stderr: ${stderr}`);
});

Deno.test("validate: Allocated-to target of type Specification fires MSL-R083", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001] Source requirement

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Requirement
      Allocated-to: 01HGW2Q8MNP3RSTVWXYZABCDEG

- [REQ-002] Target requirement (should be Component)

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Type: Requirement
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-R083");
  assertStringIncludes(stderr, "Allocated-to");
});

// ---------------------------------------------------------------------------
// Captions — spec §2.6
// ---------------------------------------------------------------------------

Deno.test("validate: orphan Figure: caption emits MSL-C070", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [SRS_BRK_0001] Sensor input

  This is body text.

  Figure: An orphan caption with no figure adjacent

  More body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-C070");
});

Deno.test("validate: Figure: caption adjacent to image passes", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [SRS_BRK_0001] Sensor input

  ![Sensor diagram](sensor.svg)

  Figure: Sensor connection diagram

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 0, `expected exit 0, got ${code}; stderr: ${stderr}`);
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
