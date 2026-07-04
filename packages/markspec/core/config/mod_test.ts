import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { join, resolve } from "@std/path";
import { ConfigError, DEFAULT_PROJECT_CONFIG } from "../model/mod.ts";
import { discoverProjectRoot, loadConfig, parseProjectConfig } from "./mod.ts";

// ---------------------------------------------------------------------------
// parseProjectConfig — org project schema (Task 8 closed-schema flip)
// ---------------------------------------------------------------------------

Deno.test("parseProjectConfig: minimal valid config", () => {
  const config = parseProjectConfig(
    "name: my-project\nversion: 0.1.0\n",
    "project.yaml",
  );
  assertEquals(config.name, "my-project");
  assertEquals(config.version, "0.1.0");
  assertEquals(config.dependencies, []);
  assertEquals(config.references, []);
});

Deno.test("parseProjectConfig: full org config with inert keys + dependencies/references", () => {
  const yaml = `
$schema: https://driftsys.github.io/schemas/project/v1.json
name: io.driftsys.markspec
version: "1.2.3"
category: [specification, tool]
description: A demo project
license: MIT
keywords: [demo]
labels: [ASIL-A]
authors: [Jane Doe]
homepage: https://example.com
bugs: https://example.com/issues
repository: https://github.com/acme/demo
upstream: acme/demo
process: aspice
classification: internal
metadata:
  team: platform
dependencies:
  - url: https://github.com/acme/aeb-product
    name: product
references:
  - url: https://driftsys.github.io/refhub
    name: refhub
`;
  const config = parseProjectConfig(yaml, "project.yaml");
  assertEquals(config.name, "io.driftsys.markspec");
  assertEquals(config.version, "1.2.3");
  assertEquals(config.dependencies, [
    { url: "https://github.com/acme/aeb-product", name: "product" },
  ]);
  assertEquals(config.references, [
    { url: "https://driftsys.github.io/refhub", name: "refhub" },
  ]);
});

Deno.test("parseProjectConfig: missing name throws ConfigError", () => {
  const err = assertThrows(
    () => parseProjectConfig("version: 0.1.0\n", "project.yaml"),
    ConfigError,
  );
  assertEquals(err.fieldErrors.some((e) => e.field === "name"), true);
});

