/**
 * @module validator/mod_test
 *
 * Unit tests for structural and reference validation.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { validate } from "./mod.ts";
import type { Entry } from "../model/mod.ts";

/** Helper to build a spec entry. */
function typedEntry(
  overrides: Partial<Entry> & { displayId: string },
): Entry {
  return {
    title: "Title",
    body: "Body.",
    attributes: [],
    entryType: "SRS",
    family: "spec",
    source: "markdown",
    location: { file: "test.md", line: 1, column: 1 },
    ...overrides,
    id: overrides.id,
  };
}

/** Helper to build a reference entry. */
function refEntry(
  overrides: Partial<Entry> & { displayId: string },
): Entry {
  return {
    title: "Title",
    body: "Body.",
    attributes: [],
    entryType: undefined,
    family: "reference",
    id: undefined,
    source: "markdown",
    location: { file: "refs.md", line: 1, column: 1 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Structural checks (MSL-R)
// ---------------------------------------------------------------------------

Deno.test("validate: valid entries pass", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [{ key: "Id", value: "SRS_00000000000000000000000001" }],
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, true);
  assertEquals(result.diagnostics.length, 0);
});

Deno.test("validate: missing Id on typed entry → MSL-R003", () => {
  const entries: Entry[] = [
    typedEntry({ displayId: "SRS_BRK_0001", id: undefined, attributes: [] }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, false);
  assertEquals(result.diagnostics[0].code, "MSL-R003");
  assertStringIncludes(result.diagnostics[0].message, "missing Id");
});

Deno.test("validate: malformed ULID → MSL-R003", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "not-a-ulid",
      attributes: [{ key: "Id", value: "not-a-ulid" }],
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, false);
  assertEquals(result.diagnostics[0].code, "MSL-R003");
  assertStringIncludes(result.diagnostics[0].message, "malformed");
});

Deno.test("validate: duplicate display ID → MSL-R006", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [{ key: "Id", value: "SRS_00000000000000000000000001" }],
      location: { file: "a.md", line: 3, column: 1 },
    }),
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000002",
      attributes: [{ key: "Id", value: "SRS_00000000000000000000000002" }],
      location: { file: "b.md", line: 5, column: 1 },
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, false);
  const diag = result.diagnostics.find((d) => d.code === "MSL-R006");
  assertEquals(diag != null, true);
  assertStringIncludes(diag!.message, "duplicate display ID");
  assertStringIncludes(diag!.message, "a.md");
});

Deno.test("validate: duplicate ULID → MSL-R005", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [{ key: "Id", value: "SRS_00000000000000000000000001" }],
      location: { file: "a.md", line: 3, column: 1 },
    }),
    typedEntry({
      displayId: "SRS_BRK_0002",
      id: "SRS_00000000000000000000000001",
      attributes: [{ key: "Id", value: "SRS_00000000000000000000000001" }],
      location: { file: "b.md", line: 5, column: 1 },
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, false);
  const diag = result.diagnostics.find((d) => d.code === "MSL-R005");
  assertEquals(diag != null, true);
  assertStringIncludes(diag!.message, "duplicate Id");
});

Deno.test("validate: type prefix mismatch → MSL-R007", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      entryType: "SRS",
      id: "SYS_00000000000000000000000001",
      attributes: [{ key: "Id", value: "SYS_00000000000000000000000001" }],
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, false);
  const diag = result.diagnostics.find((d) => d.code === "MSL-R007");
  assertEquals(diag != null, true);
  assertStringIncludes(diag!.message, "does not match");
});

Deno.test("validate: unknown attribute key → MSL-R010 warning", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [
        { key: "Id", value: "SRS_00000000000000000000000001" },
        { key: "CustomKey", value: "some value" },
      ],
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, true); // warnings don't fail
  const diag = result.diagnostics.find((d) => d.code === "MSL-R010");
  assertEquals(diag != null, true);
  assertEquals(diag!.severity, "warning");
  assertStringIncludes(diag!.message, "CustomKey");
});

