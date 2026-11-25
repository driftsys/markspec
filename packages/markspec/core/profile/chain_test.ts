/**
 * @module core/profile/chain_test
 *
 * Unit tests for single-profile chain loading.
 */

import { assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import { loadChain } from "./chain.ts";
import type { RunGit } from "./git-cache.ts";
import type { RunNpm } from "./npm.ts";
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

// ---------------------------------------------------------------------------
// #1002 — relative `extends:` inside a git-fetched profile
// ---------------------------------------------------------------------------

const MONOREPO = "https://host/org/repo.git";

/** Cached manifest map for git tiers of {@linkcode MONOREPO} at `v1.0.0`. */
async function gitManifests(
  project: string,
  bySubpath: Record<string, string>,
  tag = "v1.0.0",
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const [subpath, yaml] of Object.entries(bySubpath)) {
    const loc = await computeCacheLocation(project, {
      repo: MONOREPO,
      subpath: subpath === "" ? undefined : subpath,
      tag,
    });
    map[loc.manifestPath] = yaml;
  }
  return map;
}

function manifest(id: string, extendsSpec?: string): string {
  return `id: "${id}"\nversion: 1.0.0\nmarkspec-schema: "1"\n` +
    (extendsSpec === undefined ? "" : `extends: "${extendsSpec}"\n`);
}

const noGit: RunGit = () =>
  Promise.resolve({ code: 0, stdout: "", stderr: "" });

Deno.test("loadChain: relative extends in a git subpath profile resolves in the same repo and tag (#1002)", async () => {
  const project = resolve("/project");
  const result = await loadChain(
    { kind: "git", repo: MONOREPO, subpath: "profiles/a", tag: "v1.0.0" },
    project,
    project,
    mockReadFile(
      await gitManifests(project, {
        "profiles/a": manifest("@org/a", "../core"),
        "profiles/core": manifest("@org/core"),
      }),
    ),
    { runGit: noGit },
  );

  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.map((t) => t.id), ["@org/core", "@org/a"]);
  assertEquals(result.chain?.tiers[0].specifier, {
    kind: "git",
    repo: MONOREPO,
    subpath: "profiles/core",
    tag: "v1.0.0",
  });
});

Deno.test("loadChain: relative extends in a git root profile resolves to a subpath (#1002)", async () => {
  const project = resolve("/project");
  const result = await loadChain(
    { kind: "git", repo: MONOREPO, subpath: undefined, tag: "v1.0.0" },
    project,
    project,
    mockReadFile(
      await gitManifests(project, {
        "": manifest("@org/root", "./sub"),
        "sub": manifest("@org/sub"),
      }),
    ),
    { runGit: noGit },
  );

  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.map((t) => t.id), ["@org/sub", "@org/root"]);
  assertEquals(result.chain?.tiers[0].specifier, {
    kind: "git",
    repo: MONOREPO,
    subpath: "sub",
    tag: "v1.0.0",
  });
});

Deno.test("loadChain: relative extends up to the git repo root resolves with no subpath (#1002)", async () => {
  const project = resolve("/project");
  const result = await loadChain(
    { kind: "git", repo: MONOREPO, subpath: "profiles/a", tag: "v1.0.0" },
    project,
    project,
    mockReadFile(
      await gitManifests(project, {
        "profiles/a": manifest("@org/a", "../.."),
        "": manifest("@org/root"),
      }),
    ),
    { runGit: noGit },
  );

  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers[0].specifier, {
    kind: "git",
    repo: MONOREPO,
    subpath: undefined,
    tag: "v1.0.0",
  });
});

for (
  const [label, escaping] of [
    ["one level above the root", "../../.."],
    ["into a folder outside the root", "../../../outside"],
  ]
) {
  Deno.test(`loadChain: relative extends ${label} of the git repo emits PROFILE-LOAD-001 (#1002)`, async () => {
    const project = resolve("/project");
    const gitCalls: string[][] = [];
    const runGit: RunGit = (args) => {
      gitCalls.push([...args]);
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };
    const manifests = await gitManifests(project, {
      "profiles/a": manifest("@org/a", escaping),
    });
    const result = await loadChain(
      { kind: "git", repo: MONOREPO, subpath: "profiles/a", tag: "v1.0.0" },
      project,
      project,
      mockReadFile(manifests),
      { runGit },
    );

    assertEquals(result.chain, null);
    assertEquals(result.diagnostics.map((d) => d.code), ["PROFILE-LOAD-001"]);
    const [diagnostic] = result.diagnostics;
    assertEquals(
      diagnostic.message.includes("leaves the repository root"),
      true,
    );
    assertEquals(diagnostic.message.includes("profiles/a"), true);
    // The diagnostic points at the child manifest that declares the path.
    assertEquals(diagnostic.location?.file, Object.keys(manifests)[0]);
    assertEquals(gitCalls, []); // rejected before any fetch
  });
}

