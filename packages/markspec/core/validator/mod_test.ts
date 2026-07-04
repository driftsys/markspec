/**
 * @module validator/mod_test
 *
 * Unit tests for the core structural validator. Exercises shape
 * discrimination, identity uniqueness, and the two baked-in relations
 * (`Supersedes`, `References`). Profile-specific rules are out of scope.
 */

import { assertEquals } from "@std/assert";
import type { Entry } from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";
import { runPipeline, validate } from "./mod.ts";
import type { TyplBlock } from "../typl/mod.ts";

function entry(
  partial: Partial<Omit<Entry, "displayId">> & { displayId: string },
): Entry {
  return {
    displayId: makeDisplayId(partial.displayId),
    title: partial.title ?? "Test entry",
    body: partial.body ?? "Body.",
    rawAttributes: partial.rawAttributes ?? [],
    id: partial.id,
    shape: partial.shape ?? "Authored",
    location: partial.location ??
      { file: "test.md", line: 1, column: 1 },
    source: partial.source ?? { kind: "markdown" },
    typedAttributes: partial.typedAttributes ?? new Map(),
    bodyTokens: partial.bodyTokens ?? [],
    types: partial.types,
  };
}

const ULID_A = "01HGW2Q8MNP3RSTVWXYZABCDEF";
const ULID_B = "01HGW2Q8MNP3RSTVWXYZABCDEG";

// ---------------------------------------------------------------------------
// MSL-R003 / MSL-R004 — identity
// ---------------------------------------------------------------------------

Deno.test("validate: entry with ULID Id passes", () => {
  const result = validate([
    entry({
      displayId: "REQ-001",
      rawAttributes: [{ key: "Id", value: ULID_A }],
      id: ULID_A,
      shape: "Authored",
    }),
  ]);
  const structural = result.diagnostics.filter((d) =>
    d.code === "MSL-R003" || d.code === "MSL-R004"
  );
  assertEquals(structural, []);
});

Deno.test("validate: missing Id → MSL-R003", () => {
  const result = validate([entry({ displayId: "REQ-001" })]);
  const r003 = result.diagnostics.filter((d) => d.code === "MSL-R003");
  assertEquals(r003.length, 1);
});

Deno.test("validate: malformed Id → MSL-R004", () => {
  const result = validate([
    entry({
      displayId: "REQ-001",
      rawAttributes: [{ key: "Id", value: "not-a-ulid-or-uri" }],
      id: "not-a-ulid-or-uri",
    }),
  ]);
  const r004 = result.diagnostics.filter((d) => d.code === "MSL-R004");
  assertEquals(r004.length >= 1, true);
});

Deno.test("validate: URI Id on referenced entry passes", () => {
  const result = validate([
    entry({
      displayId: "ISO-26262-6",
      rawAttributes: [{ key: "Id", value: "urn:iso:std:iso:26262:-6:ed-2" }],
      id: "urn:iso:std:iso:26262:-6:ed-2",
      shape: "Reference",
    }),
  ]);
  const structural = result.diagnostics.filter((d) =>
    d.code === "MSL-R003" || d.code === "MSL-R004"
  );
  assertEquals(structural, []);
});

Deno.test("validate: ULID Id with shape=referenced → MSL-R004 mismatch", () => {
  const result = validate([
    entry({
      displayId: "REQ-001",
      rawAttributes: [{ key: "Id", value: ULID_A }],
      id: ULID_A,
      shape: "Reference",
    }),
  ]);
  const r004 = result.diagnostics.filter((d) => d.code === "MSL-R004");
  assertEquals(r004.length >= 1, true);
});

Deno.test("validate: multiple Id attributes → MSL-R003", () => {
  const result = validate([
    entry({
      displayId: "REQ-001",
      rawAttributes: [
        { key: "Id", value: ULID_A },
        { key: "Id", value: ULID_B },
      ],
      id: ULID_A,
    }),
  ]);
  const r003 = result.diagnostics.filter((d) => d.code === "MSL-R003");
  assertEquals(r003.length >= 1, true);
});

