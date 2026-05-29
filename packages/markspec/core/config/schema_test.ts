import { assertEquals } from "@std/assert";
import { parseMarkspecYaml } from "./markspec.ts";

Deno.test("markspec.yaml: $schema key emits no unknown-key warning", () => {
  const yaml = [
    "$schema: https://driftsys.github.io/markspec/schemas/markspec/v1.json",
    "profiles:",
    "  - io.example.demo@1.0.0",
  ].join("\n");
  const { diagnostics } = parseMarkspecYaml(yaml, ".markspec.yaml");
  assertEquals(diagnostics.filter((d) => d.code === "MARKSPEC-YAML-001"), []);
});
