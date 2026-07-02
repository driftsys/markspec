/**
 * @module lsp/profile_request_test
 *
 * Unit tests for {@linkcode buildProfileResponse} — pure helper that turns a
 * (chain, effective) pair into the wire shape returned by the
 * `markspec/profile` LSP request.
 */

import { assertEquals } from "@std/assert";
import { buildProfileResponse } from "./profile_request.ts";
import type {
  EffectiveProfile,
  EffectiveTypeDef,
  LoadedProfile,
  ProfileChain,
  ProvenancedMapEntry,
  ProvenancedValue,
} from "../core/mod.ts";

/** Provenanced-value helper — origin doesn't matter for the LSP wire shape. */
function pv<T>(value: T): ProvenancedValue<T> {
  return { value, origin: "test" };
}

/** Provenanced-map-entry helper. */
function pe<V>(value: V): ProvenancedMapEntry<V> {
  return { value, origin: "test" };
}

/** Minimal `EffectiveTypeDef` with only the fields the helper reads. */
function fakeTypeDef(opts: {
  name: string;
  displayIdPattern?: string;
  color?: string;
}): EffectiveTypeDef {
  return {
    name: opts.name,
    extends: "requirement",
    displayIdPattern: pv(opts.displayIdPattern),
    displayIdPatternEnforcement: pv("warn"),
    color: pv(opts.color),
    required: pv([]),
    attributes: new Map(),
    traceability: new Map(),
    description: pv(undefined),
    attrDescriptions: new Map(),
    relationDescriptions: new Map(),
    discipline: pv(undefined),
  };
}

/** Minimal `EffectiveProfile` with only the fields the helper reads. */
function fakeEffective(
  types: ReadonlyArray<EffectiveTypeDef>,
  colors: ReadonlyMap<string, string> = new Map(),
): EffectiveProfile {
  const typesMap = new Map<string, ProvenancedMapEntry<EffectiveTypeDef>>();
  for (const t of types) typesMap.set(t.name, pe(t));
  const colorsMap = new Map<string, ProvenancedMapEntry<string>>();
  for (const [k, v] of colors) colorsMap.set(k, pe(v));
  return {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: colorsMap,
    types: typesMap,
    documents: { types: new Map(), frontMatter: new Map() },
    delivers: [],
    kinds: new Map(),
    prose: {
      lexicons: {
        "capitalized-allow": pv([]),
        "sentence-abbrev": pv([]),
      },
    },
    disciplineMode: { value: "none", origin: "inferred" },
  };
}

/** Minimal `LoadedProfile` exposing only the fields the helper reads. */
function fakeLoaded(id: string, sourcePath: string): LoadedProfile {
  return {
    id,
    version: "0.0.0",
    // deno-lint-ignore no-explicit-any
    specifier: { kind: "local", path: sourcePath } as any,
    // deno-lint-ignore no-explicit-any
    manifest: {} as any,
    sourcePath,
    baseDir: sourcePath.replace(/\/[^/]+$/, ""),
  };
}

function fakeChain(
  tiers: ReadonlyArray<LoadedProfile>,
  effective: EffectiveProfile,
): ProfileChain {
  return { tiers, effective };
}

Deno.test("buildProfileResponse: no profile loaded returns empty shape", () => {
  const result = buildProfileResponse(null, undefined);
  assertEquals(result, {
    chain: [],
    effective: { name: "(none)", types: [] },
  });
});

Deno.test("buildProfileResponse: single-tier chain with hue-resolved type", () => {
  const stkType = fakeTypeDef({
    name: "stakeholder-requirement",
    displayIdPattern: "STK_{NNNN}",
    color: "primary",
  });
  const effective = fakeEffective([stkType], new Map([["primary", "blue"]]));
  const chain = fakeChain(
    [fakeLoaded("markspec/default", "/proj/.markspec.yaml")],
    effective,
  );

  const result = buildProfileResponse(chain, effective);

  assertEquals(result.chain, [{
    name: "markspec/default",
    source: "/proj/.markspec.yaml",
  }]);
  assertEquals(result.effective.name, "markspec/default");
  assertEquals(result.effective.types, [{
    name: "stakeholder-requirement",
    prefix: "STK_",
    color: "blue",
  }]);
});

Deno.test("buildProfileResponse: multi-tier chain, child tier's id wins for effective.name", () => {
  const t = fakeTypeDef({
    name: "stakeholder-requirement",
    displayIdPattern: "STK_AEB_{NNNN}",
    color: "primary",
  });
  const effective = fakeEffective([t], new Map([["primary", "orange"]]));
  const chain = fakeChain(
    [
      fakeLoaded("markspec/default", "/proj/.markspec.yaml"),
      fakeLoaded("acme/aeb", "/proj/acme-profile.yaml"),
    ],
    effective,
  );

  const result = buildProfileResponse(chain, effective);

  assertEquals(result.chain.map((l) => l.name), [
    "markspec/default",
    "acme/aeb",
  ]);
  assertEquals(result.effective.name, "acme/aeb");
  assertEquals(result.effective.types[0].prefix, "STK_AEB_");
  assertEquals(result.effective.types[0].color, "orange");
});

Deno.test("buildProfileResponse: type without color declared returns null color", () => {
  const t = fakeTypeDef({
    name: "memo",
    displayIdPattern: "MEMO_{NNNN}",
  });
  const effective = fakeEffective([t]);
  const chain = fakeChain(
    [fakeLoaded("markspec/default", "/proj/.markspec.yaml")],
    effective,
  );

  const result = buildProfileResponse(chain, effective);

  assertEquals(result.effective.types[0].color, null);
});

Deno.test("buildProfileResponse: type with displayIdPattern absent returns empty prefix", () => {
  const t = fakeTypeDef({
    name: "memo",
  });
  const effective = fakeEffective([t]);
  const chain = fakeChain(
    [fakeLoaded("markspec/default", "/proj/.markspec.yaml")],
    effective,
  );

  const result = buildProfileResponse(chain, effective);

  assertEquals(result.effective.types[0].prefix, "");
});

Deno.test("buildProfileResponse: invalid hue value returns null color", () => {
  const t = fakeTypeDef({
    name: "stakeholder-requirement",
    displayIdPattern: "STK_{NNNN}",
    color: "primary",
  });
  const effective = fakeEffective(
    [t],
    new Map([["primary", "not-a-hue"]]),
  );
  const chain = fakeChain(
    [fakeLoaded("markspec/default", "/proj/.markspec.yaml")],
    effective,
  );

  const result = buildProfileResponse(chain, effective);

  assertEquals(result.effective.types[0].color, null);
});