// ---------------------------------------------------------------------------
// MSL-R005 / MSL-R006 — uniqueness
// ---------------------------------------------------------------------------

Deno.test("validate: duplicate display ID → MSL-R006", () => {
  const result = validate([
    entry({
      displayId: "REQ-001",
      rawAttributes: [{ key: "Id", value: ULID_A }],
      id: ULID_A,
    }),
    entry({
      displayId: "REQ-001",
      rawAttributes: [{ key: "Id", value: ULID_B }],
      id: ULID_B,
      location: { file: "other.md", line: 5, column: 1 },
    }),
  ]);
  const r006 = result.diagnostics.filter((d) => d.code === "MSL-R006");
  assertEquals(r006.length, 1);
});

Deno.test("validate: duplicate Id value → MSL-R005", () => {
  const result = validate([
    entry({
      displayId: "REQ-001",
      rawAttributes: [{ key: "Id", value: ULID_A }],
      id: ULID_A,
    }),
    entry({
      displayId: "REQ-002",
      rawAttributes: [{ key: "Id", value: ULID_A }],
      id: ULID_A,
      location: { file: "other.md", line: 5, column: 1 },
    }),
  ]);
  const r005 = result.diagnostics.filter((d) => d.code === "MSL-R005");
  assertEquals(r005.length, 1);
});

// ---------------------------------------------------------------------------
// MSL-R010 — unknown attributes
// ---------------------------------------------------------------------------

Deno.test("validate: universal attribute not flagged", () => {
  const result = validate([
    entry({
      displayId: "REQ-001",
      rawAttributes: [
        { key: "Id", value: ULID_A },
        { key: "Labels", value: "important" },
      ],
      id: ULID_A,
    }),
  ]);
  const r010 = result.diagnostics.filter((d) => d.code === "MSL-R010");
  assertEquals(r010, []);
});

Deno.test("validate: unknown attribute → MSL-R010 warning", () => {
  const result = validate([
    entry({
      displayId: "REQ-001",
      rawAttributes: [
        { key: "Id", value: ULID_A },
        { key: "Custom-attr", value: "value" },
      ],
      id: ULID_A,
    }),
  ]);
  const r010 = result.diagnostics.filter((d) => d.code === "MSL-R010");
  assertEquals(r010.length, 1);
  assertEquals(r010[0].severity, "warning");
});

// ---------------------------------------------------------------------------
// MSL-T012 — Supersedes
// ---------------------------------------------------------------------------

Deno.test("validate: Supersedes target exists → passes", () => {
  const result = validate([
    entry({
      displayId: "REQ-001",
      rawAttributes: [{ key: "Id", value: ULID_A }],
      id: ULID_A,
    }),
    entry({
      displayId: "REQ-002",
      rawAttributes: [
        { key: "Id", value: ULID_B },
        { key: "Supersedes", value: "REQ-001" },
      ],
      id: ULID_B,
      location: { file: "test.md", line: 5, column: 1 },
    }),
  ]);
  const t012 = result.diagnostics.filter((d) => d.code === "MSL-T012");
  assertEquals(t012, []);
});

Deno.test("validate: Supersedes unresolved → MSL-T012", () => {
  const result = validate([
    entry({
      displayId: "REQ-001",
      rawAttributes: [
        { key: "Id", value: ULID_A },
        { key: "Supersedes", value: "REQ-GONE" },
      ],
      id: ULID_A,
    }),
  ]);
  const t012 = result.diagnostics.filter((d) => d.code === "MSL-T012");
  assertEquals(t012.length, 1);
});

// ---------------------------------------------------------------------------
// MSL-T005 — References to referenced entries
// ---------------------------------------------------------------------------

