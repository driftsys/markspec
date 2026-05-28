/**
 * @module core/profile/trace_targets_test
 */

import { assertEquals } from "@std/assert";
import {
  entryMatchesTargets,
  filterEntriesByTraceTargets,
  targetsForRelation,
} from "./trace_targets.ts";
import type {
  EffectiveProfile,
  EffectiveTypeDef,
  Entry,
  ProvenancedMapEntry,
  TargetMatcher,
  TraceRule,
} from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";

const ORIGIN = "@test/p";

function makeTypeDef(
  name: string,
  extendsType: string,
  rules: Record<string, TargetMatcher[]> = {},
): ProvenancedMapEntry<EffectiveTypeDef> {
  const traceability = new Map<string, ProvenancedMapEntry<TraceRule>>();
  for (const [relation, target] of Object.entries(rules)) {
    traceability.set(relation, {
      value: { target, required: false },
      origin: ORIGIN,
    });
  }
  return {
    value: {
      name,
      extends: extendsType,
      displayIdPattern: { value: undefined, origin: ORIGIN },
      displayIdPatternEnforcement: { value: "off", origin: ORIGIN },
      color: { value: undefined, origin: ORIGIN },
      required: { value: [], origin: ORIGIN },
      attributes: new Map(),
      traceability,
      description: { value: undefined, origin: ORIGIN },
      attrDescriptions: new Map(),
      relationDescriptions: new Map(),
      discipline: { value: undefined, origin: ORIGIN },
    },
    origin: ORIGIN,
  };
}

function makeProfile(
  types: Record<string, ProvenancedMapEntry<EffectiveTypeDef>>,
): EffectiveProfile {
  return {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map(Object.entries(types)),
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

function makeEntry(opts: {
  id?: string;
  type?: string;
  shape?: "Authored" | "Reference";
}): Entry {
  return {
    displayId: makeDisplayId(opts.id ?? "TEST-001"),
    title: "Test entry",
    body: "Body.",
    rawAttributes: [],
    typedAttributes: new Map(),
    type: opts.type,
    shape: opts.shape ?? "Authored",
    location: { file: "test.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
  };
}

// ---------------------------------------------------------------------------
// targetsForRelation
// ---------------------------------------------------------------------------

Deno.test("targetsForRelation: undefined when sourceType is undefined", () => {
  const profile = makeProfile({});
  assertEquals(targetsForRelation(profile, undefined, "Satisfies"), undefined);
});

Deno.test("targetsForRelation: undefined when type not in profile", () => {
  const profile = makeProfile({});
  assertEquals(
    targetsForRelation(profile, "software-requirement", "Satisfies"),
    undefined,
  );
});

Deno.test("targetsForRelation: undefined when type has no rule for that relation", () => {
  const profile = makeProfile({
    "software-requirement": makeTypeDef("software-requirement", "Requirement"),
  });
  assertEquals(
    targetsForRelation(profile, "software-requirement", "Satisfies"),
    undefined,
  );
});

Deno.test("targetsForRelation: returns the target list when rule exists", () => {
  const profile = makeProfile({
    "software-requirement": makeTypeDef(
      "software-requirement",
      "Requirement",
      { "Satisfies": ["system-requirement"] },
    ),
  });
  assertEquals(
    targetsForRelation(profile, "software-requirement", "Satisfies"),
    ["system-requirement"],
  );
});

// ---------------------------------------------------------------------------
// entryMatchesTargets
// ---------------------------------------------------------------------------

Deno.test("entryMatchesTargets: exact type match", () => {
  const profile = makeProfile({
    "system-requirement": makeTypeDef("system-requirement", "Requirement"),
  });
  const entry = makeEntry({ type: "system-requirement" });
  assertEquals(
    entryMatchesTargets(entry, ["system-requirement"], profile),
    true,
  );
});

Deno.test("entryMatchesTargets: matches via extends chain", () => {
  // A "safety-system-requirement" that extends "system-requirement" should
  // match a target of "system-requirement" via the extends transitively.
  const profile = makeProfile({
    "system-requirement": makeTypeDef("system-requirement", "Requirement"),
    "safety-system-requirement": makeTypeDef(
      "safety-system-requirement",
      "system-requirement",
    ),
  });
  const entry = makeEntry({ type: "safety-system-requirement" });
  assertEquals(
    entryMatchesTargets(entry, ["system-requirement"], profile),
    true,
  );
});

Deno.test("entryMatchesTargets: shape matcher (Authored) hits Authored entry", () => {
  const profile = makeProfile({});
  const entry = makeEntry({ shape: "Authored" });
  assertEquals(
    entryMatchesTargets(entry, [{ shape: "Authored" }], profile),
    true,
  );
});

Deno.test("entryMatchesTargets: shape matcher (Reference) misses Authored entry", () => {
  const profile = makeProfile({});
  const entry = makeEntry({ shape: "Authored" });
  assertEquals(
    entryMatchesTargets(entry, [{ shape: "Reference" }], profile),
    false,
  );
});

Deno.test("entryMatchesTargets: untyped entry never matches a string target", () => {
  const profile = makeProfile({
    "system-requirement": makeTypeDef("system-requirement", "Requirement"),
  });
  const entry = makeEntry({ type: undefined });
  assertEquals(
    entryMatchesTargets(entry, ["system-requirement"], profile),
    false,
  );
});

Deno.test("entryMatchesTargets: untyped entry still matches a shape target", () => {
  const profile = makeProfile({});
  const entry = makeEntry({ type: undefined, shape: "Reference" });
  assertEquals(
    entryMatchesTargets(entry, [{ shape: "Reference" }], profile),
    true,
  );
});

Deno.test("entryMatchesTargets: union of targets — matches any one", () => {
  const profile = makeProfile({
    "system-requirement": makeTypeDef("system-requirement", "Requirement"),
    "stakeholder-requirement": makeTypeDef(
      "stakeholder-requirement",
      "Requirement",
    ),
  });
  const entry = makeEntry({ type: "stakeholder-requirement" });
  assertEquals(
    entryMatchesTargets(
      entry,
      ["system-requirement", "stakeholder-requirement"],
      profile,
    ),
    true,
  );
});

Deno.test("entryMatchesTargets: no matcher matches", () => {
  const profile = makeProfile({
    "system-requirement": makeTypeDef("system-requirement", "Requirement"),
    "test": makeTypeDef("test", "Test"),
  });
  const entry = makeEntry({ type: "test" });
  assertEquals(
    entryMatchesTargets(entry, ["system-requirement"], profile),
    false,
  );
});

// ---------------------------------------------------------------------------
// filterEntriesByTraceTargets
// ---------------------------------------------------------------------------

Deno.test("filterEntriesByTraceTargets: preserves order, keeps only matches", () => {
  const profile = makeProfile({
    "system-requirement": makeTypeDef("system-requirement", "Requirement"),
    "test": makeTypeDef("test", "Test"),
  });
  const entries = [
    makeEntry({ id: "SYS-001", type: "system-requirement" }),
    makeEntry({ id: "TST-001", type: "test" }),
    makeEntry({ id: "SYS-002", type: "system-requirement" }),
    makeEntry({ id: "FREE-001", type: undefined }),
  ];
  const filtered = filterEntriesByTraceTargets(
    entries,
    ["system-requirement"],
    profile,
  );
  assertEquals(filtered.length, 2);
  assertEquals(filtered[0].displayId, "SYS-001");
  assertEquals(filtered[1].displayId, "SYS-002");
});
