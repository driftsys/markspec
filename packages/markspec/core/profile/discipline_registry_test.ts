// packages/markspec/core/profile/discipline_registry_test.ts

import { assertEquals } from "@std/assert";
import {
  CORE_DISCIPLINE_REGISTRY,
  type EffectiveTypeDef,
} from "../model/mod.ts";
import { buildEffectiveDisciplineRegistry } from "./discipline_registry.ts";

// NOTE: no test exercises multi-pass fixed-point resolution because the
// current manifest parser rejects `extends` values that aren't core
// types (PROFILE-TYPE-002), so profile→profile inheritance chains are
// unreachable. Add a multi-pass test if that constraint is ever relaxed.

// deno-lint-ignore no-explicit-any
function emptyEffective(): any {
  return {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map(),
    documents: { types: new Map(), frontMatter: new Map() },
    kinds: new Map(),
    prose: {
      lexicons: {
        "capitalized-allow": { value: [], origin: "" },
        "sentence-abbrev": { value: [], origin: "" },
      },
    },
  };
}

function typeEntry(
  name: string,
  extendsBase: string,
  discipline: string | undefined,
): EffectiveTypeDef {
  return {
    name,
    extends: extendsBase,
    displayIdPattern: { value: undefined, origin: "p" },
    displayIdPatternEnforcement: { value: "off", origin: "p" },
    color: { value: undefined, origin: "p" },
    required: { value: [], origin: "p" },
    attributes: new Map(),
    traceability: new Map(),
    description: { value: undefined, origin: "p" },
    attrDescriptions: new Map(),
    relationDescriptions: new Map(),
    discipline: { value: discipline, origin: "p" },
  };
}

Deno.test("registry: null effective profile → core seed unchanged", () => {
  const reg = buildEffectiveDisciplineRegistry(null);
  assertEquals(reg.get("SoftwareComponent"), "software");
  assertEquals(reg.get("HardwareComponent"), "hardware");
  // Same size as core seed; no extra entries.
  assertEquals(reg.size, CORE_DISCIPLINE_REGISTRY.size);
});

Deno.test("registry: profile-declared type with explicit discipline", () => {
  const ep = emptyEffective();
  ep.types.set("SoftwareRequirement", {
    value: typeEntry("SoftwareRequirement", "Requirement", "software"),
    origin: "p",
  });
  const reg = buildEffectiveDisciplineRegistry(ep);
  assertEquals(reg.get("SoftwareRequirement"), "software");
});

Deno.test("registry: profile-declared type auto-inherits from core ancestor", () => {
  // FirmwareUnit extends SoftwareUnit, no explicit discipline → inherit 'software'.
  const ep = emptyEffective();
  ep.types.set("FirmwareUnit", {
    value: typeEntry("FirmwareUnit", "SoftwareUnit", undefined),
    origin: "p",
  });
  const reg = buildEffectiveDisciplineRegistry(ep);
  assertEquals(reg.get("FirmwareUnit"), "software");
});

Deno.test("registry: explicit discipline overrides ancestor inheritance", () => {
  const ep = emptyEffective();
  ep.kinds.set("firmware", { value: {}, origin: "p" });
  ep.types.set("EmbeddedFirmwareUnit", {
    value: typeEntry("EmbeddedFirmwareUnit", "SoftwareUnit", "firmware"),
    origin: "p",
  });
  const reg = buildEffectiveDisciplineRegistry(ep);
  assertEquals(reg.get("EmbeddedFirmwareUnit"), "firmware");
});

Deno.test("registry: type with no ancestor in registry is skipped", () => {
  const ep = emptyEffective();
  ep.types.set("LooseType", {
    value: typeEntry("LooseType", "Requirement", undefined),
    origin: "p",
  });
  const reg = buildEffectiveDisciplineRegistry(ep);
  // Requirement is not discipline-bearing; LooseType inherits nothing.
  assertEquals(reg.has("LooseType"), false);
});

Deno.test("registry: core entries are preserved", () => {
  const ep = emptyEffective();
  ep.types.set("MyType", {
    value: typeEntry("MyType", "Requirement", "system"),
    origin: "p",
  });
  const reg = buildEffectiveDisciplineRegistry(ep);
  // Core SW/HW Component/Interface/Unit subtypes still in registry.
  assertEquals(reg.get("SoftwareComponent"), "software");
  assertEquals(reg.get("HardwareInterface"), "hardware");
  assertEquals(reg.get("MyType"), "system");
});
