import { assertEquals } from "@std/assert";
import { parseManifest } from "./manifest.ts";

Deno.test("manifest: a $schema root key is accepted (no PROFILE-LOAD-003)", () => {
  const yaml = [
    "$schema: https://driftsys.github.io/markspec/schemas/profile/v1.json",
    "id: io.example.demo",
    "version: 1.0.0",
    'markspec-schema: "1"',
  ].join("\n");
  const { manifest, diagnostics } = parseManifest(yaml, "markspec.yaml");
  assertEquals(diagnostics.filter((d) => d.severity === "error"), []);
  assertEquals(manifest?.id, "io.example.demo");
});
