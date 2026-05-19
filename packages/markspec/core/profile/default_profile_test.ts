/**
 * @module core/profile/default_profile_test
 *
 * The embedded default-profile manifest must parse and merge cleanly as a
 * lone tier — it ships in the binary and a malformed constant would break
 * every project that does not opt out.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  BUILTIN_DEFAULT_SOURCE_PATH,
  DEFAULT_PROFILE_MANIFEST,
} from "./default_profile.ts";
import { parseManifest } from "./manifest.ts";
import { loadChain } from "./chain.ts";
import { BUILTIN_DEFAULT_SPECIFIER } from "./default_profile.ts";

Deno.test("default profile manifest parses with zero error diagnostics", () => {
  const result = parseManifest(
    DEFAULT_PROFILE_MANIFEST,
    BUILTIN_DEFAULT_SOURCE_PATH,
  );
  assertExists(result.manifest);
  assertEquals(result.manifest.id, "@markspec/profile-default");
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  assertEquals(errors, []);
  const schemaMiss = result.diagnostics.filter((d) =>
    d.code === "PROFILE-SCHEMA-002"
  );
  assertEquals(schemaMiss, []);
});

Deno.test("builtin specifier resolves to a lone one-tier chain", async () => {
  const readFile = (): Promise<string | undefined> =>
    Promise.resolve(undefined);
  const result = await loadChain(
    BUILTIN_DEFAULT_SPECIFIER,
    "/project",
    "/project",
    readFile,
    { bundledDefault: true },
  );
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  assertExists(result.chain);
  assertEquals(result.chain.tiers.length, 1);
  assertEquals(result.chain.tiers[0].id, "@markspec/profile-default");
});
