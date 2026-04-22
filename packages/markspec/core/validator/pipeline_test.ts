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
    title: "",
    body: "",
    id: opts.id ?? "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape,
    source: "markdown",
    attributes,
    location: { file: "t.md", line: 1, column: 1 },
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
    attributes: [],
    location: { file: "t.md", line: 1, column: 1 },
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
    attributes: [],
    location: { file: "t.md", line: 1, column: 1 },
  };
  const result = runPipeline([entry], profile);
  const codes = new Set(result.diagnostics.map((d) => d.code));
  if (!codes.has("MSL-R003")) throw new Error("expected MSL-R003");
  if (!codes.has("MSL-T003")) throw new Error("expected MSL-T003");
  assertEquals(result.valid, false);
});

Deno.test("runPipeline: profile with zero types runs Stage 2 permissively", () => {
  const origin = "@test/p";
  const profile: EffectiveProfile = {
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
