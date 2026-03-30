import { assertStringIncludes } from "@std/assert";
import { renderTypst } from "./mod.ts";
import type { CompileResult, ProjectConfig } from "../core/mod.ts";

/** Minimal compiled result for testing. */
function emptyCompileResult(): CompileResult {
  return {
    entries: new Map(),
    links: [],
    forward: new Map(),
    reverse: new Map(),
    diagnostics: [],
  };
}

/** Minimal project config for testing. */
function testConfig(): ProjectConfig {
  return {
    name: "io.test.project",
    version: "1.0.0",
    labels: [],
    parents: [],
    parentFallback: "",
  };
}

Deno.test("renderTypst: generates valid Typst source", () => {
  const typst = renderTypst("# Hello World\n\nSome content.", {
    compiled: emptyCompileResult(),
    config: testConfig(),
    typstPackagePath: "/tmp/markspec-typst",
  });

  assertStringIncludes(typst, '#import "lib.typ": markspec-doc');
  assertStringIncludes(typst, '#import "vendor/cmarker/lib.typ": render');
  assertStringIncludes(typst, 'project: "io.test.project"');
  assertStringIncludes(typst, 'version: "1.0.0"');
  assertStringIncludes(typst, "# Hello World");
});
