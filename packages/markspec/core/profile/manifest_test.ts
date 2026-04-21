/**
 * @module core/profile/manifest_test
 *
 * Unit tests for markspec.yaml manifest parsing.
 */

import { assertEquals } from "@std/assert";
import { parseManifest } from "./manifest.ts";

Deno.test("parseManifest: minimal valid manifest", () => {
  const yaml = `
id: "@acme/profile-minimal"
version: 0.1.0
`;
  const result = parseManifest(yaml);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.manifest?.id, "@acme/profile-minimal");
  assertEquals(result.manifest?.version, "0.1.0");
  assertEquals(result.manifest?.types.size, 0);
  assertEquals(result.manifest?.universalAttributes.length, 0);
});
