/**
 * @module core/validator/attributes_test
 *
 * Unit tests for Stage 3 — typed attribute validation.
 */

import { assertEquals } from "@std/assert";
import { effectiveScope, validateAttributesForEntry } from "./attributes.ts";
import type {
  AttrDecl,
  EffectiveProfile,
  EffectiveShapeScope,
  EffectiveTypeDef,
  Entry,
  EntryShape,
  ProvenancedMapEntry,
} from "../model/mod.ts";

const ORIGIN = "@test/p";

function provAttrs(
  attrs: readonly AttrDecl[],
): Map<string, ProvenancedMapEntry<AttrDecl>> {
  const out = new Map<string, ProvenancedMapEntry<AttrDecl>>();
  for (const a of attrs) out.set(a.name, { value: a, origin: ORIGIN });
  return out;
}

function shapeScope(opts: {
  required?: readonly string[];
  attributes?: readonly AttrDecl[];
}): EffectiveShapeScope {
  return {
    required: { value: opts.required ?? [], origin: ORIGIN },
    attributes: provAttrs(opts.attributes ?? []),
    traceability: new Map(),
  };
}

function typeDef(opts: {
  name: string;
  shape: EntryShape;
  required?: readonly string[];
  attributes?: readonly AttrDecl[];
}): ProvenancedMapEntry<EffectiveTypeDef> {
  return {
    origin: ORIGIN,
    value: {
      name: opts.name,
      shape: opts.shape,
      displayIdPattern: { value: undefined, origin: ORIGIN },
      displayIdPatternEnforcement: { value: "off", origin: ORIGIN },
      required: { value: opts.required ?? [], origin: ORIGIN },
      attributes: provAttrs(opts.attributes ?? []),
      traceability: new Map(),
    },
  };
}

function profile(opts: {
  universalRequired?: readonly string[];
  universalAttrs?: readonly AttrDecl[];
  identified?: EffectiveShapeScope;
  referenced?: EffectiveShapeScope;
  types?: ReadonlyArray<ProvenancedMapEntry<EffectiveTypeDef>>;
}): EffectiveProfile {
  const typesMap = new Map<string, ProvenancedMapEntry<EffectiveTypeDef>>();
  for (const t of opts.types ?? []) typesMap.set(t.value.name, t);
  return {
    required: { value: opts.universalRequired ?? [], origin: ORIGIN },
    attributes: provAttrs(opts.universalAttrs ?? []),
    labels: { value: [], origin: ORIGIN },
    identified: opts.identified ?? shapeScope({}),
    referenced: opts.referenced ?? shapeScope({}),
    types: typesMap,
    documents: { types: new Map(), frontMatter: new Map() },
  };
}

function entry(opts: {
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
    displayId: "X-001",
    title: "",
    body: "",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape,
    type: opts.type,
    source: "markdown",
    attributes,
    typedAttributes: new Map(
      Object.entries(attrs).map(([k, vs]) => [k, vs]),
    ),
    location: { file: "t.md", line: 1, column: 1 },
  };
}

const textAttr: AttrDecl = {
  name: "Rationale",
  type: "text",
  required: false,
  cardinality: { lower: 0, upper: 1 },
};

const statusAttr: AttrDecl = {
  name: "Status",
  type: "enum",
  required: false,
  cardinality: { lower: 0, upper: 1 },
  values: ["draft", "approved"],
};

const notesAttr: AttrDecl = {
  name: "Notes",
  type: "text",
  required: false,
  cardinality: { lower: 0, upper: 1 },
};

