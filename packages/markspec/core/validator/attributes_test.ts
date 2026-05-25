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
  EffectiveTypeDef,
  Entry,
  EntryShape,
  ProvenancedMapEntry,
} from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";

const ORIGIN = "@test/p";

function provAttrs(
  attrs: readonly AttrDecl[],
): Map<string, ProvenancedMapEntry<AttrDecl>> {
  const out = new Map<string, ProvenancedMapEntry<AttrDecl>>();
  for (const a of attrs) out.set(a.name, { value: a, origin: ORIGIN });
  return out;
}

function typeDef(opts: {
  name: string;
  required?: readonly string[];
  attributes?: readonly AttrDecl[];
}): ProvenancedMapEntry<EffectiveTypeDef> {
  return {
    origin: ORIGIN,
    value: {
      name: opts.name,
      extends: "Requirement",
      displayIdPattern: { value: undefined, origin: ORIGIN },
      displayIdPatternEnforcement: { value: "off", origin: ORIGIN },
      color: { value: undefined, origin: ORIGIN },
      required: { value: opts.required ?? [], origin: ORIGIN },
      attributes: provAttrs(opts.attributes ?? []),
      traceability: new Map(),
      description: { value: undefined, origin: ORIGIN },
      attrDescriptions: new Map(),
      relationDescriptions: new Map(),
    },
  };
}

function profile(opts: {
  universalAttrs?: readonly AttrDecl[];
  types?: ReadonlyArray<ProvenancedMapEntry<EffectiveTypeDef>>;
}): EffectiveProfile {
  const typesMap = new Map<string, ProvenancedMapEntry<EffectiveTypeDef>>();
  for (const t of opts.types ?? []) typesMap.set(t.value.name, t);
  return {
    attributes: provAttrs(opts.universalAttrs ?? []),
    labels: new Map(),
    colors: new Map(),
    conventions: new Map(),
    types: typesMap,
    documents: { types: new Map(), frontMatter: new Map() },
    prose: {
      lexicons: {
        "capitalized-allow": { value: [], origin: "" },
        "sentence-abbrev": { value: [], origin: "" },
      },
    },
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
    displayId: makeDisplayId("X-001"),
    title: "",
    body: "",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape,
    type: opts.type,
    source: { kind: "markdown" },
    rawAttributes: attributes,
    typedAttributes: new Map(
      Object.entries(attrs).map(([k, vs]) => [k, vs]),
    ),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
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
    universalAttrs: [statusAttr],
  });
  const e = entry({ shape: "Authored" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.required, []);
  assertEquals(scope.attributes.size, 1);
  assertEquals(scope.attributes.get("Status"), statusAttr);
});

