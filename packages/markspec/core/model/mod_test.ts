/**
 * @module core/model/mod_test
 *
 * Unit tests for the {@linkcode BodyToken} discriminated union (ADR-016).
 */

import { assertEquals } from "@std/assert";
import type {
  BodyToken,
  BodyTokenKind,
  DisciplineMode,
  EffectiveProfile,
  EffectiveTypeDef,
  Entry,
  KindDecl,
  ProfileManifest,
  TypeDef,
} from "./mod.ts";
import {
  attributeSpec,
  makeDisplayId,
  UNIVERSAL_ATTRIBUTE_KEYS,
} from "./mod.ts";

Deno.test("BodyToken: discriminated union exhaustiveness", () => {
  const modal: BodyToken = {
    kind: "modal",
    text: "shall",
    case: "lower",
    location: { file: "x.md", line: 1, column: 1 },
  };
  function kindOf(t: BodyToken): BodyTokenKind {
    switch (t.kind) {
      case "modal":
      case "ears-trigger":
      case "gherkin-section":
      case "gherkin-step":
      case "entity-ref":
      case "inline-code":
        return t.kind;
    }
  }
  assertEquals(kindOf(modal), "modal");
});

Deno.test("Entry type accepts optional derivedDiscipline field", () => {
  const entry: Entry = {
    displayId: makeDisplayId("REQ_0001"),
    title: "Test entry",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "t.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
    derivedDiscipline: "software",
  };
  if (entry.derivedDiscipline !== "software") throw new Error("unreachable");
});

Deno.test("Entry type allows derivedDiscipline to be omitted (optional field)", () => {
  // Pre-Phase-4 entries (e.g. parser-emitted) don't carry derivedDiscipline.
  // The optional shape matches the existing bodyAst?: precedent.
  const entry: Entry = {
    displayId: makeDisplayId("REQ_0002"),
    title: "Test entry without discipline",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "t.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
  };
  if (entry.derivedDiscipline !== undefined) throw new Error("unreachable");
});

Deno.test("Slice 2 model: KindDecl + kinds/discipline fields type-check", () => {
  // KindDecl is a tiny record with an optional description.
  const kd: KindDecl = { description: "Embedded firmware modules" };
  if (kd.description !== "Embedded firmware modules") {
    throw new Error("unreachable");
  }

  // ProfileManifest gains a kinds map.
  const manifest: ProfileManifest = {
    id: "x",
    version: "0",
    universalAttributes: [],
    labels: [],
    conventions: [],
    colors: new Map(),
    types: new Map(),
    documents: { types: [], frontMatter: [] },
    delivers: [],
    kinds: new Map<string, KindDecl>([["firmware", {}]]),
    prose: { lexicons: { "capitalized-allow": [], "sentence-abbrev": [] } },
  };
  if (!manifest.kinds.has("firmware")) throw new Error("unreachable");

  // TypeDef gains an optional discipline string.
  const td: TypeDef = {
    name: "SoftwareRequirement",
    extends: "Requirement",
    displayIdPatternEnforcement: "off",
    required: [],
    attributes: [],
    traceability: new Map(),
    discipline: "software",
  };
  if (td.discipline !== "software") throw new Error("unreachable");

  // EffectiveProfile gains a provenanced kinds map.
  const ep: EffectiveProfile = {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map(),
    documents: { types: new Map(), frontMatter: new Map() },
    kinds: new Map(),
    prose: {
      lexicons: {
        "capitalized-allow": { value: [], origin: "x" },
        "sentence-abbrev": { value: [], origin: "x" },
      },
    },
    disciplineMode: { value: "none", origin: "inferred" },
  };
  if (ep.kinds.size !== 0) throw new Error("unreachable");

  // EffectiveTypeDef gains a provenanced discipline value.
  const etd: EffectiveTypeDef = {
    name: "SoftwareRequirement",
    extends: "Requirement",
    displayIdPattern: { value: undefined, origin: "x" },
    displayIdPatternEnforcement: { value: "off", origin: "x" },
    color: { value: undefined, origin: "x" },
    required: { value: [], origin: "x" },
    attributes: new Map(),
    traceability: new Map(),
    description: { value: undefined, origin: "x" },
    attrDescriptions: new Map(),
    relationDescriptions: new Map(),
    discipline: { value: "software", origin: "x" },
  };
  if (etd.discipline.value !== "software") throw new Error("unreachable");
});

Deno.test("Slice 5 model: DisciplineMode + disciplineMode fields type-check", () => {
  // DisciplineMode is a closed union.
  const m: DisciplineMode = "flat";
  if (m !== "flat") throw new Error("unreachable");

  // ProfileManifest.disciplineMode is optional.
  const manifest: ProfileManifest = {
    id: "x",
    version: "0",
    universalAttributes: [],
    labels: [],
    conventions: [],
    colors: new Map(),
    types: new Map(),
    documents: { types: [], frontMatter: [] },
    delivers: [],
    kinds: new Map(),
    prose: { lexicons: { "capitalized-allow": [], "sentence-abbrev": [] } },
    // disciplineMode intentionally omitted — must compile
  };
  if (manifest.id !== "x") throw new Error("unreachable");

  // EffectiveProfile.disciplineMode is required (always populated).
  const ep: EffectiveProfile = {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map(),
    documents: { types: new Map(), frontMatter: new Map() },
    kinds: new Map(),
    prose: {
      lexicons: {
        "capitalized-allow": { value: [], origin: "x" },
        "sentence-abbrev": { value: [], origin: "x" },
      },
    },
    disciplineMode: { value: "none", origin: "inferred" },
  };
  if (ep.disciplineMode.value !== "none") throw new Error("unreachable");
});

Deno.test("Slice 3 model: Discipline and Discipline-frozen are in the universal catalog", () => {
  assertEquals(UNIVERSAL_ATTRIBUTE_KEYS.includes("Discipline"), true);
  assertEquals(UNIVERSAL_ATTRIBUTE_KEYS.includes("Discipline-frozen"), true);

  const d = attributeSpec("Discipline");
  assertEquals(d?.type, "text");
  assertEquals(d?.origin, "authored");
  assertEquals(d?.required, false);
  assertEquals(d?.shapes.length, 2); // both shapes

  const df = attributeSpec("Discipline-frozen");
  assertEquals(df?.type, "text");
  assertEquals(df?.origin, "authored");
  assertEquals(df?.required, false);
  assertEquals(df?.shapes.length, 2);
});
