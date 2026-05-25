/**
 * @module core/validator/type_resolution_test
 *
 * Unit tests for {@linkcode explicitType} and {@linkcode resolvedCoreType}.
 * These focus on edge cases (empty values, whitespace) that are hard to
 * exercise via the e2e validator suite because the parser drops
 * malformed trailer lines upstream.
 */

import { assertEquals } from "@std/assert";
import {
  explicitType,
  inferTypeFromDisplayIdPrefix,
  resolvedCoreType,
  resolvedCoreTypeWithProvenance,
} from "./type_resolution.ts";
import type {
  EffectiveProfile,
  EffectiveTypeDef,
  Entry,
  ProvenancedMapEntry,
} from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";

const ULID = "01HGW2Q8MNP3RSTVWXYZABCDEF";

function makeEntry(opts: {
  attrs: Array<{ key: string; value: string }>;
  type?: string;
  shape?: "Authored" | "Reference";
  id?: string;
}): Entry {
  return {
    displayId: makeDisplayId("TEST-001"),
    title: "Test entry",
    body: "Body.",
    rawAttributes: opts.attrs,
    typedAttributes: new Map(),
    id: opts.id ?? ULID,
    type: opts.type,
    shape: opts.shape ?? "Authored",
    location: { file: "test.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
  };
}

Deno.test("explicitType: returns the trimmed value for a non-empty Type:", () => {
  const entry = makeEntry({
    attrs: [
      { key: "Id", value: ULID },
      { key: "Type", value: "  Requirement  " },
    ],
  });
  assertEquals(explicitType(entry), "Requirement");
});

Deno.test("explicitType: returns undefined when Type: attribute is absent", () => {
  const entry = makeEntry({ attrs: [{ key: "Id", value: ULID }] });
  assertEquals(explicitType(entry), undefined);
});

Deno.test("explicitType: returns undefined for an empty Type: value", () => {
  const entry = makeEntry({
    attrs: [
      { key: "Id", value: ULID },
      { key: "Type", value: "" },
    ],
  });
  assertEquals(explicitType(entry), undefined);
});

Deno.test("explicitType: returns undefined for a whitespace-only Type: value", () => {
  const entry = makeEntry({
    attrs: [
      { key: "Id", value: ULID },
      { key: "Type", value: "   " },
    ],
  });
  assertEquals(explicitType(entry), undefined);
});

Deno.test("resolvedCoreType: prefers explicit Type: when valid", () => {
  const entry = makeEntry({
    attrs: [
      { key: "Id", value: ULID },
      { key: "Type", value: "Requirement" },
    ],
    type: "SoftwareUnit",
  });
  assertEquals(resolvedCoreType(entry), "Requirement");
});

Deno.test("resolvedCoreType: falls back to entry.type when explicit Type absent", () => {
  const entry = makeEntry({
    attrs: [{ key: "Id", value: ULID }],
    type: "SoftwareUnit",
  });
  assertEquals(resolvedCoreType(entry), "SoftwareUnit");
});

Deno.test("resolvedCoreType: infers from URI scheme for Reference shape with no explicit Type", () => {
  const entry = makeEntry({
    attrs: [{ key: "Id", value: "pkg:cargo/serde@1.0.0" }],
    shape: "Reference",
    id: "pkg:cargo/serde@1.0.0",
  });
  assertEquals(resolvedCoreType(entry), "SoftwareComponent");
});

Deno.test("resolvedCoreType: returns undefined when no source resolves to a core type", () => {
  const entry = makeEntry({
    attrs: [{ key: "Id", value: ULID }],
  });
  assertEquals(resolvedCoreType(entry), undefined);
});

// ---------------------------------------------------------------------------
// inferTypeFromDisplayIdPrefix (spec §1.3.1 step 4)
// ---------------------------------------------------------------------------

Deno.test("inferTypeFromDisplayIdPrefix: REQ-001 → Requirement", () => {
  assertEquals(inferTypeFromDisplayIdPrefix("REQ-001"), "Requirement");
});

Deno.test("inferTypeFromDisplayIdPrefix: TST_AEB_0001 → Test", () => {
  assertEquals(inferTypeFromDisplayIdPrefix("TST_AEB_0001"), "Test");
});

Deno.test("inferTypeFromDisplayIdPrefix: ICD-OpenAPI-1 → Contract", () => {
  assertEquals(inferTypeFromDisplayIdPrefix("ICD-OpenAPI-1"), "Contract");
});

Deno.test("inferTypeFromDisplayIdPrefix: REC_ADR_001 → Record", () => {
  assertEquals(inferTypeFromDisplayIdPrefix("REC_ADR_001"), "Record");
});

Deno.test("inferTypeFromDisplayIdPrefix: RSK-Hazard-001 → Risk", () => {
  assertEquals(inferTypeFromDisplayIdPrefix("RSK-Hazard-001"), "Risk");
});

Deno.test("inferTypeFromDisplayIdPrefix: requires - or _ separator", () => {
  // `REQ` alone or `REQ001` (no separator) doesn't qualify — these
  // are ambiguous IDs that shouldn't auto-infer.
  assertEquals(inferTypeFromDisplayIdPrefix("REQ"), undefined);
  assertEquals(inferTypeFromDisplayIdPrefix("REQ001"), undefined);
});

Deno.test("inferTypeFromDisplayIdPrefix: case-sensitive", () => {
  assertEquals(inferTypeFromDisplayIdPrefix("req-001"), undefined);
  assertEquals(inferTypeFromDisplayIdPrefix("Req-001"), undefined);
});

Deno.test("inferTypeFromDisplayIdPrefix: unrelated prefix → undefined", () => {
  assertEquals(inferTypeFromDisplayIdPrefix("SAD-001"), undefined);
  assertEquals(inferTypeFromDisplayIdPrefix("braking::sensor"), undefined);
});

Deno.test("resolvedCoreType: step 4 falls back to prefix when no explicit Type and no profile classification", () => {
  const entry = makeEntry({
    attrs: [{ key: "Id", value: ULID }],
  });
  // makeEntry produces displayId "TEST-001" which doesn't match a
  // prefix — verify undefined.
  assertEquals(resolvedCoreType(entry), undefined);

  const reqEntry = {
    ...entry,
    displayId: makeDisplayId("REQ-001"),
  };
  assertEquals(resolvedCoreType(reqEntry), "Requirement");
});

// ---------------------------------------------------------------------------
// resolvedCoreTypeWithProvenance — tracks which step matched (spec §1.3.1)
// ---------------------------------------------------------------------------

Deno.test("resolvedCoreTypeWithProvenance: step 1 — explicit Type:", () => {
  const entry = makeEntry({
    attrs: [
      { key: "Id", value: ULID },
      { key: "Type", value: "Requirement" },
    ],
  });
  assertEquals(
    resolvedCoreTypeWithProvenance(entry),
    { type: "Requirement", step: 1 },
  );
});

Deno.test("resolvedCoreTypeWithProvenance: step 2 — profile-classified entry.type", () => {
  const entry = makeEntry({
    attrs: [{ key: "Id", value: ULID }],
    type: "SoftwareUnit",
  });
  assertEquals(
    resolvedCoreTypeWithProvenance(entry),
    { type: "SoftwareUnit", step: 2 },
  );
});

Deno.test("resolvedCoreTypeWithProvenance: step 3 — Source: introspection", () => {
  const entry = makeEntry({
    attrs: [
      { key: "Id", value: ULID },
      { key: "Source", value: "crates/foo/Cargo.toml" },
    ],
  });
  assertEquals(
    resolvedCoreTypeWithProvenance(entry),
    { type: "SoftwareComponent", step: 3 },
  );
});

Deno.test("resolvedCoreTypeWithProvenance: step 4 — display-ID prefix", () => {
  const entry = {
    ...makeEntry({ attrs: [{ key: "Id", value: ULID }] }),
    displayId: makeDisplayId("REQ-001"),
  };
  assertEquals(
    resolvedCoreTypeWithProvenance(entry),
    { type: "Requirement", step: 4 },
  );
});

Deno.test("resolvedCoreTypeWithProvenance: step 5 — URI scheme", () => {
  const entry = makeEntry({
    attrs: [{ key: "Id", value: "pkg:cargo/serde@1.0.0" }],
    shape: "Reference",
    id: "pkg:cargo/serde@1.0.0",
  });
  assertEquals(
    resolvedCoreTypeWithProvenance(entry),
    { type: "SoftwareComponent", step: 5 },
  );
});

Deno.test("resolvedCoreTypeWithProvenance: step 6 — discriminating attribute", () => {
  const entry = makeEntry({
    attrs: [
      { key: "Id", value: ULID },
      { key: "Verifies", value: "01HGW2Q8MNP3RSTVWXYZABCDEG" },
    ],
  });
  assertEquals(
    resolvedCoreTypeWithProvenance(entry),
    { type: "Test", step: 6 },
  );
});

Deno.test("resolvedCoreTypeWithProvenance: undefined when nothing resolves", () => {
  const entry = makeEntry({
    attrs: [{ key: "Id", value: ULID }],
  });
  assertEquals(resolvedCoreTypeWithProvenance(entry), undefined);
});

Deno.test("resolvedCoreTypeWithProvenance: earliest step wins (explicit Type beats discriminator)", () => {
  const entry = makeEntry({
    attrs: [
      { key: "Id", value: ULID },
      { key: "Type", value: "Requirement" },
      { key: "Verifies", value: "01HGW2Q8MNP3RSTVWXYZABCDEG" },
    ],
  });
  assertEquals(
    resolvedCoreTypeWithProvenance(entry),
    { type: "Requirement", step: 1 },
  );
});

Deno.test("resolvedCoreType: profile type resolves to its core parent via extends", () => {
  const origin = "@test/p";
  const sysReq: ProvenancedMapEntry<EffectiveTypeDef> = {
    value: {
      name: "system-requirement",
      extends: "Requirement",
      displayIdPattern: { value: "FREQ-{n:04d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
      color: { value: undefined, origin },
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map(),
      description: { value: undefined, origin },
      attrDescriptions: new Map(),
      relationDescriptions: new Map(),
    },
    origin,
  };
  const profile: EffectiveProfile = {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map([["system-requirement", sysReq]]),
    documents: { types: new Map(), frontMatter: new Map() },
    prose: {
      lexicons: {
        "capitalized-allow": { value: [], origin: "" },
        "sentence-abbrev": { value: [], origin: "" },
      },
    },
  };

  // Step 1 — explicit `Type:` naming a profile type.
  const explicit = makeEntry({
    attrs: [{ key: "Type", value: "system-requirement" }],
  });
  assertEquals(resolvedCoreType(explicit), undefined); // no profile: unresolvable
  assertEquals(resolvedCoreType(explicit, profile), "Requirement");
  assertEquals(
    resolvedCoreTypeWithProvenance(explicit, profile),
    { type: "Requirement", step: 1 },
  );

  // Step 2 — profile-classified entry.type.
  const classified = makeEntry({ attrs: [], type: "system-requirement" });
  assertEquals(resolvedCoreType(classified), undefined);
  assertEquals(resolvedCoreType(classified, profile), "Requirement");
  assertEquals(
    resolvedCoreTypeWithProvenance(classified, profile),
    { type: "Requirement", step: 2 },
  );

  // An unknown profile type (not in the profile) stays unresolved.
  const unknown = makeEntry({ attrs: [], type: "mystery-type" });
  assertEquals(resolvedCoreType(unknown, profile), undefined);
});
