import { assertEquals } from "@std/assert";
import { ALLOWED_MARKSPEC_YAML_KEYS, parseMarkspecYaml } from "./markspec.ts";

const MARKSPEC_SCHEMA_URL = new URL(
  "../../../../schemas/markspec/v1.json",
  import.meta.url,
);

async function loadMarkspecSchema(): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(MARKSPEC_SCHEMA_URL));
}

Deno.test("markspec.yaml: $schema key emits no unknown-key warning", () => {
  const yaml = [
    "$schema: https://driftsys.github.io/markspec/schemas/markspec/v1.json",
    "profiles:",
    "  - io.example.demo@1.0.0",
  ].join("\n");
  const { diagnostics } = parseMarkspecYaml(yaml, ".markspec.yaml");
  assertEquals(diagnostics.filter((d) => d.code === "MARKSPEC-YAML-001"), []);
});

Deno.test("markspec schema: $id is the canonical URL", async () => {
  const schema = await loadMarkspecSchema();
  assertEquals(
    schema.$id,
    "https://driftsys.github.io/markspec/schemas/markspec/v1.json",
  );
});

Deno.test("markspec schema: keys match parser (minus $schema)", async () => {
  const schema = await loadMarkspecSchema();
  const keys = new Set(
    Object.keys((schema.properties ?? {}) as Record<string, unknown>),
  );
  keys.delete("$schema");
  assertEquals(
    [...keys].sort(),
    [...ALLOWED_MARKSPEC_YAML_KEYS].filter((k) => k !== "$schema").sort(),
  );
});
