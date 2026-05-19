/**
 * End-to-end validation of the aspice-swe-mini strawman profile.
 *
 * Loads the strawman through the full chain → merge → classify → validate
 * pipeline to exercise every profile schema section against a real profile.
 */

import { assertEquals, assertExists } from "@std/assert";
import { loadChain } from "./chain.ts";
import type { ProfileChain, ProfileSpecifier } from "../model/mod.ts";
import { resolve } from "@std/path";

const readFile = async (path: string): Promise<string | undefined> => {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
};

/** Absolute path to the examples/profiles directory. */
const PROFILES_DIR = resolve(
  new URL(".", import.meta.url).pathname,
  "../../../../docs/examples/profiles",
);

/**
 * The strawman declares no `extends:`. The bundled default profile is
 * auto-spliced as the implicit root when `bundledDefault: true`, exactly
 * as `loadProfileForCommand` does for real projects.
 */
async function loadStrawmanChain(): Promise<{
  chain: ProfileChain | null;
  diagnostics: readonly { severity: string; code: string; message: string }[];
}> {
  const specifier: ProfileSpecifier = {
    kind: "local",
    path: "./aspice-swe-mini",
  };
  return await loadChain(specifier, PROFILES_DIR, PROFILES_DIR, readFile, {
    bundledDefault: true,
  });
}

Deno.test("strawman: chain resolves with 2 tiers", async () => {
  const result = await loadStrawmanChain();
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
    `unexpected errors: ${JSON.stringify(result.diagnostics)}`,
  );
  assertExists(result.chain);
  assertEquals(result.chain.tiers.length, 2);
  assertEquals(result.chain.tiers[0].id, "@markspec/profile-default");
  assertEquals(result.chain.tiers[1].id, "@markspec/profile-aspice-swe-mini");
});

Deno.test("strawman: effective profile has all 7 types", async () => {
  const result = await loadStrawmanChain();
  assertExists(result.chain);
  const types = result.chain.effective.types;
  const typeNames = [...types.keys()].sort();
  assertEquals(typeNames, [
    "integration-test",
    "software-element",
    "software-requirement",
    "stakeholder-requirement",
    "standard",
    "unit",
    "unit-test",
  ]);
});

Deno.test("strawman: effective profile has ASIL labels", async () => {
  const result = await loadStrawmanChain();
  assertExists(result.chain);
  const labelKeys = [...result.chain.effective.labels.keys()];
  const asilLabels = labelKeys.filter((l) =>
    l === "QM" || l.startsWith("ASIL-")
  );
  assertEquals(asilLabels.length, 5); // QM, ASIL-A, ASIL-B, ASIL-C, ASIL-D
});

Deno.test("strawman: software-requirement has Derived-from traceability rule", async () => {
  const result = await loadStrawmanChain();
  assertExists(result.chain);
  const srs = result.chain.effective.types.get("software-requirement");
  assertExists(srs);
  const derivedFrom = srs.value.traceability.get("Derived-from");
  assertExists(derivedFrom);
  assertEquals(derivedFrom.value.required, true);
});

Deno.test("strawman: standard type extends Specification", async () => {
  const result = await loadStrawmanChain();
  assertExists(result.chain);
  const standard = result.chain.effective.types.get("standard");
  assertExists(standard);
  assertEquals(standard.value.extends, "Specification");
});

Deno.test("strawman: per-type color resolves through merged colors map", async () => {
  const result = await loadStrawmanChain();
  assertExists(result.chain);
  const types = result.chain.effective.types;
  const colors = result.chain.effective.colors;

  // The colour-role → hue values (primary=blue, …) originate from the
  // bundled default profile (the root tier). These lines confirm the
  // merge pipeline propagates them into the effective colours map. The
  // per-type `color.value` assertions below are the meaningful cross-tier
  // checks: the role name comes from the strawman, its hue from the default.

  // Default profile colors are inherited.
  assertEquals(colors.get("primary")?.value, "blue");
  assertEquals(colors.get("secondary")?.value, "teal");
  assertEquals(colors.get("danger")?.value, "red");

  // Strawman types pick roles.
  const stk = types.get("stakeholder-requirement");
  assertExists(stk);
  assertEquals(stk.value.color.value, "primary");

  const swe = types.get("software-element");
  assertExists(swe);
  assertEquals(swe.value.color.value, "secondary");

  const swt = types.get("unit-test");
  assertExists(swt);
  assertEquals(swt.value.color.value, "danger");

  // Referenced type carries no color.
  const standard = types.get("standard");
  assertExists(standard);
  assertEquals(standard.value.color.value, undefined);
});
