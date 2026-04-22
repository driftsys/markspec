/**
 * @module core/validator/traceability_test
 *
 * Unit tests for Stage 4 — traceability rule enforcement.
 */

import { assertEquals } from "@std/assert";
import { effectiveTraceRules, matchesAnyTarget } from "./traceability.ts";
import type {
  EffectiveProfile,
  EffectiveShapeScope,
  EffectiveTypeDef,
  Entry,
  EntryShape,
  ProvenancedMapEntry,
  TraceRule,
} from "../model/mod.ts";

const ORIGIN = "@test/p";

function traceMap(
  entries: Record<string, TraceRule>,
): Map<string, ProvenancedMapEntry<TraceRule>> {
  const out = new Map<string, ProvenancedMapEntry<TraceRule>>();
  for (const [name, rule] of Object.entries(entries)) {
    out.set(name, { value: rule, origin: ORIGIN });
  }
  return out;
}

function shapeScope(opts: {
  traceability?: Record<string, TraceRule>;
}): EffectiveShapeScope {
  return {
    required: { value: [], origin: ORIGIN },
    attributes: new Map(),
    traceability: traceMap(opts.traceability ?? {}),
  };
}

function typeDef(opts: {
  name: string;
  shape: EntryShape;
  traceability?: Record<string, TraceRule>;
}): ProvenancedMapEntry<EffectiveTypeDef> {
  return {
    origin: ORIGIN,
    value: {
      name: opts.name,
      shape: opts.shape,
      displayIdPattern: { value: undefined, origin: ORIGIN },
      displayIdPatternEnforcement: { value: "off", origin: ORIGIN },
      required: { value: [], origin: ORIGIN },
      attributes: new Map(),
      traceability: traceMap(opts.traceability ?? {}),
    },
  };
}

function profile(opts: {
  identified?: EffectiveShapeScope;
  referenced?: EffectiveShapeScope;
  types?: ReadonlyArray<ProvenancedMapEntry<EffectiveTypeDef>>;
}): EffectiveProfile {
  const typesMap = new Map<string, ProvenancedMapEntry<EffectiveTypeDef>>();
  for (const t of opts.types ?? []) typesMap.set(t.value.name, t);
  return {
    required: { value: [], origin: ORIGIN },
    attributes: new Map(),
    labels: { value: [], origin: ORIGIN },
    identified: opts.identified ?? shapeScope({}),
    referenced: opts.referenced ?? shapeScope({}),
    types: typesMap,
    documents: { types: new Map(), frontMatter: new Map() },
  };
}

function entry(opts: { shape: EntryShape; type?: string }): Entry {
  return {
    displayId: "X-001",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape,
    type: opts.type,
    source: "markdown",
    title: "",
    body: "",
    attributes: [],
    typedAttributes: new Map(),
    location: { file: "t.md", line: 1, column: 1 },
  };
}

const derivedFromRule: TraceRule = {
  target: [{ shape: "identified" }],
  cardinality: { lower: 0, upper: Infinity },
  required: false,
};

const verifiesRule: TraceRule = {
  target: ["requirement"],
  cardinality: { lower: 1, upper: Infinity },
  required: true,
};

