/**
 * @module core/compiler/discipline_classifier_test
 *
 * Unit tests for {@linkcode classifyDiscipline} — channels 3 (type-based)
 * and 4 (allocation-based) per ADR-017 Invariant 1.
 */

import { assertEquals } from "@std/assert";
import {
  CORE_DISCIPLINE_REGISTRY,
  type DisplayId,
  type Entry,
  makeDisplayId,
} from "../mod.ts";
import { classifyDiscipline } from "./discipline_classifier.ts";

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

Deno.test("channel 3: Type SoftwareComponent → 'software'", () => {
  const entry = fixture({ type: "SoftwareComponent" });
  const empty = new Map<DisplayId, Entry>();
  assertEquals(
    classifyDiscipline(entry, empty, CORE_DISCIPLINE_REGISTRY),
    "software",
  );
});

Deno.test("channel 3: Type HardwareInterface → 'hardware'", () => {
  const entry = fixture({ type: "HardwareInterface" });
  const empty = new Map<DisplayId, Entry>();
  assertEquals(
    classifyDiscipline(entry, empty, CORE_DISCIPLINE_REGISTRY),
    "hardware",
  );
});

Deno.test("channel 3: Type that isn't in the registry falls through", () => {
  const entry = fixture({ type: "Requirement" });
  const empty = new Map<DisplayId, Entry>();
  assertEquals(
    classifyDiscipline(entry, empty, CORE_DISCIPLINE_REGISTRY),
    "system",
  );
});

Deno.test("default: entry with no Type and no Allocated-to → 'system'", () => {
  const entry = fixture({});
  const empty = new Map<DisplayId, Entry>();
  assertEquals(
    classifyDiscipline(entry, empty, CORE_DISCIPLINE_REGISTRY),
    "system",
  );
});

// ---------------------------------------------------------------------------
// Channel 4: allocation-based
// ---------------------------------------------------------------------------

import { MIXED_DISCIPLINE } from "../mod.ts";
import type { Discipline } from "../mod.ts";

Deno.test("channel 4: Allocated-to a SoftwareComponent → 'software'", () => {
  const req = fixture({
    displayId: makeDisplayId("REQ_0001"),
    rawAttributes: [{ key: "Allocated-to", value: "SWC_0001" }],
  });
  const swc = fixture({
    displayId: makeDisplayId("SWC_0001"),
    type: "SoftwareComponent",
  });
  const map = new Map<DisplayId, Entry>([
    [req.displayId, req],
    [swc.displayId, swc],
  ]);
  assertEquals(
    classifyDiscipline(req, map, CORE_DISCIPLINE_REGISTRY),
    "software",
  );
});

Deno.test("channel 4: Allocated-to a HardwareComponent → 'hardware'", () => {
  const req = fixture({
    displayId: makeDisplayId("REQ_0001"),
    rawAttributes: [{ key: "Allocated-to", value: "HWC_0001" }],
  });
  const hwc = fixture({
    displayId: makeDisplayId("HWC_0001"),
    type: "HardwareComponent",
  });
  const map = new Map<DisplayId, Entry>([
    [req.displayId, req],
    [hwc.displayId, hwc],
  ]);
  assertEquals(
    classifyDiscipline(req, map, CORE_DISCIPLINE_REGISTRY),
    "hardware",
  );
});

Deno.test(
  "channel 4: multiple Allocated-to lines with same discipline → that discipline",
  () => {
    const req = fixture({
      displayId: makeDisplayId("REQ_0001"),
      rawAttributes: [
        { key: "Allocated-to", value: "SWC_0001" },
        { key: "Allocated-to", value: "SWC_0002" },
      ],
    });
    const swc1 = fixture({
      displayId: makeDisplayId("SWC_0001"),
      type: "SoftwareComponent",
    });
    const swc2 = fixture({
      displayId: makeDisplayId("SWC_0002"),
      type: "SoftwareComponent",
    });
    const map = new Map<DisplayId, Entry>([
      [req.displayId, req],
      [swc1.displayId, swc1],
      [swc2.displayId, swc2],
    ]);
    assertEquals(
      classifyDiscipline(req, map, CORE_DISCIPLINE_REGISTRY),
      "software",
    );
  },
);

