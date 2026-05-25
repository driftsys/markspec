/**
 * @module core/validator/discipline_test
 *
 * Unit tests for {@linkcode validateDiscipline} — ADR-017 Slice 3, Task 4.
 * Covers MSL-T025 (unknown override kind) only; Tasks 5–8 will add tests
 * for MSL-T026 through MSL-T031.
 */

import { assertEquals } from "@std/assert";
import {
  CORE_DISCIPLINE_REGISTRY,
  type DisplayId,
  type Entry,
  makeDisplayId,
} from "../mod.ts";
import { validateDiscipline } from "./discipline.ts";

function fixture(overrides: Partial<Entry>): Entry {
  return {
    displayId: makeDisplayId("X_0001"),
    title: "Fixture",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "t.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
    derivedDiscipline: "system",
    ...overrides,
  };
}

Deno.test("MSL-T025: unknown override kind emits error", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [{ key: "Discipline", value: "nonsense" }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    CORE_DISCIPLINE_REGISTRY,
  );
  const t025 = diags.find((d) => d.code === "MSL-T025");
  assertEquals(t025?.severity, "error");
  assertEquals(t025?.message.includes("nonsense"), true);
});

Deno.test("MSL-T025: known core kind override is silent", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [{ key: "Discipline", value: "software" }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    CORE_DISCIPLINE_REGISTRY,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T025"), false);
});

Deno.test("MSL-T025: empty override value is silent (no false positive)", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [{ key: "Discipline", value: "" }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    CORE_DISCIPLINE_REGISTRY,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T025"), false);
});

Deno.test("MSL-T026: missing kind ('@ 2026-01-15' with no leading kind) emits error", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [{ key: "Discipline-frozen", value: "@ 2026-01-15" }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    CORE_DISCIPLINE_REGISTRY,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T026"), true);
});

Deno.test("MSL-T026: uppercase kind ('Software') emits error", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [{ key: "Discipline-frozen", value: "Software" }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    CORE_DISCIPLINE_REGISTRY,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T026"), true);
});

Deno.test("MSL-T026: invalid month (2026-13-99) emits error", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [{
      key: "Discipline-frozen",
      value: "software @ 2026-13-99",
    }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    CORE_DISCIPLINE_REGISTRY,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T026"), true);
});

Deno.test("MSL-T026: invalid Feb 30 emits error", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [{
      key: "Discipline-frozen",
      value: "software @ 2026-02-30",
    }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    CORE_DISCIPLINE_REGISTRY,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T026"), true);
});

Deno.test("MSL-T026: bare kind ('software') is silent", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [{ key: "Discipline-frozen", value: "software" }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    CORE_DISCIPLINE_REGISTRY,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T026"), false);
});

Deno.test("MSL-T026: kind + valid date ('software @ 2026-05-25') is silent", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [{
      key: "Discipline-frozen",
      value: "software @ 2026-05-25",
    }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    CORE_DISCIPLINE_REGISTRY,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T026"), false);
});

Deno.test("MSL-T027: well-formed freeze with unknown kind emits error", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [{
      key: "Discipline-frozen",
      value: "nonsense @ 2026-01-15",
    }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    CORE_DISCIPLINE_REGISTRY,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T027"), true);
});

Deno.test("MSL-T026 suppresses MSL-T027: malformed value never reaches the kind check", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [{
      key: "Discipline-frozen",
      value: "Software @ 2026-01-15",
    }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    CORE_DISCIPLINE_REGISTRY,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T026"), true);
  assertEquals(diags.some((d) => d.code === "MSL-T027"), false);
});

const TEST_REGISTRY_T028 = new Map<string, string>([
  ["SoftwareRequirement", "software"],
  ["HardwareRequirement", "hardware"],
  ["SoftwareComponent", "software"],
  ["HardwareComponent", "hardware"],
]);