Deno.test("validate: reference entries skip ULID checks", () => {
  const entries: Entry[] = [
    refEntry({
      displayId: "ISO-26262-6",
      attributes: [
        { key: "Document", value: "ISO 26262-6:2018" },
        { key: "URL", value: "https://www.iso.org/standard/68383.html" },
      ],
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, true);
  assertEquals(result.diagnostics.length, 0);
});

Deno.test("validate: multiple errors accumulated", () => {
  const entries: Entry[] = [
    typedEntry({ displayId: "SRS_BRK_0001", id: undefined, attributes: [] }),
    typedEntry({
      displayId: "SRS_BRK_0002",
      id: "bad",
      attributes: [{ key: "Id", value: "bad" }],
      location: { file: "test.md", line: 10, column: 1 },
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, false);
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error").length >= 2,
    true,
  );
});

// ---------------------------------------------------------------------------
// Reference integrity (MSL-T)
// ---------------------------------------------------------------------------

Deno.test("validate: Satisfies target exists → passes", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SYS_BRK_0042",
      entryType: "SYS",
      id: "SYS_00000000000000000000000001",
      attributes: [{ key: "Id", value: "SYS_00000000000000000000000001" }],
    }),
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000002",
      attributes: [
        { key: "Id", value: "SRS_00000000000000000000000002" },
        { key: "Satisfies", value: "SYS_BRK_0042" },
      ],
      location: { file: "test.md", line: 10, column: 1 },
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, true);
  assertEquals(
    result.diagnostics.filter((d) => d.code === "MSL-T001").length,
    0,
  );
});

Deno.test("validate: Satisfies target missing → MSL-T001", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [
        { key: "Id", value: "SRS_00000000000000000000000001" },
        { key: "Satisfies", value: "SYS_BRK_9999" },
      ],
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, false);
  const diag = result.diagnostics.find((d) => d.code === "MSL-T001");
  assertEquals(diag != null, true);
  assertStringIncludes(diag!.message, "SYS_BRK_9999");
});

Deno.test("validate: multi-value Satisfies with one missing", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SYS_BRK_0001",
      entryType: "SYS",
      id: "SYS_00000000000000000000000001",
      attributes: [{ key: "Id", value: "SYS_00000000000000000000000001" }],
    }),
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000002",
      attributes: [
        { key: "Id", value: "SRS_00000000000000000000000002" },
        { key: "Satisfies", value: "SYS_BRK_0001, SYS_BRK_9999" },
      ],
      location: { file: "test.md", line: 10, column: 1 },
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, false);
  const t001 = result.diagnostics.filter((d) => d.code === "MSL-T001");
  assertEquals(t001.length, 1);
  assertStringIncludes(t001[0].message, "SYS_BRK_9999");
});

Deno.test("validate: Derived-from ID checked against entries", () => {
  // Derived-from is spec→spec per ADR-002 §Part 2. Target must be a spec.
  const entries: Entry[] = [
    typedEntry({
      displayId: "SYS_BRK_0042",
      entryType: "SYS",
      id: "SYS_00000000000000000000000042",
      attributes: [{ key: "Id", value: "SYS_00000000000000000000000042" }],
    }),
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [
        { key: "Id", value: "SRS_00000000000000000000000001" },
        { key: "Derived-from", value: "SYS_BRK_0042" },
      ],
      location: { file: "test.md", line: 10, column: 1 },
    }),
  ];
  const result = validate(entries);
  const t004 = result.diagnostics.filter((d) => d.code === "MSL-T004");
  assertEquals(t004.length, 0);
});

Deno.test("validate: Derived-from unresolved → MSL-T004 warning", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [
        { key: "Id", value: "SRS_00000000000000000000000001" },
        { key: "Derived-from", value: "UNKNOWN-REF §1.2" },
      ],
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, true); // warning, not error
  const t004 = result.diagnostics.filter((d) => d.code === "MSL-T004");
  assertEquals(t004.length, 1);
  assertStringIncludes(t004[0].message, "UNKNOWN-REF");
});

// ---------------------------------------------------------------------------
// ADR-002 new checks (MSL-R008, MSL-R009, MSL-T005, MSL-T006)
// ---------------------------------------------------------------------------

