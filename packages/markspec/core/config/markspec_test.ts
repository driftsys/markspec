/**
 * @module core/config/markspec_test
 *
 * Unit tests for .markspec.yaml loading.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";
import {
  addProfileSpecifier,
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
  const project = resolve("/project");
  const result = await readMarkspecYaml(
    project,
    mockReadFile({
      [join(project, MARKSPEC_YAML_FILENAME)]: "profiles: []\n",
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

Deno.test("parseMarkspecYaml: git+file:// specifier parsed", () => {
  const result = parseMarkspecYaml(
    `profiles:\n  - "git+file:///tmp/foo.git#v1.0"\n`,
    "/project/.markspec.yaml",
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.config?.profiles[0], {
    kind: "git",
    repo: "file:///tmp/foo.git",
    subpath: undefined,
    tag: "v1.0",
  });
});

Deno.test("parseMarkspecYaml: git+file:// with subpath parsed", () => {
  const result = parseMarkspecYaml(
    `profiles:\n  - "git+file:///tmp/foo.git/sub#v1.0"\n`,
    "/project/.markspec.yaml",
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.config?.profiles[0], {
    kind: "git",
    repo: "file:///tmp/foo.git",
    subpath: "sub",
    tag: "v1.0",
  });
});

Deno.test("parseMarkspecYaml: npm scoped specifier parsed", () => {
  const result = parseMarkspecYaml(
    'profiles:\n  - "npm:@markspec/profile-default@^1.0"',
    "/project/.markspec.yaml",
  );
  assertEquals(result.diagnostics.length, 0);
  assertExists(result.config);
  assertEquals(result.config.profiles.length, 1);
  const spec = result.config.profiles[0];
  assertEquals(spec.kind, "npm");
  if (spec.kind === "npm") {
    assertEquals(spec.scope, "@markspec");
    assertEquals(spec.name, "profile-default");
    assertEquals(spec.range, "^1.0");
  }
});

Deno.test("parseMarkspecYaml: npm unscoped specifier parsed", () => {
  const result = parseMarkspecYaml(
    'profiles:\n  - "npm:my-profile@1.2.3"',
    "/project/.markspec.yaml",
  );
  assertEquals(result.diagnostics.length, 0);
  assertExists(result.config);
  assertEquals(result.config.profiles.length, 1);
  const spec = result.config.profiles[0];
  assertEquals(spec.kind, "npm");
  if (spec.kind === "npm") {
    assertEquals(spec.scope, undefined);
    assertEquals(spec.name, "my-profile");
    assertEquals(spec.range, "1.2.3");
  }
});

Deno.test("parseMarkspecYaml: npm specifier missing version range errors", () => {
  const result = parseMarkspecYaml(
    'profiles:\n  - "npm:@markspec/profile-default"',
    "/project/.markspec.yaml",
  );
  assertEquals(result.config, null);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-003");
});

Deno.test("addProfileSpecifier: creates file when absent", async () => {
  const project = resolve("/project");
  const writes: Record<string, string> = {};
  await addProfileSpecifier(
    "npm:@markspec/profile-default@^1.0",
    () => Promise.resolve(undefined),
    (path, content) => {
      writes[path] = content;
      return Promise.resolve();
    },
    project,
  );
  const written = writes[join(project, ".markspec.yaml")];
  assertExists(written);
  assertStringIncludes(written, "profiles:");
  assertStringIncludes(written, "npm:@markspec/profile-default@^1.0");
});

Deno.test("addProfileSpecifier: appends to existing profiles list", async () => {
  const project = resolve("/project");
  const existing = 'profiles:\n  - "./local-profile"\n';
  const writes: Record<string, string> = {};
  await addProfileSpecifier(
    "npm:@markspec/profile-default@^1.0",
    () => Promise.resolve(existing),
    (path, content) => {
      writes[path] = content;
      return Promise.resolve();
    },
    project,
  );
  const written = writes[join(project, ".markspec.yaml")];
  assertExists(written);
  assertStringIncludes(written, "./local-profile");
  assertStringIncludes(written, "npm:@markspec/profile-default@^1.0");
});

Deno.test("addProfileSpecifier: adds profiles key when missing", async () => {
  const project = resolve("/project");
  const existing = "# some comment\n";
  const writes: Record<string, string> = {};
  await addProfileSpecifier(
    "./my-profile",
    () => Promise.resolve(existing),
    (path, content) => {
      writes[path] = content;
      return Promise.resolve();
    },
    project,
  );
  const written = writes[join(project, ".markspec.yaml")];
  assertExists(written);
  assertStringIncludes(written, "# some comment");
  assertStringIncludes(written, "profiles:");
  assertStringIncludes(written, "./my-profile");
});

Deno.test("parseMarkspecYaml: default-profile false parsed", () => {
  const result = parseMarkspecYaml(
    "profiles: []\ndefault-profile: false\n",
    "/p/.markspec.yaml",
  );
  assertExists(result.config);
  assertEquals(result.config.defaultProfile, false);
  assertEquals(result.diagnostics, []);
});

Deno.test("parseMarkspecYaml: default-profile true parsed", () => {
  const result = parseMarkspecYaml(
    "default-profile: true\n",
    "/p/.markspec.yaml",
  );
  assertExists(result.config);
  assertEquals(result.config.defaultProfile, true);
});

Deno.test("parseMarkspecYaml: default-profile absent leaves field undefined", () => {
  const result = parseMarkspecYaml(
    "profiles:\n  - ./profiles/x\n",
    "/p/.markspec.yaml",
  );
  assertExists(result.config);
  assertEquals(result.config.defaultProfile, undefined);
});

Deno.test("parseMarkspecYaml: non-boolean default-profile emits MARKSPEC-YAML-003", () => {
  const result = parseMarkspecYaml(
    'default-profile: "no"\n',
    "/p/.markspec.yaml",
  );
  assertEquals(result.config, null);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-003");
});

Deno.test("addProfileSpecifier: preserves an existing default-profile key", async () => {
  const p = resolve("/p");
  const yamlPath = join(p, ".markspec.yaml");
  const store: Record<string, string> = {
    [yamlPath]: "default-profile: false\nprofiles:\n  - ./a\n",
  };
  await addProfileSpecifier(
    "./b",
    (path: string) => Promise.resolve(store[path]),
    (path: string, content: string) => {
      store[path] = content;
      return Promise.resolve();
    },
    p,
  );
  assertStringIncludes(store[yamlPath], "default-profile: false");
  assertStringIncludes(store[yamlPath], '- "./b"');
});
