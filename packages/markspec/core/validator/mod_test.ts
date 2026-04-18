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
  const entries: Entry[] = [
    refEntry({
      displayId: "ISO-26262-6",
      attributes: [{ key: "Document", value: "ISO 26262-6:2018" }],
    }),
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001",
      attributes: [
        { key: "Id", value: "SRS_00000000000000000000000001" },
        { key: "Derived-from", value: "ISO-26262-6 §9.4" },
      ],
    }),
  ];
  const result = validate(entries);
  // ISO-26262-6 exists as a display ID → no warning
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
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_00000000000000000000000001RSTVWXYZABCDE",
      attributes: [{
        key: "Id",
        value: "SRS_00000000000000000000000001RSTVWXYZABCDE",
      }],
    }),
    typedEntry({
      displayId: "SAD_BRK_0010",
      entryType: "SAD",
      id: "SAD_00000000000000000000000010",
      attributes: [
        { key: "Id", value: "SAD_00000000000000000000000010" },
        { key: "Allocated-to", value: "SRS_BRK_0001" },
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
