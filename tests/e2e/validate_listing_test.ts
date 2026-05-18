/**
 * @module tests/e2e/validate_listing_test
 *
 * E2E tests for listing-directive validation (MSL-L010-L050).
 * Tests run against `markspec validate` with crafted input files.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Phase 1: Directive placement and conflict detection (§2.3)
// MSL-L010: redundant directive (filename matches explicit)
// MSL-L011: conflict (filename vs different explicit)
// MSL-L012: two different explicit directives in one file
// ---------------------------------------------------------------------------

Deno.test("validate/listing: L010 info on references.md with matching explicit directive", async () => {
  const { code, stderr } = await markspec(["validate", "references.md"], {
    files: {
      // Empty listing: only L010 (info) + L050 (info) → exit 0
      "references.md": `<!-- markspec:references -->

# References
`,
    },
  });
  // L010 is info — should not cause exit 1 (errors only → exit 1)
  assertEquals(
    code,
    0,
    `expected exit 0 (L010 is info), got ${code}; stderr: ${stderr}`,
  );
  assertStringIncludes(stderr, "MSL-L010");
  assertStringIncludes(stderr, "redundant");
});

Deno.test("validate/listing: L010 info on glossary.md with matching explicit directive", async () => {
  const { code, stderr } = await markspec(["validate", "glossary.md"], {
    files: {
      // Proper glossary structure: only L010 (info) → exit 0
      "glossary.md": `<!-- markspec:glossary -->

# Glossary

## A

### ASIL

Automotive Safety Integrity Level.
`,
    },
  });
  assertEquals(
    code,
    0,
    `expected exit 0 (L010 is info), got ${code}; stderr: ${stderr}`,
  );
  assertStringIncludes(stderr, "MSL-L010");
});

Deno.test("validate/listing: L010 info on components.md with matching explicit directive", async () => {
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      // Empty listing: only L010 (info) + L050 (info) → exit 0
      "components.md": `<!-- markspec:components -->

# Components
`,
    },
  });
  assertEquals(
    code,
    0,
    `expected exit 0 (L010 is info), got ${code}; stderr: ${stderr}`,
  );
  assertStringIncludes(stderr, "MSL-L010");
});

Deno.test("validate/listing: L011 error on glossary.md with conflicting markspec:components directive", async () => {
  const { code, stderr } = await markspec(["validate", "glossary.md"], {
    files: {
      "glossary.md": `<!-- markspec:components -->

# Glossary

## A

### ASIL

Automotive Safety Integrity Level.
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L011");
  assertStringIncludes(stderr, "conflict");
});

Deno.test("validate/listing: L011 error on references.md with conflicting markspec:glossary directive", async () => {
  const { code, stderr } = await markspec(["validate", "references.md"], {
    files: {
      "references.md": `<!-- markspec:glossary -->

# References

- [iso-26262] ISO 26262

      Id: urn:iso:std:iso:26262:2018
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L011");
});

Deno.test("validate/listing: L012 error on file with two different explicit directives", async () => {
  const { code, stderr } = await markspec(["validate", "mixed.md"], {
    files: {
      "mixed.md": `<!-- markspec:references -->
<!-- markspec:glossary -->

# Mixed

- [iso-26262] ISO 26262

      Id: urn:iso:std:iso:26262:2018
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L012");
  assertStringIncludes(stderr, "multiple");
});

Deno.test("validate/listing: L012 error on two components directives (same kind still conflicts)", async () => {
  const { code, stderr } = await markspec(["validate", "mixed.md"], {
    files: {
      "mixed.md": `<!-- markspec:components -->
<!-- markspec:references -->

# Mixed
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L012");
});

Deno.test("validate/listing: no listing code for ordinary file with no directives", async () => {
  const { stderr } = await markspec(["validate", "requirements.md"], {
    files: {
      "requirements.md": `# Requirements

- [SRS_001] A requirement

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  // No L01x codes expected
  assertEquals(
    stderr.includes("MSL-L01"),
    false,
    `did not expect MSL-L01x but got: ${stderr}`,
  );
});

// ---------------------------------------------------------------------------
// Phase 2: Glossary heading-shape grammar (§4.2)
// MSL-L020: zero or ≥2 H1 headings
// MSL-L021: H3 term with no preceding H2
// MSL-L022: duplicate term slug within same H2 group
// MSL-L023: H3 with empty definition
// MSL-L024: heading deeper than H3 inside glossary
// ---------------------------------------------------------------------------

Deno.test("validate/listing: L020 error on glossary.md with no H1", async () => {
  const { code, stderr } = await markspec(["validate", "glossary.md"], {
    files: {
      "glossary.md": `## A

### ASIL

Automotive Safety Integrity Level.
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L020");
});

Deno.test("validate/listing: L020 error on glossary.md with two H1 headings", async () => {
  const { code, stderr } = await markspec(["validate", "glossary.md"], {
    files: {
      "glossary.md": `# Glossary

# Second Title

## A

### ASIL

Automotive Safety Integrity Level.
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L020");
});

Deno.test("validate/listing: L021 error on H3 with no preceding H2", async () => {
  const { code, stderr } = await markspec(["validate", "glossary.md"], {
    files: {
      "glossary.md": `# Glossary

### ASIL

Automotive Safety Integrity Level.
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L021");
});

Deno.test("validate/listing: L022 error on duplicate term slug in same H2 group", async () => {
  const { code, stderr } = await markspec(["validate", "glossary.md"], {
    files: {
      "glossary.md": `# Glossary

## A

### ASIL

Automotive Safety Integrity Level.

### ASIL

Another definition of ASIL.
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L022");
  assertStringIncludes(stderr, "asil");
});

Deno.test("validate/listing: L023 warning on H3 with empty definition", async () => {
  const { code, stderr } = await markspec(["validate", "glossary.md"], {
    files: {
      "glossary.md": `# Glossary

## A

### ASIL

### ASPICE

Automotive SPICE.
`,
    },
  });
  // L023 is warning → exit 2
  assertEquals(
    code,
    2,
    `expected exit 2 (warning), got ${code}; stderr: ${stderr}`,
  );
  assertStringIncludes(stderr, "MSL-L023");
  assertStringIncludes(stderr, "ASIL");
});

Deno.test("validate/listing: L024 error on H4+ inside glossary", async () => {
  const { code, stderr } = await markspec(["validate", "glossary.md"], {
    files: {
      "glossary.md": `# Glossary

## A

### ASIL

Automotive Safety Integrity Level.

#### Sub-level

Not allowed.
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L024");
});

Deno.test("validate/listing: valid glossary.md passes without L02x", async () => {
  const { code, stderr } = await markspec(["validate", "glossary.md"], {
    files: {
      "glossary.md": `# Glossary

## A

### ASIL

Automotive Safety Integrity Level.

### ASPICE

Automotive SPICE.
`,
    },
  });
  assertEquals(code, 0, `expected exit 0, got ${code}; stderr: ${stderr}`);
  assertEquals(
    stderr.includes("MSL-L02"),
    false,
    `did not expect MSL-L02x but got: ${stderr}`,
  );
});

// ---------------------------------------------------------------------------
// Phase 3: Component Id-scheme parsers (§5)
// MSL-L030: unrecognized scheme (info)
// MSL-L031: malformed purl
// MSL-L032: malformed mfg:
// MSL-L033: gtin wrong length
// MSL-L034: gtin bad check digit
// MSL-L035: cpe: legacy 2.2 binding
// MSL-L036: cpe: invalid part
// MSL-L037: malformed urn:system: / urn:tool:
// ---------------------------------------------------------------------------

Deno.test("validate/listing: L030 info on unrecognized URI scheme in components.md", async () => {
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      // Explicit Type: suppresses MSL-T021; L030 fires because the scheme is unknown
      "components.md": `# Components

- [my-component] Some component

      Id: custom:foo:bar
      Type: Component
`,
    },
  });
  // L030 is info — should not be exit 1
  assertEquals(
    code,
    0,
    `expected exit 0 (L030 is info), got ${code}; stderr: ${stderr}`,
  );
  assertStringIncludes(stderr, "MSL-L030");
  assertStringIncludes(stderr, "unrecognized");
});

Deno.test("validate/listing: L031 error on malformed purl (missing name)", async () => {
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      "components.md": `# Components

- [my-lib] A library

      Id: pkg:cargo/
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L031");
  assertStringIncludes(stderr, "purl");
});

Deno.test("validate/listing: valid purl in components.md passes", async () => {
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      "components.md": `# Components

- [serde] serde

      Id: pkg:cargo/serde@1.0.0
      Type: SoftwareComponent
`,
    },
  });
  assertEquals(code, 0, `expected exit 0, got ${code}; stderr: ${stderr}`);
  assertEquals(
    stderr.includes("MSL-L03"),
    false,
    `did not expect MSL-L03x but got: ${stderr}`,
  );
});

Deno.test("validate/listing: L032 error on malformed mfg: id (missing vendor)", async () => {
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      "components.md": `# Components

- [my-part] A part

      Id: mfg::R0402
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L032");
  assertStringIncludes(stderr, "mfg");
});

Deno.test("validate/listing: valid mfg: id passes", async () => {
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      "components.md": `# Components

- [my-part] A part

      Id: mfg:bosch:R0402-100K
      Type: HardwareComponent
`,
    },
  });
  assertEquals(code, 0, `expected exit 0, got ${code}; stderr: ${stderr}`);
  assertEquals(
    stderr.includes("MSL-L032"),
    false,
    `did not expect MSL-L032 but got: ${stderr}`,
  );
});

Deno.test("validate/listing: L033 error on gtin: wrong length", async () => {
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      "components.md": `# Components

- [my-product] A product

      Id: gtin:123456
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L033");
  assertStringIncludes(stderr, "gtin");
});

Deno.test("validate/listing: L034 error on gtin: bad check digit", async () => {
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      "components.md": `# Components

- [my-product] A product

      Id: gtin:12345678
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L034");
});

Deno.test("validate/listing: valid gtin-8 passes (73513537 — check digit 7)", async () => {
  // GTIN-8: 73513537, check digit=7 verified by GS1 mod-10
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      "components.md": `# Components

- [my-product] A product

      Id: gtin:73513537
      Type: HardwareComponent
`,
    },
  });
  assertEquals(code, 0, `expected exit 0, got ${code}; stderr: ${stderr}`);
  assertEquals(
    stderr.includes("MSL-L03"),
    false,
    `did not expect MSL-L03x but got: ${stderr}`,
  );
});

Deno.test("validate/listing: L035 error on CPE 2.2 URI binding", async () => {
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      "components.md": `# Components

- [my-os] An OS

      Id: cpe:/o:linux:linux_kernel:5.4
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L035");
  assertStringIncludes(stderr, "2.3");
});

Deno.test("validate/listing: L036 error on CPE with invalid part", async () => {
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      "components.md": `# Components

- [my-thing] A thing

      Id: cpe:2.3:x:vendor:product:*:*:*:*:*:*:*:*
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L036");
  assertStringIncludes(stderr, "part");
});

Deno.test("validate/listing: valid cpe:2.3 passes", async () => {
  // 11 colon-separated components after cpe:2.3:
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      "components.md": `# Components

- [linux-kernel] Linux kernel

      Id: cpe:2.3:o:linux:linux_kernel:5.4:*:*:*:*:*:*:*
      Type: SoftwareComponent
`,
    },
  });
  assertEquals(code, 0, `expected exit 0, got ${code}; stderr: ${stderr}`);
  assertEquals(
    stderr.includes("MSL-L035"),
    false,
    `did not expect MSL-L035 but got: ${stderr}`,
  );
  assertEquals(
    stderr.includes("MSL-L036"),
    false,
    `did not expect MSL-L036 but got: ${stderr}`,
  );
});

Deno.test("validate/listing: L037 error on malformed urn:system: (empty segment)", async () => {
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      "components.md": `# Components

- [my-sys] A system

      Id: urn:system:
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L037");
  assertStringIncludes(stderr, "urn:system:");
});

Deno.test("validate/listing: valid urn:system: passes", async () => {
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      "components.md": `# Components

- [can-bus] CAN bus

      Id: urn:system:can-bus.main
      Type: Component
`,
    },
  });
  assertEquals(code, 0, `expected exit 0, got ${code}; stderr: ${stderr}`);
  assertEquals(
    stderr.includes("MSL-L037"),
    false,
    `did not expect MSL-L037 but got: ${stderr}`,
  );
});

Deno.test("validate/listing: L037 error on malformed urn:tool: (invalid char)", async () => {
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      "components.md": `# Components

- [my-tool] A tool

      Id: urn:tool:gcc@13
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L037");
});

Deno.test("validate/listing: valid urn:tool: passes", async () => {
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      "components.md": `# Components

- [gcc] GCC compiler

      Id: urn:tool:gcc.13
      Type: SoftwareComponent
`,
    },
  });
  assertEquals(code, 0, `expected exit 0, got ${code}; stderr: ${stderr}`);
  assertEquals(
    stderr.includes("MSL-L037"),
    false,
    `did not expect MSL-L037 but got: ${stderr}`,
  );
});

// ---------------------------------------------------------------------------
// Phase 4: Per-directive content validation (§6)
// MSL-L040: Authored-shape entry in references listing (warning)
// MSL-L041: entry with resolved Type: Unit in references listing (warning)
// MSL-L042: entry block in glossary file (error)
// MSL-L043: non-Component-family type in components listing (error)
// MSL-L050: listing document with zero items (info)
// ---------------------------------------------------------------------------

Deno.test("validate/listing: L040 warning on Authored entry in references.md", async () => {
  const { code, stderr } = await markspec(["validate", "references.md"], {
    files: {
      "references.md": `# References

- [SRS_001] An authored entry in references

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  // L040 is warning → exit 2
  assertEquals(
    code,
    2,
    `expected exit 2 (warning), got ${code}; stderr: ${stderr}`,
  );
  assertStringIncludes(stderr, "MSL-L040");
  assertStringIncludes(stderr, "Authored");
});

Deno.test("validate/listing: L041 warning on Type: Unit entry in references.md", async () => {
  const { code, stderr } = await markspec(["validate", "references.md"], {
    files: {
      "references.md": `# References

- [some-unit] A unit-typed reference

      Id: urn:some:unit:thing
      Type: Unit
`,
    },
  });
  // L041 is warning → exit 2
  assertEquals(
    code,
    2,
    `expected exit 2 (warning), got ${code}; stderr: ${stderr}`,
  );
  assertStringIncludes(stderr, "MSL-L041");
  assertStringIncludes(stderr, "Unit");
});

Deno.test("validate/listing: L042 error on entry block in glossary.md", async () => {
  const { code, stderr } = await markspec(["validate", "glossary.md"], {
    files: {
      "glossary.md": `# Glossary

## A

### ASIL

Automotive Safety Integrity Level.

- [SRS_001] Misplaced entry

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L042");
  assertStringIncludes(stderr, "glossary");
});

Deno.test("validate/listing: L043 error on non-Component-family type in components.md", async () => {
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      "components.md": `# Components

- [my-req] A requirement (wrong type)

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Requirement
`,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr: ${stderr}`);
  assertStringIncludes(stderr, "MSL-L043");
  assertStringIncludes(stderr, "Component");
});

Deno.test("validate/listing: L050 info on empty references.md", async () => {
  const { code, stderr } = await markspec(["validate", "references.md"], {
    files: {
      "references.md": `# References

No items yet.
`,
    },
  });
  // L050 is info → exit 0
  assertEquals(
    code,
    0,
    `expected exit 0 (L050 is info), got ${code}; stderr: ${stderr}`,
  );
  assertStringIncludes(stderr, "MSL-L050");
  assertStringIncludes(stderr, "empty");
});

Deno.test("validate/listing: L050 info on empty glossary.md", async () => {
  const { code, stderr } = await markspec(["validate", "glossary.md"], {
    files: {
      "glossary.md": `# Glossary

Welcome to the glossary.
`,
    },
  });
  assertEquals(
    code,
    0,
    `expected exit 0 (L050 is info), got ${code}; stderr: ${stderr}`,
  );
  assertStringIncludes(stderr, "MSL-L050");
});

Deno.test("validate/listing: L050 info on empty components.md", async () => {
  const { code, stderr } = await markspec(["validate", "components.md"], {
    files: {
      "components.md": `# Components

No components yet.
`,
    },
  });
  assertEquals(
    code,
    0,
    `expected exit 0 (L050 is info), got ${code}; stderr: ${stderr}`,
  );
  assertStringIncludes(stderr, "MSL-L050");
});
