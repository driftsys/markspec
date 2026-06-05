/**
 * @module core/validator/types_test
 *
 * Unit tests for entry classification against a profile.
 */

import { assertEquals } from "@std/assert";
import { classifyEntriesStage, classifyEntry } from "./types.ts";
import type {
  EffectiveProfile,
  EffectiveTypeDef,
  Entry,
  EntryShape,
  ProvenancedMapEntry,
} from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";

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
    displayId: makeDisplayId(opts.displayId),
    title: "",
    body: "",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape,
    type: opts.type,
    source: { kind: "markdown" },
    rawAttributes: attributes,
    location: { file: "t.md", line: 1, column: 1 },
    typedAttributes: new Map(),
    bodyTokens: [],
  };
}

function buildType(opts: {
  name: string;
  displayIdPattern?: string;
  enforcement?: "off" | "warn" | "error";
}): ProvenancedMapEntry<EffectiveTypeDef> {
  const origin = "@test/profile";
  return {
    value: {
      name: opts.name,
      extends: "Requirement",
      displayIdPattern: { value: opts.displayIdPattern, origin },
      displayIdPatternEnforcement: {
        value: opts.enforcement ?? "off",
        origin,
      },
      color: { value: undefined, origin },
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map(),
      description: { value: undefined, origin },
      attrDescriptions: new Map(),
      relationDescriptions: new Map(),
      discipline: { value: undefined, origin },
    },
    origin,
  };
}

function buildProfile(
  types: ReadonlyArray<ProvenancedMapEntry<EffectiveTypeDef>>,
): EffectiveProfile {
  const typesMap = new Map<string, ProvenancedMapEntry<EffectiveTypeDef>>();
  for (const t of types) typesMap.set(t.value.name, t);
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

Deno.test("classifyEntry: unique pattern match classifies entry", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  const entry = buildEntry({ displayId: "REQ-0001", shape: "Authored" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, "requirement");
  assertEquals(result.diagnostics, []);
});

Deno.test("classifyEntry: no match + strict mode emits MSL-T003", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  const entry = buildEntry({ displayId: "FOO-001", shape: "Authored" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, undefined);
  assertEquals(result.diagnostics[0].code, "MSL-T003");
});

Deno.test("classifyEntry: ambiguous match emits MSL-T002", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      displayIdPattern: "REQ-{n}",
    }),
    buildType({
      name: "req-extended",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  const entry = buildEntry({ displayId: "REQ-0001", shape: "Authored" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, undefined);
  assertEquals(result.diagnostics[0].code, "MSL-T002");
});

Deno.test("classifyEntry: counter-less named pattern classifies underscore-bearing ID", () => {
  // Issue #594: a named (non-numbered) component type declares a counter-less
  // display-id-pattern and is classified by prefix with no explicit Type:.
  const profile = buildProfile([
    buildType({
      name: "sw-component",
      displayIdPattern: "SWC_{name}",
      enforcement: "off",
    }),
  ]);
  const entry = buildEntry({ displayId: "SWC_LIGHT_CTRL", shape: "Authored" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, "sw-component");
  assertEquals(result.diagnostics, []);
});

Deno.test("classifyEntry: overlapping named prefixes emit MSL-T002", () => {
  // Two counter-less patterns can both match an ID; the existing ambiguity
  // path applies unchanged.
  const profile = buildProfile([
    buildType({
      name: "sw-component",
      displayIdPattern: "SWC_{name}",
      enforcement: "off",
    }),
    buildType({
      name: "sw-light-component",
      displayIdPattern: "SWC_LIGHT_{name}",
      enforcement: "off",
    }),
  ]);
  const entry = buildEntry({ displayId: "SWC_LIGHT_CTRL", shape: "Authored" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, undefined);
  assertEquals(result.diagnostics[0].code, "MSL-T002");
});

Deno.test("classifyEntry: all types participate in pattern match regardless of extends", () => {
  // Tier 2: types no longer have a 'shape' field; all participate in pattern
  // matching. Only the entry's own shape guards classification (Authored only).
  const profile = buildProfile([
    buildType({
      name: "requirement",
      displayIdPattern: "REQ-{n:04d}",
    }),
    buildType({
      name: "citation",
      displayIdPattern: "CIT-{n:04d}",
    }),
  ]);
  const entry = buildEntry({ displayId: "REQ-0001", shape: "Authored" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, "requirement");
  assertEquals(result.diagnostics, []);
});

Deno.test("classifyEntry: explicit Type: trailer used when present", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  const entry = buildEntry({
    displayId: "FOO-001",
    shape: "Authored",
    typeAttribute: "requirement",
  });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, "requirement");
  assertEquals(result.diagnostics, []);
});

Deno.test("classifyEntry: explicit Type: unknown value emits MSL-T001", () => {
  const profile = buildProfile([
    buildType({ name: "requirement" }),
  ]);
  const entry = buildEntry({
    displayId: "REQ-0001",
    shape: "Authored",
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
      displayIdPattern: "REQ-{n}",
    }),
    buildType({
      name: "note",
      displayIdPattern: "NOTE-{n}",
    }),
  ]);
  const entry = buildEntry({
    displayId: "REQ-1",
    shape: "Authored",
    typeAttribute: "note",
  });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, "note");
  assertEquals(result.diagnostics, []);
});

