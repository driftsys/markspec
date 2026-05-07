/**
 * Tests for resolveEntryColor — the five rows of the resolution table
 * in docs/superpowers/specs/2026-05-06-profile-driven-entry-colors-design.md.
 */

import { assertEquals } from "@std/assert";
import { resolveEntryColor } from "./colors.ts";
import type { EffectiveProfile, Entry } from "../../core/mod.ts";

function makeIdentifiedEntry(type: string | undefined): Entry {
  return {
    shape: "identified",
    displayId: "TST_AAA_0001",
    title: "t",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    id: "TST_00000000000000000000000001",
    type,
    source: "markdown" as const,
    location: { file: "f.md", line: 1, column: 1 },
  } as Entry;
}

function makeReferencedEntry(type: string | undefined): Entry {
  return { ...makeIdentifiedEntry(type), shape: "referenced" } as Entry;
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
        shape: "identified" as const,
        displayIdPattern: { value: undefined, origin: "test" },
        displayIdPatternEnforcement: { value: "off" as const, origin: "test" },
        color: { value: color, origin: "test" },
        required: { value: [], origin: "test" },
        attributes: new Map(),
        traceability: new Map(),
      },
      origin: "test",
    }]),
  );
  return {
    required: { value: [], origin: "test" },
    attributes: new Map(),
    labels: { value: [], origin: "test" },
    colors: colorsMap,
    identified: {
      required: { value: [], origin: "test" },
      attributes: new Map(),
      traceability: new Map(),
    },
    referenced: {
      required: { value: [], origin: "test" },
      attributes: new Map(),
      traceability: new Map(),
    },
    types: typesMap,
    documents: { types: new Map(), frontMatter: new Map() },
  } as EffectiveProfile;
}

Deno.test("resolveEntryColor: referenced shape returns null regardless of profile/type", () => {
  const profile = makeProfile({ primary: "blue" }, { ref: "primary" });
  assertEquals(resolveEntryColor(makeReferencedEntry("ref"), profile), null);
  assertEquals(resolveEntryColor(makeReferencedEntry(undefined), profile), null);
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