Deno.test("validate: reference entry missing URI and URL → MSL-R008", () => {
  const entries: Entry[] = [
    refEntry({
      displayId: "ISO-26262-6",
      attributes: [{ key: "Document", value: "ISO 26262-6:2018" }],
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, false);
  const r008 = result.diagnostics.find((d) => d.code === "MSL-R008");
  assertEquals(r008 != null, true);
  assertStringIncludes(r008!.message, "URI or URL");
});

Deno.test("validate: reference entry with URL → passes", () => {
  const entries: Entry[] = [
    refEntry({
      displayId: "ISO-26262-6",
      attributes: [
        { key: "Document", value: "ISO 26262-6:2018" },
        { key: "URL", value: "https://www.iso.org/standard/68383.html" },
      ],
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, true);
});

Deno.test("validate: spec entry NNNN = 0 → MSL-R009", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_000",
      id: "SRS_00000000000000000000000001RSTVWXYZABCDE",
      attributes: [{
        key: "Id",
        value: "SRS_00000000000000000000000001RSTVWXYZABCDE",
      }],
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, false);
  const r009 = result.diagnostics.find((d) => d.code === "MSL-R009");
  assertEquals(r009 != null, true);
  assertStringIncludes(r009!.message, "NNNN must be > 0");
});

Deno.test("validate: References target exists → passes", () => {
  const entries: Entry[] = [
    refEntry({
      displayId: "ISO-26262-6",
      attributes: [
        { key: "URL", value: "https://www.iso.org/standard/68383.html" },
      ],
    }),
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [
        { key: "Id", value: "SRS_00000000000000000000000001" },
        { key: "References", value: "ISO-26262-6" },
      ],
      location: { file: "test.md", line: 10, column: 1 },
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, true);
});

Deno.test("validate: References target missing → MSL-T005", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001RSTVWXYZABCDE",
      attributes: [
        { key: "Id", value: "SRS_00000000000000000000000001RSTVWXYZABCDE" },
        { key: "References", value: "UNKNOWN-REF" },
      ],
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, false);
  const t005 = result.diagnostics.find((d) => d.code === "MSL-T005");
  assertEquals(t005 != null, true);
  assertStringIncludes(t005!.message, "UNKNOWN-REF");
});

Deno.test("validate: Allocated-to target missing → MSL-T006", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SAD_BRK_0010",
      entryType: "SAD",
      id: "SAD_00000000000000000000000010",
      attributes: [
        { key: "Id", value: "SAD_00000000000000000000000010" },
        { key: "Allocated-to", value: "SRS_NONEXISTENT" },
      ],
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, false);
  const t006 = result.diagnostics.find((d) => d.code === "MSL-T006");
  assertEquals(t006 != null, true);
  assertStringIncludes(t006!.message, "SRS_NONEXISTENT");
});

Deno.test("validate: Allocated-to target exists → passes", () => {
  // Allocated-to targets elements per ADR-002 §Part 2.
  const entries: Entry[] = [
    typedEntry({
      displayId: "braking_core::controller",
      family: "element",
      entryType: undefined,
      id: "01HGW3D6QRST7JKMNPQRSTVWXY",
      attributes: [{
        key: "Element-id",
        value: "01HGW3D6QRST7JKMNPQRSTVWXY",
      }],
    }),
    typedEntry({
      displayId: "SAD_BRK_0010",
      entryType: "SAD",
      id: "SAD_00000000000000000000000010",
      attributes: [
        { key: "Id", value: "SAD_00000000000000000000000010" },
        { key: "Allocated-to", value: "braking_core::controller" },
      ],
      location: { file: "arch.md", line: 10, column: 1 },
    }),
  ];
  const result = validate(entries);
  const t006 = result.diagnostics.filter((d) => d.code === "MSL-T006");
  assertEquals(t006.length, 0);
});

// ---------------------------------------------------------------------------
// Phase 3a — new identity-attribute path (ADR-002 Part 6)
// ---------------------------------------------------------------------------

Deno.test("validate: new Spec-id with bare ULID passes", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
      attributes: [
        { key: "Spec-id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      ],
    }),
  ];
  const result = validate(entries);
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
  );
});