Deno.test("effectiveScope: universal only", () => {
  const p = profile({
    universalRequired: ["Status"],
    universalAttrs: [statusAttr],
  });
  const e = entry({ shape: "identified" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.required, ["Status"]);
  assertEquals(scope.attributes.size, 1);
  assertEquals(scope.attributes.get("Status"), statusAttr);
});

Deno.test("effectiveScope: universal + identified shape for identified entry", () => {
  const p = profile({
    universalAttrs: [statusAttr],
    identified: shapeScope({
      required: ["Rationale"],
      attributes: [textAttr],
    }),
    referenced: shapeScope({
      attributes: [notesAttr],
    }),
  });
  const e = entry({ shape: "identified" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.required, ["Rationale"]);
  assertEquals(scope.attributes.size, 2);
  assertEquals(scope.attributes.has("Status"), true);
  assertEquals(scope.attributes.has("Rationale"), true);
  assertEquals(scope.attributes.has("Notes"), false);
});

Deno.test("effectiveScope: universal + referenced shape for referenced entry", () => {
  const p = profile({
    universalAttrs: [statusAttr],
    identified: shapeScope({
      attributes: [textAttr],
    }),
    referenced: shapeScope({
      required: ["Notes"],
      attributes: [notesAttr],
    }),
  });
  const e = entry({ shape: "referenced" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.required, ["Notes"]);
  assertEquals(scope.attributes.size, 2);
  assertEquals(scope.attributes.has("Status"), true);
  assertEquals(scope.attributes.has("Notes"), true);
  assertEquals(scope.attributes.has("Rationale"), false);
});

Deno.test("effectiveScope: classified entry adds type-specific scope", () => {
  const asilAttr: AttrDecl = {
    name: "ASIL",
    type: "enum",
    required: false,
    cardinality: { lower: 0, upper: 1 },
    values: ["QM", "A", "B", "C", "D"],
  };
  const p = profile({
    universalAttrs: [statusAttr],
    identified: shapeScope({ attributes: [textAttr] }),
    types: [typeDef({
      name: "requirement",
      shape: "identified",
      required: ["ASIL"],
      attributes: [asilAttr],
    })],
  });
  const e = entry({ shape: "identified", type: "requirement" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.required, ["ASIL"]);
  assertEquals(scope.attributes.size, 3);
  assertEquals(scope.attributes.has("ASIL"), true);
});

Deno.test("effectiveScope: un-classified entry uses only universal + shape", () => {
  const asilAttr: AttrDecl = {
    name: "ASIL",
    type: "enum",
    required: false,
    cardinality: { lower: 0, upper: 1 },
    values: ["QM", "A", "B"],
  };
  const p = profile({
    universalAttrs: [statusAttr],
    identified: shapeScope({ attributes: [textAttr] }),
    types: [typeDef({
      name: "requirement",
      shape: "identified",
      attributes: [asilAttr],
    })],
  });
  const e = entry({ shape: "identified" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.attributes.size, 2);
  assertEquals(scope.attributes.has("ASIL"), false);
});

Deno.test("effectiveScope: required lists concatenated in scope order", () => {
  const p = profile({
    universalRequired: ["Status"],
    universalAttrs: [statusAttr],
    identified: shapeScope({
      required: ["Rationale"],
      attributes: [textAttr],
    }),
    types: [typeDef({
      name: "requirement",
      shape: "identified",
      required: ["ASIL"],
      attributes: [{
        name: "ASIL",
        type: "enum",
        required: false,
        cardinality: { lower: 0, upper: 1 },
        values: ["QM"],
      }],
    })],
  });
  const e = entry({ shape: "identified", type: "requirement" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.required, ["Status", "Rationale", "ASIL"]);
});

Deno.test("effectiveScope: type-scope attr wins over shape-scope attr on name collision", () => {
  const shapeStatus: AttrDecl = {
    name: "Status",
    type: "text",
    required: false,
    cardinality: { lower: 0, upper: 1 },
  };
  const typeStatus: AttrDecl = {
    name: "Status",
    type: "enum",
    required: false,
    cardinality: { lower: 0, upper: 1 },
    values: ["draft", "approved"],
  };
  const p = profile({
    identified: shapeScope({ attributes: [shapeStatus] }),
    types: [typeDef({
      name: "requirement",
      shape: "identified",
      attributes: [typeStatus],
    })],
  });
  const e = entry({ shape: "identified", type: "requirement" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.attributes.get("Status"), typeStatus);
});

Deno.test("validateAttributesForEntry: required missing → MSL-A001", () => {
  const p = profile({
    universalRequired: ["Status"],
    universalAttrs: [statusAttr],
  });
  const e = entry({ shape: "identified", attrs: {} });
  const diags = validateAttributesForEntry(e, p);
  const a001 = diags.find((d) => d.code === "MSL-A001");
  if (!a001) {
    throw new Error(`expected MSL-A001, got: ${diags.map((d) => d.code)}`);
  }
  if (!a001.message.includes("Status")) {
    throw new Error(`expected Status in message: ${a001.message}`);
  }
});

Deno.test("validateAttributesForEntry: required present → no MSL-A001", () => {
  const p = profile({
    universalRequired: ["Status"],
    universalAttrs: [statusAttr],
  });
  const e = entry({
    shape: "identified",
    attrs: { Status: ["draft"] },
  });
  const diags = validateAttributesForEntry(e, p);
  assertEquals(diags.filter((d) => d.code === "MSL-A001"), []);
});

Deno.test("validateAttributesForEntry: cardinality upper exceeded → MSL-A002", () => {
  const singleValAttr: AttrDecl = {
    name: "Title",
    type: "text",
    required: false,
    cardinality: { lower: 0, upper: 1 },
  };
  const p = profile({ universalAttrs: [singleValAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Title: ["first", "second"] },
  });
  const diags = validateAttributesForEntry(e, p);
  const a002 = diags.find((d) => d.code === "MSL-A002");
  if (!a002) {
    throw new Error(`expected MSL-A002, got: ${diags.map((d) => d.code)}`);
  }
});

Deno.test("validateAttributesForEntry: cardinality lower unmet when attribute present → MSL-A003", () => {
  const listAttr: AttrDecl = {
    name: "Labels",
    type: "tag-list",
    required: false,
    cardinality: { lower: 2, upper: Infinity },
  };
  const p = profile({ universalAttrs: [listAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Labels: ["only-one"] },
  });
  const diags = validateAttributesForEntry(e, p);
  const a003 = diags.find((d) => d.code === "MSL-A003");
  if (!a003) {
    throw new Error(`expected MSL-A003, got: ${diags.map((d) => d.code)}`);
  }
});

Deno.test("validateAttributesForEntry: cardinality lower with 0 values + not required = no diagnostic", () => {
  const listAttr: AttrDecl = {
    name: "Labels",
    type: "tag-list",
    required: false,
    cardinality: { lower: 1, upper: Infinity },
  };
  const p = profile({ universalAttrs: [listAttr] });
  const e = entry({ shape: "identified", attrs: {} });
  const diags = validateAttributesForEntry(e, p);
  assertEquals(diags.filter((d) => d.code === "MSL-A003"), []);
});

Deno.test("validateAttributesForEntry: unknown attribute → MSL-A005 warning", () => {
  const p = profile({ universalAttrs: [statusAttr] });
  const e = entry({
    shape: "identified",
    attrs: { UnknownThing: ["value"] },
  });
  const diags = validateAttributesForEntry(e, p);
  const a005 = diags.find((d) => d.code === "MSL-A005");
  if (!a005) {
    throw new Error(`expected MSL-A005, got: ${diags.map((d) => d.code)}`);
  }
  assertEquals(a005.severity, "warning");
});

Deno.test("validateAttributesForEntry: declared attributes do NOT emit MSL-A005", () => {
  const p = profile({ universalAttrs: [statusAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Status: ["draft"] },
  });
  const diags = validateAttributesForEntry(e, p);
  assertEquals(diags.filter((d) => d.code === "MSL-A005"), []);
});

Deno.test("validateAttributesForEntry: core-reserved attributes are never unknown", () => {
  const p = profile({});
  const e = entry({
    shape: "identified",
    attrs: { Id: ["01HGW2Q8MNP3RSTVWXYZABCDEF"], Type: ["requirement"] },
  });
  const diags = validateAttributesForEntry(e, p);
  const a005 = diags.filter((d) => d.code === "MSL-A005");
  assertEquals(a005, []);
});

Deno.test("validateAttributesForEntry: value-type mismatch → MSL-A004", () => {
  const intAttr: AttrDecl = {
    name: "Count",
    type: "integer",
    required: false,
    cardinality: { lower: 0, upper: 1 },
  };
  const p = profile({ universalAttrs: [intAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Count: ["not-an-int"] },
  });
  const diags = validateAttributesForEntry(e, p);
  const a004 = diags.find((d) => d.code === "MSL-A004");
  if (!a004) {
    throw new Error(`expected MSL-A004, got: ${diags.map((d) => d.code)}`);
  }
  if (!a004.message.includes("Count")) {
    throw new Error(`expected attribute name in message: ${a004.message}`);
  }
});

Deno.test("validateAttributesForEntry: all valid values → no MSL-A004", () => {
  const intAttr: AttrDecl = {
    name: "Count",
    type: "integer",
    required: false,
    cardinality: { lower: 0, upper: Infinity },
  };
  const p = profile({ universalAttrs: [intAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Count: ["1", "2", "3"] },
  });
  const diags = validateAttributesForEntry(e, p);
  assertEquals(diags.filter((d) => d.code === "MSL-A004"), []);
});

Deno.test("validateAttributesForEntry: one bad value among good ones → single MSL-A004", () => {
  const intAttr: AttrDecl = {
    name: "Count",
    type: "integer",
    required: false,
    cardinality: { lower: 0, upper: Infinity },
  };
  const p = profile({ universalAttrs: [intAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Count: ["1", "bad", "3"] },
  });
  const diags = validateAttributesForEntry(e, p);
  const a004 = diags.filter((d) => d.code === "MSL-A004");
  assertEquals(a004.length, 1);
});

Deno.test("effectiveScope: trace rule without explicit attribute declaration synthesizes id-list", () => {
  const origin = ORIGIN;
  const traceRule = {
    target: ["requirement"] as const,
    cardinality: { lower: 1, upper: 2 },
    required: true,
  };
  const p: EffectiveProfile = {
    required: { value: [], origin },
    attributes: new Map(),
    labels: { value: [], origin },
    identified: {
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map([
        ["Verifies", { value: traceRule, origin }],
      ]),
    },
    referenced: {
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map(),
    },
    types: new Map(),
    documents: { types: new Map(), frontMatter: new Map() },
  };
  const e = entry({ shape: "identified" });
  const scope = effectiveScope(e, p);
  const verifies = scope.attributes.get("Verifies");
  if (!verifies) throw new Error("expected synthesized Verifies attribute");
  assertEquals(verifies.type, "id-list");
  assertEquals(verifies.required, false);
  assertEquals(verifies.cardinality, { lower: 0, upper: Infinity });
});

Deno.test("effectiveScope: explicit attribute declaration wins over trace-rule synthesis", () => {
  // If the profile declares both the attribute AND the trace rule,
  // the explicit attr wins (not synthesized).
  const origin = ORIGIN;
  const explicitAttr: AttrDecl = {
    name: "Verifies",
    type: "id-list",
    required: true,
    cardinality: { lower: 1, upper: 3 },
  };
  const traceRule = {
    target: ["requirement"] as const,
    cardinality: { lower: 0, upper: Infinity },
    required: false,
  };
  const p: EffectiveProfile = {
    required: { value: [], origin },
    attributes: new Map([
      ["Verifies", { value: explicitAttr, origin }],
    ]),
    labels: { value: [], origin },
    identified: {
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map([
        ["Verifies", { value: traceRule, origin }],
      ]),
    },
    referenced: {
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map(),
    },
    types: new Map(),
    documents: { types: new Map(), frontMatter: new Map() },
  };
  const e = entry({ shape: "identified" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.attributes.get("Verifies"), explicitAttr);
});

Deno.test("validateAttributesForEntry: enum value-type mismatch → MSL-A004", () => {
  const enumAttr: AttrDecl = {
    name: "Status",
    type: "enum",
    required: false,
    cardinality: { lower: 0, upper: 1 },
    values: ["draft", "approved"],
  };
  const p = profile({ universalAttrs: [enumAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Status: ["rejected"] },
  });
  const diags = validateAttributesForEntry(e, p);
  const a004 = diags.find((d) => d.code === "MSL-A004");
  if (!a004) {
    throw new Error(`expected MSL-A004, got: ${diags.map((d) => d.code)}`);
  }
});
