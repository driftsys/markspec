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
    displayId: opts.displayId,
    title: opts.displayId,
    body: "",
    id: opts.id ?? "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape,
    source: "markdown",
    rawAttributes: attributes,
    location: { file: "t.md", line: 1, column: 1 },
    typedAttributes: new Map(),
  };
}

function buildProfileWithRequirement(): EffectiveProfile {
  const origin = "@test/p";
  const reqType: ProvenancedMapEntry<EffectiveTypeDef> = {
    value: {
      name: "requirement",
      shape: "identified",
      displayIdPattern: { value: "REQ-{n:04d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
      color: { value: undefined, origin },
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map(),
    },
    origin,
  };
  return {
    required: { value: [], origin },
    attributes: new Map(),
    labels: { value: [], origin },
    colors: new Map(),
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
    types: new Map([["requirement", reqType]]),
    documents: { types: new Map(), frontMatter: new Map() },
  };
}

Deno.test("runPipeline: null profile runs Stage 1 only, entries pass through unchanged", () => {
  const entries = [
    buildEntry({ displayId: "REQ-0001", shape: "identified" }),
  ];
  const result = runPipeline(entries, null);
  assertEquals(result.entries[0].type, undefined);
  assertEquals(result.valid, true);
});

Deno.test("runPipeline: profile present runs Stage 2, entries classified", () => {
  const profile = buildProfileWithRequirement();
  const entries = [
    buildEntry({ displayId: "REQ-0001", shape: "identified" }),
  ];
  const result = runPipeline(entries, profile);
  assertEquals(result.entries[0].type, "requirement");
  assertEquals(result.valid, true);
});

Deno.test("runPipeline: Stage 1 error contributes to diagnostics + valid=false", () => {
  const entry: Entry = {
    displayId: "REQ-0001",
    title: "",
    body: "",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "identified",
    source: "markdown",
    rawAttributes: [],
    location: { file: "t.md", line: 1, column: 1 },
    typedAttributes: new Map(),
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
    displayId: "FOO-001",
    title: "",
    body: "",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "identified",
    source: "markdown",
    rawAttributes: [],
    location: { file: "t.md", line: 1, column: 1 },
    typedAttributes: new Map(),
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
      shape: "identified",
      displayIdPattern: { value: "REQ-{n:04d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
      color: { value: undefined, origin },
      required: { value: ["Rationale"], origin },
      attributes: new Map([
        ["Rationale", { value: rationaleAttr, origin }],
      ]),
      traceability: new Map(),
    },
  };
  const profile: EffectiveProfile = {
    required: { value: [], origin },
    attributes: new Map(),
    labels: { value: [], origin },
    colors: new Map(),
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
    types: new Map([["requirement", reqType]]),
    documents: { types: new Map(), frontMatter: new Map() },
  };

  // Entry classified as requirement but missing Rationale.
  const e: Entry = {
    displayId: "REQ-0001",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "identified",
    source: "markdown",
    title: "",
    body: "",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
    ]),
    location: { file: "t.md", line: 1, column: 1 },
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
    required: { value: [], origin },
    attributes: new Map([["Rationale", { value: rationaleAttr, origin }]]),
    labels: { value: [], origin },
    colors: new Map(),
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
    types: new Map(),
    documents: { types: new Map(), frontMatter: new Map() },
  };

  const e: Entry = {
    displayId: "X-001",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "identified",
    source: "markdown",
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
  const origin = "@test/p";
  const profile: EffectiveProfile = {
    required: { value: [], origin },
    attributes: new Map(),
    labels: { value: [], origin },
    colors: new Map(),
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
    types: new Map(),
    documents: { types: new Map(), frontMatter: new Map() },
  };
  const entries = [
    buildEntry({ displayId: "FOO-001", shape: "identified" }),
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
      shape: "identified",
      displayIdPattern: { value: "TEST-{n:04d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
      color: { value: undefined, origin },
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map([
        ["Verifies", { value: requiredRule, origin }],
      ]),
    },
  };
  const profile: EffectiveProfile = {
    required: { value: [], origin },
    attributes: new Map(),
    labels: { value: [], origin },
    colors: new Map(),
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
    types: new Map([["test", reqType]]),
    documents: { types: new Map(), frontMatter: new Map() },
  };

  const e: Entry = {
    displayId: "TEST-0001",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "identified",
    source: "markdown",
    title: "",
    body: "",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
    ]),
    location: { file: "t.md", line: 1, column: 1 },
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

Deno.test("runPipeline: Stage 2.5 normalization splits comma-separated id-list values before Stage 3", () => {
  const origin = "@test/p";
  const verifiesAttr = {
    name: "Verifies",
    type: "id-list" as const,
    required: false,
    cardinality: { lower: 0, upper: Infinity },
  };
  const profile: EffectiveProfile = {
    required: { value: [], origin },
    attributes: new Map([
      ["Verifies", { value: verifiesAttr, origin }],
    ]),
    labels: { value: [], origin },
    colors: new Map(),
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
    types: new Map(),
    documents: { types: new Map(), frontMatter: new Map() },
  };

  const target1: Entry = {
    displayId: "REQ-0001",
    id: "01T1T1T1T1T1T1T1T1T1T1T1T1",
    shape: "identified",
    source: "markdown",
    title: "",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map([["Id", ["01T1T1T1T1T1T1T1T1T1T1T1T1"]]]),
    location: { file: "t.md", line: 1, column: 1 },
  };
  const target2: Entry = {
    displayId: "REQ-0002",
    id: "01T2T2T2T2T2T2T2T2T2T2T2T2",
    shape: "identified",
    source: "markdown",
    title: "",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map([["Id", ["01T2T2T2T2T2T2T2T2T2T2T2T2"]]]),
    location: { file: "t.md", line: 1, column: 1 },
  };
  const e: Entry = {
    displayId: "TEST-0001",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "identified",
    source: "markdown",
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
  };

  const result = runPipeline([e, target1, target2], profile);
  // Stage 3 should see split values → no MSL-A004.
  assertEquals(result.diagnostics.filter((d) => d.code === "MSL-A004"), []);
});