Deno.test("effectiveTraceRules: identified shape scope only", () => {
  const p = profile({
    identified: shapeScope({
      traceability: { "Derived-from": derivedFromRule },
    }),
  });
  const e = entry({ shape: "identified" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.size, 1);
  assertEquals(rules.get("Derived-from"), derivedFromRule);
});

Deno.test("effectiveTraceRules: referenced entry always returns empty map", () => {
  const p = profile({
    identified: shapeScope({
      traceability: { "Derived-from": derivedFromRule },
    }),
  });
  const e = entry({ shape: "referenced" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.size, 0);
});

Deno.test("effectiveTraceRules: classified entry adds type-scope rules", () => {
  const p = profile({
    identified: shapeScope({
      traceability: { "Derived-from": derivedFromRule },
    }),
    types: [typeDef({
      name: "test",
      shape: "identified",
      traceability: { Verifies: verifiesRule },
    })],
  });
  const e = entry({ shape: "identified", type: "test" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.size, 2);
  assertEquals(rules.get("Derived-from"), derivedFromRule);
  assertEquals(rules.get("Verifies"), verifiesRule);
});

Deno.test("effectiveTraceRules: un-classified entry uses only shape scope", () => {
  const p = profile({
    identified: shapeScope({
      traceability: { "Derived-from": derivedFromRule },
    }),
    types: [typeDef({
      name: "test",
      shape: "identified",
      traceability: { Verifies: verifiesRule },
    })],
  });
  const e = entry({ shape: "identified" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.size, 1);
  assertEquals(rules.has("Verifies"), false);
  assertEquals(rules.has("Derived-from"), true);
});

Deno.test("effectiveTraceRules: type scope wins on link-name collision", () => {
  const tightRule: TraceRule = {
    target: ["stakeholder-requirement"],
    cardinality: { lower: 1, upper: Infinity },
    required: true,
  };
  const p = profile({
    identified: shapeScope({
      traceability: { "Derived-from": derivedFromRule },
    }),
    types: [typeDef({
      name: "requirement",
      shape: "identified",
      traceability: { "Derived-from": tightRule },
    })],
  });
  const e = entry({ shape: "identified", type: "requirement" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.get("Derived-from"), tightRule);
});

Deno.test("effectiveTraceRules: classified entry with unknown type falls back to shape scope", () => {
  const p = profile({
    identified: shapeScope({
      traceability: { "Derived-from": derivedFromRule },
    }),
  });
  const e = entry({ shape: "identified", type: "not-in-profile" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.size, 1);
  assertEquals(rules.get("Derived-from"), derivedFromRule);
});

function targetEntry(opts: {
  shape: EntryShape;
  type?: string;
  displayId?: string;
}): Entry {
  return {
    displayId: opts.displayId ?? "Y-001",
    id: "01TARGET02TARGET03TARGET04",
    shape: opts.shape,
    type: opts.type,
    source: "markdown",
    title: "",
    body: "",
    attributes: [],
    typedAttributes: new Map(),
    location: { file: "t.md", line: 1, column: 1 },
  };
}

Deno.test("matchesAnyTarget: string matcher accepts target with matching type", () => {
  const t = targetEntry({ shape: "identified", type: "requirement" });
  assertEquals(matchesAnyTarget(t, ["requirement"]), true);
});

Deno.test("matchesAnyTarget: string matcher rejects mismatched type", () => {
  const t = targetEntry({ shape: "identified", type: "note" });
  assertEquals(matchesAnyTarget(t, ["requirement"]), false);
});

Deno.test("matchesAnyTarget: string matcher rejects un-classified target", () => {
  const t = targetEntry({ shape: "identified" });
  assertEquals(matchesAnyTarget(t, ["requirement"]), false);
});

Deno.test("matchesAnyTarget: shape matcher accepts matching shape", () => {
  const t = targetEntry({ shape: "identified" });
  assertEquals(matchesAnyTarget(t, [{ shape: "identified" }]), true);
});

Deno.test("matchesAnyTarget: shape matcher rejects opposite shape", () => {
  const t = targetEntry({ shape: "referenced" });
  assertEquals(matchesAnyTarget(t, [{ shape: "identified" }]), false);
});

Deno.test("matchesAnyTarget: multi-matcher uses OR — first match wins", () => {
  const t = targetEntry({ shape: "identified", type: "requirement" });
  assertEquals(
    matchesAnyTarget(t, ["stakeholder-requirement", "requirement"]),
    true,
  );
});

Deno.test("matchesAnyTarget: multi-matcher all reject → false", () => {
  const t = targetEntry({ shape: "identified", type: "other" });
  assertEquals(matchesAnyTarget(t, ["a", "b", { shape: "referenced" }]), false);
});

Deno.test("matchesAnyTarget: mixed string + shape matcher", () => {
  const reqTarget = targetEntry({ shape: "identified", type: "requirement" });
  const refTarget = targetEntry({ shape: "referenced", type: "citation" });
  const otherIdentified = targetEntry({ shape: "identified", type: "note" });

  const rule = ["requirement", { shape: "referenced" as const }];
  assertEquals(matchesAnyTarget(reqTarget, rule), true);
  assertEquals(matchesAnyTarget(refTarget, rule), true);
  assertEquals(matchesAnyTarget(otherIdentified, rule), false);
});

Deno.test("matchesAnyTarget: empty matcher list → always false", () => {
  const t = targetEntry({ shape: "identified", type: "requirement" });
  assertEquals(matchesAnyTarget(t, []), false);
});