Deno.test("effectiveScope: Authored entry without type uses only universal scope", () => {
  const p = profile({
    universalAttrs: [statusAttr],
    types: [typeDef({
      name: "requirement",
      attributes: [textAttr],
    })],
  });
  const e = entry({ shape: "Authored" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.required, []);
  assertEquals(scope.attributes.size, 1);
  assertEquals(scope.attributes.has("Status"), true);
  assertEquals(scope.attributes.has("Rationale"), false);
});

Deno.test("effectiveScope: Reference entry without type uses only universal scope", () => {
  const p = profile({
    universalAttrs: [statusAttr],
    types: [typeDef({
      name: "requirement",
      attributes: [notesAttr],
    })],
  });
  const e = entry({ shape: "Reference" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.required, []);
  assertEquals(scope.attributes.size, 1);
  assertEquals(scope.attributes.has("Status"), true);
  assertEquals(scope.attributes.has("Notes"), false);
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
    types: [typeDef({
      name: "requirement",
      required: ["ASIL"],
      attributes: [asilAttr],
    })],
  });
  const e = entry({ shape: "Authored", type: "requirement" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.required, ["ASIL"]);
  assertEquals(scope.attributes.size, 2);
  assertEquals(scope.attributes.has("ASIL"), true);
});

Deno.test("effectiveScope: un-classified entry uses only universal scope", () => {
  const asilAttr: AttrDecl = {
    name: "ASIL",
    type: "enum",
    required: false,
    cardinality: { lower: 0, upper: 1 },
    values: ["QM", "A", "B"],
  };
  const p = profile({
    universalAttrs: [statusAttr],
    types: [typeDef({
      name: "requirement",
      attributes: [asilAttr],
    })],
  });
  const e = entry({ shape: "Authored" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.attributes.size, 1);
  assertEquals(scope.attributes.has("ASIL"), false);
});

Deno.test("effectiveScope: required comes from type scope only", () => {
  const p = profile({
    universalAttrs: [statusAttr],
    types: [typeDef({
      name: "requirement",
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
  const e = entry({ shape: "Authored", type: "requirement" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.required, ["ASIL"]);
});

Deno.test("effectiveScope: type-scope attr wins over universal attr on name collision", () => {
  const universalStatus: AttrDecl = {
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
    universalAttrs: [universalStatus],
    types: [typeDef({
      name: "requirement",
      attributes: [typeStatus],
    })],
  });
  const e = entry({ shape: "Authored", type: "requirement" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.attributes.get("Status"), typeStatus);
});

Deno.test("validateAttributesForEntry: required missing → MSL-A001", () => {
  const p = profile({
    universalAttrs: [statusAttr],
    types: [typeDef({
      name: "requirement",
      required: ["Status"],
      attributes: [statusAttr],
    })],
  });
  const e = entry({ shape: "Authored", type: "requirement", attrs: {} });
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
    universalAttrs: [statusAttr],
    types: [typeDef({
      name: "requirement",
      required: ["Status"],
      attributes: [statusAttr],
    })],
  });
  const e = entry({
    shape: "Authored",
    type: "requirement",
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
    shape: "Authored",
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
    shape: "Authored",
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
  const e = entry({ shape: "Authored", attrs: {} });
  const diags = validateAttributesForEntry(e, p);
  assertEquals(diags.filter((d) => d.code === "MSL-A003"), []);
});

Deno.test("validateAttributesForEntry: unknown attribute → MSL-A005 warning", () => {
  const p = profile({ universalAttrs: [statusAttr] });
  const e = entry({
    shape: "Authored",
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
    shape: "Authored",
    attrs: { Status: ["draft"] },
  });
  const diags = validateAttributesForEntry(e, p);
  assertEquals(diags.filter((d) => d.code === "MSL-A005"), []);
});

Deno.test("validateAttributesForEntry: core-reserved attributes are never unknown", () => {
  const p = profile({});
  const e = entry({
    shape: "Authored",
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
    shape: "Authored",
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
    shape: "Authored",
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
    shape: "Authored",
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
    attributes: new Map(),
    labels: new Map(),
    colors: new Map(),
    conventions: new Map(),
    types: new Map([
      ["requirement", {
        origin,
        value: {
          name: "requirement",
          extends: "Requirement",
          displayIdPattern: { value: undefined, origin },
          displayIdPatternEnforcement: { value: "off", origin },
          color: { value: undefined, origin },
          required: { value: [], origin },
          attributes: new Map(),
          traceability: new Map([
            ["Verifies", { value: traceRule, origin }],
          ]),
          description: { value: undefined, origin },
          attrDescriptions: new Map(),
          relationDescriptions: new Map(),
        },
      }],
    ]),
    documents: { types: new Map(), frontMatter: new Map() },
    prose: {
      lexicons: {
        "capitalized-allow": { value: [], origin: "" },
        "sentence-abbrev": { value: [], origin: "" },
      },
    },
  };
  const e = entry({ shape: "Authored", type: "requirement" });
  const scope = effectiveScope(e, p);
  const verifies = scope.attributes.get("Verifies");
  if (!verifies) throw new Error("expected synthesized Verifies attribute");
  assertEquals(verifies.type, "id-list");
  assertEquals(verifies.required, false);
  assertEquals(verifies.cardinality, { lower: 0, upper: Infinity });
});

Deno.test("effectiveScope: explicit attribute declaration wins over trace-rule synthesis", () => {
  // If the profile declares the attribute explicitly at universal scope AND the
  // type has a trace rule for the same key, the explicit attr wins — synthesis
  // only fires when the key is not already in the scope map.
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
    attributes: new Map([
      ["Verifies", { value: explicitAttr, origin }],
    ]),
    labels: new Map(),
    colors: new Map(),
    conventions: new Map(),
    types: new Map([
      ["requirement", {
        origin,
        value: {
          name: "requirement",
          extends: "Requirement",
          displayIdPattern: { value: undefined, origin },
          displayIdPatternEnforcement: { value: "off", origin },
          color: { value: undefined, origin },
          required: { value: [], origin },
          attributes: new Map(),
          traceability: new Map([
            ["Verifies", { value: traceRule, origin }],
          ]),
          description: { value: undefined, origin },
          attrDescriptions: new Map(),
          relationDescriptions: new Map(),
        },
      }],
    ]),
    documents: { types: new Map(), frontMatter: new Map() },
    prose: {
      lexicons: {
        "capitalized-allow": { value: [], origin: "" },
        "sentence-abbrev": { value: [], origin: "" },
      },
    },
  };
  const e = entry({ shape: "Authored", type: "requirement" });
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
    shape: "Authored",
    attrs: { Status: ["rejected"] },
  });
  const diags = validateAttributesForEntry(e, p);
  const a004 = diags.find((d) => d.code === "MSL-A004");
  if (!a004) {
    throw new Error(`expected MSL-A004, got: ${diags.map((d) => d.code)}`);
  }
});