Deno.test("validate: Spec-id with legacy TYPE-prefixed ULID → MSL-R004", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_01HGW2Q8MNP3",
      attributes: [{ key: "Spec-id", value: "SRS_01HGW2Q8MNP3" }],
    }),
  ];
  const result = validate(entries);
  const r004 = result.diagnostics.find((d) => d.code === "MSL-R004");
  assertEquals(r004 != null, true);
  assertStringIncludes(r004!.message, "bare 26-char Crockford base32");
});

Deno.test("validate: Spec-id with lowercase letter in ULID → MSL-R004", () => {
  // Crockford base32 is uppercase only; lowercase is malformed.
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "01hgw2q8mnp3rstvwxyzabcdef",
      attributes: [
        { key: "Spec-id", value: "01hgw2q8mnp3rstvwxyzabcdef" },
      ],
    }),
  ];
  const result = validate(entries);
  const r004 = result.diagnostics.find((d) => d.code === "MSL-R004");
  assertEquals(r004 != null, true);
});

Deno.test("validate: Reference-id with URI passes", () => {
  const entries: Entry[] = [
    refEntry({
      displayId: "ISO-26262-6",
      id: "urn:iso:std:iso:26262:-6:ed-2",
      attributes: [
        { key: "Reference-id", value: "urn:iso:std:iso:26262:-6:ed-2" },
      ],
    }),
  ];
  const result = validate(entries);
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
  );
});

Deno.test("validate: Reference-id without scheme → MSL-R004", () => {
  const entries: Entry[] = [
    refEntry({
      displayId: "BOGUS",
      id: "not a uri",
      attributes: [{ key: "Reference-id", value: "not a uri" }],
    }),
  ];
  const result = validate(entries);
  const r004 = result.diagnostics.find((d) => d.code === "MSL-R004");
  assertEquals(r004 != null, true);
  assertStringIncludes(r004!.message, "not a URI");
});

Deno.test("validate: both legacy Id: and new Spec-id → MSL-R003 migration conflict", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
      attributes: [
        { key: "Id", value: "SRS_01HGW2Q8MNP3" },
        { key: "Spec-id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      ],
    }),
  ];
  const result = validate(entries);
  const r003 = result.diagnostics.find((d) => d.code === "MSL-R003");
  assertEquals(r003 != null, true);
  assertStringIncludes(r003!.message, "legacy");
});

Deno.test("validate: two new identity attributes → MSL-R003", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
      attributes: [
        { key: "Spec-id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
        { key: "Test-id", value: "01HGW3R9Q2P4ABCDEFGHJKMNPQ" },
      ],
    }),
  ];
  const result = validate(entries);
  const r003 = result.diagnostics.find((d) => d.code === "MSL-R003");
  assertEquals(r003 != null, true);
  assertStringIncludes(r003!.message, "multiple identity attributes");
});

Deno.test("validate: Spec-id with element-format display ID → MSL-R007", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "braking::controller::debounce",
      id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
      entryType: undefined,
      attributes: [
        { key: "Spec-id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      ],
    }),
  ];
  const result = validate(entries);
  const r007 = result.diagnostics.find((d) => d.code === "MSL-R007");
  assertEquals(r007 != null, true);
  assertStringIncludes(r007!.message, "does not match the spec family format");
});

Deno.test("validate: Element-id entry with :: display ID passes", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "braking_core::controller::debounce_input",
      id: "01HGW3D6QRST7JKMNPQRSTVWXY",
      family: "element",
      entryType: undefined,
      attributes: [
        { key: "Element-id", value: "01HGW3D6QRST7JKMNPQRSTVWXY" },
      ],
    }),
  ];
  const result = validate(entries);
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
  );
});

Deno.test("validate: Test-id entry with TYPED display ID passes", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SWT_BRK_0107",
      id: "01HGW3R9Q2P4ABCDEFGHJKMNPQ",
      family: "test",
      entryType: "SWT",
      attributes: [
        { key: "Test-id", value: "01HGW3R9Q2P4ABCDEFGHJKMNPQ" },
      ],
    }),
  ];
  const result = validate(entries);
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
  );
});

