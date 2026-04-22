/**
 * @module core/profile/resolver_test
 *
 * Unit tests for local profile specifier resolution.
 */

import { assertEquals } from "@std/assert";
import { resolveLocalSpecifier } from "./resolver.ts";
import type { Diagnostic } from "../model/mod.ts";

function mockReadFile(map: Record<string, string>) {
  return (path: string): Promise<string | undefined> =>
    Promise.resolve(map[path]);
}

Deno.test("resolveLocalSpecifier: happy path reads markspec.yaml", async () => {
  const diagnostics: Diagnostic[] = [];
  const result = await resolveLocalSpecifier(
    { kind: "local", path: "./profiles/custom" },
    "/project",
    mockReadFile({
      "/project/profiles/custom/markspec.yaml": "id: @acme/x\nversion: 1.0.0\n",
    }),
    diagnostics,
  );
  assertEquals(diagnostics, []);
  assertEquals(result?.rawYaml, "id: @acme/x\nversion: 1.0.0\n");
  assertEquals(result?.sourcePath, "/project/profiles/custom/markspec.yaml");
  assertEquals(result?.baseDir, "/project/profiles/custom");
});

Deno.test("resolveLocalSpecifier: missing markspec.yaml emits PROFILE-LOAD-001", async () => {
  const diagnostics: Diagnostic[] = [];
  const result = await resolveLocalSpecifier(
    { kind: "local", path: "./profiles/missing" },
    "/project",
    mockReadFile({}),
    diagnostics,
  );
  assertEquals(result, null);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "PROFILE-LOAD-001");
  assertEquals(diagnostics[0].severity, "error");
  const msg = diagnostics[0].message;
  if (!msg.includes("./profiles/missing")) {
    throw new Error(`expected specifier in message, got: ${msg}`);
  }
});

Deno.test("resolveLocalSpecifier: parent-relative path resolves correctly", async () => {
  const diagnostics: Diagnostic[] = [];
  const result = await resolveLocalSpecifier(
    { kind: "local", path: "../shared/base" },
    "/workspace/project",
    mockReadFile({
      "/workspace/shared/base/markspec.yaml":
        "id: @acme/base\nversion: 1.0.0\n",
    }),
    diagnostics,
  );
  assertEquals(diagnostics, []);
  assertEquals(result?.sourcePath, "/workspace/shared/base/markspec.yaml");
  assertEquals(result?.baseDir, "/workspace/shared/base");
});
