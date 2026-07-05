/**
 * @module core/validator/pipeline_test
 *
 * Integration tests for the pipeline runner composing Stages 1 + 2.
 */

import { assertEquals } from "@std/assert";
import { runPipeline } from "./pipeline.ts";
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
  id?: string;
  shape: EntryShape;
  idKey?: string;
  typeAttribute?: string;
}): Entry {
  const attributes = [
    { key: opts.idKey ?? "Id", value: opts.id ?? "01HGW2Q8MNP3RSTVWXYZABCDEF" },
  ];
  if (opts.typeAttribute) {
    attributes.push({ key: "Type", value: opts.typeAttribute });
  }
  return {
    displayId: makeDisplayId(opts.displayId),
    title: opts.displayId,
    body: "",
    id: opts.id ?? "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape,
    source: { kind: "markdown" },
    rawAttributes: attributes,
    location: { file: "t.md", line: 1, column: 1 },
    typedAttributes: new Map(),
    bodyTokens: [],
  };
}

function buildProfileWithRequirement(): EffectiveProfile {
  const origin = "@test/p";
  const reqType: ProvenancedMapEntry<EffectiveTypeDef> = {
    value: {
      name: "requirement",
      extends: "Requirement",
      displayIdPattern: { value: "REQ-{n:04d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
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
  return {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map([["requirement", reqType]]),
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

Deno.test("runPipeline: null profile runs Stage 1 only, entries pass through unchanged", () => {
  const entries = [
    buildEntry({ displayId: "REQ-0001", shape: "Authored" }),
  ];
  const result = runPipeline(entries, null);
  assertEquals(result.entries[0].type, undefined);
  assertEquals(result.valid, true);
});

Deno.test("runPipeline: profile present runs Stage 2, entries classified", () => {
  const profile = buildProfileWithRequirement();
  const entries = [
    buildEntry({ displayId: "REQ-0001", shape: "Authored" }),
  ];
  const result = runPipeline(entries, profile);
  assertEquals(result.entries[0].type, "requirement");
  assertEquals(result.valid, true);
});

Deno.test("runPipeline: Stage 1 error contributes to diagnostics + valid=false", () => {
  const entry: Entry = {
    displayId: makeDisplayId("REQ-0001"),
    title: "",
    body: "",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    source: { kind: "markdown" },
    rawAttributes: [],
    location: { file: "t.md", line: 1, column: 1 },
    typedAttributes: new Map(),
    bodyTokens: [],
  };
  const result = runPipeline([entry], null);
  const msl_r003 = result.diagnostics.find((d) => d.code === "MSL-R003");
  if (!msl_r003) {
    throw new Error(
      `expected MSL-R003, got: ${result.diagnostics.map((d) => d.code)}`,
    );
  }
  assertEquals(result.valid, false);
});

Deno.test("runPipeline: both stages contribute diagnostics independently", () => {
  const profile = buildProfileWithRequirement();
  const entry: Entry = {
    displayId: makeDisplayId("FOO-001"),
    title: "",
    body: "",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    source: { kind: "markdown" },
    rawAttributes: [],
    location: { file: "t.md", line: 1, column: 1 },
    typedAttributes: new Map(),
    bodyTokens: [],
  };
  const result = runPipeline([entry], profile);
  const codes = new Set(result.diagnostics.map((d) => d.code));
  if (!codes.has("MSL-R003")) throw new Error("expected MSL-R003");
  if (!codes.has("MSL-T003")) throw new Error("expected MSL-T003");
  assertEquals(result.valid, false);
});

Deno.test("runPipeline: Stage 3 checks attributes of classified entries", () => {
  const origin = "@test/p";
  const rationaleAttr = {
    name: "Rationale",
    type: "text" as const,
    required: true,
    cardinality: { lower: 1, upper: 1 },
  };
  const reqType: ProvenancedMapEntry<EffectiveTypeDef> = {
    origin,
    value: {
      name: "requirement",
      extends: "Requirement",
      displayIdPattern: { value: "REQ-{n:04d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
      color: { value: undefined, origin },
      required: { value: ["Rationale"], origin },
      attributes: new Map([
        ["Rationale", { value: rationaleAttr, origin }],
      ]),
      traceability: new Map(),
      description: { value: undefined, origin },
      attrDescriptions: new Map(),
      relationDescriptions: new Map(),
      discipline: { value: undefined, origin },
    },
  };
  const profile: EffectiveProfile = {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map([["requirement", reqType]]),
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

  // Entry classified as requirement but missing Rationale.
  const e: Entry = {
    displayId: makeDisplayId("REQ-0001"),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    source: { kind: "markdown" },
    title: "",
    body: "",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
    ]),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
  };

  const result = runPipeline([e], profile);
  const a001 = result.diagnostics.find((d) => d.code === "MSL-A001");
  if (!a001) {
    throw new Error(
      `expected MSL-A001, got: ${result.diagnostics.map((d) => d.code)}`,
    );
  }
  assertEquals(result.valid, false);
});

Deno.test("runPipeline: MSL-R010 suppressed for profile-declared attributes", () => {
  const origin = "@test/p";
  const rationaleAttr = {
    name: "Rationale",
    type: "text" as const,
    required: false,
    cardinality: { lower: 0, upper: 1 },
  };
  const profile: EffectiveProfile = {
    attributes: new Map([["Rationale", { value: rationaleAttr, origin }]]),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map(),
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

  const e: Entry = {
    displayId: makeDisplayId("X-001"),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    source: { kind: "markdown" },
    title: "",
    body: "",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Rationale", value: "because" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Rationale", ["because"]],
    ]),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
  };

  const result = runPipeline([e], profile);
  const r010 = result.diagnostics.find((d) => d.code === "MSL-R010");
  if (r010) {
    throw new Error(
      `expected MSL-R010 suppressed, got: ${r010.message}`,
    );
  }
});

Deno.test("runPipeline: profile with zero types runs Stage 2 permissively", () => {
  const profile: EffectiveProfile = {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map(),
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
  const entries = [
    buildEntry({ displayId: "FOO-001", shape: "Authored" }),
  ];
  const result = runPipeline(entries, profile);
  const t003 = result.diagnostics.filter((d) => d.code === "MSL-T003");
  assertEquals(t003.length, 0);
  assertEquals(result.valid, true);
});

Deno.test("runPipeline: Stage 4 catches required link missing", () => {
  const origin = "@test/p";
  const requiredRule = {
    target: ["requirement"] as const,
    cardinality: { lower: 1, upper: Infinity },
    required: true,
  };
  const reqType: ProvenancedMapEntry<EffectiveTypeDef> = {
    origin,
    value: {
      name: "test",
      extends: "Requirement",
      displayIdPattern: { value: "TEST-{n:04d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
      color: { value: undefined, origin },
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map([
        ["Verifies", { value: requiredRule, origin }],
      ]),
      description: { value: undefined, origin },
      attrDescriptions: new Map(),
      relationDescriptions: new Map(),
      discipline: { value: undefined, origin },
    },
  };
  const profile: EffectiveProfile = {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map([["test", reqType]]),
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

  const e: Entry = {
    displayId: makeDisplayId("TEST-0001"),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    source: { kind: "markdown" },
    title: "",
    body: "",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
    ]),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
  };

  const result = runPipeline([e], profile);
  const l001 = result.diagnostics.find((d) => d.code === "MSL-L001");
  if (!l001) {
    throw new Error(
      `expected MSL-L001, got: ${result.diagnostics.map((d) => d.code)}`,
    );
  }
  assertEquals(result.valid, false);
});

Deno.test("Slice 3 pipeline: validateDiscipline runs and emits MSL-T025 on unknown override", () => {
  const entry: Entry = {
    shape: "Authored",
    displayId: makeDisplayId("REQ_001"),
    title: "x",
    body: "",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Discipline", value: "nonsense" },
    ],
    typedAttributes: new Map(),
    type: undefined,
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    location: { file: "x.md", line: 1, column: 1 },
    bodyTokens: [],
    source: { kind: "markdown" as const },
    derivedDiscipline: "system",
  };

  const { diagnostics } = runPipeline([entry], null);
  assertEquals(diagnostics.some((d) => d.code === "MSL-T025"), true);
});

// ---------------------------------------------------------------------------
// Upstream entries (federated-upstream epic, slice 4) — validation-exempt
// graph citizens. Stage 3 (typed attributes) and Stage 4 (traceability)
// per-entry emit loops must skip `kind:"upstream"` entries, while the
// Stage 4 resolution maps (`graph`/`byDisplayId`) must still include them
// so project refs targeting an upstream entry resolve cleanly.
// ---------------------------------------------------------------------------

Deno.test("runPipeline: Stage 3 — upstream entry missing a required attribute emits no MSL-A001", () => {
  const origin = "@test/p";
  const rationaleAttr = {
    name: "Rationale",
    type: "text" as const,
    required: true,
    cardinality: { lower: 1, upper: 1 },
  };
  const reqType: ProvenancedMapEntry<EffectiveTypeDef> = {
    origin,
    value: {
      name: "requirement",
      extends: "Requirement",
      displayIdPattern: { value: "REQ-{n:04d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
      color: { value: undefined, origin },
      required: { value: ["Rationale"], origin },
      attributes: new Map([
        ["Rationale", { value: rationaleAttr, origin }],
      ]),
      traceability: new Map(),
      description: { value: undefined, origin },
      attrDescriptions: new Map(),
      relationDescriptions: new Map(),
      discipline: { value: undefined, origin },
    },
  };
  const profile: EffectiveProfile = {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map([["requirement", reqType]]),
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

  // Upstream entry classified as requirement but missing Rationale. A real
  // hydrated snapshot entry would never be malformed like this, but the
  // test proves the emit loop skips upstream entries unconditionally.
  const e: Entry = {
    displayId: makeDisplayId("REQ-0001"),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    source: { kind: "markdown" },
    title: "",
    body: "",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
    ]),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
    origin: { kind: "upstream", upstreamId: "acme/reqs", version: "v1.0" },
  };

  const result = runPipeline([e], profile);
  const a001 = result.diagnostics.filter((d) => d.code === "MSL-A001");
  assertEquals(a001, []);
});

Deno.test("runPipeline: Stage 3 — kind:profile corpus entry missing a required attribute STILL emits MSL-A001 (corpus unchanged)", () => {
  const origin = "@test/p";
  const rationaleAttr = {
    name: "Rationale",
    type: "text" as const,
    required: true,
    cardinality: { lower: 1, upper: 1 },
  };
  const reqType: ProvenancedMapEntry<EffectiveTypeDef> = {
    origin,
    value: {
      name: "requirement",
      extends: "Requirement",
      displayIdPattern: { value: "REQ-{n:04d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
      color: { value: undefined, origin },
      required: { value: ["Rationale"], origin },
      attributes: new Map([
        ["Rationale", { value: rationaleAttr, origin }],
      ]),
      traceability: new Map(),
      description: { value: undefined, origin },
      attrDescriptions: new Map(),
      relationDescriptions: new Map(),
      discipline: { value: undefined, origin },
    },
  };
  const profile: EffectiveProfile = {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map([["requirement", reqType]]),
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

  const e: Entry = {
    displayId: makeDisplayId("REQ-0001"),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    source: { kind: "markdown" },
    title: "",
    body: "",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
    ]),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
    origin: {
      kind: "profile",
      profileId: "acme/profile",
      profileVersion: "1.0.0",
    },
  };

  const result = runPipeline([e], profile);
  const a001 = result.diagnostics.find((d) => d.code === "MSL-A001");
  if (!a001) {
    throw new Error(
      `expected MSL-A001, got: ${result.diagnostics.map((d) => d.code)}`,
    );
  }
});

Deno.test("runPipeline: Stage 4 — upstream entry's own missing required link emits no MSL-L001", () => {
  const origin = "@test/p";
  const requiredRule = {
    target: ["requirement"] as const,
    cardinality: { lower: 1, upper: Infinity },
    required: true,
  };
  const testType: ProvenancedMapEntry<EffectiveTypeDef> = {
    origin,
    value: {
      name: "test",
      extends: "Requirement",
      displayIdPattern: { value: "TEST-{n:04d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
      color: { value: undefined, origin },
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map([
        ["Verifies", { value: requiredRule, origin }],
      ]),
      description: { value: undefined, origin },
      attrDescriptions: new Map(),
      relationDescriptions: new Map(),
      discipline: { value: undefined, origin },
    },
  };
  const profile: EffectiveProfile = {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map([["test", testType]]),
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

  const e: Entry = {
    displayId: makeDisplayId("TEST-0001"),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    source: { kind: "markdown" },
    title: "",
    body: "",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
    ]),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
    origin: { kind: "upstream", upstreamId: "acme/reqs", version: "v1.0" },
  };

  const result = runPipeline([e], profile);
  const l001 = result.diagnostics.filter((d) => d.code === "MSL-L001");
  assertEquals(l001, []);
});

Deno.test("runPipeline: Stage 4 — PROJECT entry's required link resolves to an UPSTREAM entry (resolution map preserved, no MSL-L006/L004)", () => {
  const origin = "@test/p";
  const requiredRule = {
    target: ["requirement"] as const,
    cardinality: { lower: 1, upper: Infinity },
    required: true,
  };
  const reqType: ProvenancedMapEntry<EffectiveTypeDef> = {
    origin,
    value: {
      name: "requirement",
      extends: "Requirement",
      displayIdPattern: { value: "REQ-{n:04d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
      color: { value: undefined, origin },
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map(),
      description: { value: undefined, origin },
      attrDescriptions: new Map(),
      relationDescriptions: new Map(),
      discipline: { value: undefined, origin },
    },
  };
  const testType: ProvenancedMapEntry<EffectiveTypeDef> = {
    origin,
    value: {
      name: "test",
      extends: "Requirement",
      displayIdPattern: { value: "TEST-{n:04d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
      color: { value: undefined, origin },
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map([
        ["Verifies", { value: requiredRule, origin }],
      ]),
      description: { value: undefined, origin },
      attrDescriptions: new Map(),
      relationDescriptions: new Map(),
      discipline: { value: undefined, origin },
    },
  };
  const profile: EffectiveProfile = {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map([["requirement", reqType], ["test", testType]]),
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

  // Upstream target — must still be a resolution target for the project
  // entry's `Verifies:` link, even though it is itself validation-exempt.
  // Its `type` is pre-set here to "requirement", simulating what real
  // hydration produces: an upstream entry's type comes from its OWN
  // compile (design §4.5/D6) — the consumer's Stage 2 never classifies
  // it, so a hydrated snapshot always arrives with `type` already set.
  const upstreamTarget: Entry = {
    displayId: makeDisplayId("REQ-0001"),
    id: "01UPSTREAMTARGET0000000001",
    shape: "Authored",
    source: { kind: "markdown" },
    title: "",
    body: "",
    type: "requirement",
    rawAttributes: [
      { key: "Id", value: "01UPSTREAMTARGET0000000001" },
    ],
    typedAttributes: new Map([
      ["Id", ["01UPSTREAMTARGET0000000001"]],
    ]),
    location: { file: "upstream.md", line: 1, column: 1 },
    bodyTokens: [],
    origin: { kind: "upstream", upstreamId: "acme/reqs", version: "v1.0" },
  };

  const project: Entry = {
    displayId: makeDisplayId("TEST-0001"),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    source: { kind: "markdown" },
    title: "",
    body: "",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Verifies", value: "REQ-0001" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Verifies", ["REQ-0001"]],
    ]),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
  };

  const result = runPipeline([project, upstreamTarget], profile);
  const l001 = result.diagnostics.filter((d) => d.code === "MSL-L001");
  const l004 = result.diagnostics.filter((d) => d.code === "MSL-L004");
  const l006 = result.diagnostics.filter((d) => d.code === "MSL-L006");
  assertEquals(l001, []);
  assertEquals(l004, []);
  assertEquals(l006, []);
});

Deno.test("runPipeline: Stage 2 — upstream entry matching no profile type pattern emits no MSL-T001/T002/T003/T004", () => {
  const profile = buildProfileWithRequirement();

  // Upstream entry whose display ID matches the "requirement" type's
  // pattern (REQ-{n:04d}) for none of the profile's declared types —
  // a strict (types.size > 0) consumer profile would classify this as
  // MSL-T003 for a project entry. Upstream entries are validation-exempt
  // graph citizens (design §4.7): Stage 2 must not classify or emit for
  // them at all.
  const e: Entry = {
    displayId: makeDisplayId("ZZZ-9999"),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    source: { kind: "markdown" },
    title: "",
    body: "",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
    ]),
    location: { file: "upstream.md", line: 1, column: 1 },
    bodyTokens: [],
    origin: { kind: "upstream", upstreamId: "acme/reqs", version: "v1.0" },
  };

  const result = runPipeline([e], profile);
  const classifyCodes = result.diagnostics.filter((d) =>
    ["MSL-T001", "MSL-T002", "MSL-T003", "MSL-T004"].includes(d.code)
  );
  assertEquals(classifyCodes, []);
});

Deno.test("runPipeline: Stage 2 — upstream entry's pre-set type is preserved, not overwritten by classification", () => {
  const profile = buildProfileWithRequirement();

  // Display ID matches the "requirement" type's pattern (REQ-{n:04d}) —
  // if Stage 2 classified this entry, it would overwrite `type` to
  // "requirement". Per design §4.5/D6 an upstream entry's type comes
  // from its OWN compile; the consumer must never re-classify it.
  const e: Entry = {
    displayId: makeDisplayId("REQ-0001"),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    source: { kind: "markdown" },
    title: "",
    body: "",
    type: "foreign-req",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
    ]),
    location: { file: "upstream.md", line: 1, column: 1 },
    bodyTokens: [],
    origin: { kind: "upstream", upstreamId: "acme/reqs", version: "v1.0" },
  };

  const result = runPipeline([e], profile);
  assertEquals(result.entries[0].type, "foreign-req");
});

