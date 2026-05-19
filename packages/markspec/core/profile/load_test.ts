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

Deno.test("loadProfileForCommand: no .markspec.yaml yields the bundled default chain", async () => {
  const result = await loadProfileForCommand("/project", mockReadFile({}));
  // Filter to errors: a builtin-only chain routes through mergeChain,
  // which may legitimately emit non-error (info/warning) diagnostics.
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.chain?.tiers[0].id, "@markspec/profile-default");
});

Deno.test("loadProfileForCommand: empty profiles list yields the bundled default chain", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({ "/project/.markspec.yaml": "profiles: []\n" }),
  );
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.chain?.tiers[0].id, "@markspec/profile-default");
});

Deno.test("loadProfileForCommand: default-profile false yields core-only (null chain)", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml": "profiles: []\ndefault-profile: false\n",
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics, []);
});

Deno.test("loadProfileForCommand: single local profile is spliced onto the bundled default", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml": `profiles:\n  - ./profiles/custom\n`,
      "/project/profiles/custom/markspec.yaml":
        `id: "@acme/custom"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 2);
  assertEquals(result.chain?.tiers[0].id, "@markspec/profile-default");
  assertEquals(result.chain?.tiers[1].id, "@acme/custom");
});

Deno.test("loadProfileForCommand: default-profile false keeps a single-tier chain", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml":
        `default-profile: false\nprofiles:\n  - ./profiles/custom\n`,
      "/project/profiles/custom/markspec.yaml":
        `id: "@acme/custom"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.chain?.tiers[0].id, "@acme/custom");
});

Deno.test("loadProfileForCommand: explicit default-profile true still splices the bundled default", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml":
        `default-profile: true\nprofiles:\n  - ./profiles/custom\n`,
      "/project/profiles/custom/markspec.yaml":
        `id: "@acme/custom"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 2);
  assertEquals(result.chain?.tiers[0].id, "@markspec/profile-default");
  assertEquals(result.chain?.tiers[1].id, "@acme/custom");
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
        `id: "@acme/custom"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
    }),
  );
  // Loading succeeded despite the warning; builtin spliced as root.
  assertEquals(result.chain?.tiers.length, 2);
  assertEquals(result.chain?.tiers[0].id, "@markspec/profile-default");
  assertEquals(result.chain?.tiers[1].id, "@acme/custom");
  const warnings = result.diagnostics.filter((d) =>
    d.code === "MARKSPEC-YAML-001"
  );
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0].severity, "warning");
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
