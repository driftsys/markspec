/**
 * Tests for resolveEntryColor — the five rows of the resolution table
 * in docs/superpowers/specs/2026-05-06-profile-driven-entry-colors-design.md.
 */

import { assertEquals } from "@std/assert";
import { resolveEntryColor } from "./colors.ts";
import type { EffectiveProfile, Entry } from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";

function makeIdentifiedEntry(type: string | undefined): Entry {
  return {
    shape: "Authored",
    displayId: makeDisplayId("TST_AAA_0001"),
    title: "t",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    id: "TST_00000000000000000000000001",
    type,
    source: { kind: "markdown" } as const,
    location: { file: "f.md", line: 1, column: 1 },
    bodyTokens: [],
  } as Entry;
}

function makeReferencedEntry(type: string | undefined): Entry {
  return { ...makeIdentifiedEntry(type), shape: "Reference" } as Entry;
}

function makeProfile(
  colors: Record<string, string>,
  typeColors: Record<string, string | undefined>,
): EffectiveProfile {
  const colorsMap = new Map(
    Object.entries(colors).map(([k, v]) => [k, {
      value: v,
      origin: "test",
    }]),
  );
  const typesMap = new Map(
    Object.entries(typeColors).map(([name, color]) => [name, {
      value: {
        name,
        extends: "Item",
        displayIdPattern: { value: undefined, origin: "test" },
        displayIdPatternEnforcement: { value: "off" as const, origin: "test" },
        color: { value: color, origin: "test" },
        required: { value: [], origin: "test" },
        attributes: new Map(),
        traceability: new Map(),
        description: { value: undefined, origin: "test" },
        attrDescriptions: new Map(),
        relationDescriptions: new Map(),
      },
      origin: "test",
    }]),
  );
  return {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: colorsMap,
    types: typesMap,
    documents: { types: new Map(), frontMatter: new Map() },
    prose: {
      lexicons: {
        "capitalized-allow": { value: [], origin: "" },
        "sentence-abbrev": { value: [], origin: "" },
      },
    },
  } as EffectiveProfile;
}

Deno.test("resolveEntryColor: referenced shape returns null regardless of profile/type", () => {
  const profile = makeProfile({ primary: "blue" }, { ref: "primary" });
  assertEquals(resolveEntryColor(makeReferencedEntry("ref"), profile), null);
  assertEquals(
    resolveEntryColor(makeReferencedEntry(undefined), profile),
    null,
  );
  assertEquals(resolveEntryColor(makeReferencedEntry("ref"), undefined), null);
});

Deno.test("resolveEntryColor: identified + profile + known type with color resolves the hue", () => {
  const profile = makeProfile(
    { primary: "blue", danger: "red" },
    { req: "primary", test: "danger" },
  );
  assertEquals(resolveEntryColor(makeIdentifiedEntry("req"), profile), "blue");
  assertEquals(resolveEntryColor(makeIdentifiedEntry("test"), profile), "red");
});

Deno.test("resolveEntryColor: identified + profile + type without color falls back to blue", () => {
  const profile = makeProfile(
    { primary: "blue" },
    { req: undefined },
  );
  assertEquals(resolveEntryColor(makeIdentifiedEntry("req"), profile), "blue");
});

Deno.test("resolveEntryColor: identified + profile + unknown type falls back to blue", () => {
  const profile = makeProfile({ primary: "blue" }, {});
  assertEquals(
    resolveEntryColor(makeIdentifiedEntry("nonexistent"), profile),
    "blue",
  );
});

Deno.test("resolveEntryColor: identified + no profile falls back to blue", () => {
  assertEquals(
    resolveEntryColor(makeIdentifiedEntry("anything"), undefined),
    "blue",
  );
  assertEquals(
    resolveEntryColor(makeIdentifiedEntry(undefined), undefined),
    "blue",
  );
});

Deno.test("resolveEntryColor: type's color name not in colors map falls back to blue", () => {
  // The type was authored with color: 'unknown', merge would have already
  // emitted MSL-PROFILE-COLOR-003 — the renderer must still produce something.
  const profile = makeProfile(
    { primary: "blue" },
    { req: "unknown" },
  );
  assertEquals(resolveEntryColor(makeIdentifiedEntry("req"), profile), "blue");
});

// ── Integration: parseManifest → mergeChain → resolveEntryColor ──────────
// (issue #260 — guards against drift between manifest validator and renderer)

import { parseManifest } from "./manifest.ts";
import { mergeChain } from "./merge.ts";
import type { LoadedProfile, ProfileChain } from "../model/mod.ts";

function loadEffective(yaml: string): EffectiveProfile {
  const parsed = parseManifest(yaml, "test.yaml");
  if (!parsed.manifest) {
    throw new Error(
      `parseManifest failed: ${
        parsed.diagnostics.map((d) => d.code).join(", ")
      }`,
    );
  }
  const tier: LoadedProfile = {
    id: parsed.manifest.id,
    version: parsed.manifest.version,
    specifier: { kind: "local", path: "." },
    manifest: parsed.manifest,
    sourcePath: "test.yaml",
    baseDir: ".",
  };
  // mergeChain reads only .tiers; effective is filled by mergeChain itself.
  const chain = { tiers: [tier] } as unknown as ProfileChain;
  const merged = mergeChain(chain);
  if (!merged.effective) {
    throw new Error(
      `mergeChain failed: ${merged.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }
  return merged.effective;
}

Deno.test("integration: end-to-end manifest → merge → resolve picks the declared hue", () => {
  const yaml = `
id: "@acme/profile"
version: 1.0.0
profile:
  colors:
    primary: blue
    danger: red
  attributes: []
  labels: []
  types:
    requirement:
      extends: Requirement
      color: primary
    test:
      extends: Test
      color: danger
  documents: { types: [], frontMatter: [] }
`;
  const profile = loadEffective(yaml);

  assertEquals(
    resolveEntryColor(makeIdentifiedEntry("requirement"), profile),
    "blue",
  );
  assertEquals(
    resolveEntryColor(makeIdentifiedEntry("test"), profile),
    "red",
  );
});

Deno.test("integration: manifest with type.color absent → renderer falls back to blue", () => {
  const yaml = `
id: "@acme/profile"
version: 1.0.0
profile:
  colors:
    primary: teal
  attributes: []
  labels: []
  types:
    requirement:
      extends: Requirement
  documents: { types: [], frontMatter: [] }
`;
  const profile = loadEffective(yaml);

  // type exists but color is unset — fallback to palette blue, NOT to
  // any declared role like 'primary' (decoupling renderer from profile
  // vocabulary, per the design spec's resolution table).
  assertEquals(
    resolveEntryColor(makeIdentifiedEntry("requirement"), profile),
    "blue",
  );
});

Deno.test("integration: referenced-shape entry stays uncolored even with type color declared", () => {
  // A Reference-shape entry returns null regardless of what color the
  // type declares — the renderer gates on entry.shape, not the profile.
  const yaml = `
id: "@acme/profile"
version: 1.0.0
profile:
  colors:
    primary: blue
  attributes: []
  labels: []
  types:
    standard:
      extends: Specification
      color: primary
  documents: { types: [], frontMatter: [] }
`;
  const profile = loadEffective(yaml);

  assertEquals(
    resolveEntryColor(makeReferencedEntry("standard"), profile),
    null,
  );
});