Deno.test("loadChain: relative extends reads the parent at the child's tag (#1002)", async () => {
  const project = resolve("/project");
  const tag = "a/v1.2.0";
  const result = await loadChain(
    { kind: "git", repo: MONOREPO, subpath: "profiles/a", tag },
    project,
    project,
    mockReadFile(
      await gitManifests(project, {
        "profiles/a": manifest("@org/a", "../core"),
        "profiles/core": manifest("@org/core"),
      }, tag),
    ),
    { runGit: noGit },
  );

  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers[0].specifier, {
    kind: "git",
    repo: MONOREPO,
    subpath: "profiles/core",
    tag,
  });
});

Deno.test("loadChain: relative extends that leaves the root from a git root profile names subpath '.' (#1002)", async () => {
  const project = resolve("/project");
  const gitCalls: string[][] = [];
  const runGit: RunGit = (args) => {
    gitCalls.push([...args]);
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };
  const result = await loadChain(
    { kind: "git", repo: MONOREPO, subpath: undefined, tag: "v1.0.0" },
    project,
    project,
    mockReadFile(
      await gitManifests(project, { "": manifest("@org/root", "../x") }),
    ),
    { runGit },
  );

  assertEquals(result.chain, null);
  assertEquals(gitCalls, []); // rejected before any fetch
  assertEquals(result.diagnostics.map((d) => d.code), ["PROFILE-LOAD-001"]);
  assertEquals(
    result.diagnostics[0].message.includes("(declared in subpath '.')"),
    true,
  );
});

Deno.test("loadChain: relative extends with a trailing slash resolves to the same subpath (#1002)", async () => {
  const project = resolve("/project");
  const result = await loadChain(
    { kind: "git", repo: MONOREPO, subpath: "profiles/a", tag: "v1.0.0" },
    project,
    project,
    mockReadFile(
      await gitManifests(project, {
        "profiles/a": manifest("@org/a", "../core/"),
        "profiles/core": manifest("@org/core"),
      }),
    ),
    { runGit: noGit },
  );

  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers[0].specifier, {
    kind: "git",
    repo: MONOREPO,
    subpath: "profiles/core",
    tag: "v1.0.0",
  });
});

Deno.test("loadChain: cycle through relative extends in a git repo emits PROFILE-LOAD-004 (#1002)", async () => {
  const project = resolve("/project");
  const result = await loadChain(
    { kind: "git", repo: MONOREPO, subpath: "profiles/a", tag: "v1.0.0" },
    project,
    project,
    mockReadFile(
      await gitManifests(project, {
        "profiles/a": manifest("@org/a", "../b"),
        "profiles/b": manifest("@org/b", "../a"),
      }),
    ),
    { runGit: noGit },
  );

  assertEquals(result.chain, null);
  assertEquals(result.diagnostics.map((d) => d.code), ["PROFILE-LOAD-004"]);
});

// ---------------------------------------------------------------------------
// Relative extends in an npm-fetched profile (#1006)
// ---------------------------------------------------------------------------

const NPM_CACHE = resolve("/cache/markspec");
const NPM_PACKAGE_DIR = join(NPM_CACHE, "npm", "@org", "profile-a", "1.0.0");
const NPM_LEAF = {
  kind: "npm",
  scope: "@org",
  name: "profile-a",
  range: "^1",
} as const;

/** An npm runner whose `pack` names the 1.0.0 tarball; the package is
 * already unpacked in the cache, so nothing is extracted. */
const npmPacksA100: RunNpm = () =>
  Promise.resolve({ code: 0, stdout: "org-profile-a-1.0.0.tgz\n", stderr: "" });

for (
  const parentPath of ["./base", "../1.0.0/base", "./..base"]
) {
  Deno.test(`loadChain: relative extends '${parentPath}' inside an npm package resolves in the package (#1006)`, async () => {
    const project = resolve("/project");
    const result = await loadChain(
      NPM_LEAF,
      project,
      project,
      mockReadFile({
        [join(NPM_PACKAGE_DIR, "markspec.yaml")]: manifest(
          "@org/profile-a",
          parentPath,
        ),
        [join(NPM_PACKAGE_DIR, parentPath, "markspec.yaml")]: manifest(
          "@org/base",
        ),
      }),
      { runNpm: npmPacksA100, npmCacheRoot: NPM_CACHE },
    );

    assertEquals(result.diagnostics, []);
    assertEquals(result.chain?.tiers.map((t) => t.id), [
      "@org/base",
      "@org/profile-a",
    ]);
  });
}