Deno.test("validate: legacy Id path still works for back-compat", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [{
        key: "Id",
        value: "SRS_00000000000000000000000001",
      }],
    }),
  ];
  const result = validate(entries);
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
  );
});

// ---------------------------------------------------------------------------
// Phase 3b — enum-type attribute value validation (MSL-R014)
// ---------------------------------------------------------------------------

Deno.test("validate: valid Status passes", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
      attributes: [
        { key: "Spec-id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
        { key: "Status", value: "approved" },
      ],
    }),
  ];
  const result = validate(entries);
  const r014 = result.diagnostics.find((d) => d.code === "MSL-R014");
  assertEquals(r014, undefined);
});

Deno.test("validate: unknown Status value → MSL-R014", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
      attributes: [
        { key: "Spec-id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
        { key: "Status", value: "bogus" },
      ],
    }),
  ];
  const result = validate(entries);
  const r014 = result.diagnostics.find((d) => d.code === "MSL-R014");
  assertEquals(r014 != null, true);
  assertStringIncludes(r014!.message, "Status");
  assertStringIncludes(r014!.message, "bogus");
  assertStringIncludes(r014!.message, "approved");
});

Deno.test("validate: unknown Test-level → MSL-R014", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SWT_BRK_0001",
      family: "test",
      entryType: "SWT",
      id: "01HGW3R9Q2P4ABCDEFGHJKMNPQ",
      attributes: [
        { key: "Test-id", value: "01HGW3R9Q2P4ABCDEFGHJKMNPQ" },
        { key: "Test-level", value: "hardware" },
      ],
    }),
  ];
  const result = validate(entries);
  const r014 = result.diagnostics.find((d) => d.code === "MSL-R014");
  assertEquals(r014 != null, true);
  assertStringIncludes(r014!.message, "Test-level");
  assertStringIncludes(r014!.message, "unit");
});

Deno.test("validate: valid Test-level (unit, integration, system, acceptance) passes", () => {
  for (const level of ["unit", "integration", "system", "acceptance"]) {
    const entries: Entry[] = [
      typedEntry({
        displayId: "SWT_BRK_0001",
        family: "test",
        entryType: "SWT",
        id: "01HGW3R9Q2P4ABCDEFGHJKMNPQ",
        attributes: [
          { key: "Test-id", value: "01HGW3R9Q2P4ABCDEFGHJKMNPQ" },
          { key: "Test-level", value: level },
        ],
      }),
    ];
    const result = validate(entries);
    const r014 = result.diagnostics.find((d) => d.code === "MSL-R014");
    assertEquals(r014, undefined, `level '${level}' should pass`);
  }
});

Deno.test("validate: unknown Element-kind → MSL-R014", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "braking::foo",
      family: "element",
      entryType: undefined,
      id: "01HGW3D6QRST7JKMNPQRSTVWXY",
      attributes: [
        { key: "Element-id", value: "01HGW3D6QRST7JKMNPQRSTVWXY" },
        { key: "Element-kind", value: "widget" },
      ],
    }),
  ];
  const result = validate(entries);
  const r014 = result.diagnostics.find((d) => d.code === "MSL-R014");
  assertEquals(r014 != null, true);
  assertStringIncludes(r014!.message, "Element-kind");
});

Deno.test("validate: all four Element-kind vocab values pass", () => {
  for (const kind of ["item", "artifact", "dependency", "unit"]) {
    const entries: Entry[] = [
      typedEntry({
        displayId: "braking::foo",
        family: "element",
        entryType: undefined,
        id: "01HGW3D6QRST7JKMNPQRSTVWXY",
        attributes: [
          { key: "Element-id", value: "01HGW3D6QRST7JKMNPQRSTVWXY" },
          { key: "Element-kind", value: kind },
        ],
      }),
    ];
    const result = validate(entries);
    const r014 = result.diagnostics.find((d) => d.code === "MSL-R014");
    assertEquals(r014, undefined, `kind '${kind}' should pass`);
  }
});

