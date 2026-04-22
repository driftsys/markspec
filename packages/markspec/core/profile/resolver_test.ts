/**
 * @module core/profile/resolver_test
 *
 * Unit tests for local profile specifier resolution.
 */

import { assertEquals } from "@std/assert";
import { resolveGitSpecifier, resolveLocalSpecifier } from "./resolver.ts";
import { computeCacheLocation } from "./git-cache.ts";
import type { RunGit } from "./git-cache.ts";
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
