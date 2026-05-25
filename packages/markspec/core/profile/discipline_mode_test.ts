// packages/markspec/core/profile/discipline_mode_test.ts

import { assertEquals } from "@std/assert";
import {
  inferDisciplineMode,
  resolveDisciplineMode,
} from "./discipline_mode.ts";
import type { EffectiveTypeDef } from "../model/mod.ts";

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
    disciplineMode: { value: "none", origin: "inferred" },
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

Deno.test("inferDisciplineMode: tiered when a requirement-shaped type has discipline:", () => {
  const ep = emptyEffective();
  ep.types.set("SoftwareRequirement", {
    value: typeEntry("SoftwareRequirement", "Requirement", "software"),
    origin: "p",
  });
  assertEquals(inferDisciplineMode(ep), "tiered");
});

Deno.test("inferDisciplineMode: flat when profile declares a requirement-shaped type without discipline:", () => {
  const ep = emptyEffective();
  ep.types.set("SystemRequirement", {
    value: typeEntry("SystemRequirement", "Requirement", undefined),
    origin: "p",
  });
  // Profile declares SystemRequirement (extends Requirement, no discipline:).
  // No tiered signal; profile is doing requirements work → flat.
  assertEquals(inferDisciplineMode(ep), "flat");
});

Deno.test("inferDisciplineMode: none when profile contributes nothing", () => {
  // Empty profile — no types declared, no profile-extended kinds. The
  // implementation deliberately treats the always-present core registry
  // (SoftwareComponent etc.) as "not a profile contribution" so empty
  // profiles get the spec example table's "none" result rather than
  // collapsing to "flat" via the always-present core registry.
  const ep = emptyEffective();
  assertEquals(inferDisciplineMode(ep), "none");
});

Deno.test("inferDisciplineMode: tiered wins on mixed-signal profile", () => {
  const ep = emptyEffective();
  ep.types.set("SoftwareRequirement", {
    value: typeEntry("SoftwareRequirement", "Requirement", "software"),
    origin: "p",
  });
  ep.types.set("SystemRequirement", {
    value: typeEntry("SystemRequirement", "Requirement", undefined),
    origin: "p",
  });
  assertEquals(inferDisciplineMode(ep), "tiered");
});

Deno.test("inferDisciplineMode: type name is irrelevant (SoftwareRequirement without discipline: → flat)", () => {
  const ep = emptyEffective();
  ep.types.set("SoftwareRequirement", {
    value: typeEntry("SoftwareRequirement", "Requirement", undefined),
    origin: "p",
  });
  // No tiered requirement type (discipline: is undefined). With core
  // registry present, falls through to "flat".
  assertEquals(inferDisciplineMode(ep), "flat");
});

Deno.test("inferDisciplineMode: deep extends chain reaches Requirement", () => {
  const ep = emptyEffective();
  ep.types.set("BaseReq", {
    value: typeEntry("BaseReq", "Requirement", undefined),
    origin: "p",
  });
  ep.types.set("DerivedReq", {
    value: typeEntry("DerivedReq", "BaseReq", "software"),
    origin: "p",
  });
  // DerivedReq → BaseReq → Requirement. Has discipline:. → tiered.
  assertEquals(inferDisciplineMode(ep), "tiered");
});

Deno.test("resolveDisciplineMode: declared value wins with origin 'declared'", () => {
  const ep = emptyEffective();
  // Even though inference would yield "none" or "flat", explicit declared
  // value takes precedence.
  const resolved = resolveDisciplineMode(ep, {
    value: "tiered",
    origin: "tier-a",
  });
  assertEquals(resolved.value, "tiered");
  assertEquals(resolved.origin, "declared");
});

Deno.test("resolveDisciplineMode: undefined declared falls back to inference with origin 'inferred'", () => {
  const ep = emptyEffective();
  const resolved = resolveDisciplineMode(ep, undefined);
  assertEquals(resolved.value, "none");
  assertEquals(resolved.origin, "inferred");
});

Deno.test("resolveDisciplineMode: declared 'none' wins over inferable 'tiered'", () => {
  const ep = emptyEffective();
  ep.types.set("SoftwareRequirement", {
    value: typeEntry("SoftwareRequirement", "Requirement", "software"),
    origin: "p",
  });
  // Would infer "tiered" but author explicitly said "none".
  const resolved = resolveDisciplineMode(ep, {
    value: "none",
    origin: "tier-a",
  });
  assertEquals(resolved.value, "none");
  assertEquals(resolved.origin, "declared");
});
