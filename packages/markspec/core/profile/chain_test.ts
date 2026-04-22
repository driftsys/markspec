/**
 * @module core/profile/chain_test
 *
 * Unit tests for single-profile chain loading.
 */

import { assertEquals } from "@std/assert";
import { loadChain } from "./chain.ts";

function mockReadFile(map: Record<string, string>) {
  return (path: string): Promise<string | undefined> =>
    Promise.resolve(map[path]);
}

Deno.test("loadChain: happy path returns a one-tier chain", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/custom" },
    "/project",
    mockReadFile({
      "/project/profiles/custom/markspec.yaml":
        `id: "@acme/custom"\nversion: 1.0.0\n`,
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 1);
  const tier = result.chain?.tiers[0];
  assertEquals(tier?.id, "@acme/custom");
  assertEquals(tier?.version, "1.0.0");
  assertEquals(tier?.specifier, { kind: "local", path: "./profiles/custom" });
  assertEquals(tier?.sourcePath, "/project/profiles/custom/markspec.yaml");
  assertEquals(tier?.baseDir, "/project/profiles/custom");
});

Deno.test("loadChain: unresolvable specifier propagates PROFILE-LOAD-001", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/missing" },
    "/project",
    mockReadFile({}),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-001");
});

Deno.test("loadChain: malformed manifest propagates PROFILE-LOAD-003", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/broken" },
    "/project",
    mockReadFile({
      "/project/profiles/broken/markspec.yaml": `no_id: true\n`,
    }),
  );
  assertEquals(result.chain, null);
  const codes = result.diagnostics.map((d) => d.code);
  // parseManifest emits PROFILE-LOAD-003 for missing id AND missing version
  assertEquals(codes[0], "PROFILE-LOAD-003");
});

Deno.test("loadChain: git specifier errors with PROFILE-LOAD-001 (Phase 4 scope)", async () => {
  const result = await loadChain(
    {
      kind: "git",
      repo: "https://github.com/acme/base.git",
      subpath: undefined,
      tag: "v1.0",
    },
    "/project",
    mockReadFile({}),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-001");
  const msg = result.diagnostics[0].message;
  if (!msg.toLowerCase().includes("git")) {
    throw new Error(`expected 'git' in message, got: ${msg}`);
  }
});

Deno.test("loadChain: manifest with extends: is loaded but extends is ignored", async () => {
  // Phase 2 does not walk extends. The chain is the single leaf profile.
  // Phase 3 will replace this behavior with real chain resolution.
  const result = await loadChain(
    { kind: "local", path: "./profiles/leaf" },
    "/project",
    mockReadFile({
      "/project/profiles/leaf/markspec.yaml":
        `id: "@acme/leaf"\nversion: 1.0.0\nextends: "./parent"\n`,
      // parent intentionally unreadable — Phase 2 must not try to fetch it
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.chain?.tiers[0].id, "@acme/leaf");
  // The manifest still carries the parsed extends — Phase 3 will consume it.
  assertEquals(result.chain?.tiers[0].manifest.extends, {
    kind: "local",
    path: "./parent",
  });
});