/** The PROFILE-LOAD-001 message for a relative `extends:` that leaves the
 * package of {@linkcode NPM_LEAF}. */
function leavesNpmPackage(parentPath: string): string {
  return `profile specifier '${parentPath}' cannot be resolved: the relative ` +
    `path leaves the package root of npm:@org/profile-a@^1; publish the ` +
    `parent profile as its own package and extend it with an npm: ` +
    `specifier`;
}

/** Another package already in the cache: a relative path must not read it. */
const CACHED_CORE = {
  [join(NPM_CACHE, "npm", "@org", "core", "1.0.0", "markspec.yaml")]: manifest(
    "@org/core",
  ),
};

Deno.test("loadChain: relative extends that leaves an npm package emits PROFILE-LOAD-001 (#1006)", async () => {
  const project = resolve("/project");
  const leafManifest = join(NPM_PACKAGE_DIR, "markspec.yaml");
  for (const parentPath of ["../core", "../../core/1.0.0", "../"]) {
    const result = await loadChain(
      NPM_LEAF,
      project,
      project,
      mockReadFile({
        [leafManifest]: manifest("@org/profile-a", parentPath),
        ...CACHED_CORE,
      }),
      { runNpm: npmPacksA100, npmCacheRoot: NPM_CACHE },
    );

    assertEquals(result.chain, null, parentPath);
    assertEquals(
      result.diagnostics.map((d) => [d.code, d.severity]),
      [["PROFILE-LOAD-001", "error"]],
      parentPath,
    );
    assertEquals(result.diagnostics[0].message, leavesNpmPackage(parentPath));
    assertEquals(result.diagnostics[0].location?.file, leafManifest);
  }
});

Deno.test({
  name:
    "loadChain: relative extends that leaves an npm package through backslash segments emits PROFILE-LOAD-001 on Windows (#1006)",
  // A backslash is a path separator only on Windows; elsewhere it is part
  // of a file name and the path stays inside the package.
  ignore: Deno.build.os !== "windows",
  fn: async () => {
    const project = resolve("/project");
    const leafManifest = join(NPM_PACKAGE_DIR, "markspec.yaml");
    for (const parentPath of ["./..\\core", "../1.0.0\\..\\..\\core"]) {
      const result = await loadChain(
        NPM_LEAF,
        project,
        project,
        mockReadFile({
          [leafManifest]: manifest("@org/profile-a", parentPath),
          ...CACHED_CORE,
        }),
        { runNpm: npmPacksA100, npmCacheRoot: NPM_CACHE },
      );

      assertEquals(result.chain, null, parentPath);
      assertEquals(
        result.diagnostics.map((d) => d.code),
        ["PROFILE-LOAD-001"],
        parentPath,
      );
      assertEquals(result.diagnostics[0].message, leavesNpmPackage(parentPath));
    }
  },
});

Deno.test("loadChain: relative extends that leaves an npm package from a nested local tier emits PROFILE-LOAD-001 (#1006)", async () => {
  const project = resolve("/project");
  const baseManifest = join(NPM_PACKAGE_DIR, "base", "markspec.yaml");
  const result = await loadChain(
    NPM_LEAF,
    project,
    project,
    mockReadFile({
      [join(NPM_PACKAGE_DIR, "markspec.yaml")]: manifest(
        "@org/profile-a",
        "./base",
      ),
      [baseManifest]: manifest("@org/base", "../../../core/1.0.0"),
      ...CACHED_CORE,
    }),
    { runNpm: npmPacksA100, npmCacheRoot: NPM_CACHE },
  );

  assertEquals(result.chain, null);
  assertEquals(
    result.diagnostics.map((d) => [d.code, d.severity]),
    [["PROFILE-LOAD-001", "error"]],
  );
  assertEquals(
    result.diagnostics[0].message,
    leavesNpmPackage("../../../core/1.0.0"),
  );
  assertEquals(result.diagnostics[0].location?.file, baseManifest);
});

const NPM_CORE_DIR = join(NPM_CACHE, "npm", "@org", "core", "1.0.0");

