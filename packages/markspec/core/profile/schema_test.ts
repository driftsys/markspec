import { assertEquals } from "@std/assert";
import {
  ALLOWED_ATTR_KEYS,
  ALLOWED_PROFILE_KEYS,
  ALLOWED_ROOT_KEYS,
  ALLOWED_TRACE_RULE_KEYS,
  ALLOWED_TYPE_KEYS,
} from "./manifest.ts";
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

const PROFILE_SCHEMA_URL = new URL(
  "../../../../schemas/profile/v1.json",
  import.meta.url,
);

async function loadProfileSchema(): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(PROFILE_SCHEMA_URL));
}

function propKeys(node: unknown): Set<string> {
  const props = (node as { properties?: Record<string, unknown> }).properties;
  return new Set(Object.keys(props ?? {}));
}

Deno.test("profile schema: $id is the canonical URL", async () => {
  const schema = await loadProfileSchema();
  assertEquals(
    schema.$id,
    "https://driftsys.github.io/markspec/schemas/profile/v1.json",
  );
});

Deno.test("profile schema: root keys match parser (minus $schema)", async () => {
  const schema = await loadProfileSchema();
  const keys = propKeys(schema);
  keys.delete("$schema");
  assertEquals(
    [...keys].sort(),
    [...ALLOWED_ROOT_KEYS].filter((k) => k !== "$schema").sort(),
  );
});

Deno.test("profile schema: profile-object keys match parser", async () => {
  const schema = await loadProfileSchema();
  const profileNode = (schema.properties as Record<string, unknown>).profile;
  assertEquals(
    [...propKeys(profileNode)].sort(),
    [...ALLOWED_PROFILE_KEYS].sort(),
  );
});

Deno.test("profile schema: type-object keys match parser", async () => {
  const schema = await loadProfileSchema();
  const defs = (schema.$defs ?? {}) as Record<string, unknown>;
  assertEquals([...propKeys(defs.type)].sort(), [...ALLOWED_TYPE_KEYS].sort());
});

Deno.test("profile schema: attribute-object keys match parser", async () => {
  const schema = await loadProfileSchema();
  const defs = (schema.$defs ?? {}) as Record<string, unknown>;
  assertEquals(
    [...propKeys(defs.attribute)].sort(),
    [...ALLOWED_ATTR_KEYS].sort(),
  );
});

Deno.test("profile schema: trace-rule keys match parser", async () => {
  const schema = await loadProfileSchema();
  const defs = (schema.$defs ?? {}) as Record<string, unknown>;
  assertEquals(
    [...propKeys(defs.traceRule)].sort(),
    [...ALLOWED_TRACE_RULE_KEYS].sort(),
  );
});
