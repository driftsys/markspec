/**
 * @module core/profile/chain_test
 *
 * Unit tests for single-profile chain loading.
 */

import { assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import { loadChain } from "./chain.ts";
import type { RunGit } from "./git-cache.ts";
import { computeCacheLocation } from "./git-cache.ts";
import { BUILTIN_DEFAULT_SPECIFIER } from "./default_profile.ts";

function mockReadFile(map: Record<string, string>) {
  return (path: string): Promise<string | undefined> =>
    Promise.resolve(map[path]);
}

Deno.test("loadChain: happy path returns a one-tier chain", async () => {
  const project = resolve("/project");
  const customDir = join(project, "profiles", "custom");
  const customYaml = join(customDir, "markspec.yaml");
  const result = await loadChain(
    { kind: "local", path: "./profiles/custom" },
    project,
    project,
    mockReadFile({
      [customYaml]:
        `id: "@acme/custom"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 1);
  const tier = result.chain?.tiers[0];
  assertEquals(tier?.id, "@acme/custom");
  assertEquals(tier?.version, "1.0.0");
  assertEquals(tier?.specifier, { kind: "local", path: "./profiles/custom" });
  assertEquals(tier?.sourcePath, customYaml);
  assertEquals(tier?.baseDir, customDir);
});

Deno.test("loadChain: unresolvable specifier propagates PROFILE-LOAD-001", async () => {
  const project = resolve("/project");
  const result = await loadChain(
    { kind: "local", path: "./profiles/missing" },
    project,
    project,
    mockReadFile({}),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-001");
});

Deno.test("loadChain: malformed manifest propagates PROFILE-LOAD-003", async () => {
  const project = resolve("/project");
  const result = await loadChain(
    { kind: "local", path: "./profiles/broken" },
    project,
    project,
    mockReadFile({
      [join(project, "profiles", "broken", "markspec.yaml")]: `no_id: true\n`,
    }),
  );
  assertEquals(result.chain, null);
  const codes = result.diagnostics.map((d) => d.code);
  // parseManifest emits PROFILE-LOAD-003 for missing id AND missing version
  assertEquals(codes[0], "PROFILE-LOAD-003");
});

Deno.test("loadChain: two-tier chain loads in root→leaf order", async () => {
  const project = resolve("/project");
  const result = await loadChain(
    { kind: "local", path: "./profiles/child" },
    project,
    project,
    mockReadFile({
      [join(project, "profiles", "child", "markspec.yaml")]:
        `id: "@acme/child"\nversion: 1.0.0\nmarkspec-schema: "1"\nextends: "../base"\n`,
      [join(project, "profiles", "base", "markspec.yaml")]:
        `id: "@acme/base"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 2);
  // tiers[0] = root parent, tiers[last] = leaf
  assertEquals(result.chain?.tiers[0].id, "@acme/base");
  assertEquals(result.chain?.tiers[1].id, "@acme/child");
});

Deno.test("loadChain: three-tier chain loads in order", async () => {
  const project = resolve("/project");
  const result = await loadChain(
    { kind: "local", path: "./profiles/leaf" },
    project,
    project,
    mockReadFile({
      [join(project, "profiles", "leaf", "markspec.yaml")]:
        `id: "@acme/leaf"\nversion: 1.0.0\nmarkspec-schema: "1"\nextends: "../mid"\n`,
      [join(project, "profiles", "mid", "markspec.yaml")]:
        `id: "@acme/mid"\nversion: 1.0.0\nmarkspec-schema: "1"\nextends: "../base"\n`,
      [join(project, "profiles", "base", "markspec.yaml")]:
        `id: "@acme/base"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
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
  const project = resolve("/project");
  const result = await loadChain(
    { kind: "local", path: "./profiles/a" },
    project,
    project,
    mockReadFile({
      [join(project, "profiles", "a", "markspec.yaml")]:
        `id: "@acme/a"\nversion: 1.0.0\nmarkspec-schema: "1"\nextends: "../b"\n`,
      [join(project, "profiles", "b", "markspec.yaml")]:
        `id: "@acme/b"\nversion: 1.0.0\nmarkspec-schema: "1"\nextends: "../a"\n`,
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-004");
});

Deno.test("loadChain: self-cycle emits PROFILE-LOAD-004", async () => {
  const project = resolve("/project");
  const result = await loadChain(
    { kind: "local", path: "./profiles/me" },
    project,
    project,
    mockReadFile({
      [join(project, "profiles", "me", "markspec.yaml")]:
        `id: "@acme/me"\nversion: 1.0.0\nmarkspec-schema: "1"\nextends: "./"\n`,
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-004");
});

Deno.test("loadChain: depth beyond 20 emits PROFILE-LOAD-005", async () => {
  const project = resolve("/project");
  const files: Record<string, string> = {};
  // Build a 22-tier chain (leaf + 21 ancestors)
  for (let i = 0; i < 22; i++) {
    const id = `@acme/t${i}`;
    const extendsLine = i < 21 ? `\nextends: "../t${i + 1}"` : "";
    files[join(project, "profiles", `t${i}`, "markspec.yaml")] =
      `id: "${id}"\nversion: 1.0.0${extendsLine}\n`;
  }
  const result = await loadChain(
    { kind: "local", path: "./profiles/t0" },
    project,
    project,
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
  const project = resolve("/project");
  const result = await loadChain(
    { kind: "local", path: "./profiles/leaf" },
    project,
    project,
    mockReadFile({
      [join(project, "profiles", "leaf", "markspec.yaml")]:
        `id: "@acme/leaf"\nversion: 1.0.0\nmarkspec-schema: "1"\nextends: "../missing"\n`,
      // no file at <project>/profiles/missing/markspec.yaml
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-001");
});

Deno.test("loadChain: top-level git specifier routes through resolveGitSpecifier", async () => {
  const project = resolve("/project");
  const spec = {
    kind: "git" as const,
    repo: "https://github.com/acme/repo.git",
    subpath: undefined,
    tag: "v1.0.0",
  };
  const loc = await computeCacheLocation(project, spec);

  const gitCalls: string[][] = [];
  const runGit: RunGit = (args) => {
    gitCalls.push([...args]);
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };

  // Cache hit: markspec.yaml is already at the cache location.
  const result = await loadChain(
    spec,
    project,
    project,
    mockReadFile({
      [loc.manifestPath]:
        `id: "@acme/from-git"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
    }),
    { runGit },
  );

  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.chain?.tiers[0].id, "@acme/from-git");
  assertEquals(gitCalls.length, 0); // hit — no git calls
});

Deno.test("loadChain: git specifier in extends chain is walked", async () => {
  const project = resolve("/project");
  const parentSpec = {
    kind: "git" as const,
    repo: "https://github.com/acme/parent.git",
    subpath: undefined,
    tag: "v1.0.0",
  };
  const parentLoc = await computeCacheLocation(project, parentSpec);

  const runGit: RunGit = () =>
    Promise.resolve({ code: 0, stdout: "", stderr: "" });

  const result = await loadChain(
    { kind: "local", path: "./profiles/child" },
    project,
    project,
    mockReadFile({
      [join(project, "profiles", "child", "markspec.yaml")]:
        `id: "@acme/child"\nversion: 1.0.0\nmarkspec-schema: "1"\n` +
        `extends: "git+${parentSpec.repo}#${parentSpec.tag}"\n`,
      [parentLoc.manifestPath]:
        `id: "@acme/git-parent"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
    }),
    { runGit },
  );

  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.map((t) => t.id), [
    "@acme/git-parent",
    "@acme/child",
  ]);
});

Deno.test("loadChain: git clone failure propagates PROFILE-LOAD-001", async () => {
  const project = resolve("/project");
  const failingRunGit: RunGit = (args) => {
    if (args[0] === "clone") {
      return Promise.resolve({
        code: 128,
        stdout: "",
        stderr: "fatal: unreachable",
      });
    }
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };

  const result = await loadChain(
    {
      kind: "git",
      repo: "https://github.com/acme/no-such.git",
      subpath: undefined,
      tag: "v1.0.0",
    },
    project,
    project,
    mockReadFile({}),
    { runGit: failingRunGit },
  );

  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-001");
});

Deno.test(
  "loadChain: bundledDefault splices builtin as root of an extends-less leaf",
  async () => {
    const project = resolve("/project");
    const result = await loadChain(
      { kind: "local", path: "./profiles/custom" },
      project,
      project,
      mockReadFile({
        [join(project, "profiles", "custom", "markspec.yaml")]:
          `id: "@acme/custom"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
      }),
      { bundledDefault: true },
    );
    assertEquals(result.diagnostics, []);
    assertEquals(result.chain?.tiers.length, 2);
    assertEquals(result.chain?.tiers[0].id, "@markspec/profile-default");
    assertEquals(result.chain?.tiers[1].id, "@acme/custom");
  },
);

Deno.test("loadChain: bundledDefault disabled does not splice", async () => {
  const project = resolve("/project");
  const result = await loadChain(
    { kind: "local", path: "./profiles/custom" },
    project,
    project,
    mockReadFile({
      [join(project, "profiles", "custom", "markspec.yaml")]:
        `id: "@acme/custom"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
    }),
    { bundledDefault: false },
  );
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.chain?.tiers[0].id, "@acme/custom");
});

Deno.test("loadChain: builtin leaf with bundledDefault yields exactly one tier (no self-splice)", async () => {
  const project = resolve("/project");
  const result = await loadChain(
    BUILTIN_DEFAULT_SPECIFIER,
    project,
    project,
    mockReadFile({}),
    { bundledDefault: true },
  );
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.chain?.tiers[0].id, "@markspec/profile-default");
});

Deno.test("loadChain: builtin spliced below a multi-tier local chain", async () => {
  const project = resolve("/project");
  const result = await loadChain(
    { kind: "local", path: "./profiles/leaf" },
    project,
    project,
    mockReadFile({
      [join(project, "profiles", "leaf", "markspec.yaml")]:
        `id: "@acme/leaf"\nversion: 1.0.0\nmarkspec-schema: "1"\nextends: "../root"\n`,
      [join(project, "profiles", "root", "markspec.yaml")]:
        `id: "@acme/root"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
    }),
    { bundledDefault: true },
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 3);
  assertEquals(result.chain?.tiers[0].id, "@markspec/profile-default");
  assertEquals(result.chain?.tiers[1].id, "@acme/root");
  assertEquals(result.chain?.tiers[2].id, "@acme/leaf");
});
