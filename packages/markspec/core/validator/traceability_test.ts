/**
 * @module core/validator/traceability_test
 *
 * Unit tests for Stage 4 — traceability rule enforcement.
 */

import { assertEquals } from "@std/assert";
import {
  effectiveTraceRules,
  matchesAnyTarget,
  validateTraceabilityForEntry,
} from "./traceability.ts";
import type {
  EffectiveProfile,
  EffectiveTypeDef,
  Entry,
  EntryShape,
  ProvenancedMapEntry,
  TraceRule,
} from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";

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

function typeDef(opts: {
  name: string;
  traceability?: Record<string, TraceRule>;
}): ProvenancedMapEntry<EffectiveTypeDef> {
  return {
    origin: ORIGIN,
    value: {
      name: opts.name,
      extends: "Requirement",
      displayIdPattern: { value: undefined, origin: ORIGIN },
      displayIdPatternEnforcement: { value: "off", origin: ORIGIN },
      color: { value: undefined, origin: ORIGIN },
      required: { value: [], origin: ORIGIN },
      attributes: new Map(),
      traceability: traceMap(opts.traceability ?? {}),
      description: { value: undefined, origin: ORIGIN },
      attrDescriptions: new Map(),
      relationDescriptions: new Map(),
      discipline: { value: undefined, origin: ORIGIN },
    },
  };
}