Deno.test("MSL-T028: override 'hardware' on SoftwareRequirement-typed entry emits warning", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    type: "SoftwareRequirement",
    rawAttributes: [{ key: "Discipline", value: "hardware" }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    TEST_REGISTRY_T028,
  );
  const t = diags.find((d) => d.code === "MSL-T028");
  assertEquals(t?.severity, "warning");
});

Deno.test("MSL-T028: override 'software' matching type derivation is silent", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    type: "SoftwareRequirement",
    rawAttributes: [{ key: "Discipline", value: "software" }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    TEST_REGISTRY_T028,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T028"), false);
});

Deno.test("MSL-T028: suppressed when entry type is not in the registry (default-system suppression)", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    type: "Requirement", // not in TEST_REGISTRY_T028 → channel 3 yields undefined
    rawAttributes: [{ key: "Discipline", value: "software" }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    TEST_REGISTRY_T028,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T028"), false);
});

Deno.test("MSL-T029: override 'hardware' on entry allocated to SoftwareComponent emits warning", () => {
  const sw = fixture({
    displayId: makeDisplayId("COMP_SW"),
    type: "SoftwareComponent",
  });
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [
      { key: "Allocated-to", value: "COMP_SW" },
      { key: "Discipline", value: "hardware" },
    ],
  });
  const map = new Map<DisplayId, Entry>([[sw.displayId, sw]]);
  const diags = validateDiscipline([e], map, TEST_REGISTRY_T028);
  const t = diags.find((d) => d.code === "MSL-T029");
  assertEquals(t?.severity, "warning");
});

Deno.test("MSL-T029: matching allocation is silent", () => {
  const sw = fixture({
    displayId: makeDisplayId("COMP_SW"),
    type: "SoftwareComponent",
  });
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [
      { key: "Allocated-to", value: "COMP_SW" },
      { key: "Discipline", value: "software" },
    ],
  });
  const map = new Map<DisplayId, Entry>([[sw.displayId, sw]]);
  const diags = validateDiscipline([e], map, TEST_REGISTRY_T028);
  assertEquals(diags.some((d) => d.code === "MSL-T029"), false);
});

Deno.test("MSL-T029: suppressed when no allocation targets resolve (default-system suppression)", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [{ key: "Discipline", value: "software" }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    TEST_REGISTRY_T028,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T029"), false);
});

Deno.test("MSL-T028 + MSL-T029 can both fire on the same entry", () => {
  const sw = fixture({
    displayId: makeDisplayId("COMP_SW"),
    type: "SoftwareComponent",
  });
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    type: "SoftwareRequirement",
    rawAttributes: [
      { key: "Allocated-to", value: "COMP_SW" },
      { key: "Discipline", value: "hardware" },
    ],
  });
  const map = new Map<DisplayId, Entry>([[sw.displayId, sw]]);
  const diags = validateDiscipline([e], map, TEST_REGISTRY_T028);
  assertEquals(diags.some((d) => d.code === "MSL-T028"), true);
  assertEquals(diags.some((d) => d.code === "MSL-T029"), true);
});

Deno.test("MSL-T025 suppresses MSL-T028 and T029 (unknown kind, nothing to compare)", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    type: "SoftwareRequirement",
    rawAttributes: [{ key: "Discipline", value: "nonsense" }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    TEST_REGISTRY_T028,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T025"), true);
  assertEquals(diags.some((d) => d.code === "MSL-T028"), false);
  assertEquals(diags.some((d) => d.code === "MSL-T029"), false);
});

Deno.test("MSL-T030: freeze 'software' on hardware-typed entry emits warning", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    type: "HardwareRequirement",
    rawAttributes: [{
      key: "Discipline-frozen",
      value: "software @ 2026-01-15",
    }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    TEST_REGISTRY_T028,
  );
  const t = diags.find((d) => d.code === "MSL-T030");
  assertEquals(t?.severity, "warning");
});

Deno.test("MSL-T030: freeze matching current derivation is silent", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    type: "SoftwareRequirement",
    rawAttributes: [{
      key: "Discipline-frozen",
      value: "software @ 2026-01-15",
    }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    TEST_REGISTRY_T028,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T030"), false);
});