Deno.test("parseProjectConfig: empty name throws ConfigError", () => {
  const err = assertThrows(
    () => parseProjectConfig('name: ""\nversion: 0.1.0\n', "project.yaml"),
    ConfigError,
  );
  assertEquals(err.fieldErrors[0].field, "name");
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
// version required (Task 8)
// ---------------------------------------------------------------------------

Deno.test("parseProjectConfig: missing version throws ConfigError", () => {
  const err = assertThrows(
    () => parseProjectConfig("name: test\n", "project.yaml"),
    ConfigError,
  );
  const versionErr = err.fieldErrors.find((e) => e.field === "version");
  assertEquals(versionErr !== undefined, true);
  assertStringIncludes(versionErr!.message, "version is required");
});

// ---------------------------------------------------------------------------
// name pattern (Task 8)
// ---------------------------------------------------------------------------

Deno.test("parseProjectConfig: name violating the org pattern throws ConfigError", () => {
  const err = assertThrows(
    () =>
      parseProjectConfig("name: Not_Valid\nversion: 0.1.0\n", "project.yaml"),
    ConfigError,
  );
  const nameErr = err.fieldErrors.find((e) => e.field === "name");
  assertEquals(nameErr !== undefined, true);
  assertStringIncludes(nameErr!.message, "must match");
});

Deno.test("parseProjectConfig: name starting with a digit throws ConfigError", () => {
  const err = assertThrows(
    () => parseProjectConfig("name: 1acme\nversion: 0.1.0\n", "project.yaml"),
    ConfigError,
  );
  assertEquals(err.fieldErrors.some((e) => e.field === "name"), true);
});

Deno.test("parseProjectConfig: dotted reverse-DNS name is accepted", () => {
  const config = parseProjectConfig(
    "name: io.driftsys.markspec\nversion: 0.1.0\n",
    "project.yaml",
  );
  assertEquals(config.name, "io.driftsys.markspec");
});

// ---------------------------------------------------------------------------
// migrated keys → actionable ConfigError (Task 8)
// ---------------------------------------------------------------------------

Deno.test("parseProjectConfig: 'exclude' key is a migrated-key ConfigError", () => {
  const err = assertThrows(
    () =>
      parseProjectConfig(
        "name: test\nversion: 0.1.0\nexclude:\n  - skills/\n",
        "project.yaml",
      ),
    ConfigError,
  );
  const fieldErr = err.fieldErrors.find((e) => e.field === "exclude");
  assertEquals(fieldErr !== undefined, true);
  assertStringIncludes(fieldErr!.message, "has moved to .markspec.yaml");
});

Deno.test("parseProjectConfig: 'caption-conventions' key is a migrated-key ConfigError", () => {
  const err = assertThrows(
    () =>
      parseProjectConfig(
        "name: test\nversion: 0.1.0\ncaption-conventions:\n  Figure: above\n",
        "project.yaml",
      ),
    ConfigError,
  );
  const fieldErr = err.fieldErrors.find((e) =>
    e.field === "caption-conventions"
  );
  assertEquals(fieldErr !== undefined, true);
  assertStringIncludes(fieldErr!.message, "has moved to .markspec.yaml");
});

// ---------------------------------------------------------------------------
// retired keys → actionable ConfigError (Task 8)
// ---------------------------------------------------------------------------

Deno.test("parseProjectConfig: 'parents' key is a retired-key ConfigError", () => {
  const err = assertThrows(
    () =>
      parseProjectConfig(
        "name: test\nversion: 0.1.0\nparents:\n  - https://example.com\n",
        "project.yaml",
      ),
    ConfigError,
  );
  const fieldErr = err.fieldErrors.find((e) => e.field === "parents");
  assertEquals(fieldErr !== undefined, true);
  assertStringIncludes(fieldErr!.message, "is retired");
  assertStringIncludes(fieldErr!.message, "references:");
});

Deno.test("parseProjectConfig: 'parent-fallback' key is a retired-key ConfigError", () => {
  const err = assertThrows(
    () =>
      parseProjectConfig(
        "name: test\nversion: 0.1.0\nparent-fallback: https://example.com\n",
        "project.yaml",
      ),
    ConfigError,
  );
  const fieldErr = err.fieldErrors.find((e) => e.field === "parent-fallback");
  assertEquals(fieldErr !== undefined, true);
  assertStringIncludes(fieldErr!.message, "is retired");
});

// ---------------------------------------------------------------------------
// unknown keys rejected (Task 8)
// ---------------------------------------------------------------------------

Deno.test("parseProjectConfig: unknown key throws ConfigError", () => {
  const err = assertThrows(
    () =>
      parseProjectConfig(
        "name: test\nversion: 0.1.0\ndomain: BRK\n",
        "project.yaml",
      ),
    ConfigError,
  );
  const fieldErr = err.fieldErrors.find((e) => e.field === "domain");
  assertEquals(fieldErr !== undefined, true);
  assertStringIncludes(fieldErr!.message, "unknown key 'domain'");
  assertStringIncludes(fieldErr!.message, "closed org schema");
});

// ---------------------------------------------------------------------------
// org inert keys accepted, ignored (Task 8)
// ---------------------------------------------------------------------------

Deno.test("parseProjectConfig: org inert keys are accepted and ignored", () => {
  const yaml = `
name: test
version: 0.1.0
$schema: https://driftsys.github.io/schemas/project/v1.json
category: [tool]
description: something
license: MIT
keywords: [a, b]
labels: [ASIL-A]
authors: [Jane Doe]
homepage: https://example.com
bugs: https://example.com/issues
repository: https://github.com/acme/demo
upstream: acme/demo
process: aspice
classification: internal
metadata:
  team: platform
`;
  const config = parseProjectConfig(yaml, "project.yaml");
  assertEquals(config.name, "test");
  assertEquals(config.version, "0.1.0");
});

Deno.test("parseProjectConfig: error includes line number", () => {
  const yaml = "name: test\nversion: 0.1.0\ndomain: BRK\n";
  const err = assertThrows(
    () => parseProjectConfig(yaml, "project.yaml"),
    ConfigError,
  );
  const fieldErr = err.fieldErrors.find((e) => e.field === "domain");
  assertEquals(fieldErr!.line, 3);
});

// ---------------------------------------------------------------------------
// discoverProjectRoot
// ---------------------------------------------------------------------------

Deno.test("discoverProjectRoot: finds project.yaml in current directory", async () => {
  const a = resolve("/a");
  const yamlPath = join(a, "project.yaml");
  const readFile = (path: string) =>
    Promise.resolve(
      path.endsWith("project.yaml") && path === yamlPath
        ? "name: test"
        : undefined,
    );
  const root = await discoverProjectRoot(a, readFile);
  assertEquals(root, a);
});

Deno.test("discoverProjectRoot: finds project.yaml two levels up", async () => {
  const a = resolve("/a");
  const yamlPath = join(a, "project.yaml");
  const deep = join(a, "b", "c");
  const readFile = (path: string) =>
    Promise.resolve(path === yamlPath ? "name: test" : undefined);
  const root = await discoverProjectRoot(deep, readFile);
  assertEquals(root, a);
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
  const proj = resolve("/proj");
  const files: Record<string, string> = {
    [join(proj, "project.yaml")]: "name: my-project\nversion: 0.1.0\n",
  };
  const readFile = (path: string) => Promise.resolve(files[path]);
  const result = await loadConfig(join(proj, "src", "deep"), readFile);
  assertEquals(result?.config.name, "my-project");
  assertEquals(result?.projectRoot, proj);
});

Deno.test("loadConfig: returns undefined when no project.yaml found", async () => {
  const readFile = () => Promise.resolve(undefined);
  const result = await loadConfig("/tmp/nowhere", readFile);
  assertEquals(result, undefined);
});

Deno.test("loadConfig: throws ConfigError on invalid project.yaml", async () => {
  const proj = resolve("/proj");
  const files: Record<string, string> = {
    [join(proj, "project.yaml")]: "domain: bad\n",
  };
  const readFile = (path: string) => Promise.resolve(files[path]);
  try {
    await loadConfig(proj, readFile);
    throw new Error("should have thrown");
  } catch (err) {
    assertEquals(err instanceof ConfigError, true);
  }
});

// ---------------------------------------------------------------------------
// DEFAULT_PROJECT_CONFIG shape (Task 8 final org shape)
// ---------------------------------------------------------------------------

Deno.test("DEFAULT_PROJECT_CONFIG has the org project shape", () => {
  assertEquals(DEFAULT_PROJECT_CONFIG.name, "");
  assertEquals(DEFAULT_PROJECT_CONFIG.version, "0.0.0");
  assertEquals(DEFAULT_PROJECT_CONFIG.dependencies, []);
  assertEquals(DEFAULT_PROJECT_CONFIG.references, []);
});

// ---------------------------------------------------------------------------
// dependencies / references (org project-manifest projectRef lists)
// ---------------------------------------------------------------------------

Deno.test("parseProjectConfig: parses dependencies and references projectRefs", () => {
  const config = parseProjectConfig(
    `name: io.acme.brake
version: "1.0.0"
dependencies:
  - url: https://github.com/acme/aeb-product
    name: product
  - url: ../aeb-sensor
    name: sensor
    version: main
references:
  - url: https://driftsys.github.io/refhub
    name: refhub
`,
    "/proj/project.yaml",
  );
  assertEquals(config.dependencies, [
    { url: "https://github.com/acme/aeb-product", name: "product" },
    { url: "../aeb-sensor", name: "sensor", version: "main" },
  ]);
  assertEquals(config.references, [
    { url: "https://driftsys.github.io/refhub", name: "refhub" },
  ]);
});

Deno.test("parseProjectConfig: dependencies/references default to empty", () => {
  const config = parseProjectConfig(
    "name: t\nversion: 0.1.0\n",
    "/proj/project.yaml",
  );
  assertEquals(config.dependencies, []);
  assertEquals(config.references, []);
});

Deno.test("parseProjectConfig: projectRef without url is a ConfigError", () => {
  assertThrows(
    () =>
      parseProjectConfig(
        "name: t\nversion: 0.1.0\nreferences:\n  - name: refhub\n",
        "/proj/project.yaml",
      ),
    ConfigError,
    "url",
  );
});

Deno.test("parseProjectConfig: unknown projectRef key is a ConfigError", () => {
  assertThrows(
    () =>
      parseProjectConfig(
        "name: t\nversion: 0.1.0\nreferences:\n  - url: https://x.example\n    kind: git\n",
        "/proj/project.yaml",
      ),
    ConfigError,
    "kind",
  );
});

Deno.test("parseProjectConfig: unsafe projectRef name is a ConfigError", () => {
  assertThrows(
    () =>
      parseProjectConfig(
        "name: t\nversion: 0.1.0\nreferences:\n  - url: https://x.example\n    name: ../evil\n",
        "/proj/project.yaml",
      ),
    ConfigError,
    "name",
  );
});
