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

Deno.test("loadChain: two-tier chain loads in root→leaf order", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/child" },
    "/project",
    mockReadFile({
      "/project/profiles/child/markspec.yaml":
        `id: "@acme/child"\nversion: 1.0.0\nextends: "../base"\n`,
      "/project/profiles/base/markspec.yaml":
        `id: "@acme/base"\nversion: 1.0.0\n`,
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 2);
  // tiers[0] = root parent, tiers[last] = leaf
  assertEquals(result.chain?.tiers[0].id, "@acme/base");
  assertEquals(result.chain?.tiers[1].id, "@acme/child");
});

Deno.test("loadChain: three-tier chain loads in order", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/leaf" },
    "/project",
    mockReadFile({
      "/project/profiles/leaf/markspec.yaml":
        `id: "@acme/leaf"\nversion: 1.0.0\nextends: "../mid"\n`,
      "/project/profiles/mid/markspec.yaml":
        `id: "@acme/mid"\nversion: 1.0.0\nextends: "../base"\n`,
      "/project/profiles/base/markspec.yaml":
        `id: "@acme/base"\nversion: 1.0.0\n`,
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.map((t) => t.id), [
    "@acme/base",
    "@acme/mid",
    "@acme/leaf",
  ]);
});

Deno.test("loadChain: direct cycle emits PROFILE-LOAD-004", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/a" },
    "/project",
    mockReadFile({
      "/project/profiles/a/markspec.yaml":
        `id: "@acme/a"\nversion: 1.0.0\nextends: "../b"\n`,
      "/project/profiles/b/markspec.yaml":
        `id: "@acme/b"\nversion: 1.0.0\nextends: "../a"\n`,
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-004");
});

Deno.test("loadChain: self-cycle emits PROFILE-LOAD-004", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/me" },
    "/project",
    mockReadFile({
      "/project/profiles/me/markspec.yaml":
        `id: "@acme/me"\nversion: 1.0.0\nextends: "./"\n`,
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-004");
});

Deno.test("loadChain: depth beyond 20 emits PROFILE-LOAD-005", async () => {
  const files: Record<string, string> = {};
  // Build a 22-tier chain (leaf + 21 ancestors)
  for (let i = 0; i < 22; i++) {
    const id = `@acme/t${i}`;
    const extendsLine = i < 21 ? `\nextends: "../t${i + 1}"` : "";
    files[`/project/profiles/t${i}/markspec.yaml`] =
      `id: "${id}"\nversion: 1.0.0${extendsLine}\n`;
  }
  const result = await loadChain(
    { kind: "local", path: "./profiles/t0" },
    "/project",
    mockReadFile(files),
  );
  assertEquals(result.chain, null);
  assertEquals(
    result.diagnostics.find((d) => d.code === "PROFILE-LOAD-005") !==
      undefined,
    true,
  );
});

Deno.test("loadChain: extends of unresolvable parent propagates PROFILE-LOAD-001", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/leaf" },
    "/project",
    mockReadFile({
      "/project/profiles/leaf/markspec.yaml":
        `id: "@acme/leaf"\nversion: 1.0.0\nextends: "../missing"\n`,
      // no file at /project/profiles/missing/markspec.yaml
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-001");
});
