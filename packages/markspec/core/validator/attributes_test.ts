/**
 * @module core/validator/attributes_test
 *
 * Unit tests for Stage 3 — typed attribute validation.
 */

import { assertEquals } from "@std/assert";
import { effectiveScope } from "./attributes.ts";
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