Deno.test("runPipeline: Stage 2.4 — upstream entry is exempt from late-stage MSL-T021 inference", () => {
  const profile = buildProfileWithRequirement();

  // A type-less entry whose display ID carries a path-like separator drives
  // late-stage display-ID-shape inference (MSL-T021). As a project entry it
  // fires; as an upstream entry it must be exempt (design §4.7).
  const base: Entry = {
    displayId: makeDisplayId("svc/handler"),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    source: { kind: "markdown" },
    title: "",
    body: "",
    rawAttributes: [{ key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" }],
    typedAttributes: new Map([["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]]]),
    location: { file: "upstream.md", line: 1, column: 1 },
    bodyTokens: [],
  };

  // Control: as a project entry the fixture genuinely triggers MSL-T021.
  const projectT021 = runPipeline([{ ...base }], profile).diagnostics.filter(
    (d) => d.code === "MSL-T021",
  );
  assertEquals(projectT021.length > 0, true);

  // Upstream: exempt — no MSL-T021.
  const upstreamT021 = runPipeline([{
    ...base,
    origin: { kind: "upstream", upstreamId: "acme/reqs", version: "v1.0" },
  }], profile).diagnostics.filter((d) => d.code === "MSL-T021");
  assertEquals(upstreamT021, []);
});

Deno.test("runPipeline: Stage 2.5 normalization splits comma-separated id-list values before Stage 3", () => {
  const origin = "@test/p";
  const verifiesAttr = {
    name: "Verifies",
    type: "id-list" as const,
    required: false,
    cardinality: { lower: 0, upper: Infinity },
  };
  const profile: EffectiveProfile = {
    attributes: new Map([
      ["Verifies", { value: verifiesAttr, origin }],
    ]),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map(),
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

  const target1: Entry = {
    displayId: makeDisplayId("REQ-0001"),
    id: "01T1T1T1T1T1T1T1T1T1T1T1T1",
    shape: "Authored",
    source: { kind: "markdown" },
    title: "",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map([["Id", ["01T1T1T1T1T1T1T1T1T1T1T1T1"]]]),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
  };
  const target2: Entry = {
    displayId: makeDisplayId("REQ-0002"),
    id: "01T2T2T2T2T2T2T2T2T2T2T2T2",
    shape: "Authored",
    source: { kind: "markdown" },
    title: "",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map([["Id", ["01T2T2T2T2T2T2T2T2T2T2T2T2"]]]),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
  };
  const e: Entry = {
    displayId: makeDisplayId("TEST-0001"),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    source: { kind: "markdown" },
    title: "",
    body: "",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      {
        key: "Verifies",
        value: "01T1T1T1T1T1T1T1T1T1T1T1T1, 01T2T2T2T2T2T2T2T2T2T2T2T2",
      },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Verifies", ["01T1T1T1T1T1T1T1T1T1T1T1T1, 01T2T2T2T2T2T2T2T2T2T2T2T2"]],
    ]),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
  };

  const result = runPipeline([e, target1, target2], profile);
  // Stage 3 should see split values → no MSL-A004.
  assertEquals(result.diagnostics.filter((d) => d.code === "MSL-A004"), []);
});

Deno.test("runPipeline: upstream entry violating every emit stage stays silent but resolves (#771 partition anchor)", () => {
  const profile = buildProfileWithRequirement();

  // One upstream entry engineered to trip a rule in EVERY per-entry emit
  // surface, were it emittable:
  // - Stage 1  checkStructural: missing Id (MSL-R003/I003), empty title
  //   (MSL-P010), unknown attribute (MSL-R010)
  // - Stage 1  checkReferences: unresolvable Supersedes (MSL-T012),
  //   unresolvable References citation (MSL-T005)
  // - Stage 1.5 validateCoreTypeAttribute: unknown Type value (MSL-T020)
  // - Stage 1.6 trace_types: Satisfies target carrying Deprecated
  //   (MSL-R081)
  // - Stage 1.7 discipline: unknown Discipline kind (MSL-T025)
  // This is the #765-class regression net: it pins the partition itself,
  // so a future stage that forgets the emittable list fails here.
  const upstream: Entry = {
    displayId: makeDisplayId("UP-0001"),
    shape: "Authored",
    source: { kind: "markdown" },
    title: "",
    body: "",
    type: "foreign-req",
    rawAttributes: [
      { key: "Frobnicate", value: "x" },
      { key: "Type", value: "not-a-type" },
      { key: "Supersedes", value: "GHOST-0001" },
      { key: "References", value: "ghost-slug" },
      { key: "Discipline", value: "quantum" },
      { key: "Satisfies", value: "REQ-0002" },
    ],
    typedAttributes: new Map(),
    location: { file: "upstream.md", line: 1, column: 1 },
    bodyTokens: [],
    origin: { kind: "upstream", upstreamId: "acme/reqs", version: "v1.0" },
  };

  // Retired project entry — the upstream's Satisfies target (MSL-R081 bait:
  // a project source pointing here would warn "target is retired").
  const retired: Entry = {
    displayId: makeDisplayId("REQ-0002"),
    id: "01T2T2T2T2T2T2T2T2T2T2T2T2",
    shape: "Authored",
    source: { kind: "markdown" },
    title: "Retired requirement",
    body: "",
    rawAttributes: [
      { key: "Id", value: "01T2T2T2T2T2T2T2T2T2T2T2T2" },
      { key: "Deprecated", value: "superseded 2026-01" },
    ],
    typedAttributes: new Map([["Id", ["01T2T2T2T2T2T2T2T2T2T2T2T2"]]]),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
  };

  // Project entry whose link targets the upstream entry — resolution must
  // keep working while the upstream stays silent.
  const project: Entry = {
    displayId: makeDisplayId("REQ-0001"),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    source: { kind: "markdown" },
    title: "Project requirement",
    body: "",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Supersedes", value: "UP-0001" },
    ],
    typedAttributes: new Map([["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]]]),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
  };

  const result = runPipeline([upstream, project, retired], profile);

  // None of the upstream entry's baited codes may fire...
  const baitCodes = [
    "MSL-R003",
    "MSL-I003",
    "MSL-P010",
    "MSL-R010",
    "MSL-T012",
    "MSL-T005",
    "MSL-T020",
    "MSL-T025",
    "MSL-R081",
  ];
  assertEquals(
    result.diagnostics.filter((d) => baitCodes.includes(d.code)),
    [],
  );
  // ...no diagnostic of any code may be attributed to the upstream entry...
  assertEquals(
    result.diagnostics.filter(
      (d) =>
        d.message.includes("UP-0001") ||
        d.location?.file === "upstream.md",
    ),
    [],
  );
  // ...and the upstream entry stayed a live resolution target: the project
  // entry's Supersedes resolved (a missing target would be MSL-T012 at the
  // project entry, already excluded above) and passed through to output.
  assertEquals(
    result.entries.some((e) => e.displayId === "UP-0001"),
    true,
  );
});
