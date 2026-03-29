import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  ConfigError,
  DEFAULT_PROJECT_CONFIG,
  REFHUB_URL,
} from "../model/mod.ts";
import { discoverProjectRoot, loadConfig, parseProjectConfig } from "./mod.ts";

// ---------------------------------------------------------------------------
// parseProjectConfig
// ---------------------------------------------------------------------------

Deno.test("parseProjectConfig: minimal valid config", () => {
  const config = parseProjectConfig("name: my-project\n", "project.yaml");
  assertEquals(config.name, "my-project");
  assertEquals(config.domain, "");
  assertEquals(config.version, "0.0.0");
  assertEquals(config.labels, []);
  assertEquals(config.parents, []);
  assertEquals(config.parentFallback, REFHUB_URL);
});

Deno.test("parseProjectConfig: full config with all fields", () => {
  const yaml = `
name: io.driftsys.markspec
domain: BRK
version: 1.2.3
labels:
  - ASIL-A
  - ASIL-B
parents:
  - https://safety.company.io/registry
parent-fallback: https://example.com/refhub
`;
  const config = parseProjectConfig(yaml, "project.yaml");
  assertEquals(config.name, "io.driftsys.markspec");
  assertEquals(config.domain, "BRK");
  assertEquals(config.version, "1.2.3");
  assertEquals(config.labels, ["ASIL-A", "ASIL-B"]);
  assertEquals(config.parents, ["https://safety.company.io/registry"]);
  assertEquals(config.parentFallback, "https://example.com/refhub");
});

Deno.test("parseProjectConfig: missing optional fields use defaults", () => {
  const config = parseProjectConfig("name: test\n", "project.yaml");
  assertEquals(config.domain, DEFAULT_PROJECT_CONFIG.domain);
  assertEquals(config.version, DEFAULT_PROJECT_CONFIG.version);
  assertEquals(config.labels, DEFAULT_PROJECT_CONFIG.labels);
  assertEquals(config.parents, DEFAULT_PROJECT_CONFIG.parents);
  assertEquals(config.parentFallback, DEFAULT_PROJECT_CONFIG.parentFallback);
});

Deno.test("parseProjectConfig: missing name throws ConfigError", () => {
  const err = assertThrows(
    () => parseProjectConfig("domain: BRK\n", "project.yaml"),
    ConfigError,
  );
  assertEquals(err.fieldErrors.length, 1);
  assertEquals(err.fieldErrors[0].field, "name");
});

Deno.test("parseProjectConfig: empty name throws ConfigError", () => {
  const err = assertThrows(
    () => parseProjectConfig('name: ""\n', "project.yaml"),
    ConfigError,
  );
  assertEquals(err.fieldErrors[0].field, "name");
});

Deno.test("parseProjectConfig: invalid domain format throws ConfigError", () => {
  const err = assertThrows(
    () => parseProjectConfig("name: test\ndomain: brk\n", "project.yaml"),
    ConfigError,
  );
  assertEquals(err.fieldErrors[0].field, "domain");

  const err2 = assertThrows(
    () => parseProjectConfig("name: test\ndomain: TOOLONG7\n", "project.yaml"),
    ConfigError,
  );
  assertEquals(err2.fieldErrors[0].field, "domain");
});

Deno.test("parseProjectConfig: invalid labels type throws ConfigError", () => {
  const err = assertThrows(
    () =>
      parseProjectConfig("name: test\nlabels: not-an-array\n", "project.yaml"),
    ConfigError,
  );
  assertEquals(err.fieldErrors[0].field, "labels");
});

Deno.test("parseProjectConfig: empty label in array throws ConfigError", () => {
  const err = assertThrows(
    () =>
      parseProjectConfig(
        'name: test\nlabels:\n  - ""\n',
        "project.yaml",
      ),
    ConfigError,
  );
  assertEquals(err.fieldErrors[0].field, "labels[0]");
});

Deno.test("parseProjectConfig: invalid parent URL throws ConfigError", () => {
  const err = assertThrows(
    () =>
      parseProjectConfig(
        "name: test\nparents:\n  - not-a-url\n",
        "project.yaml",
      ),
    ConfigError,
  );
  assertEquals(err.fieldErrors[0].field, "parents[0]");
});

Deno.test("parseProjectConfig: malformed YAML throws ConfigError", () => {
  const err = assertThrows(
    () => parseProjectConfig(":\n  :\n    - :", "project.yaml"),
    ConfigError,
  );
  assertEquals(err.fieldErrors[0].field, "(syntax)");
});