/** An npm runner whose `pack` names the 1.0.0 tarball of the requested
 * package (`@org/profile-a` or `@org/core`), both already in the cache. */
const npmPacksBoth: RunNpm = (args) =>
  Promise.resolve({
    code: 0,
    stdout: String(args[1]).startsWith("@org/core")
      ? "org-core-1.0.0.tgz\n"
      : "org-profile-a-1.0.0.tgz\n",
    stderr: "",
  });

Deno.test("loadChain: a nested local tier in an npm package resolves its parent from its own directory (#1006)", async () => {
  const project = resolve("/project");
  const result = await loadChain(
    NPM_LEAF,
    project,
    project,
    mockReadFile({
      [join(NPM_PACKAGE_DIR, "markspec.yaml")]: manifest(
        "@org/profile-a",
        "./a",
      ),
      [join(NPM_PACKAGE_DIR, "a", "markspec.yaml")]: manifest("@org/a", "./b"),
      [join(NPM_PACKAGE_DIR, "a", "b", "markspec.yaml")]: manifest(
        "@org/b",
        "../../shared",
      ),
      [join(NPM_PACKAGE_DIR, "shared", "markspec.yaml")]: manifest(
        "@org/shared",
      ),
    }),
    { runNpm: npmPacksA100, npmCacheRoot: NPM_CACHE },
  );

  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.map((t) => t.id), [
    "@org/shared",
    "@org/b",
    "@org/a",
    "@org/profile-a",
  ]);
});

Deno.test("loadChain: relative extends two local tiers deep that leaves an npm package emits PROFILE-LOAD-001 (#1006)", async () => {
  const project = resolve("/project");
  const bManifest = join(NPM_PACKAGE_DIR, "a", "b", "markspec.yaml");
  const result = await loadChain(
    NPM_LEAF,
    project,
    project,
    mockReadFile({
      [join(NPM_PACKAGE_DIR, "markspec.yaml")]: manifest(
        "@org/profile-a",
        "./a",
      ),
      [join(NPM_PACKAGE_DIR, "a", "markspec.yaml")]: manifest("@org/a", "./b"),
      [bManifest]: manifest("@org/b", "../../../../core/1.0.0"),
      ...CACHED_CORE,
    }),
    { runNpm: npmPacksA100, npmCacheRoot: NPM_CACHE },
  );

  assertEquals(result.chain, null);
  assertEquals(result.diagnostics.map((d) => d.code), ["PROFILE-LOAD-001"]);
  assertEquals(
    result.diagnostics[0].message,
    leavesNpmPackage("../../../../core/1.0.0"),
  );
  assertEquals(result.diagnostics[0].location?.file, bManifest);
});

Deno.test("loadChain: an npm parent replaces the package that confines relative extends (#1006)", async () => {
  const project = resolve("/project");
  const leaf = manifest("@org/profile-a", "npm:@org/core@^1");
  const inside = await loadChain(
    NPM_LEAF,
    project,
    project,
    mockReadFile({
      [join(NPM_PACKAGE_DIR, "markspec.yaml")]: leaf,
      [join(NPM_CORE_DIR, "markspec.yaml")]: manifest("@org/core", "./base"),
      [join(NPM_CORE_DIR, "base", "markspec.yaml")]: manifest(
        "@org/core-base",
      ),
    }),
    { runNpm: npmPacksBoth, npmCacheRoot: NPM_CACHE },
  );
  assertEquals(inside.diagnostics, []);
  assertEquals(inside.chain?.tiers.map((t) => t.id), [
    "@org/core-base",
    "@org/core",
    "@org/profile-a",
  ]);

  const outside = await loadChain(
    NPM_LEAF,
    project,
    project,
    mockReadFile({
      [join(NPM_PACKAGE_DIR, "markspec.yaml")]: leaf,
      [join(NPM_CORE_DIR, "markspec.yaml")]: manifest(
        "@org/core",
        "../../profile-a/1.0.0",
      ),
    }),
    { runNpm: npmPacksBoth, npmCacheRoot: NPM_CACHE },
  );
  assertEquals(outside.chain, null);
  assertEquals(outside.diagnostics.map((d) => d.code), ["PROFILE-LOAD-001"]);
  assertEquals(
    outside.diagnostics[0].message,
    "profile specifier '../../profile-a/1.0.0' cannot be resolved: the " +
      "relative path leaves the package root of npm:@org/core@^1; publish " +
      "the parent profile as its own package and extend it with an npm: " +
      "specifier",
  );
});