Deno.test("validate: References target is referenced entry → passes", () => {
  const result = validate([
    entry({
      displayId: "ISO-26262-6",
      rawAttributes: [{
        key: "Id",
        value: "urn:iso:std:iso:26262:-6:ed-2",
      }],
      id: "urn:iso:std:iso:26262:-6:ed-2",
      shape: "Reference",
    }),
    entry({
      displayId: "REQ-001",
      rawAttributes: [
        { key: "Id", value: ULID_A },
        { key: "References", value: "ISO-26262-6 §9.4" },
      ],
      id: ULID_A,
      location: { file: "test.md", line: 5, column: 1 },
    }),
  ]);
  const t005 = result.diagnostics.filter((d) => d.code === "MSL-T005");
  assertEquals(t005, []);
});

Deno.test("validate: References unresolved → MSL-T005", () => {
  const result = validate([
    entry({
      displayId: "REQ-001",
      rawAttributes: [
        { key: "Id", value: ULID_A },
        { key: "References", value: "UNKNOWN-STANDARD" },
      ],
      id: ULID_A,
    }),
  ]);
  const t005 = result.diagnostics.filter((d) => d.code === "MSL-T005");
  assertEquals(t005.length, 1);
});

Deno.test("validate: References target is identified (wrong shape) → MSL-R085 warning", () => {
  const result = validate([
    entry({
      displayId: "REQ-001",
      rawAttributes: [{ key: "Id", value: ULID_A }],
      id: ULID_A,
    }),
    entry({
      displayId: "REQ-002",
      rawAttributes: [
        { key: "Id", value: ULID_B },
        { key: "References", value: "REQ-001" },
      ],
      id: ULID_B,
      location: { file: "test.md", line: 5, column: 1 },
    }),
  ]);
  // Per spec §4.8, wrong-shape References target is a warning (MSL-R085),
  // not an error. Unresolved targets stay MSL-T005 (error).
  const r085 = result.diagnostics.filter((d) => d.code === "MSL-R085");
  assertEquals(r085.length, 1);
  assertEquals(r085[0].severity, "warning");
  const t005 = result.diagnostics.filter((d) => d.code === "MSL-T005");
  assertEquals(t005.length, 0);
});

// ---------------------------------------------------------------------------
// Regression — end-to-end happy path
// ---------------------------------------------------------------------------

Deno.test("validate: complete valid set → no error diagnostics", () => {
  const result = validate([
    entry({
      displayId: "ISO-26262-6",
      rawAttributes: [{
        key: "Id",
        value: "urn:iso:std:iso:26262:-6:ed-2",
      }],
      id: "urn:iso:std:iso:26262:-6:ed-2",
      shape: "Reference",
    }),
    entry({
      displayId: "REQ-001",
      rawAttributes: [
        { key: "Id", value: ULID_A },
        { key: "Labels", value: "ASIL-B" },
        { key: "References", value: "ISO-26262-6 §9.4" },
      ],
      id: ULID_A,
      location: { file: "test.md", line: 5, column: 1 },
    }),
    entry({
      displayId: "REQ-002",
      rawAttributes: [
        { key: "Id", value: ULID_B },
        { key: "Supersedes", value: "REQ-001" },
      ],
      id: ULID_B,
      location: { file: "test.md", line: 10, column: 1 },
    }),
  ]);
  assertEquals(result.valid, true);
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
});

// ---------------------------------------------------------------------------
// Typl cross-entry collision detection — TYPL-002/TYPL-003 retired (#723):
// plain (entry-local) $Name collisions across entries are silent now that
// only dotted, corpus-wide published names are declared-once (TYPL-009).
// ---------------------------------------------------------------------------

/** Build a minimal TyplBlock with a single binding for testing. */
function typlBlock(
  name: string,
  kind: TyplBlock["bindings"][0]["kind"],
): TyplBlock {
  return {
    bindings: [{
      statementKind: "binding",
      name,
      kind,
      shape: undefined,
      position: { line: 1, column: 1 },
    }],
    typedefs: [],
  };
}