Deno.test("parseProjectConfig: non-object YAML throws ConfigError", () => {
  const err = assertThrows(
    () => parseProjectConfig("- item1\n- item2\n", "project.yaml"),
    ConfigError,
  );
  assertEquals(err.fieldErrors[0].field, "(root)");
});

Deno.test("parseProjectConfig: error includes line number", () => {
  const yaml = "name: test\ndomain: bad\n";
  const err = assertThrows(
    () => parseProjectConfig(yaml, "project.yaml"),
    ConfigError,
  );
  assertEquals(err.fieldErrors[0].line, 2);
});

Deno.test("parseProjectConfig: parent-fallback kebab-case maps to parentFallback", () => {
  const yaml = "name: test\nparent-fallback: https://example.com/fallback\n";
  const config = parseProjectConfig(yaml, "project.yaml");
  assertEquals(config.parentFallback, "https://example.com/fallback");
});

Deno.test("parseProjectConfig: findLineNumber handles regex metacharacters in field names", () => {
  const yaml = "name: test\nparent-fallback: not-a-url\n";
  const err = assertThrows(
    () => parseProjectConfig(yaml, "project.yaml"),
    ConfigError,
  );
  assertEquals(err.fieldErrors[0].field, "parent-fallback");
  assertEquals(err.fieldErrors[0].line, 2);
});

Deno.test("parseProjectConfig: ignores unknown fields", () => {
  const yaml =
    "name: test\ncategory: [tool]\ndescription: something\nlicense: MIT\n";
  const config = parseProjectConfig(yaml, "project.yaml");
  assertEquals(config.name, "test");
});

Deno.test("parseProjectConfig: numeric version is coerced to string", () => {
  const config = parseProjectConfig("name: test\nversion: 1.0\n", "p.yaml");
  assertEquals(config.version, "1");
});

Deno.test("parseProjectConfig: numeric version emits coercion warning", () => {
  const warnings: string[] = [];
  const origError = console.error;
  console.error = (msg: string) => warnings.push(msg);
  try {
    parseProjectConfig("name: test\nversion: 1.0\n", "p.yaml");
  } finally {
    console.error = origError;
  }
  assertEquals(warnings.length, 1);
  assertStringIncludes(warnings[0], "version");
  assertStringIncludes(warnings[0], "Quote");
});

// ---------------------------------------------------------------------------
// discoverProjectRoot
// ---------------------------------------------------------------------------

Deno.test("discoverProjectRoot: finds project.yaml in current directory", async () => {
  const readFile = (path: string) =>
    Promise.resolve(
      path.endsWith("project.yaml") && path === "/a/project.yaml"
        ? "name: test"
        : undefined,
    );
  const root = await discoverProjectRoot("/a", readFile);
  assertEquals(root, "/a");
});

Deno.test("discoverProjectRoot: finds project.yaml two levels up", async () => {
  const readFile = (path: string) =>
    Promise.resolve(path === "/a/project.yaml" ? "name: test" : undefined);
  const root = await discoverProjectRoot("/a/b/c", readFile);
  assertEquals(root, "/a");
});

Deno.test("discoverProjectRoot: returns undefined when not found", async () => {
  const readFile = () => Promise.resolve(undefined);
  const root = await discoverProjectRoot("/a/b/c", readFile);
  assertEquals(root, undefined);
});

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

Deno.test("loadConfig: discovers and returns valid config", async () => {
  const files: Record<string, string> = {
    "/proj/project.yaml": "name: my-project\ndomain: BRK\n",
  };
  const readFile = (path: string) => Promise.resolve(files[path]);
  const result = await loadConfig("/proj/src/deep", readFile);
  assertEquals(result?.config.name, "my-project");
  assertEquals(result?.config.domain, "BRK");
  assertEquals(result?.projectRoot, "/proj");
});

Deno.test("loadConfig: returns undefined when no project.yaml found", async () => {
  const readFile = () => Promise.resolve(undefined);
  const result = await loadConfig("/tmp/nowhere", readFile);
  assertEquals(result, undefined);
});

Deno.test("loadConfig: throws ConfigError on invalid project.yaml", async () => {
  const files: Record<string, string> = {
    "/proj/project.yaml": "domain: bad\n",
  };
  const readFile = (path: string) => Promise.resolve(files[path]);
  try {
    await loadConfig("/proj", readFile);
    throw new Error("should have thrown");
  } catch (err) {
    assertEquals(err instanceof ConfigError, true);
  }
});
