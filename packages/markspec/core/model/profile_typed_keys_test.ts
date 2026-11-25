/**
 * @module core/model/profile_typed_keys_test
 *
 * Unit tests for the profile typed-key rule (#990).
 */

import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  profileTypedKeys,
  trimProfileTypedValues,
} from "./profile_typed_keys.ts";
import type {
  AttrDecl,
  EffectiveProfile,
  EffectiveTypeDef,
  ProvenancedMapEntry,
  TraceRule,
  ValueType,
} from "./profile.ts";
import { type Entry, makeDisplayId } from "./mod.ts";

const ORIGIN = "@test/p";
const NBSP = String.fromCharCode(0xa0);
const BOM = String.fromCharCode(0xfeff);

function attr(name: string, type: ValueType): AttrDecl {
  return {
    name,
    type,
    required: false,
    cardinality: { lower: 0, upper: 1 },
  };
}

function provMap<V>(
  items: readonly (readonly [string, V])[],
): Map<string, ProvenancedMapEntry<V>> {
  return new Map(items.map(([k, v]) => [k, { value: v, origin: ORIGIN }]));
}

function typeDef(
  name: string,
  attrs: readonly AttrDecl[],
  traceability: readonly string[] = [],
): EffectiveTypeDef {
  const rule: TraceRule = { target: ["requirement"], required: false };
  return {
    name,
    extends: "Requirement",
    displayIdPattern: { value: undefined, origin: ORIGIN },
    displayIdPatternEnforcement: { value: "warn", origin: ORIGIN },
    color: { value: undefined, origin: ORIGIN },
    required: { value: [], origin: ORIGIN },
    attributes: provMap(attrs.map((a) => [a.name, a] as const)),
    traceability: provMap(traceability.map((t) => [t, rule] as const)),
    description: { value: undefined, origin: ORIGIN },
    attrDescriptions: new Map(),
    relationDescriptions: new Map(),
    discipline: { value: undefined, origin: ORIGIN },
  };
}

function profile(
  universal: readonly AttrDecl[],
  types: readonly EffectiveTypeDef[] = [],
): EffectiveProfile {
  return {
    attributes: provMap(universal.map((a) => [a.name, a] as const)),
    labels: new Map(),
    colors: new Map(),
    conventions: new Map(),
    types: provMap(types.map((t) => [t.name, t] as const)),
    documents: { types: new Map(), frontMatter: new Map() },
    delivers: [],
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

function entry(attrs: readonly (readonly [string, string])[]): Entry {
  const typed = new Map<string, string[]>();
  for (const [k, v] of attrs) typed.set(k, [...(typed.get(k) ?? []), v]);
  return {
    displayId: makeDisplayId("REQ-0001"),
    shape: "Authored",
    source: { kind: "markdown" },
    title: "",
    body: "",
    rawAttributes: attrs.map(([key, value]) => ({ key, value })),
    typedAttributes: typed,
    attributeLines: attrs.map((_, i) => 10 + i),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
  };
}

Deno.test("profileTypedKeys: a universal attribute of a type other than text is typed", () => {
  const keys = profileTypedKeys(
    profile([attr("Hazard", "id"), attr("Count", "integer")]),
  );
  assertEquals(keys.has("Hazard"), true);
  assertEquals(keys.has("Count"), true);
});

Deno.test("profileTypedKeys: a text attribute is not typed", () => {
  const keys = profileTypedKeys(profile([attr("Note", "text")]));
  assertEquals(keys.has("Note"), false);
});

Deno.test("profileTypedKeys: an undeclared key is not typed", () => {
  const keys = profileTypedKeys(profile([attr("Hazard", "id")]));
  assertEquals(keys.has("Comment"), false);
});

Deno.test("profileTypedKeys: type-scoped attributes and trace rule names are typed", () => {
  const keys = profileTypedKeys(
    profile([], [typeDef("requirement", [attr("Risk", "id-list")], [
      "Mitigates",
    ])]),
  );
  assertEquals(keys.has("Risk"), true);
  assertEquals(keys.has("Mitigates"), true);
});

Deno.test("profileTypedKeys: a key declared as text anywhere is not typed", () => {
  const keys = profileTypedKeys(
    profile([attr("Ref", "id")], [typeDef("requirement", [
      attr("Ref", "text"),
    ])]),
  );
  assertEquals(keys.has("Ref"), false);
});

Deno.test("profileTypedKeys: keys are stored in canonical case", () => {
  const keys = profileTypedKeys(profile([attr("HAZARD-ref", "id")]));
  assertEquals([...keys], ["Hazard-ref"]);
});

Deno.test("trimProfileTypedValues: trims a typed value, keeps text and undeclared values", () => {
  const keys = profileTypedKeys(
    profile([attr("Hazard", "id"), attr("Note", "text")]),
  );
  const [out] = trimProfileTypedValues([entry([
    ["Hazard", `HAZ-0001${NBSP}`],
    ["Note", `${BOM}kept${NBSP}`],
    ["Comment", `kept${NBSP}`],
  ])], keys);
  assertEquals(out.rawAttributes, [
    { key: "Hazard", value: "HAZ-0001" },
    { key: "Note", value: `${BOM}kept${NBSP}` },
    { key: "Comment", value: `kept${NBSP}` },
  ]);
  assertEquals(out.typedAttributes.get("Hazard"), ["HAZ-0001"]);
  assertEquals(out.typedAttributes.get("Note"), [`${BOM}kept${NBSP}`]);
  assertEquals(out.typedAttributes.get("Comment"), [`kept${NBSP}`]);
});

Deno.test("trimProfileTypedValues: a miscased key is matched in canonical case", () => {
  const keys = profileTypedKeys(profile([attr("Hazard", "id")]));
  const [out] = trimProfileTypedValues(
    [entry([["HAZARD", `${BOM}HAZ-0001`]])],
    keys,
  );
  assertEquals(out.rawAttributes, [{ key: "HAZARD", value: "HAZ-0001" }]);
  assertEquals(out.typedAttributes.get("HAZARD"), ["HAZ-0001"]);
});

Deno.test("trimProfileTypedValues: a value that is empty after the trim is dropped with its line", () => {
  const keys = profileTypedKeys(profile([attr("Hazard", "id")]));
  const [out] = trimProfileTypedValues([entry([
    ["Hazard", `${NBSP}`],
    ["Note", "x"],
  ])], keys);
  assertEquals(out.rawAttributes, [{ key: "Note", value: "x" }]);
  assertEquals(out.attributeLines, [11]);
  assertEquals(out.typedAttributes.has("Hazard"), false);
});

Deno.test("trimProfileTypedValues: an entry with nothing to trim is returned as is", () => {
  const keys = profileTypedKeys(profile([attr("Hazard", "id")]));
  const input = entry([["Hazard", "HAZ-0001"], ["Note", `x${NBSP}`]]);
  assertStrictEquals(trimProfileTypedValues([input], keys)[0], input);
});
