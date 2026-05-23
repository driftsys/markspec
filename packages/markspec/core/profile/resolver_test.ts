/**
 * @module core/profile/resolver_test
 *
 * Unit tests for local profile specifier resolution.
 */

import { assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import { resolveGitSpecifier, resolveLocalSpecifier } from "./resolver.ts";
import { computeCacheLocation } from "./git-cache.ts";
import type { RunGit } from "./git-cache.ts";
import type { Diagnostic } from "../model/mod.ts";

function mockReadFile(map: Record<string, string>) {
  return (path: string): Promise<string | undefined> =>
    Promise.resolve(map[path]);
}

Deno.test("resolveLocalSpecifier: happy path reads markspec.yaml", async () => {
  const project = resolve("/project");
  const customDir = join(project, "profiles", "custom");
  const customYaml = join(customDir, "markspec.yaml");
  const diagnostics: Diagnostic[] = [];
  const result = await resolveLocalSpecifier(
    { kind: "local", path: "./profiles/custom" },
    project,
    mockReadFile({
      [customYaml]: "id: @acme/x\nversion: 1.0.0\n",
    }),
    diagnostics,
  );
  assertEquals(diagnostics, []);
  assertEquals(result?.rawYaml, "id: @acme/x\nversion: 1.0.0\n");
  assertEquals(result?.sourcePath, customYaml);
  assertEquals(result?.baseDir, customDir);
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
  const workspace = resolve("/workspace");
  const project = join(workspace, "project");
  const baseDir = join(workspace, "shared", "base");
  const baseYaml = join(baseDir, "markspec.yaml");
  const diagnostics: Diagnostic[] = [];
  const result = await resolveLocalSpecifier(
    { kind: "local", path: "../shared/base" },
    project,
    mockReadFile({
      [baseYaml]: "id: @acme/base\nversion: 1.0.0\n",
    }),
    diagnostics,
  );
  assertEquals(diagnostics, []);
  assertEquals(result?.sourcePath, baseYaml);
  assertEquals(result?.baseDir, baseDir);
});

// A RunGit that records what it would have done without touching the
// filesystem. Stays unused on the cache-hit path.
function mockRunGit(): { runGit: RunGit; calls: string[][] } {
  const calls: string[][] = [];
  const runGit: RunGit = (args) => {
    calls.push([...args]);
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };
  return { runGit, calls };
}

Deno.test("resolveGitSpecifier: cache hit reads markspec.yaml, never calls git", async () => {
  const diagnostics: Diagnostic[] = [];
  const { runGit, calls } = mockRunGit();

  const spec = {
    kind: "git" as const,
    repo: "https://github.com/acme/repo.git",
    subpath: undefined,
    tag: "v1.0.0",
  };
  const loc = await computeCacheLocation("/project", spec);

  const result = await resolveGitSpecifier(
    spec,
    "/project",
    mockReadFile({
      [loc.manifestPath]: "id: @acme/cached\nversion: 1.0.0\n",
    }),
    diagnostics,
    { runGit },
  );

  assertEquals(diagnostics, []);
  assertEquals(result?.rawYaml, "id: @acme/cached\nversion: 1.0.0\n");
  assertEquals(result?.sourcePath, loc.manifestPath);
  assertEquals(result?.baseDir, loc.dir);
  assertEquals(calls.length, 0); // git never invoked
});

Deno.test("resolveGitSpecifier: cache miss emits PROFILE-LOAD-001 (pre-Task-4.4 scaffold)", async () => {
  const diagnostics: Diagnostic[] = [];
  const { runGit } = mockRunGit();

  const result = await resolveGitSpecifier(
    {
      kind: "git",
      repo: "https://github.com/acme/repo.git",
      subpath: undefined,
      tag: "v1.0.0",
    },
    "/project",
    mockReadFile({}), // empty — no cache
    diagnostics,
    { runGit },
  );

  assertEquals(result, null);
  assertEquals(diagnostics[0].code, "PROFILE-LOAD-001");
});

/**
 * A recording RunGit that also lets the test simulate filesystem side effects
 * by writing into a shared file-map.
 */
function recordingRunGit(options: {
  files: Record<string, string>;
  onClone?: (cloneDir: string) => void;
}): { runGit: RunGit; calls: string[][] } {
  const calls: string[][] = [];
  const runGit: RunGit = (args, cwd) => {
    calls.push([...args]);
    // If the first arg is "clone", simulate the post-clone state by invoking
    // `onClone` so the test harness can populate the file-map.
    if (args[0] === "clone" && options.onClone !== undefined) {
      const cloneDir = args[args.length - 1];
      options.onClone(cloneDir);
    }
    // If the cwd is the clone dir and args is a sparse-checkout or checkout,
    // succeed silently.
    void cwd;
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };
  return { runGit, calls };
}

Deno.test(
  "resolveGitSpecifier: cache miss clones, checks out tag, reads yaml",
  async () => {
    const project = resolve("/project");
    const diagnostics: Diagnostic[] = [];
    const spec = {
      kind: "git" as const,
      repo: "https://github.com/acme/repo.git",
      subpath: undefined,
      tag: "v1.0.0",
    };
    const loc = await computeCacheLocation(project, spec);

    const files: Record<string, string> = {};
    const { runGit, calls } = recordingRunGit({
      files,
      onClone: (cloneDir) => {
        // Simulate the clone writing the manifest into the cache dir.
        files[join(cloneDir, "markspec.yaml")] =
          "id: @acme/cloned\nversion: 1.0.0\n";
      },
    });

    const result = await resolveGitSpecifier(
      spec,
      project,
      (path) => Promise.resolve(files[path]),
      diagnostics,
      { runGit },
    );

    assertEquals(diagnostics, []);
    assertEquals(result?.rawYaml, "id: @acme/cloned\nversion: 1.0.0\n");
    // First call is `clone` with the expected flags.
    const cloneCall = calls[0];
    assertEquals(cloneCall[0], "clone");
    if (!cloneCall.includes("--depth=1")) {
      throw new Error(`expected --depth=1 in clone args: ${cloneCall}`);
    }
    if (!cloneCall.includes("--filter=blob:none")) {
      throw new Error(
        `expected --filter=blob:none in clone args: ${cloneCall}`,
      );
    }
    if (!cloneCall.includes("--branch=v1.0.0")) {
      throw new Error(`expected --branch=v1.0.0 in clone args: ${cloneCall}`);
    }
    if (!cloneCall.includes(spec.repo)) {
      throw new Error(`expected repo URL in clone args: ${cloneCall}`);
    }
    if (!cloneCall.includes(loc.dir)) {
      throw new Error(`expected cache dir in clone args: ${cloneCall}`);
    }
  },
);

Deno.test("resolveGitSpecifier: subpath triggers sparse-checkout call", async () => {
  const project = resolve("/project");
  const diagnostics: Diagnostic[] = [];
  const spec = {
    kind: "git" as const,
    repo: "https://github.com/acme/repo.git",
    subpath: "aspice",
    tag: "v1.0.0",
  };
  const loc = await computeCacheLocation(project, spec);

  const files: Record<string, string> = {};
  const { runGit, calls } = recordingRunGit({
    files,
    onClone: (cloneDir) => {
      files[join(cloneDir, "aspice", "markspec.yaml")] =
        "id: @acme/sub\nversion: 1.0.0\n";
    },
  });

  const result = await resolveGitSpecifier(
    spec,
    project,
    (path) => Promise.resolve(files[path]),
    diagnostics,
    { runGit },
  );

  assertEquals(diagnostics, []);
  assertEquals(result?.rawYaml, "id: @acme/sub\nversion: 1.0.0\n");

  // Sequence: clone → sparse-checkout set <subpath> → checkout <tag>
  const sparseCall = calls.find((c) => c[0] === "sparse-checkout");
  if (!sparseCall || sparseCall[1] !== "set" || sparseCall[2] !== "aspice") {
    throw new Error(`expected sparse-checkout set aspice, got ${calls}`);
  }
  const checkoutCall = calls.find((c) => c[0] === "checkout");
  if (!checkoutCall || checkoutCall[1] !== spec.tag) {
    throw new Error(`expected checkout ${spec.tag}, got ${calls}`);
  }
  void loc;
});

Deno.test("resolveGitSpecifier: git clone failure emits PROFILE-LOAD-001", async () => {
  const diagnostics: Diagnostic[] = [];
  const failingRunGit: RunGit = (args) => {
    if (args[0] === "clone") {
      return Promise.resolve({
        code: 128,
        stdout: "",
        stderr: "fatal: repository not found",
      });
    }
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };

  const result = await resolveGitSpecifier(
    {
      kind: "git",
      repo: "https://github.com/acme/missing.git",
      subpath: undefined,
      tag: "v1.0.0",
    },
    "/project",
    (_path) => Promise.resolve(undefined),
    diagnostics,
    { runGit: failingRunGit },
  );

  assertEquals(result, null);
  assertEquals(diagnostics[0].code, "PROFILE-LOAD-001");
  const msg = diagnostics[0].message;
  if (!msg.includes("fatal: repository not found")) {
    throw new Error(`expected git stderr in message: ${msg}`);
  }
});

Deno.test("resolveGitSpecifier: clone succeeds but markspec.yaml absent emits PROFILE-LOAD-001", async () => {
  const diagnostics: Diagnostic[] = [];
  const { runGit } = recordingRunGit({
    files: {},
    onClone: () => {
      /* intentionally do not populate the manifest */
    },
  });

  const result = await resolveGitSpecifier(
    {
      kind: "git",
      repo: "https://github.com/acme/repo.git",
      subpath: undefined,
      tag: "v1.0.0",
    },
    "/project",
    (_path) => Promise.resolve(undefined),
    diagnostics,
    { runGit },
  );

  assertEquals(result, null);
  assertEquals(diagnostics[0].code, "PROFILE-LOAD-001");
  const msg = diagnostics[0].message;
  if (!msg.toLowerCase().includes("markspec.yaml")) {
    throw new Error(`expected mention of markspec.yaml: ${msg}`);
  }
});