Deno.test("validate: same $Name + same kind across entries → no TYPL-002", () => {
  const entryA = entry({
    displayId: "REQ-001",
    rawAttributes: [{ key: "Id", value: ULID_A }],
    id: ULID_A,
    location: { file: "a.md", line: 1, column: 1 },
    types: typlBlock("$Speed", "signal"),
  });
  const entryB = entry({
    displayId: "REQ-002",
    rawAttributes: [{ key: "Id", value: ULID_B }],
    id: ULID_B,
    location: { file: "b.md", line: 1, column: 1 },
    types: typlBlock("$Speed", "signal"),
  });
  const result = validate([entryA, entryB]);
  const typl002 = result.diagnostics.filter((d) => d.code === "TYPL-002");
  assertEquals(typl002, []);
});

Deno.test("validate: $Name with different kinds across entries is silent (TYPL-002 retired, #723)", () => {
  const entryA = entry({
    displayId: "REQ-001",
    rawAttributes: [{ key: "Id", value: ULID_A }],
    id: ULID_A,
    location: { file: "a.md", line: 1, column: 1 },
    types: typlBlock("$Speed", "signal"),
  });
  const entryB = entry({
    displayId: "REQ-002",
    rawAttributes: [{ key: "Id", value: ULID_B }],
    id: ULID_B,
    location: { file: "b.md", line: 1, column: 1 },
    types: typlBlock("$Speed", "event"),
  });
  const result = validate([entryA, entryB]);
  const typl002 = result.diagnostics.filter((d) => d.code === "TYPL-002");
  assertEquals(typl002.length, 0);
  assertEquals(result.valid, true);
});

// ---------------------------------------------------------------------------
// MSL-A006: empty CSV element warning
// ---------------------------------------------------------------------------

Deno.test("validate: CSV attribute with empty element emits MSL-A006", () => {
  const e = entry({
    displayId: "STK_0001",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Labels", value: "ASIL-B,,Safety" },
    ],
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
  });
  const result = validate([e]);
  const a006 = result.diagnostics.filter((d) => d.code === "MSL-A006");
  assertEquals(a006.length, 1);
  assertEquals(a006[0].severity, "warning");
});

Deno.test("validate: CSV attribute without empty element does not emit MSL-A006", () => {
  const e = entry({
    displayId: "STK_0002",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEG" },
      { key: "Labels", value: "ASIL-B, Safety" },
    ],
    id: "01HGW2Q8MNP3RSTVWXYZABCDEG",
  });
  const result = validate([e]);
  const a006 = result.diagnostics.filter((d) => d.code === "MSL-A006");
  assertEquals(a006.length, 0);
});

// ---------------------------------------------------------------------------
// MSL-T022 — SoftwareInterface re-parented from Component to Contract
// (interface-as-contract design). Satisfies is inherited from Specification
// (via Contract); Provides is a Component attribute and must no longer fire
// on SoftwareInterface.
// ---------------------------------------------------------------------------

Deno.test("MSL-T022: Satisfies is valid on a SoftwareInterface", () => {
  const e = entry({
    displayId: "API_0001",
    rawAttributes: [
      { key: "Id", value: ULID_A },
      { key: "Type", value: "SoftwareInterface" },
      { key: "Satisfies", value: "SRS_0001" },
    ],
    id: ULID_A,
  });
  // runPipeline runs validatePerTypeAttributes (Stage 1.5) which emits MSL-T022.
  // Plain validate() does not — it is Stage 1 only.
  const result = runPipeline([e], null);
  const t022 = result.diagnostics.filter((d) => d.code === "MSL-T022");
  assertEquals(t022.length, 0);
});

Deno.test("MSL-T022: Provides authored on a SoftwareInterface is flagged", () => {
  const e = entry({
    displayId: "API_0001",
    rawAttributes: [
      { key: "Id", value: ULID_A },
      { key: "Type", value: "SoftwareInterface" },
      { key: "Provides", value: "SWC_0002" },
    ],
    id: ULID_A,
  });
  // runPipeline runs validatePerTypeAttributes (Stage 1.5) which emits MSL-T022.
  // Plain validate() does not — it is Stage 1 only.
  const result = runPipeline([e], null);
  const t022 = result.diagnostics.filter((d) => d.code === "MSL-T022");
  assertEquals(t022.length >= 1, true);
});
