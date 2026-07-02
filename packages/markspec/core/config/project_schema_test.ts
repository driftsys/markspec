import { assertEquals } from "@std/assert";

const PROJECT_SCHEMA_URL = new URL(
  "../../../../schemas/project/v1.json",
  import.meta.url,
);

async function loadProjectSchema(): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(PROJECT_SCHEMA_URL));
}

Deno.test("project schema: $id is the canonical URL", async () => {
  const schema = await loadProjectSchema();
  assertEquals(
    schema.$id,
    "https://driftsys.github.io/markspec/schemas/project/v1.json",
  );
});

Deno.test("project schema: requires name and documents known keys", async () => {
  const schema = await loadProjectSchema();
  const props = new Set(
    Object.keys((schema.properties ?? {}) as Record<string, unknown>),
  );
  // `name` is the only field parseProjectConfig requires.
  assertEquals(schema.required, ["name"]);
  // Every key the parser recognises plus the scaffolder/manifest metadata
  // fields must be documented so editors offer them.
  for (
    const key of [
      "$schema",
      "name",
      "version",
      "description",
      "repository",
      "license",
      "category",
      "labels",
      "parents",
      "parent-fallback",
      "caption-conventions",
    ]
  ) {
    assertEquals(props.has(key), true, `missing property: ${key}`);
  }
});
