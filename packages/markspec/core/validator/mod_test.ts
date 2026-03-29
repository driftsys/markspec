/**
 * @module validator/mod_test
 *
 * Unit tests for structural and reference validation.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { validate } from "./mod.ts";
import type { Entry } from "../model/mod.ts";

/** Helper to build a typed entry. */
function typedEntry(
  overrides: Partial<Entry> & { displayId: string },
): Entry {
  return {
    title: "Title",
    body: "Body.",
    attributes: [],
    entryType: "SRS",
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
      id: "SRS_01HGW2Q8MNP3",
      attributes: [{ key: "Id", value: "SRS_01HGW2Q8MNP3" }],
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
      id: "SRS_01HGW2Q8MNP3",
      attributes: [{ key: "Id", value: "SRS_01HGW2Q8MNP3" }],
      location: { file: "a.md", line: 3, column: 1 },
    }),
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_01HGW2R9QLP4",
      attributes: [{ key: "Id", value: "SRS_01HGW2R9QLP4" }],
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
      id: "SRS_01HGW2Q8MNP3",
      attributes: [{ key: "Id", value: "SRS_01HGW2Q8MNP3" }],
      location: { file: "a.md", line: 3, column: 1 },
    }),
    typedEntry({
      displayId: "SRS_BRK_0002",
      id: "SRS_01HGW2Q8MNP3",
      attributes: [{ key: "Id", value: "SRS_01HGW2Q8MNP3" }],
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
      id: "SYS_01HGW2Q8MNP3",
      attributes: [{ key: "Id", value: "SYS_01HGW2Q8MNP3" }],
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
      id: "SRS_01HGW2Q8MNP3",
      attributes: [
        { key: "Id", value: "SRS_01HGW2Q8MNP3" },
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
      id: "SYS_01HGW2Q8MNP3",
      attributes: [{ key: "Id", value: "SYS_01HGW2Q8MNP3" }],
    }),
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_01HGW2R9QLP4",
      attributes: [
        { key: "Id", value: "SRS_01HGW2R9QLP4" },
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
      id: "SRS_01HGW2Q8MNP3",
      attributes: [
        { key: "Id", value: "SRS_01HGW2Q8MNP3" },
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
      id: "SYS_01HGW2Q8MNP3",
      attributes: [{ key: "Id", value: "SYS_01HGW2Q8MNP3" }],
    }),
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_01HGW2R9QLP4",
      attributes: [
        { key: "Id", value: "SRS_01HGW2R9QLP4" },
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
      id: "SRS_01HGW2Q8MNP3",
      attributes: [
        { key: "Id", value: "SRS_01HGW2Q8MNP3" },
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
      id: "SRS_01HGW2Q8MNP3",
      attributes: [
        { key: "Id", value: "SRS_01HGW2Q8MNP3" },
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
// Allocates and Between (MSL-T008, MSL-T009)
// ---------------------------------------------------------------------------

Deno.test("validate: Allocates target missing → MSL-T008", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SAD_BRK_0010",
      entryType: "SAD",
      id: "SAD_01HGW3A2EFG3",
      attributes: [
        { key: "Id", value: "SAD_01HGW3A2EFG3" },
        { key: "Allocates", value: "SRS_NONEXISTENT" },
      ],
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, false);
  const t008 = result.diagnostics.find((d) => d.code === "MSL-T008");
  assertEquals(t008 != null, true);
  assertStringIncludes(t008!.message, "SRS_NONEXISTENT");
});

Deno.test("validate: Allocates target exists → passes", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "SRS_BRK_0001",
      id: "SRS_01HGW2Q8MNP3",
      attributes: [{ key: "Id", value: "SRS_01HGW2Q8MNP3" }],
    }),
    typedEntry({
      displayId: "SAD_BRK_0010",
      entryType: "SAD",
      id: "SAD_01HGW3A2EFG3",
      attributes: [
        { key: "Id", value: "SAD_01HGW3A2EFG3" },
        { key: "Allocates", value: "SRS_BRK_0001" },
      ],
      location: { file: "arch.md", line: 10, column: 1 },
    }),
  ];
  const result = validate(entries);
  const t008 = result.diagnostics.filter((d) => d.code === "MSL-T008");
  assertEquals(t008.length, 0);
});

Deno.test("validate: Between with 2 parties → passes", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "ICD_BRK_0001",
      entryType: "ICD",
      id: "ICD_01HGW4A1BCD2",
      attributes: [
        { key: "Id", value: "ICD_01HGW4A1BCD2" },
        { key: "Between", value: "braking-ecu, vehicle-dynamics-ecu" },
      ],
    }),
  ];
  const result = validate(entries);
  const t009 = result.diagnostics.filter((d) => d.code === "MSL-T009");
  assertEquals(t009.length, 0);
});

Deno.test("validate: Between with 1 party → MSL-T009", () => {
  const entries: Entry[] = [
    typedEntry({
      displayId: "ICD_BRK_0001",
      entryType: "ICD",
      id: "ICD_01HGW4A1BCD2",
      attributes: [
        { key: "Id", value: "ICD_01HGW4A1BCD2" },
        { key: "Between", value: "braking-ecu" },
      ],
    }),
  ];
  const result = validate(entries);
  assertEquals(result.valid, false);
  const t009 = result.diagnostics.find((d) => d.code === "MSL-T009");
  assertEquals(t009 != null, true);
  assertStringIncludes(t009!.message, "found 1");
});
