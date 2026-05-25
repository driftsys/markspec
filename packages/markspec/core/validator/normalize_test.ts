/**
 * @module core/validator/normalize_test
 *
 * Unit tests for Stage 2.5 list-value normalization.
 */

import { assertEquals } from "@std/assert";
import { normalizeListValues } from "./normalize.ts";
import type {
  AttrDecl,
  EffectiveProfile,
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

function profile(opts: {
  universalAttrs?: readonly AttrDecl[];
}): EffectiveProfile {
  return {
    attributes: provAttrs(opts.universalAttrs ?? []),
    labels: new Map(),
    colors: new Map(),
    conventions: new Map(),
    types: new Map(),
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
  attrs?: Record<string, readonly string[]>;
}): Entry {
  const attrs = opts.attrs ?? {};
  const attributes = [];
  for (const [k, vs] of Object.entries(attrs)) {
    for (const v of vs) attributes.push({ key: k, value: v });
  }
  return {
    displayId: makeDisplayId("X-001"),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape,
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

const idListAttr: AttrDecl = {
  name: "Verifies",
  type: "id-list",
  required: false,
  cardinality: { lower: 0, upper: Infinity },
};

const tagListAttr: AttrDecl = {
  name: "Labels",
  type: "tag-list",
  required: false,
  cardinality: { lower: 0, upper: Infinity },
};

const textAttr: AttrDecl = {
  name: "Rationale",
  type: "text",
  required: false,
  cardinality: { lower: 0, upper: 1 },
};

Deno.test("normalizeListValues: id-list with comma-separated value is split", () => {
  const p = profile({ universalAttrs: [idListAttr] });
  const e = entry({
    shape: "Authored",
    attrs: {
      Verifies: ["REQ-0001, REQ-0002, REQ-0003"],
    },
  });
  const out = normalizeListValues(e, p);
  assertEquals(out.typedAttributes.get("Verifies"), [
    "REQ-0001",
    "REQ-0002",
    "REQ-0003",
  ]);
});

Deno.test("normalizeListValues: tag-list with comma-separated value is split", () => {
  const p = profile({ universalAttrs: [tagListAttr] });
  const e = entry({
    shape: "Authored",
    attrs: { Labels: ["DRAFT, INTERNAL"] },
  });
  const out = normalizeListValues(e, p);
  assertEquals(out.typedAttributes.get("Labels"), ["DRAFT", "INTERNAL"]);
});

Deno.test("normalizeListValues: no comma → idempotent (value unchanged)", () => {
  const p = profile({ universalAttrs: [idListAttr] });
  const e = entry({
    shape: "Authored",
    attrs: { Verifies: ["REQ-0001", "REQ-0002"] },
  });
  const out = normalizeListValues(e, p);
  assertEquals(out.typedAttributes.get("Verifies"), ["REQ-0001", "REQ-0002"]);
  assertEquals(out, e);
});

Deno.test("normalizeListValues: trims whitespace around split values", () => {
  const p = profile({ universalAttrs: [idListAttr] });
  const e = entry({
    shape: "Authored",
    attrs: { Verifies: ["  REQ-0001  ,  REQ-0002  "] },
  });
  const out = normalizeListValues(e, p);
  assertEquals(out.typedAttributes.get("Verifies"), [
    "REQ-0001",
    "REQ-0002",
  ]);
});

Deno.test("normalizeListValues: empty-string fragments from double commas are dropped", () => {
  const p = profile({ universalAttrs: [idListAttr] });
  const e = entry({
    shape: "Authored",
    attrs: { Verifies: ["REQ-0001,,REQ-0002"] },
  });
  const out = normalizeListValues(e, p);
  assertEquals(out.typedAttributes.get("Verifies"), [
    "REQ-0001",
    "REQ-0002",
  ]);
});

Deno.test("normalizeListValues: non-list types are never split", () => {
  const p = profile({ universalAttrs: [textAttr] });
  const e = entry({
    shape: "Authored",
    attrs: { Rationale: ["one, two, three"] },
  });
  const out = normalizeListValues(e, p);
  assertEquals(out.typedAttributes.get("Rationale"), ["one, two, three"]);
});

Deno.test("normalizeListValues: mix of multi-line and comma-separated merges correctly", () => {
  const p = profile({ universalAttrs: [idListAttr] });
  const e = entry({
    shape: "Authored",
    attrs: { Verifies: ["REQ-0001, REQ-0002", "REQ-0003"] },
  });
  const out = normalizeListValues(e, p);
  assertEquals(out.typedAttributes.get("Verifies"), [
    "REQ-0001",
    "REQ-0002",
    "REQ-0003",
  ]);
});

Deno.test("normalizeListValues: un-declared attribute is untouched", () => {
  const p = profile({ universalAttrs: [idListAttr] });
  const e = entry({
    shape: "Authored",
    attrs: { Unknown: ["a, b, c"] },
  });
  const out = normalizeListValues(e, p);
  assertEquals(out.typedAttributes.get("Unknown"), ["a, b, c"]);
});

Deno.test("normalizeListValues: entry with no typedAttributes is returned as-is", () => {
  const p = profile({ universalAttrs: [idListAttr] });
  const e = entry({ shape: "Authored" });
  const out = normalizeListValues(e, p);
  assertEquals(out, e);
});

Deno.test("normalizeListValues: type-scope declarations are considered", () => {
  const origin = ORIGIN;
  const p: EffectiveProfile = {
    attributes: new Map(),
    labels: new Map(),
    colors: new Map(),
    conventions: new Map(),
    types: new Map([
      ["requirement", {
        value: {
          name: "requirement",
          extends: "Requirement",
          displayIdPattern: { value: undefined, origin },
          displayIdPatternEnforcement: { value: "off", origin },
          color: { value: undefined, origin },
          required: { value: [], origin },
          attributes: provAttrs([idListAttr]),
          traceability: new Map(),
          description: { value: undefined, origin },
          attrDescriptions: new Map(),
          relationDescriptions: new Map(),
        },
        origin,
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
  const e = entry({
    shape: "Authored",
    attrs: { Verifies: ["REQ-0001, REQ-0002"] },
  });
  const classified = { ...e, type: "requirement" };
  const out = normalizeListValues(classified, p);
  assertEquals(out.typedAttributes.get("Verifies"), ["REQ-0001", "REQ-0002"]);
});
