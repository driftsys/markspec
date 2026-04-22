/**
 * @module core/profile/load_test
 *
 * Unit tests for the loadProfileForCommand orchestrator.
 */

import { assertEquals } from "@std/assert";
import { loadProfileForCommand } from "./load.ts";

function mockReadFile(map: Record<string, string>) {
  return (path: string): Promise<string | undefined> =>
    Promise.resolve(map[path]);
}

Deno.test("loadProfileForCommand: no .markspec.yaml returns null chain", async () => {
  const result = await loadProfileForCommand("/project", mockReadFile({}));
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics, []);
});

Deno.test("loadProfileForCommand: empty profiles list returns null chain", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({ "/project/.markspec.yaml": "profiles: []\n" }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics, []);
});

Deno.test("loadProfileForCommand: single local profile loads end-to-end", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml": `profiles:\n  - ./profiles/custom\n`,
      "/project/profiles/custom/markspec.yaml":
        `id: "@acme/custom"\nversion: 1.0.0\n`,
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.chain?.tiers[0].id, "@acme/custom");
});

Deno.test("loadProfileForCommand: multiple profiles emits PROFILE-LOAD-006", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml":
        `profiles:\n  - ./profiles/a\n  - ./profiles/b\n`,
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-006");
});

Deno.test("loadProfileForCommand: .markspec.yaml YAML error surfaces", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml": `profiles: [\n  unclosed`,
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-002");
});

Deno.test("loadProfileForCommand: unknown key warning does not block loading", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml":
        `profiles:\n  - ./profiles/custom\nbogus: true\n`,
      "/project/profiles/custom/markspec.yaml":
        `id: "@acme/custom"\nversion: 1.0.0\n`,
    }),
  );
  // Loading succeeded despite the warning
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-001");
  assertEquals(result.diagnostics[0].severity, "warning");
});

Deno.test("loadProfileForCommand: profile load errors propagate", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml": `profiles:\n  - ./profiles/missing\n`,
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-001");
});