Deno.test("validate: Status withdrawn and deprecated are valid", () => {
  for (const status of ["draft", "approved", "deprecated", "withdrawn"]) {
    const entries: Entry[] = [
      typedEntry({
        displayId: "SRS_BRK_0001",
        id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
        attributes: [
          { key: "Spec-id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
          { key: "Status", value: status },
        ],
      }),
    ];
    const result = validate(entries);
    const r014 = result.diagnostics.find((d) => d.code === "MSL-R014");
    assertEquals(r014, undefined, `status '${status}' should pass`);
  }
});

// ---------------------------------------------------------------------------
// Phase 3c — traceability target-family checks (MSL-T001, T004-T013)
// ---------------------------------------------------------------------------

Deno.test("validate: Satisfies target with wrong family → MSL-T001", () => {
  // Satisfies must target a spec entry; target below is a reference.
  const entries: Entry[] = [
    refEntry({
      displayId: "ISO-26262-6",
      id: "urn:iso:std:iso:26262:-6:ed-2",
      attributes: [
        { key: "Reference-id", value: "urn:iso:std:iso:26262:-6:ed-2" },
      ],
    }),
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [
        { key: "Id", value: "SRS_00000000000000000000000001" },
        { key: "Satisfies", value: "ISO-26262-6" },
      ],
    }),
  ];
  const result = validate(entries);
  const t001 = result.diagnostics.find((d) => d.code === "MSL-T001");
  assertEquals(t001 != null, true);
  assertStringIncludes(t001!.message, "family 'reference'");
  assertStringIncludes(t001!.message, "expected 'spec'");
});

Deno.test("validate: Realizes target must be spec → MSL-T007", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "braking::one",
      family: "element",
      entryType: undefined,
      id: "01HGW3D6QRST7JKMNPQRSTVWXY",
      attributes: [{ key: "Element-id", value: "01HGW3D6QRST7JKMNPQRSTVWXY" }],
    }),
    typedEntry({
      displayId: "braking::controller",
      family: "element",
      entryType: undefined,
      id: "01HGW3D6QRST7JKMNPQRSTVWXZ",
      attributes: [
        { key: "Element-id", value: "01HGW3D6QRST7JKMNPQRSTVWXZ" },
        { key: "Realizes", value: "braking::one" },
      ],
    }),
  ];
  const result = validate(entries);
  const t007 = result.diagnostics.find((d) => d.code === "MSL-T007");
  assertEquals(t007 != null, true);
  assertStringIncludes(t007!.message, "expected 'spec'");
});

Deno.test("validate: Verifies (on test) target must be spec → MSL-T008", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "braking::unit",
      family: "element",
      entryType: undefined,
      id: "01HGW3D6QRST7JKMNPQRSTVWXY",
      attributes: [{ key: "Element-id", value: "01HGW3D6QRST7JKMNPQRSTVWXY" }],
    }),
    typedEntry({
      displayId: "SWT_BRK_0001",
      family: "test",
      entryType: "SWT",
      id: "01HGW3R9Q2P4ABCDEFGHJKMNPQ",
      attributes: [
        { key: "Test-id", value: "01HGW3R9Q2P4ABCDEFGHJKMNPQ" },
        { key: "Verifies", value: "braking::unit" },
      ],
    }),
  ];
  const result = validate(entries);
  const t008 = result.diagnostics.find((d) => d.code === "MSL-T008");
  assertEquals(t008 != null, true);
});

Deno.test("validate: Tests (on test) target must be element → MSL-T009", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [{ key: "Id", value: "SRS_00000000000000000000000001" }],
    }),
    typedEntry({
      displayId: "SWT_BRK_0001",
      family: "test",
      entryType: "SWT",
      id: "01HGW3R9Q2P4ABCDEFGHJKMNPQ",
      attributes: [
        { key: "Test-id", value: "01HGW3R9Q2P4ABCDEFGHJKMNPQ" },
        { key: "Tests", value: "SRS_BRK_0001" },
      ],
    }),
  ];
  const result = validate(entries);
  const t009 = result.diagnostics.find((d) => d.code === "MSL-T009");
  assertEquals(t009 != null, true);
});

