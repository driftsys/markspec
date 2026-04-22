/**
 * @module core/validator/types_test
 *
 * Unit tests for entry classification against a profile.
 */

import { assertEquals } from "@std/assert";
import { classifyEntry } from "./types.ts";
import type {
  EffectiveProfile,
  EffectiveTypeDef,
  Entry,
  EntryShape,
  ProvenancedMapEntry,
} from "../model/mod.ts";

function buildEntry(opts: {
  displayId: string;
  shape: EntryShape;
  type?: string;
  typeAttribute?: string;
}): Entry {
  const attributes = opts.typeAttribute
    ? [{ key: "Type", value: opts.typeAttribute }]
    : [];
  return {
    displayId: opts.displayId,
    title: "",
    body: "",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape,
    type: opts.type,
    source: "markdown",
    attributes,
    location: { file: "t.md", line: 1, column: 1 },
  };
}

function buildType(opts: {
  name: string;
  shape: EntryShape;
  displayIdPattern?: string;
  enforcement?: "off" | "warn" | "error";
}): ProvenancedMapEntry<EffectiveTypeDef> {
  const origin = "@test/profile";
  return {
    value: {
      name: opts.name,
      shape: opts.shape,
      displayIdPattern: { value: opts.displayIdPattern, origin },
      displayIdPatternEnforcement: {
        value: opts.enforcement ?? "off",
        origin,
      },
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map(),
    },
    origin,
  };
}

function buildProfile(
  types: ReadonlyArray<ProvenancedMapEntry<EffectiveTypeDef>>,
): EffectiveProfile {
  const origin = "@test/profile";
  const typesMap = new Map<string, ProvenancedMapEntry<EffectiveTypeDef>>();
  for (const t of types) typesMap.set(t.value.name, t);
  return {
    required: { value: [], origin },
    attributes: new Map(),
    labels: { value: [], origin },
    identified: {
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map(),
    },
    referenced: {
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map(),
    },
    types: typesMap,
    documents: { types: new Map(), frontMatter: new Map() },
  };
}

Deno.test("classifyEntry: unique pattern match classifies entry", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  const entry = buildEntry({ displayId: "REQ-0001", shape: "identified" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, "requirement");
  assertEquals(result.diagnostics, []);
});

Deno.test("classifyEntry: no match + strict mode emits MSL-T003", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  const entry = buildEntry({ displayId: "FOO-001", shape: "identified" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, undefined);
  assertEquals(result.diagnostics[0].code, "MSL-T003");
});

Deno.test("classifyEntry: ambiguous match emits MSL-T002", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n}",
    }),
    buildType({
      name: "req-extended",
      shape: "identified",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  const entry = buildEntry({ displayId: "REQ-0001", shape: "identified" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, undefined);
  assertEquals(result.diagnostics[0].code, "MSL-T002");
});

Deno.test("classifyEntry: only types with matching shape are considered", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n:04d}",
    }),
    buildType({
      name: "citation",
      shape: "referenced",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  const entry = buildEntry({ displayId: "REQ-0001", shape: "identified" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, "requirement");
  assertEquals(result.diagnostics, []);
});

Deno.test("classifyEntry: explicit Type: trailer used when present", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  const entry = buildEntry({
    displayId: "FOO-001",
    shape: "identified",
    typeAttribute: "requirement",
  });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, "requirement");
  assertEquals(result.diagnostics, []);
});

Deno.test("classifyEntry: explicit Type: unknown value emits MSL-T001", () => {
  const profile = buildProfile([
    buildType({ name: "requirement", shape: "identified" }),
  ]);
  const entry = buildEntry({
    displayId: "REQ-0001",
    shape: "identified",
    typeAttribute: "bogus",
  });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, undefined);
  assertEquals(result.diagnostics[0].code, "MSL-T001");
});

Deno.test("classifyEntry: explicit Type: overrides pattern inference", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n}",
    }),
    buildType({
      name: "note",
      shape: "identified",
      displayIdPattern: "NOTE-{n}",
    }),
  ]);
  const entry = buildEntry({
    displayId: "REQ-1",
    shape: "identified",
    typeAttribute: "note",
  });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, "note");
  assertEquals(result.diagnostics, []);
});

Deno.test("classifyEntry: permissive (empty types map) never emits MSL-T003", () => {
  const profile = buildProfile([]);
  const entry = buildEntry({ displayId: "FOO-001", shape: "identified" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, undefined);
  assertEquals(result.diagnostics, []);
});

Deno.test("classifyEntry: type without pattern doesn't participate in pattern match", () => {
  const profile = buildProfile([
    buildType({ name: "generic", shape: "identified" }),
  ]);
  const entry = buildEntry({ displayId: "FOO-001", shape: "identified" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, undefined);
  assertEquals(result.diagnostics[0].code, "MSL-T003");
});
