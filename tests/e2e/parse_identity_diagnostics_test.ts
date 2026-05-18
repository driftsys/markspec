/**
 * @module tests/e2e/parse_identity_diagnostics_test
 *
 * E2E acceptance tests for §4.1 Parse (MSL-P0xx) and §4.2 Identity & Shape
 * (MSL-I0xx) diagnostic codes from core-data-model.md.
 *
 * These tests exercise `markspec validate` as a black-box CLI command.
 * Each test verifies that the correct diagnostic code surfaces in stderr.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

// ===========================================================================
// §4.1 Parse errors (MSL-P0xx)
// ===========================================================================

// ---------------------------------------------------------------------------
// MSL-P001: bracketed content is empty — `- [] Title`
// ---------------------------------------------------------------------------

Deno.test("validate: empty display-ID brackets → MSL-P001", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [] Empty brackets title

  Body text here.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-P001");
});

// ---------------------------------------------------------------------------
// MSL-P002: title text missing after `]`
// ---------------------------------------------------------------------------

Deno.test("validate: no title after display-ID brackets → MSL-P002", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001]

  Body text here.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-P002");
});

// ---------------------------------------------------------------------------
// MSL-P003: unterminated display-ID brackets (missing `]`)
// ---------------------------------------------------------------------------

Deno.test("validate: unterminated bracket → MSL-P003", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001 Unterminated bracket title

  Body text here.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-P003");
});

// ---------------------------------------------------------------------------
// MSL-P020: trailers block is not the final indented code block
// ---------------------------------------------------------------------------

Deno.test("validate: trailers not final indented block → MSL-P020", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001] Valid title

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

  Body text after the trailers block.
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-P020");
});

// ---------------------------------------------------------------------------
// MSL-P021: trailer line does not match `Key: Value` syntax
// ---------------------------------------------------------------------------

Deno.test("validate: malformed trailer line → MSL-P021", async () => {
  // A line in what appears to be the trailer region that has no colon-
  // separated structure. Since `splitBodyAndAttributes` requires matching
  // ATTR_LINE_RE for inclusion, the malformed line displaces valid trailers
  // into the body and P020 fires. P021 fires on the trailing colon-like
  // line that doesn't parse as a valid Key: Value.
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001] Valid title

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      not-a-key-value: 
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-P021");
});

// ---------------------------------------------------------------------------
// MSL-P022: trailer key contains invalid characters
// ---------------------------------------------------------------------------

Deno.test("validate: invalid trailer key chars → MSL-P022", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001] Valid title

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Bad_Key: some value
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-P022");
});

// ---------------------------------------------------------------------------
// MSL-P030: Authored entry has no body block
// ---------------------------------------------------------------------------

Deno.test("validate: Authored entry without body → MSL-P030", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001] Title only with trailers

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-P030");
});

Deno.test("validate: Reference entry without body → no MSL-P030 (allowed)", async () => {
  const { stderr } = await markspec(["validate", "references.md"], {
    files: {
      "references.md": `# References

- [iso26262] ISO 26262

      Id: urn:iso:std:iso:26262
`,
    },
  });
  // MSL-P030 must NOT fire for Reference-shape entries (body is optional).
  // Other warnings (MSL-T021, MSL-M061) may still be present.
  assertEquals(
    stderr.includes("MSL-P030"),
    false,
    `MSL-P030 should not fire for Reference entries, got: ${stderr}`,
  );
});

// ===========================================================================
// §4.2 Identity & shape (MSL-I0xx) — dual-emit alongside legacy codes
// ===========================================================================

// ---------------------------------------------------------------------------
// MSL-I001 (+ legacy MSL-R004): Id value is neither ULID nor URI
// ---------------------------------------------------------------------------

Deno.test("validate: invalid Id value → MSL-I001 + MSL-R004", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001] Valid title

  Body text.

      Id: not-a-valid-ulid-or-uri
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-I001");
  assertStringIncludes(stderr, "MSL-R004");
});

// ---------------------------------------------------------------------------
// MSL-I002 (+ legacy MSL-R003): Reference-shape entry without Id
// ---------------------------------------------------------------------------

Deno.test("validate: Reference entry missing Id → MSL-I002 + MSL-R003", async () => {
  const { code, stderr } = await markspec(["validate", "references.md"], {
    files: {
      "references.md": `# References

- [serde] Serde library

  A serialization framework.
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-I002");
  assertStringIncludes(stderr, "MSL-R003");
});

// ---------------------------------------------------------------------------
// MSL-I003 (+ legacy MSL-R003): Authored-shape entry without Id
// ---------------------------------------------------------------------------

Deno.test("validate: Authored entry missing Id → MSL-I003 + MSL-R003", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001] Valid title

  Body text.

      Labels: ASIL-B
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-I003");
  assertStringIncludes(stderr, "MSL-R003");
});

// ---------------------------------------------------------------------------
// MSL-I004 (+ legacy MSL-R003): Multiple Id trailers
// ---------------------------------------------------------------------------

Deno.test("validate: multiple Id attributes → MSL-I004 + MSL-R003", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001] Valid title

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-I004");
  assertStringIncludes(stderr, "MSL-R003");
});

// ---------------------------------------------------------------------------
// MSL-I005: Display ID is empty
// ---------------------------------------------------------------------------

Deno.test("validate: empty display ID after @ strip → MSL-I005", async () => {
  // The `@` prefix is stripped for Pandoc compatibility; if only `@` was in
  // the brackets, the display ID becomes empty → MSL-I005.
  const { code, stderr } = await markspec(["validate", "references.md"], {
    files: {
      "references.md": `# References

- [@] Title here

  Body text.

      Id: urn:example:test
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-I005");
});

Deno.test("validate: empty brackets emits MSL-P001 (not I005)", async () => {
  // `[]` triggers P001 (parse-level empty bracket), entry is not admitted.
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [] Title here

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-P001");
});

// ---------------------------------------------------------------------------
// MSL-I007 (+ legacy MSL-R005): Duplicate Id value across project
// ---------------------------------------------------------------------------

Deno.test("validate: duplicate Id value → MSL-I007 + MSL-R005", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001] First entry

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [REQ-002] Second entry with same Id

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-I007");
  assertStringIncludes(stderr, "MSL-R005");
});

// ---------------------------------------------------------------------------
// MSL-I008 (+ legacy MSL-R006): Duplicate display ID within same shape
// ---------------------------------------------------------------------------

Deno.test("validate: duplicate display ID → MSL-I008 + MSL-R006", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001] First entry

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [REQ-001] Same display ID different content

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-I008");
  assertStringIncludes(stderr, "MSL-R006");
});

// ===========================================================================
// MSL-I006 — already emitted (regression guard)
// ===========================================================================

Deno.test("validate: Reference slug violation → MSL-I006 (regression)", async () => {
  const { code, stderr } = await markspec(["validate", "references.md"], {
    files: {
      "references.md": `# References

- [123-bad-slug] Invalid slug starts with digit

  Body text.

      Id: urn:example:bad-slug
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-I006");
});

// ===========================================================================
// MSL-P010 — already emitted (regression guard)
// ===========================================================================

Deno.test("validate: empty title after trim → MSL-P010 (regression)", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "req.md": `# Test

- [REQ-001]   

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-P010");
});