Deno.test("MSL-T030 fires when derivation defaults to system (NOT suppressed)", () => {
  // Entry has no Type in registry and no Allocated-to → derivation = system.
  // Freeze captured 'software'. Drift from 'software' → 'system' is meaningful.
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    type: "Requirement",
    rawAttributes: [{
      key: "Discipline-frozen",
      value: "software @ 2026-01-15",
    }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    TEST_REGISTRY_T028,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T030"), true);
});

Deno.test("MSL-T030: freeze 'system' matching default-system derivation is silent", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    type: "Requirement",
    rawAttributes: [{
      key: "Discipline-frozen",
      value: "system @ 2026-01-15",
    }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    TEST_REGISTRY_T028,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T030"), false);
});

Deno.test("MSL-T026 suppresses MSL-T030: malformed freeze → no divergence comparison", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    type: "SoftwareRequirement",
    rawAttributes: [{ key: "Discipline-frozen", value: "Software" }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    TEST_REGISTRY_T028,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T026"), true);
  assertEquals(diags.some((d) => d.code === "MSL-T030"), false);
});

Deno.test("MSL-T030 fires alongside T028/T029 — they are independent signals", () => {
  const sw = fixture({
    displayId: makeDisplayId("COMP_SW"),
    type: "SoftwareComponent",
  });
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    type: "SoftwareRequirement",
    rawAttributes: [
      { key: "Allocated-to", value: "COMP_SW" },
      { key: "Discipline", value: "hardware" },
      { key: "Discipline-frozen", value: "hardware @ 2026-01-15" },
    ],
  });
  const map = new Map<DisplayId, Entry>([[sw.displayId, sw]]);
  const diags = validateDiscipline([e], map, TEST_REGISTRY_T028);
  assertEquals(diags.some((d) => d.code === "MSL-T028"), true); // override vs type
  assertEquals(diags.some((d) => d.code === "MSL-T029"), true); // override vs allocation
  assertEquals(diags.some((d) => d.code === "MSL-T030"), true); // freeze vs derivation
});

Deno.test("MSL-T031: override 'software' + freeze 'hardware' (both known) emits warning", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [
      { key: "Discipline", value: "software" },
      { key: "Discipline-frozen", value: "hardware @ 2026-01-15" },
    ],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    CORE_DISCIPLINE_REGISTRY,
  );
  const t = diags.find((d) => d.code === "MSL-T031");
  assertEquals(t?.severity, "warning");
});

Deno.test("MSL-T031: override and freeze agreeing is silent", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [
      { key: "Discipline", value: "software" },
      { key: "Discipline-frozen", value: "software @ 2026-01-15" },
    ],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    CORE_DISCIPLINE_REGISTRY,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T031"), false);
});

Deno.test("MSL-T025 suppresses MSL-T031: unknown override → no comparison", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [
      { key: "Discipline", value: "nonsense" },
      { key: "Discipline-frozen", value: "software @ 2026-01-15" },
    ],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    CORE_DISCIPLINE_REGISTRY,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T025"), true);
  assertEquals(diags.some((d) => d.code === "MSL-T031"), false);
});

Deno.test("MSL-T026 suppresses MSL-T031: malformed freeze → no comparison", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [
      { key: "Discipline", value: "software" },
      { key: "Discipline-frozen", value: "Software" }, // uppercase → malformed
    ],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    CORE_DISCIPLINE_REGISTRY,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T026"), true);
  assertEquals(diags.some((d) => d.code === "MSL-T031"), false);
});

Deno.test("MSL-T031: only override present → no warning", () => {
  const e = fixture({
    displayId: makeDisplayId("REQ_001"),
    rawAttributes: [{ key: "Discipline", value: "software" }],
  });
  const diags = validateDiscipline(
    [e],
    new Map<DisplayId, Entry>(),
    CORE_DISCIPLINE_REGISTRY,
  );
  assertEquals(diags.some((d) => d.code === "MSL-T031"), false);
});