Deno.test(
  "channel 4: Allocated-to targets with different disciplines → MIXED_DISCIPLINE",
  () => {
    const req = fixture({
      displayId: makeDisplayId("REQ_0001"),
      rawAttributes: [
        { key: "Allocated-to", value: "SWC_0001" },
        { key: "Allocated-to", value: "HWC_0001" },
      ],
    });
    const swc = fixture({
      displayId: makeDisplayId("SWC_0001"),
      type: "SoftwareComponent",
    });
    const hwc = fixture({
      displayId: makeDisplayId("HWC_0001"),
      type: "HardwareComponent",
    });
    const map = new Map<DisplayId, Entry>([
      [req.displayId, req],
      [swc.displayId, swc],
      [hwc.displayId, hwc],
    ]);
    assertEquals(
      classifyDiscipline(req, map, CORE_DISCIPLINE_REGISTRY),
      MIXED_DISCIPLINE,
    );
  },
);

Deno.test(
  "channel 4: comma-separated Allocated-to value with two disciplines → MIXED_DISCIPLINE",
  () => {
    const req = fixture({
      displayId: makeDisplayId("REQ_0001"),
      rawAttributes: [
        { key: "Allocated-to", value: "SWC_0001, HWC_0001" },
      ],
    });
    const swc = fixture({
      displayId: makeDisplayId("SWC_0001"),
      type: "SoftwareComponent",
    });
    const hwc = fixture({
      displayId: makeDisplayId("HWC_0001"),
      type: "HardwareComponent",
    });
    const map = new Map<DisplayId, Entry>([
      [req.displayId, req],
      [swc.displayId, swc],
      [hwc.displayId, hwc],
    ]);
    assertEquals(
      classifyDiscipline(req, map, CORE_DISCIPLINE_REGISTRY),
      MIXED_DISCIPLINE,
    );
  },
);

Deno.test(
  "channel 4: Allocated-to target that doesn't exist → falls through to default",
  () => {
    const req = fixture({
      displayId: makeDisplayId("REQ_0001"),
      rawAttributes: [{ key: "Allocated-to", value: "MISSING_0001" }],
    });
    const map = new Map<DisplayId, Entry>([[req.displayId, req]]);
    assertEquals(
      classifyDiscipline(req, map, CORE_DISCIPLINE_REGISTRY),
      "system",
    );
  },
);

Deno.test(
  "channel 4: Allocated-to target whose Type isn't registered → falls through",
  () => {
    const req = fixture({
      displayId: makeDisplayId("REQ_0001"),
      rawAttributes: [{ key: "Allocated-to", value: "GEN_0001" }],
    });
    const generic = fixture({
      displayId: makeDisplayId("GEN_0001"),
      type: "Component",
    });
    const map = new Map<DisplayId, Entry>([
      [req.displayId, req],
      [generic.displayId, generic],
    ]);
    assertEquals(
      classifyDiscipline(req, map, CORE_DISCIPLINE_REGISTRY),
      "system",
    );
  },
);

Deno.test(
  "precedence: channel 3 (Type) wins over channel 4 (Allocation)",
  () => {
    const req = fixture({
      displayId: makeDisplayId("SWR_0001"),
      type: "SoftwareRequirement",
      rawAttributes: [{ key: "Allocated-to", value: "HWC_0001" }],
    });
    const hwc = fixture({
      displayId: makeDisplayId("HWC_0001"),
      type: "HardwareComponent",
    });
    const extendedRegistry = new Map<string, Discipline>([
      ...CORE_DISCIPLINE_REGISTRY,
      ["SoftwareRequirement", "software"],
    ]);
    const map = new Map<DisplayId, Entry>([
      [req.displayId, req],
      [hwc.displayId, hwc],
    ]);
    assertEquals(
      classifyDiscipline(req, map, extendedRegistry),
      "software",
    );
  },
);
