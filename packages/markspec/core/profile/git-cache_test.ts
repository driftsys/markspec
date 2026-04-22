/**
 * @module core/profile/git-cache_test
 *
 * Unit tests for the git cache — key derivation, path computation.
 */

import { assertEquals } from "@std/assert";
import { computeCacheKey, computeCacheLocation } from "./git-cache.ts";
import type { RunGitResult } from "./git-cache.ts";
import { defaultRunGit } from "./git-cache.ts";

Deno.test("computeCacheKey: stable sha256 of (repo, subpath, tag)", async () => {
  const k1 = await computeCacheKey({
    repo: "https://github.com/acme/repo.git",
    subpath: undefined,
    tag: "v1.0.0",
  });
  const k2 = await computeCacheKey({
    repo: "https://github.com/acme/repo.git",
    subpath: undefined,
    tag: "v1.0.0",
  });
  assertEquals(k1, k2); // deterministic
  assertEquals(k1.length, 64); // sha256 hex
});

Deno.test("computeCacheKey: different tags produce different keys", async () => {
  const k1 = await computeCacheKey({
    repo: "https://github.com/acme/repo.git",
    subpath: undefined,
    tag: "v1.0.0",
  });
  const k2 = await computeCacheKey({
    repo: "https://github.com/acme/repo.git",
    subpath: undefined,
    tag: "v2.0.0",
  });
  if (k1 === k2) {
    throw new Error("different tags must produce different keys");
  }
});

Deno.test("computeCacheKey: subpath differentiates keys", async () => {
  const k1 = await computeCacheKey({
    repo: "https://github.com/acme/repo.git",
    subpath: "aspice",
    tag: "v1.0.0",
  });
  const k2 = await computeCacheKey({
    repo: "https://github.com/acme/repo.git",
    subpath: undefined,
    tag: "v1.0.0",
  });
  if (k1 === k2) {
    throw new Error("subpath presence must affect the key");
  }
});

Deno.test("computeCacheLocation: returns absolute cache dir + manifest path", async () => {
  const loc = await computeCacheLocation(
    "/project",
    {
      repo: "https://github.com/acme/repo.git",
      subpath: undefined,
      tag: "v1.0.0",
    },
  );
  // cache dir: <project-root>/.markspec/cache/<key>/
  if (!loc.dir.startsWith("/project/.markspec/cache/")) {
    throw new Error(
      `expected cache dir under /project/.markspec/cache/, got ${loc.dir}`,
    );
  }
  assertEquals(loc.manifestPath, `${loc.dir}/markspec.yaml`);
});

Deno.test("computeCacheLocation: subpath appears in manifest path", async () => {
  const loc = await computeCacheLocation(
    "/project",
    {
      repo: "https://github.com/acme/repo.git",
      subpath: "aspice",
      tag: "v1.0.0",
    },
  );
  assertEquals(loc.manifestPath, `${loc.dir}/aspice/markspec.yaml`);
});

Deno.test("defaultRunGit: captures stdout/stderr from a trivial git command", async () => {
  const result: RunGitResult = await defaultRunGit(["--version"]);
  assertEquals(result.code, 0);
  if (!result.stdout.startsWith("git version")) {
    throw new Error(`unexpected output: ${result.stdout}`);
  }
});

Deno.test("defaultRunGit: nonzero exit code is captured, not thrown", async () => {
  const result = await defaultRunGit(["this-subcommand-does-not-exist"]);
  if (result.code === 0) {
    throw new Error("expected nonzero exit for unknown subcommand");
  }
  // stderr should mention the bad subcommand
  if (!result.stderr.includes("this-subcommand-does-not-exist")) {
    throw new Error(
      `stderr did not mention the bad subcommand: ${result.stderr}`,
    );
  }
});

import { ensureCacheGitignored } from "./git-cache.ts";

// File-system stubs the helper uses.
interface FsStub {
  read: (path: string) => Promise<string | undefined>;
  append: (path: string, content: string) => Promise<void>;
  writes: { path: string; content: string }[];
}

function fsStub(initial: Record<string, string> = {}): FsStub {
  const files = { ...initial };
  const writes: { path: string; content: string }[] = [];
  return {
    read: (path) => Promise.resolve(files[path]),
    append: (path, content) => {
      files[path] = (files[path] ?? "") + content;
      writes.push({ path, content });
      return Promise.resolve();
    },
    writes,
  };
}

Deno.test("ensureCacheGitignored: appends entry when missing", async () => {
  const fs = fsStub({ "/project/.gitignore": "node_modules/\n" });
  await ensureCacheGitignored("/project", fs.read, fs.append);
  assertEquals(fs.writes.length, 1);
  assertEquals(fs.writes[0].path, "/project/.gitignore");
  if (!fs.writes[0].content.includes(".markspec/cache/")) {
    throw new Error(
      `expected .markspec/cache/ in appended content: ${fs.writes[0].content}`,
    );
  }
});

Deno.test("ensureCacheGitignored: idempotent when entry already present", async () => {
  const fs = fsStub({
    "/project/.gitignore": "node_modules/\n.markspec/cache/\n",
  });
  await ensureCacheGitignored("/project", fs.read, fs.append);
  assertEquals(fs.writes.length, 0);
});

Deno.test("ensureCacheGitignored: idempotent when broader .markspec/ is present", async () => {
  const fs = fsStub({ "/project/.gitignore": ".markspec/\n" });
  await ensureCacheGitignored("/project", fs.read, fs.append);
  assertEquals(fs.writes.length, 0);
});

Deno.test("ensureCacheGitignored: no-op when .gitignore absent", async () => {
  const fs = fsStub({});
  await ensureCacheGitignored("/project", fs.read, fs.append);
  assertEquals(fs.writes.length, 0);
});
