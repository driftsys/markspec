/**
 * @module core/config/markspec_test
 *
 * Unit tests for .markspec.yaml loading.
 */

import { assertEquals } from "@std/assert";
import {
  MARKSPEC_YAML_FILENAME,
  parseMarkspecYaml,
  readMarkspecYaml,
} from "./markspec.ts";

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

Deno.test("parseMarkspecYaml: empty file produces empty config", () => {
  const result = parseMarkspecYaml("", "/project/.markspec.yaml");
  assertEquals(result.diagnostics, []);
  assertEquals(result.config?.profiles, []);
});

Deno.test("parseMarkspecYaml: single local profile parsed", () => {
  const result = parseMarkspecYaml(
    `profiles:\n  - ./profiles/custom\n`,
    "/project/.markspec.yaml",
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.config?.profiles, [
    { kind: "local", path: "./profiles/custom" },
  ]);
});

Deno.test("parseMarkspecYaml: git specifier parsed", () => {
  const result = parseMarkspecYaml(
    `profiles:\n  - git+https://github.com/acme/base.git#v1.0\n`,
    "/project/.markspec.yaml",
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.config?.profiles[0], {
    kind: "git",
    repo: "https://github.com/acme/base.git",
    subpath: undefined,
    tag: "v1.0",
  });
});

Deno.test("parseMarkspecYaml: YAML parse error emits MARKSPEC-YAML-002", () => {
  const result = parseMarkspecYaml(
    `profiles: [\n  unclosed`,
    "/project/.markspec.yaml",
  );
  assertEquals(result.config, null);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-002");
  assertEquals(result.diagnostics[0].severity, "error");
});

Deno.test("parseMarkspecYaml: non-mapping root emits MARKSPEC-YAML-003", () => {
  const result = parseMarkspecYaml("42", "/project/.markspec.yaml");
  assertEquals(result.config, null);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-003");
});

Deno.test("parseMarkspecYaml: 'profiles' must be a list", () => {
  const result = parseMarkspecYaml(
    `profiles: "oops"\n`,
    "/project/.markspec.yaml",
  );
  assertEquals(result.config, null);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-003");
});

Deno.test("parseMarkspecYaml: non-string specifier in profiles errors", () => {
  const result = parseMarkspecYaml(
    `profiles:\n  - 42\n`,
    "/project/.markspec.yaml",
  );
  assertEquals(result.config, null);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-003");
});

Deno.test("parseMarkspecYaml: unknown top-level key warns", () => {
  const result = parseMarkspecYaml(
    `profiles: []\nbogus: 1\n`,
    "/project/.markspec.yaml",
  );
  // config still produced (warning, not error)
  assertEquals(result.config?.profiles, []);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-001");
  assertEquals(result.diagnostics[0].severity, "warning");
  const msg = result.diagnostics[0].message;
  if (!msg.includes("bogus")) {
    throw new Error(`expected 'bogus' in message, got: ${msg}`);
  }
});

Deno.test("parseMarkspecYaml: malformed specifier errors", () => {
  const result = parseMarkspecYaml(
    `profiles:\n  - "oops-not-local-or-git"\n`,
    "/project/.markspec.yaml",
  );
  assertEquals(result.config, null);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-003");
});
