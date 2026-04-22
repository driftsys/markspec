/**
 * @module core/config/markspec_test
 *
 * Unit tests for .markspec.yaml loading.
 */

import { assertEquals } from "@std/assert";
import { MARKSPEC_YAML_FILENAME, readMarkspecYaml } from "./markspec.ts";

function mockReadFile(map: Record<string, string>) {
  return (path: string): Promise<string | undefined> =>
    Promise.resolve(map[path]);
}

Deno.test("readMarkspecYaml: returns null when file absent", async () => {
  const result = await readMarkspecYaml(
    "/project",
    mockReadFile({}),
  );
  assertEquals(result, null);
});

Deno.test("readMarkspecYaml: returns contents when file present", async () => {
  const result = await readMarkspecYaml(
    "/project",
    mockReadFile({
      [`/project/${MARKSPEC_YAML_FILENAME}`]: "profiles: []\n",
    }),
  );
  assertEquals(result, "profiles: []\n");
});