Deno.test("validate: Part-of target must be element → MSL-T010", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [{ key: "Id", value: "SRS_00000000000000000000000001" }],
    }),
    typedEntry({
      displayId: "braking::child",
      family: "element",
      entryType: undefined,
      id: "01HGW3D6QRST7JKMNPQRSTVWXY",
      attributes: [
        { key: "Element-id", value: "01HGW3D6QRST7JKMNPQRSTVWXY" },
        { key: "Part-of", value: "SRS_BRK_0001" },
      ],
    }),
  ];
  const result = validate(entries);
  const t010 = result.diagnostics.find((d) => d.code === "MSL-T010");
  assertEquals(t010 != null, true);
});

Deno.test("validate: Supersedes must target same family → MSL-T012", () => {
  const entries: Entry[] = [
    refEntry({
      displayId: "ISO-26262-6",
      id: "urn:iso:std:iso:26262:-6:ed-2",
      attributes: [
        { key: "Reference-id", value: "urn:iso:std:iso:26262:-6:ed-2" },
      ],
    }),
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [
        { key: "Id", value: "SRS_00000000000000000000000001" },
        { key: "Supersedes", value: "ISO-26262-6" },
      ],
    }),
  ];
  const result = validate(entries);
  const t012 = result.diagnostics.find((d) => d.code === "MSL-T012");
  assertEquals(t012 != null, true);
  assertStringIncludes(t012!.message, "expected 'spec'");
});

Deno.test("validate: Supersedes same family passes", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [{ key: "Id", value: "SRS_00000000000000000000000001" }],
    }),
    typedEntry({
      displayId: "SRS_BRK_0002",
      id: "SRS_00000000000000000000000002",
      attributes: [
        { key: "Id", value: "SRS_00000000000000000000000002" },
        { key: "Supersedes", value: "SRS_BRK_0001" },
      ],
    }),
  ];
  const result = validate(entries);
  const t012 = result.diagnostics.find((d) => d.code === "MSL-T012");
  assertEquals(t012, undefined);
});

Deno.test("validate: upstream target with Status: deprecated → MSL-T013 warning", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SYS_BRK_0042",
      entryType: "SYS",
      id: "SYS_00000000000000000000000042",
      attributes: [
        { key: "Id", value: "SYS_00000000000000000000000042" },
        { key: "Status", value: "deprecated" },
      ],
    }),
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [
        { key: "Id", value: "SRS_00000000000000000000000001" },
        { key: "Satisfies", value: "SYS_BRK_0042" },
      ],
    }),
  ];
  const result = validate(entries);
  const t013 = result.diagnostics.find((d) => d.code === "MSL-T013");
  assertEquals(t013 != null, true);
  assertStringIncludes(t013!.message, "deprecated");
});

Deno.test("validate: upstream target with Status: approved → no MSL-T013", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SYS_BRK_0042",
      entryType: "SYS",
      id: "SYS_00000000000000000000000042",
      attributes: [
        { key: "Id", value: "SYS_00000000000000000000000042" },
        { key: "Status", value: "approved" },
      ],
    }),
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [
        { key: "Id", value: "SRS_00000000000000000000000001" },
        { key: "Satisfies", value: "SYS_BRK_0042" },
      ],
    }),
  ];
  const result = validate(entries);
  const t013 = result.diagnostics.find((d) => d.code === "MSL-T013");
  assertEquals(t013, undefined);
});

Deno.test("validate: Depends-on to element passes", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "braking::lib",
      family: "element",
      entryType: undefined,
      id: "01HGW3D6QRST7JKMNPQRSTVWXY",
      attributes: [{ key: "Element-id", value: "01HGW3D6QRST7JKMNPQRSTVWXY" }],
    }),
    typedEntry({
      displayId: "braking::main",
      family: "element",
      entryType: undefined,
      id: "01HGW3D6QRST7JKMNPQRSTVWXZ",
      attributes: [
        { key: "Element-id", value: "01HGW3D6QRST7JKMNPQRSTVWXZ" },
        { key: "Depends-on", value: "braking::lib" },
      ],
    }),
  ];
  const result = validate(entries);
  const t011 = result.diagnostics.find((d) => d.code === "MSL-T011");
  assertEquals(t011, undefined);
});