Deno.test("classifyEntry: permissive (empty types map) never emits MSL-T003", () => {
  const profile = buildProfile([]);
  const entry = buildEntry({ displayId: "FOO-001", shape: "Authored" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, undefined);
  assertEquals(result.diagnostics, []);
});

Deno.test("classifyEntry: type without pattern doesn't participate in pattern match", () => {
  const profile = buildProfile([
    buildType({ name: "generic" }),
  ]);
  const entry = buildEntry({ displayId: "FOO-001", shape: "Authored" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, undefined);
  assertEquals(result.diagnostics[0].code, "MSL-T003");
});

Deno.test("classifyEntriesStage: sets entry.type on successful classification", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  const entries = [
    buildEntry({ displayId: "REQ-0001", shape: "Authored" }),
    buildEntry({ displayId: "REQ-0002", shape: "Authored" }),
  ];
  const result = classifyEntriesStage(entries, profile);
  assertEquals(result.diagnostics, []);
  assertEquals(result.entries[0].type, "requirement");
  assertEquals(result.entries[1].type, "requirement");
});

Deno.test("classifyEntriesStage: preserves entries for un-classified (permissive mode)", () => {
  const profile = buildProfile([]);
  const entries = [
    buildEntry({ displayId: "FOO-001", shape: "Authored" }),
  ];
  const result = classifyEntriesStage(entries, profile);
  assertEquals(result.diagnostics, []);
  assertEquals(result.entries[0].type, undefined);
});

Deno.test("classifyEntriesStage: accumulates diagnostics across entries", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  const entries = [
    buildEntry({ displayId: "FOO-001", shape: "Authored" }),
    buildEntry({ displayId: "BAR-002", shape: "Authored" }),
    buildEntry({ displayId: "REQ-0001", shape: "Authored" }),
  ];
  const result = classifyEntriesStage(entries, profile);
  const t003 = result.diagnostics.filter((d) => d.code === "MSL-T003");
  assertEquals(t003.length, 2);
});

Deno.test("classifyEntriesStage: MSL-T004 warn when enforcement=warn and pattern mismatches", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      displayIdPattern: "REQ-{n:04d}",
      enforcement: "warn",
    }),
  ]);
  const entries = [
    buildEntry({
      displayId: "FOO-001",
      shape: "Authored",
      typeAttribute: "requirement",
    }),
  ];
  const result = classifyEntriesStage(entries, profile);
  assertEquals(result.entries[0].type, "requirement");
  const t004 = result.diagnostics.find((d) => d.code === "MSL-T004");
  if (!t004) {
    throw new Error(
      `expected MSL-T004, got: ${result.diagnostics.map((d) => d.code)}`,
    );
  }
  assertEquals(t004.severity, "warning");
});

Deno.test("classifyEntriesStage: MSL-T004 error when enforcement=error", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      displayIdPattern: "REQ-{n:04d}",
      enforcement: "error",
    }),
  ]);
  const entries = [
    buildEntry({
      displayId: "FOO-001",
      shape: "Authored",
      typeAttribute: "requirement",
    }),
  ];
  const result = classifyEntriesStage(entries, profile);
  const t004 = result.diagnostics.find((d) => d.code === "MSL-T004");
  if (!t004) {
    throw new Error(
      `expected MSL-T004, got: ${result.diagnostics.map((d) => d.code)}`,
    );
  }
  assertEquals(t004.severity, "error");
});

Deno.test("classifyEntriesStage: no MSL-T004 when enforcement=off", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      displayIdPattern: "REQ-{n:04d}",
      enforcement: "off",
    }),
  ]);
  const entries = [
    buildEntry({
      displayId: "FOO-001",
      shape: "Authored",
      typeAttribute: "requirement",
    }),
  ];
  const result = classifyEntriesStage(entries, profile);
  const t004 = result.diagnostics.find((d) => d.code === "MSL-T004");
  assertEquals(t004, undefined);
});

Deno.test("classifyEntriesStage: pattern-matched classification is never MSL-T004 (by definition)", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      displayIdPattern: "REQ-{n:04d}",
      enforcement: "error",
    }),
  ]);
  const entries = [
    buildEntry({ displayId: "REQ-0001", shape: "Authored" }),
  ];
  const result = classifyEntriesStage(entries, profile);
  assertEquals(result.diagnostics, []);
});

// ─── Change 3: Authored-only pattern guard ────────────────────────────────────

Deno.test("classifyEntry: Reference-shape entry is NOT classified by display-id-pattern", () => {
  // A Reference type with a display-id-pattern. If the guard is missing,
  // a Reference entry whose displayId matches the pattern would be
  // classified — which is incorrect.
  const profile = buildProfile([
    buildType({
      name: "external-ref",
      displayIdPattern: "EXT-{n:04d}",
    }),
  ]);
  const entry = buildEntry({
    displayId: "EXT-0001",
    shape: "Reference",
  });
  const result = classifyEntry(entry, profile);
  // Must not be classified via pattern for Reference entries.
  assertEquals(result.type, undefined);
});