function profile(opts: {
  types?: ReadonlyArray<ProvenancedMapEntry<EffectiveTypeDef>>;
}): EffectiveProfile {
  const typesMap = new Map<string, ProvenancedMapEntry<EffectiveTypeDef>>();
  for (const t of opts.types ?? []) typesMap.set(t.value.name, t);
  return {
    attributes: new Map(),
    labels: new Map(),
    colors: new Map(),
    conventions: new Map(),
    types: typesMap,
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

function entry(opts: { shape: EntryShape; type?: string }): Entry {
  return {
    displayId: makeDisplayId("X-001"),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape,
    type: opts.type,
    source: { kind: "markdown" },
    title: "",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
  };
}

const derivedFromRule: TraceRule = {
  target: [{ shape: "Authored" }],
  cardinality: { lower: 0, upper: Infinity },
  required: false,
};

const verifiesRule: TraceRule = {
  target: ["requirement"],
  cardinality: { lower: 1, upper: Infinity },
  required: true,
};

Deno.test("effectiveTraceRules: classified entry gets type-scope rules", () => {
  const p = profile({
    types: [typeDef({
      name: "test",
      traceability: { "Derived-from": derivedFromRule },
    })],
  });
  const e = entry({ shape: "Authored", type: "test" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.size, 1);
  assertEquals(rules.get("Derived-from"), derivedFromRule);
});

Deno.test("effectiveTraceRules: Reference entry always returns empty map", () => {
  const p = profile({
    types: [typeDef({
      name: "citation",
      traceability: { "Derived-from": derivedFromRule },
    })],
  });
  const e = entry({ shape: "Reference" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.size, 0);
});

Deno.test("effectiveTraceRules: classified entry gets all type rules", () => {
  const p = profile({
    types: [typeDef({
      name: "test",
      traceability: { Verifies: verifiesRule, "Derived-from": derivedFromRule },
    })],
  });
  const e = entry({ shape: "Authored", type: "test" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.size, 2);
  assertEquals(rules.get("Derived-from"), derivedFromRule);
  assertEquals(rules.get("Verifies"), verifiesRule);
});

Deno.test("effectiveTraceRules: un-classified Authored entry returns empty map", () => {
  // Tier 2: no shape scope — unclassified entries get no traceability rules.
  const p = profile({
    types: [typeDef({
      name: "test",
      traceability: { Verifies: verifiesRule },
    })],
  });
  const e = entry({ shape: "Authored" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.size, 0);
  assertEquals(rules.has("Verifies"), false);
});

Deno.test("effectiveTraceRules: type rules are used for classified entry", () => {
  const tightRule: TraceRule = {
    target: ["stakeholder-requirement"],
    cardinality: { lower: 1, upper: Infinity },
    required: true,
  };
  const p = profile({
    types: [typeDef({
      name: "requirement",
      traceability: { "Derived-from": tightRule },
    })],
  });
  const e = entry({ shape: "Authored", type: "requirement" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.get("Derived-from"), tightRule);
});

Deno.test("effectiveTraceRules: classified with unknown type returns empty map", () => {
  // Tier 2: no shape scope fallback — unknown type → no rules.
  const p = profile({
    types: [typeDef({
      name: "test",
      traceability: { "Derived-from": derivedFromRule },
    })],
  });
  const e = entry({ shape: "Authored", type: "not-in-profile" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.size, 0);
});

function targetEntry(opts: {
  shape: EntryShape;
  type?: string;
  displayId?: string;
}): Entry {
  return {
    displayId: makeDisplayId(opts.displayId ?? "Y-001"),
    id: "01TARGET02TARGET03TARGET04",
    shape: opts.shape,
    type: opts.type,
    source: { kind: "markdown" },
    title: "",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
  };
}

Deno.test("matchesAnyTarget: string matcher accepts target with matching type", () => {
  const t = targetEntry({ shape: "Authored", type: "requirement" });
  assertEquals(matchesAnyTarget(t, ["requirement"]), true);
});

Deno.test("matchesAnyTarget: string matcher rejects mismatched type", () => {
  const t = targetEntry({ shape: "Authored", type: "note" });
  assertEquals(matchesAnyTarget(t, ["requirement"]), false);
});

Deno.test("matchesAnyTarget: string matcher rejects un-classified target", () => {
  const t = targetEntry({ shape: "Authored" });
  assertEquals(matchesAnyTarget(t, ["requirement"]), false);
});

Deno.test("matchesAnyTarget: shape matcher accepts matching shape", () => {
  const t = targetEntry({ shape: "Authored" });
  assertEquals(matchesAnyTarget(t, [{ shape: "Authored" }]), true);
});

Deno.test("matchesAnyTarget: shape matcher rejects opposite shape", () => {
  const t = targetEntry({ shape: "Reference" });
  assertEquals(matchesAnyTarget(t, [{ shape: "Authored" }]), false);
});

Deno.test("matchesAnyTarget: multi-matcher uses OR — first match wins", () => {
  const t = targetEntry({ shape: "Authored", type: "requirement" });
  assertEquals(
    matchesAnyTarget(t, ["stakeholder-requirement", "requirement"]),
    true,
  );
});

Deno.test("matchesAnyTarget: multi-matcher all reject → false", () => {
  const t = targetEntry({ shape: "Authored", type: "other" });
  assertEquals(matchesAnyTarget(t, ["a", "b", { shape: "Reference" }]), false);
});

Deno.test("matchesAnyTarget: mixed string + shape matcher", () => {
  const reqTarget = targetEntry({ shape: "Authored", type: "requirement" });
  const refTarget = targetEntry({ shape: "Reference", type: "citation" });
  const otherIdentified = targetEntry({ shape: "Authored", type: "note" });

  const rule = ["requirement", { shape: "Reference" as const }];
  assertEquals(matchesAnyTarget(reqTarget, rule), true);
  assertEquals(matchesAnyTarget(refTarget, rule), true);
  assertEquals(matchesAnyTarget(otherIdentified, rule), false);
});

Deno.test("matchesAnyTarget: empty matcher list → always false", () => {
  const t = targetEntry({ shape: "Authored", type: "requirement" });
  assertEquals(matchesAnyTarget(t, []), false);
});

// ---------------------------------------------------------------------------
// validateTraceabilityForEntry
// ---------------------------------------------------------------------------

function graphOf(entries: readonly Entry[]): Map<string, Entry> {
  const g = new Map<string, Entry>();
  for (const e of entries) g.set(e.id!, e);
  return g;
}

function entryWithAttrs(opts: {
  id?: string;
  displayId?: string;
  shape: EntryShape;
  type?: string;
  attrs?: Record<string, readonly string[]>;
}): Entry {
  const attrs = opts.attrs ?? {};
  const attributes = [];
  for (const [k, vs] of Object.entries(attrs)) {
    for (const v of vs) attributes.push({ key: k, value: v });
  }
  return {
    displayId: makeDisplayId(opts.displayId ?? "REQ-0001"),
    id: opts.id ?? "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape,
    type: opts.type,
    source: { kind: "markdown" },
    title: "",
    body: "",
    rawAttributes: attributes,
    typedAttributes: new Map(
      Object.entries(attrs).map(([k, vs]) => [k, vs]),
    ),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
  };
}

// MSL-L001 required missing

Deno.test("validateTraceabilityForEntry: required link missing → MSL-L001", () => {
  const requiredRule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 1, upper: Infinity },
    required: true,
  };
  const p = profile({
    types: [
      typeDef({ name: "test", traceability: { Verifies: requiredRule } }),
    ],
  });
  const e = entryWithAttrs({ shape: "Authored", type: "test" });
  const graph = graphOf([e]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  const l001 = diags.find((d) => d.code === "MSL-L001");
  if (!l001) {
    throw new Error(`expected MSL-L001, got: ${diags.map((d) => d.code)}`);
  }
  if (!l001.message.includes("Verifies")) {
    throw new Error(`expected 'Verifies' in message: ${l001.message}`);
  }
});

Deno.test("validateTraceabilityForEntry: required link present → no MSL-L001", () => {
  const target = entryWithAttrs({
    id: "01TARGET02TARGET03TARGET04",
    displayId: "REQ-9999",
    shape: "Authored",
    type: "requirement",
  });
  const requiredRule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 1, upper: Infinity },
    required: true,
  };
  const p = profile({
    types: [
      typeDef({ name: "test", traceability: { Verifies: requiredRule } }),
    ],
  });
  const e = entryWithAttrs({
    shape: "Authored",
    type: "test",
    attrs: { Verifies: [target.id!] },
  });
  const graph = graphOf([e, target]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  assertEquals(diags.filter((d) => d.code === "MSL-L001"), []);
});

// MSL-L002 / L003

Deno.test("validateTraceabilityForEntry: upper cardinality exceeded → MSL-L002", () => {
  const rule: TraceRule = {
    target: [{ shape: "Authored" }],
    cardinality: { lower: 0, upper: 1 },
    required: false,
  };
  const p = profile({
    types: [typeDef({ name: "test", traceability: { Verifies: rule } })],
  });
  const target1 = entryWithAttrs({
    id: "01T1T1T1T1T1T1T1T1T1T1T1T1",
    shape: "Authored",
    type: "x",
  });
  const target2 = entryWithAttrs({
    id: "01T2T2T2T2T2T2T2T2T2T2T2T2",
    shape: "Authored",
    type: "x",
  });
  const e = entryWithAttrs({
    shape: "Authored",
    type: "test",
    attrs: { Verifies: [target1.id!, target2.id!] },
  });
  const graph = graphOf([e, target1, target2]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  const l002 = diags.find((d) => d.code === "MSL-L002");
  if (!l002) {
    throw new Error(`expected MSL-L002, got: ${diags.map((d) => d.code)}`);
  }
});

Deno.test("validateTraceabilityForEntry: lower cardinality unmet → MSL-L003", () => {
  const rule: TraceRule = {
    target: [{ shape: "Authored" }],
    cardinality: { lower: 2, upper: Infinity },
    required: false,
  };
  const p = profile({
    types: [typeDef({ name: "test", traceability: { Verifies: rule } })],
  });
  const target1 = entryWithAttrs({
    id: "01T1T1T1T1T1T1T1T1T1T1T1T1",
    shape: "Authored",
    type: "x",
  });
  const e = entryWithAttrs({
    shape: "Authored",
    type: "test",
    attrs: { Verifies: [target1.id!] },
  });
  const graph = graphOf([e, target1]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  const l003 = diags.find((d) => d.code === "MSL-L003");
  if (!l003) {
    throw new Error(`expected MSL-L003, got: ${diags.map((d) => d.code)}`);
  }
});

Deno.test("validateTraceabilityForEntry: required missing does not double-emit with cardinality", () => {
  const rule: TraceRule = {
    target: [{ shape: "Authored" }],
    cardinality: { lower: 1, upper: 5 },
    required: true,
  };
  const p = profile({
    types: [typeDef({ name: "test", traceability: { Verifies: rule } })],
  });
  const e = entryWithAttrs({ shape: "Authored", type: "test" });
  const graph = graphOf([e]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  const codes = diags.map((d) => d.code);
  assertEquals(codes.includes("MSL-L001"), true);
  assertEquals(codes.includes("MSL-L003"), false);
  assertEquals(codes.includes("MSL-L002"), false);
});

// MSL-L004 target

Deno.test("validateTraceabilityForEntry: target type matches → no MSL-L004", () => {
  const rule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 0, upper: Infinity },
    required: false,
  };
  const p = profile({
    types: [typeDef({ name: "test", traceability: { Verifies: rule } })],
  });
  const target = entryWithAttrs({
    id: "01T1T1T1T1T1T1T1T1T1T1T1T1",
    displayId: "REQ-0001",
    shape: "Authored",
    type: "requirement",
  });
  const e = entryWithAttrs({
    shape: "Authored",
    type: "test",
    attrs: { Verifies: [target.id!] },
  });
  const graph = graphOf([e, target]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  assertEquals(diags.filter((d) => d.code === "MSL-L004"), []);
});

Deno.test("validateTraceabilityForEntry: target type mismatch → MSL-L004", () => {
  const rule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 0, upper: Infinity },
    required: false,
  };
  const p = profile({
    types: [typeDef({ name: "test", traceability: { Verifies: rule } })],
  });
  const wrongTarget = entryWithAttrs({
    id: "01T1T1T1T1T1T1T1T1T1T1T1T1",
    displayId: "NOTE-0001",
    shape: "Authored",
    type: "note",
  });
  const e = entryWithAttrs({
    shape: "Authored",
    type: "test",
    attrs: { Verifies: [wrongTarget.id!] },
  });
  const graph = graphOf([e, wrongTarget]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  const l004 = diags.find((d) => d.code === "MSL-L004");
  if (!l004) {
    throw new Error(`expected MSL-L004, got: ${diags.map((d) => d.code)}`);
  }
  if (
    !l004.message.includes("Verifies") || !l004.message.includes("NOTE-0001")
  ) {
    throw new Error(`message lacks context: ${l004.message}`);
  }
});

Deno.test("validateTraceabilityForEntry: shape matcher accepts any identified target", () => {
  const rule: TraceRule = {
    target: [{ shape: "Authored" }],
    cardinality: { lower: 0, upper: Infinity },
    required: false,
  };
  const p = profile({
    types: [typeDef({ name: "test", traceability: { Derived: rule } })],
  });
  const target = entryWithAttrs({
    id: "01T1T1T1T1T1T1T1T1T1T1T1T1",
    shape: "Authored",
    type: "note",
  });
  const e = entryWithAttrs({
    shape: "Authored",
    type: "test",
    attrs: { Derived: [target.id!] },
  });
  const graph = graphOf([e, target]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  assertEquals(diags.filter((d) => d.code === "MSL-L004"), []);
});

Deno.test("validateTraceabilityForEntry: target not in either index → MSL-L006 (no MSL-L004)", () => {
  const rule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 0, upper: Infinity },
    required: false,
  };
  const p = profile({
    types: [typeDef({ name: "test", traceability: { Verifies: rule } })],
  });
  const e = entryWithAttrs({
    shape: "Authored",
    type: "test",
    attrs: { Verifies: ["01MISSING000000000000000000"] },
  });
  const diags = validateTraceabilityForEntry(e, p, graphOf([e]));
  assertEquals(diags.filter((d) => d.code === "MSL-L004"), []);
  assertEquals(diags.filter((d) => d.code === "MSL-L006").length, 1);
});

Deno.test("validateTraceabilityForEntry: one valid + one invalid target → single MSL-L004", () => {
  const rule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 0, upper: Infinity },
    required: false,
  };
  const p = profile({
    types: [typeDef({ name: "test", traceability: { Verifies: rule } })],
  });
  const good = entryWithAttrs({
    id: "01GOOD0000000000000000000",
    displayId: "REQ-0001",
    shape: "Authored",
    type: "requirement",
  });
  const bad = entryWithAttrs({
    id: "01BAD00000000000000000000",
    displayId: "NOTE-0001",
    shape: "Authored",
    type: "note",
  });
  const e = entryWithAttrs({
    shape: "Authored",
    type: "test",
    attrs: { Verifies: [good.id!, bad.id!] },
  });
  const graph = graphOf([e, good, bad]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  const l004 = diags.filter((d) => d.code === "MSL-L004");
  assertEquals(l004.length, 1);
  if (!l004[0].message.includes("NOTE-0001")) {
    throw new Error(`expected bad target in message: ${l004[0].message}`);
  }
});

// Scope gating

Deno.test("validateTraceabilityForEntry: Reference entries are skipped entirely", () => {
  const rule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 1, upper: Infinity },
    required: true,
  };
  const p = profile({
    types: [typeDef({ name: "citation", traceability: { Verifies: rule } })],
  });
  const e = entryWithAttrs({ shape: "Reference", type: "citation" });
  const graph = graphOf([e]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  assertEquals(diags, []);
});

Deno.test("validateTraceabilityForEntry: un-classified Authored entry gets no rules", () => {
  // Tier 2: only type-scope rules exist. An un-classified entry has no type,
  // so no traceability rules apply → no diagnostics.
  const rule: TraceRule = {
    target: [{ shape: "Authored" }],
    cardinality: { lower: 0, upper: Infinity },
    required: true,
  };
  const p = profile({
    types: [typeDef({ name: "test", traceability: { Link: rule } })],
  });
  const e = entryWithAttrs({ shape: "Authored" });
  const graph = graphOf([e]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  assertEquals(diags, []);
});

// ---------------------------------------------------------------------------
// Display-ID resolution + MSL-L006 existence (issue #593)
// ---------------------------------------------------------------------------

function byDisplayIdOf(entries: readonly Entry[]): Map<string, Entry> {
  const m = new Map<string, Entry>();
  for (const e of entries) m.set(e.displayId, e);
  return m;
}

Deno.test("validateTraceabilityForEntry: display-ID target resolves and type-checks clean", () => {
  const rule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 0, upper: Infinity },
    required: false,
  };
  const p = profile({
    types: [typeDef({ name: "test", traceability: { Verifies: rule } })],
  });
  const target = entryWithAttrs({
    id: "01T1T1T1T1T1T1T1T1T1T1T1T1",
    displayId: "REQ-0001",
    shape: "Authored",
    type: "requirement",
  });
  const e = entryWithAttrs({
    shape: "Authored",
    type: "test",
    attrs: { Verifies: ["REQ-0001"] }, // display ID, not ULID
  });
  const diags = validateTraceabilityForEntry(
    e,
    p,
    graphOf([e, target]),
    byDisplayIdOf([e, target]),
  );
  assertEquals(diags, []);
});

Deno.test("validateTraceabilityForEntry: display-ID target type mismatch → MSL-L004", () => {
  const rule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 0, upper: Infinity },
    required: false,
  };
  const p = profile({
    types: [typeDef({ name: "test", traceability: { Verifies: rule } })],
  });
  const wrong = entryWithAttrs({
    id: "01T1T1T1T1T1T1T1T1T1T1T1T1",
    displayId: "NOTE-0001",
    shape: "Authored",
    type: "note",
  });
  const e = entryWithAttrs({
    shape: "Authored",
    type: "test",
    attrs: { Verifies: ["NOTE-0001"] },
  });
  const diags = validateTraceabilityForEntry(
    e,
    p,
    graphOf([e, wrong]),
    byDisplayIdOf([e, wrong]),
  );
  if (!diags.find((d) => d.code === "MSL-L004")) {
    throw new Error(`expected MSL-L004, got: ${diags.map((d) => d.code)}`);
  }
});

Deno.test("validateTraceabilityForEntry: unresolved target → MSL-L006 warning", () => {
  const rule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 0, upper: Infinity },
    required: false,
  };
  const p = profile({
    types: [typeDef({ name: "test", traceability: { Verifies: rule } })],
  });
  const e = entryWithAttrs({
    shape: "Authored",
    type: "test",
    attrs: { Verifies: ["REQ-9999"] }, // exists nowhere
  });
  const diags = validateTraceabilityForEntry(
    e,
    p,
    graphOf([e]),
    byDisplayIdOf([e]),
  );
  const l006 = diags.find((d) => d.code === "MSL-L006");
  if (!l006) {
    throw new Error(`expected MSL-L006, got: ${diags.map((d) => d.code)}`);
  }
  assertEquals(l006.severity, "warning");
  if (!l006.message.includes("REQ-9999")) {
    throw new Error(`expected target in message: ${l006.message}`);
  }
});

Deno.test("validateTraceabilityForEntry: scheme-qualified URI target is not flagged", () => {
  const rule: TraceRule = {
    target: [{ shape: "Authored" }],
    cardinality: { lower: 0, upper: Infinity },
    required: false,
  };
  const p = profile({
    types: [typeDef({ name: "test", traceability: { Verifies: rule } })],
  });
  const e = entryWithAttrs({
    shape: "Authored",
    type: "test",
    attrs: { Verifies: ["urn:iso:std:iso:26262"] },
  });
  const diags = validateTraceabilityForEntry(
    e,
    p,
    graphOf([e]),
    byDisplayIdOf([e]),
  );
  assertEquals(diags.filter((d) => d.code === "MSL-L006"), []);
});
