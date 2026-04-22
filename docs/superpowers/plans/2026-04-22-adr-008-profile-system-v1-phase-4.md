# ADR-008 Profile System v1 — Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `git+https://…#<tag>` specifier resolution backed by a
per-project shallow+sparse clone cache, so a profile (or its `extends:` parent)
can live in a git repository rather than a local path.

**Architecture:** A new `core/profile/git-cache.ts` module owns the cache-path
derivation (sha256 of host+repo+subpath+tag), the `git` CLI invocation
(shallow+sparse+no-checkout), and `.gitignore` hygiene. `resolver.ts` gains
`resolveGitSpecifier` that dispatches to the cache: hit → reuse; miss → clone,
sparse-checkout, checkout tag. `loadChain` grows a `projectRoot` parameter so
the cache location is stable regardless of which tier triggered the fetch.
Tag-immutability assumption means no staleness checks.

**Tech Stack:** Deno + TypeScript, `@std/assert`, `@std/crypto` (for sha256),
`@std/path`. External dependency on the `git` CLI at runtime (invoked via
`Deno.Command`). Tests use real `git` against `file://` URLs pointed at local
bare repos.

**Spec:**
[docs/superpowers/specs/2026-04-21-adr-008-profile-system-v1-design.md](../specs/2026-04-21-adr-008-profile-system-v1-design.md)
§7.2 (git fetch mechanics), §7.3 (cache layout).

**Branch:** `feat/profile-system-phase-4`, branched from `main` (which now
carries merged Phases 1–3 via PRs #227, #228, #229, #230).

---

## Scope

### In Phase 4

- **Cache-path derivation** — sha256 of a canonical `(host, repo, subpath, tag)`
  tuple → `<project-root>/.markspec/cache/<sha>/...`.
- **Injectable git CLI runner** — `RunGit` type so unit tests can stub behavior
  without spawning processes; default backed by `Deno.Command("git", …)`.
- **`resolveGitSpecifier`** — shallow + sparse clone, checkout tag, read
  `markspec.yaml` from the (sub)directory. Cache-hit bypasses all of the above.
- **`.gitignore` management** — on first cache use, append `.markspec/cache/` to
  the project's `.gitignore` if the file exists and the entry isn't already
  present. Never creates `.gitignore` if absent.
- **`loadChain` threading `projectRoot`** — new 4th parameter, used only for git
  cache location. `loadProfileForCommand` already has it and passes through.
- **Git specifiers inside an `extends:` chain** — same resolver, works at every
  tier.
- **E2E tests with real `git`** — create a local bare repo in a temp dir,
  commit + tag a fixture profile, point `.markspec.yaml` at
  `git+file://…#<tag>`, run `markspec validate`.

### Deferred (not Phase 4)

- Validator pipeline stages consuming the `EffectiveProfile` — Phases 5–7.
- Generated inverses — Phase 8.
- CLI `profile add` / `doctor` — Phase 9.
- npm distribution scheme — deferred indefinitely (spec §7.1 "v1 subset").
- Auth for private repos — inherits from user's git config (no Phase 4 code);
  documented caveat.
- Cache invalidation strategies beyond "delete the directory" — tags are
  immutable by convention.
- Signature verification on cached profiles — out of scope.

### Diagnostic codes used in Phase 4

| Code               | Severity | Meaning                                                                                                |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------ |
| `PROFILE-LOAD-001` | error    | Git fetch / clone failed, OR cached clone missing `markspec.yaml`. Message distinguishes the sub-case. |

No new codes. `PROFILE-LOAD-001` is already the "specifier unresolvable" code
from Phase 2; Phase 4 reuses it with descriptive messages.

---

## Files this PR creates or modifies

### New files

- `packages/markspec/core/profile/git-cache.ts` — cache-path derivation,
  `.gitignore` hygiene, `RunGit` type + default implementation.
- `packages/markspec/core/profile/git-cache_test.ts` — unit tests with
  injectable `RunGit`.
- `tests/e2e/profile_git_test.ts` — end-to-end tests against real bare repos.
- `tests/e2e/helpers_git.ts` — shared helper for setting up local bare git
  fixtures.

### Modified files

- `packages/markspec/core/profile/resolver.ts` — add `resolveGitSpecifier`.
- `packages/markspec/core/profile/resolver_test.ts` — add git-resolver tests.
- `packages/markspec/core/profile/chain.ts` — thread `projectRoot` through
  `loadChain`, route git specifiers to `resolveGitSpecifier`, remove Phase-2
  stub messages.
- `packages/markspec/core/profile/chain_test.ts` — update existing tests to pass
  `projectRoot`; add git-in-chain tests.
- `packages/markspec/core/profile/load.ts` — pass `projectRoot` into `loadChain`
  (already has it).
- `packages/markspec/core/profile/mod.ts` — export new symbols
  (`resolveGitSpecifier`, `RunGit`, `defaultRunGit`, cache helpers).
- `packages/markspec/core/mod.ts` — re-export.

No changes to: `core/validator/**`, `core/compiler/**`, `core/parser/**`,
`main.ts`, `core/model/**`.

---

## Task overview

| #   | Task                                            | Files touched                                                                                 |
| --- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 4.1 | Cache key + path helpers                        | `profile/git-cache.ts`, `profile/git-cache_test.ts`                                           |
| 4.2 | Git CLI runner abstraction + `defaultRunGit`    | `profile/git-cache.ts`, `profile/git-cache_test.ts`                                           |
| 4.3 | `resolveGitSpecifier` scaffold — cache-hit path | `profile/resolver.ts`, `profile/resolver_test.ts`                                             |
| 4.4 | `resolveGitSpecifier` — clone on cache miss     | `profile/resolver.ts`, `profile/resolver_test.ts`                                             |
| 4.5 | `.gitignore` management on first fetch          | `profile/git-cache.ts`, `profile/git-cache_test.ts`, `profile/resolver.ts`                    |
| 4.6 | Wire `projectRoot` through `loadChain`          | `profile/chain.ts`, `profile/chain_test.ts`, `profile/load.ts`                                |
| 4.7 | Barrel exports                                  | `profile/mod.ts`, `core/mod.ts`                                                               |
| 4.8 | E2E tests with real `git` + local bare repos    | `tests/e2e/helpers_git.ts`, `tests/e2e/profile_git_test.ts`, fixture folder in tests/fixtures |

Each task is one commit. Every task follows TDD.

---

## Task 4.1 — Cache key + path helpers

Add the pure-function helpers that derive a stable filesystem path for a given
git specifier. No I/O yet.

**Files:**

- Create: `packages/markspec/core/profile/git-cache.ts`
- Create: `packages/markspec/core/profile/git-cache_test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/markspec/core/profile/git-cache_test.ts`:

```typescript
/**
 * @module core/profile/git-cache_test
 *
 * Unit tests for the git cache — key derivation, path computation.
 */

import { assertEquals } from "@std/assert";
import { computeCacheKey, computeCacheLocation } from "./git-cache.ts";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test packages/markspec/core/profile/git-cache_test.ts` Expected: FAIL
with `Cannot find module './git-cache.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/markspec/core/profile/git-cache.ts`:

```typescript
/**
 * @module core/profile/git-cache
 *
 * Cache + `git` CLI infrastructure for git-specifier resolution.
 *
 * The cache lives under `<project-root>/.markspec/cache/<sha>/` where `<sha>`
 * is the sha256 of a canonical `(host, repo, subpath, tag)` tuple. Because
 * the spec requires tag-only specifiers and tags are (by convention)
 * immutable, cached content never needs refresh: either the cache directory
 * exists and contains `markspec.yaml`, or we clone afresh.
 */

import { join } from "@std/path";

/** Components of a git specifier that contribute to the cache key. */
export interface GitCacheKeyInput {
  readonly repo: string;
  readonly subpath: string | undefined;
  readonly tag: string;
}

/**
 * Stable sha256 hex digest of the canonical `(repo, subpath, tag)` tuple.
 * Same inputs → same digest, always.
 */
export async function computeCacheKey(
  input: GitCacheKeyInput,
): Promise<string> {
  const canonical = JSON.stringify([
    input.repo,
    input.subpath ?? "",
    input.tag,
  ]);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Resolved paths for a cache-backed specifier. */
export interface CacheLocation {
  /** sha256 hex key for the specifier. */
  readonly key: string;
  /** Absolute cache directory — where the clone lives (top-level repo). */
  readonly dir: string;
  /** Absolute path of the `markspec.yaml` the resolver needs to read. */
  readonly manifestPath: string;
}

/**
 * Compute the cache location for a git specifier relative to a project root.
 */
export async function computeCacheLocation(
  projectRoot: string,
  input: GitCacheKeyInput,
): Promise<CacheLocation> {
  const key = await computeCacheKey(input);
  const dir = join(projectRoot, ".markspec", "cache", key);
  const manifestPath = input.subpath !== undefined
    ? join(dir, input.subpath, "markspec.yaml")
    : join(dir, "markspec.yaml");
  return { key, dir, manifestPath };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/git-cache_test.ts` Expected: all
5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/git-cache.ts packages/markspec/core/profile/git-cache_test.ts
git commit -m "feat(core): git-cache key + path derivation"
```

---

## Task 4.2 — Git CLI runner abstraction

Expose a `RunGit` function type so resolver code can stay unit-testable. Provide
a `defaultRunGit` that wraps `Deno.Command("git", …)`. The resolver later
injects either the default or a test double.

**Files:**

- Modify: `packages/markspec/core/profile/git-cache.ts`
- Modify: `packages/markspec/core/profile/git-cache_test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/markspec/core/profile/git-cache_test.ts`:

```typescript
import type { RunGitResult } from "./git-cache.ts";
import { defaultRunGit } from "./git-cache.ts";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
`deno test --allow-run=git packages/markspec/core/profile/git-cache_test.ts`
Expected: FAIL with `defaultRunGit is not exported` (or similar).

- [ ] **Step 3: Implement the runner**

Append to `packages/markspec/core/profile/git-cache.ts`:

```typescript
/** Result of running a git subcommand — captures exit code + output streams. */
export interface RunGitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Inject this into the resolver to stub git invocations in unit tests.
 * Production code uses {@linkcode defaultRunGit}.
 */
export type RunGit = (
  args: readonly string[],
  cwd?: string,
) => Promise<RunGitResult>;

const textDecoder = new TextDecoder();

/**
 * Default implementation backed by `Deno.Command("git", …)`. Captures stdout
 * and stderr; never throws for nonzero exit — callers inspect `result.code`.
 *
 * Requires `--allow-run=git` at the Deno CLI level.
 */
export const defaultRunGit: RunGit = async (args, cwd) => {
  const cmd = new Deno.Command("git", {
    args: [...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  return {
    code,
    stdout: textDecoder.decode(stdout),
    stderr: textDecoder.decode(stderr),
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
`deno test --allow-run=git packages/markspec/core/profile/git-cache_test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/git-cache.ts packages/markspec/core/profile/git-cache_test.ts
git commit -m "feat(core): RunGit abstraction + Deno.Command default"
```

---

## Task 4.3 — `resolveGitSpecifier` scaffold — cache-hit path

Implement `resolveGitSpecifier` enough to handle a cache-hit: the cache dir
already exists and contains `markspec.yaml`. A cache-miss emits
`PROFILE-LOAD-001` with a temporary "cache empty" message (Task 4.4 replaces the
miss branch with a real clone).

**Files:**

- Modify: `packages/markspec/core/profile/resolver.ts`
- Modify: `packages/markspec/core/profile/resolver_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/markspec/core/profile/resolver_test.ts`:

```typescript
import { resolveGitSpecifier } from "./resolver.ts";
import { computeCacheLocation } from "./git-cache.ts";
import type { RunGit } from "./git-cache.ts";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/resolver_test.ts` Expected: FAIL
— `resolveGitSpecifier` not exported.

- [ ] **Step 3: Implement `resolveGitSpecifier` cache-hit path**

Modify `packages/markspec/core/profile/resolver.ts`. Add imports:

```typescript
import { computeCacheLocation, defaultRunGit } from "./git-cache.ts";
import type { RunGit } from "./git-cache.ts";
```

Append after the existing `resolveLocalSpecifier`:

```typescript
/** Options accepted by {@linkcode resolveGitSpecifier}. */
export interface ResolveGitOptions {
  /** Injectable git runner — defaults to {@linkcode defaultRunGit}. */
  readonly runGit?: RunGit;
}

/**
 * Resolve a git specifier via a per-project shallow+sparse clone cache.
 *
 * On cache hit: reads `markspec.yaml` from the cached location.
 * On cache miss: Task 4.4 implements the clone; for now emits
 * `PROFILE-LOAD-001`.
 *
 * @param specifier - The git-kind specifier
 * @param projectRoot - Absolute path of the project root (holds `.markspec/cache/`)
 * @param readFile - File reader abstraction
 * @param diagnostics - Accumulator for errors
 * @param opts - Injectable runner (optional, defaults to real `git`)
 */
export async function resolveGitSpecifier(
  specifier: Extract<ProfileSpecifier, { kind: "git" }>,
  projectRoot: string,
  readFile: ReadFile,
  diagnostics: Diagnostic[],
  opts: ResolveGitOptions = {},
): Promise<ResolvedProfileSource | null> {
  // Silence the "runGit is unused" lint — Task 4.4 wires it in.
  const _runGit = opts.runGit ?? defaultRunGit;
  void _runGit;

  const location = await computeCacheLocation(projectRoot, {
    repo: specifier.repo,
    subpath: specifier.subpath,
    tag: specifier.tag,
  });

  const rawYaml = await readFile(location.manifestPath);
  if (rawYaml !== undefined) {
    return {
      rawYaml,
      sourcePath: location.manifestPath,
      baseDir: specifier.subpath !== undefined
        // baseDir is the directory containing the manifest (subpath-relative
        // when subpath is set so the profile's own extends: resolves against
        // the profile's directory, not the repo root).
        ? location.manifestPath.slice(0, -"/markspec.yaml".length)
        : location.dir,
    };
  }

  diagnostics.push({
    code: "PROFILE-LOAD-001",
    severity: "error",
    message: `git profile cache miss at ${location.dir} ` +
      `(Phase 4 Task 4.4 will replace this with a clone on miss)`,
    location: { file: location.dir, line: 1, column: 1 },
  });
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/resolver_test.ts` Expected: all
tests pass (3 from Phase 2 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/resolver.ts packages/markspec/core/profile/resolver_test.ts
git commit -m "feat(core): resolveGitSpecifier scaffold with cache-hit path"
```

---

## Task 4.4 — `resolveGitSpecifier` — clone on cache miss

Replace the miss-branch `PROFILE-LOAD-001` stub with the real clone-and-checkout
sequence. Use the injected `RunGit` so tests can drive arbitrary scenarios
without spawning processes.

**Files:**

- Modify: `packages/markspec/core/profile/resolver.ts`
- Modify: `packages/markspec/core/profile/resolver_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/markspec/core/profile/resolver_test.ts`:

```typescript
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

Deno.test("resolveGitSpecifier: cache miss clones, checks out tag, reads yaml", async () => {
  const diagnostics: Diagnostic[] = [];
  const spec = {
    kind: "git" as const,
    repo: "https://github.com/acme/repo.git",
    subpath: undefined,
    tag: "v1.0.0",
  };
  const loc = await computeCacheLocation("/project", spec);

  const files: Record<string, string> = {};
  const { runGit, calls } = recordingRunGit({
    files,
    onClone: (cloneDir) => {
      // Simulate the clone writing the manifest into the cache dir.
      files[`${cloneDir}/markspec.yaml`] = "id: @acme/cloned\nversion: 1.0.0\n";
    },
  });

  const result = await resolveGitSpecifier(
    spec,
    "/project",
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
    throw new Error(`expected --filter=blob:none in clone args: ${cloneCall}`);
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
});

Deno.test("resolveGitSpecifier: subpath triggers sparse-checkout call", async () => {
  const diagnostics: Diagnostic[] = [];
  const spec = {
    kind: "git" as const,
    repo: "https://github.com/acme/repo.git",
    subpath: "aspice",
    tag: "v1.0.0",
  };
  const loc = await computeCacheLocation("/project", spec);

  const files: Record<string, string> = {};
  const { runGit, calls } = recordingRunGit({
    files,
    onClone: (cloneDir) => {
      files[`${cloneDir}/aspice/markspec.yaml`] =
        "id: @acme/sub\nversion: 1.0.0\n";
    },
  });

  const result = await resolveGitSpecifier(
    spec,
    "/project",
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/resolver_test.ts` Expected: the 4
new tests fail — the miss branch currently emits the Task-4.3 stub message.

- [ ] **Step 3: Replace the miss branch with clone**

Rewrite the `resolveGitSpecifier` body in
`packages/markspec/core/profile/resolver.ts`. Replace the entire
`resolveGitSpecifier` function:

```typescript
export async function resolveGitSpecifier(
  specifier: Extract<ProfileSpecifier, { kind: "git" }>,
  projectRoot: string,
  readFile: ReadFile,
  diagnostics: Diagnostic[],
  opts: ResolveGitOptions = {},
): Promise<ResolvedProfileSource | null> {
  const runGit = opts.runGit ?? defaultRunGit;

  const location = await computeCacheLocation(projectRoot, {
    repo: specifier.repo,
    subpath: specifier.subpath,
    tag: specifier.tag,
  });

  // Cache hit?
  const cached = await readFile(location.manifestPath);
  if (cached !== undefined) {
    return buildResolvedSource(cached, location, specifier);
  }

  // Cache miss — clone shallow + sparse, then checkout the tag.
  const cloneResult = await runGit([
    "clone",
    "--depth=1",
    `--branch=${specifier.tag}`,
    "--filter=blob:none",
    "--sparse",
    "--no-checkout",
    specifier.repo,
    location.dir,
  ]);
  if (cloneResult.code !== 0) {
    diagnostics.push({
      code: "PROFILE-LOAD-001",
      severity: "error",
      message: `git clone failed for ${specifier.repo}#${specifier.tag}: ` +
        cloneResult.stderr.trim(),
      location: { file: location.dir, line: 1, column: 1 },
    });
    return null;
  }

  if (specifier.subpath !== undefined) {
    const sparseResult = await runGit(
      ["sparse-checkout", "set", specifier.subpath],
      location.dir,
    );
    if (sparseResult.code !== 0) {
      diagnostics.push({
        code: "PROFILE-LOAD-001",
        severity: "error",
        message:
          `git sparse-checkout failed for ${specifier.repo}#${specifier.tag} ` +
          `subpath '${specifier.subpath}': ${sparseResult.stderr.trim()}`,
        location: { file: location.dir, line: 1, column: 1 },
      });
      return null;
    }
  }

  const checkoutResult = await runGit(
    ["checkout", specifier.tag],
    location.dir,
  );
  if (checkoutResult.code !== 0) {
    diagnostics.push({
      code: "PROFILE-LOAD-001",
      severity: "error",
      message: `git checkout failed for ${specifier.repo}#${specifier.tag}: ` +
        checkoutResult.stderr.trim(),
      location: { file: location.dir, line: 1, column: 1 },
    });
    return null;
  }

  // After clone+checkout, expect the manifest at the computed path.
  const postCloneYaml = await readFile(location.manifestPath);
  if (postCloneYaml === undefined) {
    diagnostics.push({
      code: "PROFILE-LOAD-001",
      severity: "error",
      message:
        `git clone of ${specifier.repo}#${specifier.tag} succeeded but ` +
        `no markspec.yaml at ${location.manifestPath}`,
      location: { file: location.manifestPath, line: 1, column: 1 },
    });
    return null;
  }

  return buildResolvedSource(postCloneYaml, location, specifier);
}

function buildResolvedSource(
  rawYaml: string,
  location: { manifestPath: string; dir: string },
  specifier: Extract<ProfileSpecifier, { kind: "git" }>,
): ResolvedProfileSource {
  const baseDir = specifier.subpath !== undefined
    ? location.manifestPath.slice(0, -"/markspec.yaml".length)
    : location.dir;
  return {
    rawYaml,
    sourcePath: location.manifestPath,
    baseDir,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/resolver_test.ts` Expected: all
tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/resolver.ts packages/markspec/core/profile/resolver_test.ts
git commit -m "feat(core): resolveGitSpecifier clones on cache miss"
```

---

## Task 4.5 — `.gitignore` management on first fetch

When the cache directory is first populated (miss path), ensure
`<project-root>/.gitignore` contains `.markspec/cache/` so the user doesn't
accidentally commit the cache. Idempotent. If `.gitignore` doesn't exist, do
nothing — we don't create it for the user.

**Files:**

- Modify: `packages/markspec/core/profile/git-cache.ts`
- Modify: `packages/markspec/core/profile/git-cache_test.ts`
- Modify: `packages/markspec/core/profile/resolver.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/markspec/core/profile/git-cache_test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/git-cache_test.ts` Expected: 4
new tests FAIL — `ensureCacheGitignored` not exported.

- [ ] **Step 3: Implement the helper**

Append to `packages/markspec/core/profile/git-cache.ts`:

```typescript
/** Injectable appender for {@linkcode ensureCacheGitignored}. */
export type AppendFile = (path: string, content: string) => Promise<void>;

/**
 * Idempotently add `.markspec/cache/` to the project's `.gitignore` if that
 * file exists. No-op when `.gitignore` is absent.
 *
 * @param projectRoot - Absolute path containing the `.gitignore`
 * @param readFile - Abstraction matching `core/config/mod.ts` `ReadFile`
 * @param appendFile - Abstraction that appends a string to a file
 */
export async function ensureCacheGitignored(
  projectRoot: string,
  readFile: (path: string) => Promise<string | undefined>,
  appendFile: AppendFile,
): Promise<void> {
  const gitignorePath = join(projectRoot, ".gitignore");
  const current = await readFile(gitignorePath);
  if (current === undefined) {
    return;
  }
  // Treat any of these patterns as "already ignored" and skip.
  const lines = current.split("\n").map((l) => l.trim());
  const ignored = lines.some((l) =>
    l === ".markspec/" ||
    l === ".markspec/cache/" ||
    l === ".markspec/cache"
  );
  if (ignored) {
    return;
  }
  const needsLeadingNewline = current.length > 0 && !current.endsWith("\n");
  const content = (needsLeadingNewline ? "\n" : "") + ".markspec/cache/\n";
  await appendFile(gitignorePath, content);
}
```

- [ ] **Step 4: Add the default appender**

Still in `packages/markspec/core/profile/git-cache.ts`, append:

```typescript
/**
 * Default `AppendFile` backed by `Deno.writeTextFile` with `{ append: true }`.
 * Requires `--allow-write`.
 */
export const defaultAppendFile: AppendFile = async (path, content) => {
  await Deno.writeTextFile(path, content, { append: true });
};
```

- [ ] **Step 5: Wire into `resolveGitSpecifier`**

In `packages/markspec/core/profile/resolver.ts`, extend the import from
`./git-cache.ts`:

```typescript
import {
  computeCacheLocation,
  defaultAppendFile,
  defaultRunGit,
  ensureCacheGitignored,
} from "./git-cache.ts";
import type { AppendFile, RunGit } from "./git-cache.ts";
```

Extend `ResolveGitOptions`:

```typescript
export interface ResolveGitOptions {
  readonly runGit?: RunGit;
  /** Injectable file appender — defaults to {@linkcode defaultAppendFile}. */
  readonly appendFile?: AppendFile;
}
```

In the miss branch of `resolveGitSpecifier`, immediately after a successful
clone (before the sparse-checkout + checkout), call `ensureCacheGitignored`:

```typescript
// After the clone succeeds:
await ensureCacheGitignored(
  projectRoot,
  readFile,
  opts.appendFile ?? defaultAppendFile,
);
```

Make sure this runs only on cache-miss (i.e., after `cloneResult.code === 0`),
not on cache-hit. It's cheap but only correct to do once per actual fetch.

- [ ] **Step 6: Run tests to verify they pass**

Run:
`deno test packages/markspec/core/profile/git-cache_test.ts packages/markspec/core/profile/resolver_test.ts`
Expected: all tests pass.

Note: the existing resolver tests use `mockReadFile` that returns `undefined` by
default; `ensureCacheGitignored` reads `.gitignore` via the passed `readFile` —
so when the mock map omits `.gitignore`, the helper no-ops, which is fine.

- [ ] **Step 7: Commit**

```bash
git add packages/markspec/core/profile/git-cache.ts packages/markspec/core/profile/git-cache_test.ts packages/markspec/core/profile/resolver.ts
git commit -m "feat(core): gitignore cache dir on first fetch"
```

---

## Task 4.6 — Wire `projectRoot` through `loadChain`

`loadChain` currently takes `(specifier, contextDir, readFile)` and rejects git
specifiers. Add a `projectRoot` parameter so the cache path is stable for the
project, and route git specifiers to `resolveGitSpecifier`. Update
`loadProfileForCommand` to pass it.

**Files:**

- Modify: `packages/markspec/core/profile/chain.ts`
- Modify: `packages/markspec/core/profile/chain_test.ts`
- Modify: `packages/markspec/core/profile/load.ts`

- [ ] **Step 1: Update existing tests to pass `projectRoot`**

In `packages/markspec/core/profile/chain_test.ts`, find every
`loadChain(specifier, contextDir, readFile)` call. The two args become three —
`loadChain(specifier, contextDir, projectRoot, readFile)`. For tests, pass the
same `/project` value for both `contextDir` and `projectRoot` where the test
didn't care. Do a search-and-replace carefully by hand.

Example: the existing test

```typescript
const result = await loadChain(
  { kind: "local", path: "./profiles/custom" },
  "/project",
  mockReadFile({ ... }),
);
```

becomes

```typescript
const result = await loadChain(
  { kind: "local", path: "./profiles/custom" },
  "/project",
  "/project",
  mockReadFile({ ... }),
);
```

Apply to **all** existing `loadChain(...)` call sites in `chain_test.ts`. Count
them first (`grep -c "await loadChain"` on the file) and confirm you fixed all.

- [ ] **Step 2: Add new tests for git routing**

Append to `packages/markspec/core/profile/chain_test.ts`:

```typescript
import type { RunGit } from "./git-cache.ts";
import { computeCacheLocation } from "./git-cache.ts";

Deno.test("loadChain: top-level git specifier routes through resolveGitSpecifier", async () => {
  const spec = {
    kind: "git" as const,
    repo: "https://github.com/acme/repo.git",
    subpath: undefined,
    tag: "v1.0.0",
  };
  const loc = await computeCacheLocation("/project", spec);

  const gitCalls: string[][] = [];
  const runGit: RunGit = (args) => {
    gitCalls.push([...args]);
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };

  // Cache hit: markspec.yaml is already at the cache location.
  const result = await loadChain(
    spec,
    "/project",
    "/project",
    mockReadFile({
      [loc.manifestPath]: `id: "@acme/from-git"\nversion: 1.0.0\n`,
    }),
    { runGit },
  );

  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.chain?.tiers[0].id, "@acme/from-git");
  assertEquals(gitCalls.length, 0); // hit — no git calls
});

Deno.test("loadChain: git specifier in extends chain is walked", async () => {
  const parentSpec = {
    kind: "git" as const,
    repo: "https://github.com/acme/parent.git",
    subpath: undefined,
    tag: "v1.0.0",
  };
  const parentLoc = await computeCacheLocation("/project", parentSpec);

  const runGit: RunGit = () =>
    Promise.resolve({ code: 0, stdout: "", stderr: "" });

  const result = await loadChain(
    { kind: "local", path: "./profiles/child" },
    "/project",
    "/project",
    mockReadFile({
      "/project/profiles/child/markspec.yaml":
        `id: "@acme/child"\nversion: 1.0.0\n` +
        `extends: "git+${parentSpec.repo}#${parentSpec.tag}"\n`,
      [parentLoc.manifestPath]: `id: "@acme/git-parent"\nversion: 1.0.0\n`,
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
    "/project",
    "/project",
    mockReadFile({}),
    { runGit: failingRunGit },
  );

  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-001");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/chain_test.ts` Expected: 3 new
tests FAIL (plus the updated existing tests pass because the new signature just
takes an extra arg).

- [ ] **Step 4: Update `loadChain` signature + route git specifiers**

Modify `packages/markspec/core/profile/chain.ts`:

Add import:

```typescript
import type { AppendFile, RunGit } from "./git-cache.ts";
import { resolveGitSpecifier, resolveLocalSpecifier } from "./resolver.ts";
```

Extend the function signature and options:

```typescript
/** Options accepted by {@linkcode loadChain}. */
export interface LoadChainOptions {
  readonly runGit?: RunGit;
  readonly appendFile?: AppendFile;
}

export async function loadChain(
  specifier: ProfileSpecifier,
  contextDir: string,
  projectRoot: string,
  readFile: ReadFile,
  opts: LoadChainOptions = {},
): Promise<LoadChainResult> {
  // ...
}
```

Remove the two early-exit stubs that emit the "Phase 4" message (the one at the
top of the function AND the one inside the while loop for git specifiers). In
the while loop, replace the git branch with a real resolver call:

```typescript
while (cursorSpec !== undefined) {
  const key = specifierKey(cursorSpec, cursorDir);
  if (visited.has(key)) {
    diagnostics.push({
      code: "PROFILE-LOAD-004",
      severity: "error",
      message:
        `profile extends: cycle detected at ${stringifySpec(cursorSpec)} ` +
        `(already visited in this chain)`,
      location: { file: "<specifier>", line: 1, column: 1 },
    });
    return { chain: null, diagnostics };
  }
  visited.add(key);

  if (tiersLeafFirst.length >= MAX_CHAIN_DEPTH) {
    diagnostics.push({
      code: "PROFILE-LOAD-005",
      severity: "error",
      message:
        `profile extends: chain exceeds maximum depth (${MAX_CHAIN_DEPTH})`,
      location: { file: "<specifier>", line: 1, column: 1 },
    });
    return { chain: null, diagnostics };
  }

  const resolved = cursorSpec.kind === "git"
    ? await resolveGitSpecifier(
      cursorSpec,
      projectRoot,
      readFile,
      diagnostics,
      { runGit: opts.runGit, appendFile: opts.appendFile },
    )
    : await resolveLocalSpecifier(
      cursorSpec,
      cursorDir,
      readFile,
      diagnostics,
    );
  if (!resolved) {
    return { chain: null, diagnostics };
  }

  // ... (rest unchanged: parseManifest, build tier, advance cursor)
}
```

And extend `specifierKey` to handle both kinds:

```typescript
function specifierKey(
  spec: ProfileSpecifier,
  contextDir: string,
): string {
  if (spec.kind === "local") {
    return `local:${resolvePath(contextDir, spec.path)}`;
  }
  return `git:${spec.repo}#${spec.tag}|${spec.subpath ?? ""}`;
}

function stringifySpec(spec: ProfileSpecifier): string {
  if (spec.kind === "local") {
    return spec.path;
  }
  return `git+${spec.repo}#${spec.tag}`;
}
```

Also in the `advance cursor` block, `cursorDir` must become the resolved
profile's `baseDir` for both kinds (it already does — `resolved.baseDir`).

- [ ] **Step 5: Pass `projectRoot` from `loadProfileForCommand`**

In `packages/markspec/core/profile/load.ts`, find the
`loadChain(profiles[0], projectRoot, readFile)` call. Update to pass
`projectRoot` in both slots:

```typescript
const chainResult = await loadChain(
  profiles[0],
  projectRoot,
  projectRoot,
  readFile,
);
```

(For the top-level specifier, the declaring directory IS the project root —
`.markspec.yaml` lives there.)

- [ ] **Step 6: Run tests to verify they pass**

Run:
`deno test packages/markspec/core/profile/chain_test.ts packages/markspec/core/profile/load_test.ts`
Expected: all tests pass. The `load_test.ts` may have existing `mockReadFile`
calls that you shouldn't need to change.

- [ ] **Step 7: Full suite**

Run: `deno task test` Expected: green.

- [ ] **Step 8: Commit**

```bash
git add packages/markspec/core/profile/chain.ts packages/markspec/core/profile/chain_test.ts packages/markspec/core/profile/load.ts
git commit -m "feat(core): route git specifiers through resolveGitSpecifier"
```

---

## Task 4.7 — Barrel exports

Expose the new symbols through the `core/profile/mod.ts` and `core/mod.ts`
barrels so CLI / external consumers can reach them.

**Files:**

- Modify: `packages/markspec/core/profile/mod.ts`
- Modify: `packages/markspec/core/mod.ts`

- [ ] **Step 1: Extend `core/profile/mod.ts`**

Append to `packages/markspec/core/profile/mod.ts`:

```typescript
export { resolveGitSpecifier } from "./resolver.ts";
export type { ResolveGitOptions } from "./resolver.ts";

export {
  computeCacheKey,
  computeCacheLocation,
  defaultAppendFile,
  defaultRunGit,
  ensureCacheGitignored,
} from "./git-cache.ts";
export type {
  AppendFile,
  CacheLocation,
  GitCacheKeyInput,
  RunGit,
  RunGitResult,
} from "./git-cache.ts";
```

- [ ] **Step 2: Extend `core/mod.ts`**

In the existing `Profile system (ADR-008)` export block, add the new value and
type names (alphabetized):

```typescript
export {
  computeCacheKey,
  computeCacheLocation,
  defaultAppendFile,
  defaultRunGit,
  ensureCacheGitignored,
  loadChain,
  loadProfileForCommand,
  mergeChain,
  parseManifest,
  resolveGitSpecifier,
  resolveLocalSpecifier,
} from "./profile/mod.ts";
export type {
  AppendFile,
  CacheLocation,
  GitCacheKeyInput,
  LoadChainOptions,
  LoadChainResult,
  LoadProfileForCommandResult,
  MergeResult,
  ParseManifestResult,
  ResolvedProfileSource,
  ResolveGitOptions,
  RunGit,
  RunGitResult,
} from "./profile/mod.ts";
```

Also export `LoadChainOptions` from `profile/mod.ts`:

```typescript
export type { LoadChainOptions, LoadChainResult } from "./chain.ts";
```

(if not already present).

- [ ] **Step 3: Type-check**

Run: `deno task check` Expected: no errors.

- [ ] **Step 4: Run full test suite**

Run: `deno task test` Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/mod.ts packages/markspec/core/mod.ts
git commit -m "feat(core): export git specifier resolver + cache API"
```

---

## Task 4.8 — E2E tests with real `git` + local bare repos

Finish Phase 4 with end-to-end coverage that exercises the real `git` CLI
against a local bare repository. Use `file://` URLs so no network is touched.
One shared helper module in `tests/e2e/helpers_git.ts` creates the bare repo + a
working-tree clone, commits a fixture profile, tags the commit, and returns the
URL. Tests use `markspec()` with appropriate permissions.

**Files:**

- Create: `tests/e2e/helpers_git.ts`
- Create: `tests/e2e/profile_git_test.ts`

- [ ] **Step 1: Write the git fixture helper**

Create `tests/e2e/helpers_git.ts`:

```typescript
/**
 * @module tests/e2e/helpers_git
 *
 * Set up a local bare git repository with a profile fixture, for e2e tests
 * of git specifier resolution. Uses the real `git` CLI via Deno.Command.
 *
 * Returns a `file://` URL the caller can reference from a `.markspec.yaml`
 * specifier. The bare repo lives inside the supplied workspace so the
 * markspec() helper's cleanup removes it at the end of the test.
 */

/** What you get back from `setupGitFixture`. */
export interface GitFixture {
  /** `file:///...` URL pointing at the bare repo. Safe to use in a specifier. */
  readonly url: string;
  /** The tag name you passed in, echoed back for convenience. */
  readonly tag: string;
}

/** Options for setting up a git fixture. */
export interface GitFixtureOptions {
  /** Absolute path to the shared workspace dir (the markspec test tempdir). */
  readonly workspaceDir: string;
  /** A logical name used for both the bare repo directory and the tag prefix. */
  readonly name: string;
  /** Files to commit into the repo. Keys are paths relative to the repo root. */
  readonly files: Record<string, string>;
  /** Tag to apply to the single commit. */
  readonly tag: string;
}

/**
 * Initialize a bare repo under `<workspaceDir>/_gitfixtures/<name>.git`, create
 * a scratch worktree next to it, commit `files`, tag the commit with `tag`,
 * and push. Returns the `file://` URL pointing at the bare repo.
 */
export async function setupGitFixture(
  opts: GitFixtureOptions,
): Promise<GitFixture> {
  const bareDir = `${opts.workspaceDir}/_gitfixtures/${opts.name}.git`;
  const workDir = `${opts.workspaceDir}/_gitwork/${opts.name}`;

  await Deno.mkdir(bareDir, { recursive: true });
  await Deno.mkdir(workDir, { recursive: true });

  await runOrThrow(["git", "init", "--bare", bareDir]);

  await runOrThrow(["git", "init", workDir]);
  await runOrThrow(["git", "-C", workDir, "config", "user.email", "t@t.test"]);
  await runOrThrow(["git", "-C", workDir, "config", "user.name", "Test"]);
  await runOrThrow(["git", "-C", workDir, "checkout", "-b", "main"]);

  for (const [relPath, content] of Object.entries(opts.files)) {
    const abs = `${workDir}/${relPath}`;
    const parts = relPath.split("/");
    if (parts.length > 1) {
      await Deno.mkdir(
        `${workDir}/${parts.slice(0, -1).join("/")}`,
        { recursive: true },
      );
    }
    await Deno.writeTextFile(abs, content);
  }

  await runOrThrow(["git", "-C", workDir, "add", "."]);
  await runOrThrow([
    "git",
    "-C",
    workDir,
    "commit",
    "-m",
    "fixture",
    "--allow-empty",
  ]);
  await runOrThrow(["git", "-C", workDir, "tag", opts.tag]);
  await runOrThrow(["git", "-C", workDir, "remote", "add", "origin", bareDir]);
  await runOrThrow([
    "git",
    "-C",
    workDir,
    "push",
    "--tags",
    "origin",
    "main",
  ]);

  return {
    url: `file://${bareDir}`,
    tag: opts.tag,
  };
}

async function runOrThrow(args: string[]): Promise<void> {
  const [bin, ...rest] = args;
  const cmd = new Deno.Command(bin, {
    args: rest,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  if (code !== 0) {
    throw new Error(
      `${args.join(" ")} failed with code ${code}: ${
        new TextDecoder().decode(stderr)
      }`,
    );
  }
}
```

- [ ] **Step 2: Write the e2e tests**

Create `tests/e2e/profile_git_test.ts`:

```typescript
/**
 * @module tests/e2e/profile_git_test
 *
 * E2E tests for `git+…#<tag>` profile specifiers, using a local bare repo.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";
import { setupGitFixture } from "./helpers_git.ts";

const PROJECT_YAML = `name: phase4-e2e\nversion: 0.1.0\n`;

const REQ_MD = `# Example

- [NOTE-001] A note

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
`;

const BASE_PROFILE_YAML = `id: "@acme/phase4-base"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
`;

// Needs --allow-run=git for the subprocess to invoke git.
// Needs --allow-env for git to read HOME / GIT_CONFIG.
const PERMISSIONS = ["--allow-run=git", "--allow-env"];

Deno.test("profile git e2e: top-level git specifier clones and validates cleanly", async () => {
  // Markspec writes its fixture files under its own tempdir; we need the
  // bare repo to live in the SAME tempdir so it's cleaned up. Reach into
  // the markspec() helper's flow by using a custom cwd within a tempdir
  // we control.
  const tempRoot = await Deno.makeTempDir();
  try {
    const fixture = await setupGitFixture({
      workspaceDir: tempRoot,
      name: "base",
      files: { "markspec.yaml": BASE_PROFILE_YAML },
      tag: "v1.0.0",
    });

    await Deno.writeTextFile(`${tempRoot}/project.yaml`, PROJECT_YAML);
    await Deno.writeTextFile(
      `${tempRoot}/.markspec.yaml`,
      `profiles:\n  - "git+${fixture.url}#${fixture.tag}"\n`,
    );
    await Deno.writeTextFile(`${tempRoot}/req.md`, REQ_MD);

    const { code, stderr } = await markspec(
      ["validate", "req.md"],
      {
        files: {}, // all files already staged in tempRoot — we wrote them by hand
        cwd: undefined, // run in tempRoot
        permissions: PERMISSIONS,
      },
    );

    assertEquals(code, 0);
    const err = stderr.split("\n").filter((l) =>
      l.includes("PROFILE-LOAD") || l.includes("PROFILE-MERGE")
    );
    assertEquals(err, []);
  } finally {
    await Deno.remove(tempRoot, { recursive: true });
  }
});
```

Note: the above helper-driven approach depends on how `markspec()` resolves its
working directory. Read `tests/e2e/helpers.ts` first and, if the helper always
spawns a fresh tempdir you don't control, rewrite the test to use the existing
`{ files }` contract and create the bare repo **inside** that tempdir before the
CLI runs. Two options:

**Option A (preferred):** Extend `markspec()` to optionally expose its workspace
directory via a `setup` callback that runs after files are written and before
the CLI spawns. Then the test can call `setupGitFixture` inside that callback.

**Option B (backup):** Put the bare repo outside the markspec tempdir (in a
separate tempdir the test owns), and accept that the bare repo isn't cleaned up
by markspec(). Clean it up yourself in a `finally`.

Either works; pick A if the helper is easy to extend, B otherwise. Commit the
choice in the test's module docstring.

- [ ] **Step 3: Add error-path tests**

Still in `tests/e2e/profile_git_test.ts`, append:

```typescript
Deno.test("profile git e2e: unreachable repo surfaces PROFILE-LOAD-001", async () => {
  const tempRoot = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tempRoot}/project.yaml`, PROJECT_YAML);
    await Deno.writeTextFile(
      `${tempRoot}/.markspec.yaml`,
      `profiles:\n  - "git+file:///nonexistent-bare-repo-${crypto.randomUUID()}.git#v1.0.0"\n`,
    );
    await Deno.writeTextFile(`${tempRoot}/req.md`, REQ_MD);

    const { code, stderr } = await markspec(
      ["validate", "req.md"],
      {
        files: {},
        cwd: undefined,
        permissions: PERMISSIONS,
      },
    );

    assertEquals(code, 1);
    assertStringIncludes(stderr, "PROFILE-LOAD-001");
  } finally {
    await Deno.remove(tempRoot, { recursive: true });
  }
});

Deno.test("profile git e2e: bad tag emits PROFILE-LOAD-001", async () => {
  const tempRoot = await Deno.makeTempDir();
  try {
    const fixture = await setupGitFixture({
      workspaceDir: tempRoot,
      name: "base",
      files: { "markspec.yaml": BASE_PROFILE_YAML },
      tag: "v1.0.0",
    });

    await Deno.writeTextFile(`${tempRoot}/project.yaml`, PROJECT_YAML);
    await Deno.writeTextFile(
      `${tempRoot}/.markspec.yaml`,
      `profiles:\n  - "git+${fixture.url}#v99.0.0"\n`,
    );
    await Deno.writeTextFile(`${tempRoot}/req.md`, REQ_MD);

    const { code, stderr } = await markspec(
      ["validate", "req.md"],
      {
        files: {},
        cwd: undefined,
        permissions: PERMISSIONS,
      },
    );

    assertEquals(code, 1);
    assertStringIncludes(stderr, "PROFILE-LOAD-001");
  } finally {
    await Deno.remove(tempRoot, { recursive: true });
  }
});
```

- [ ] **Step 4: Run the e2e tests**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/profile_git_test.ts`
Expected: all 3 tests pass.

If the `markspec()` helper rejects your approach of writing files outside its
`{ files }` map, fall back to **Option B** above: keep the bare repo in a
separate tempdir and pass the URL through the `files` map.

- [ ] **Step 5: Run full suite**

Run: `deno task test` Expected: green.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/helpers_git.ts tests/e2e/profile_git_test.ts
git commit -m "test(core): e2e coverage for git specifiers with local bare repos"
```

---

## Phase 4 acceptance

All tasks checked, all commits on `feat/profile-system-phase-4`,
`deno task test` green, `deno task check` clean. Loader covers:

- `git+https://…#<tag>` specifiers resolved via shallow+sparse clone under
  `<project-root>/.markspec/cache/<sha>/`.
- Cache-hit path: O(1) filesystem read, zero `git` invocations.
- Cache-miss path:
  `git clone --depth=1 --branch --filter=blob:none --sparse --no-checkout` +
  `sparse-checkout set` (when subpath) + `checkout <tag>`.
- `.gitignore` receives `.markspec/cache/` on first fetch, idempotent across
  runs.
- Git specifier failures (unreachable, bad tag, missing manifest) surface as
  `PROFILE-LOAD-001` with the git `stderr` embedded for user clarity.
- `loadChain` accepts `projectRoot`; git specifiers work at any chain tier.
- Unit tests drive all paths via the injectable `RunGit`.
- E2E tests prove the real `git` CLI invocation works against a local bare repo.

This PR unblocks profiles published to git repos — the final piece needed for
the custom-base + ASPICE-draft-extends-base dogfood scenario.

---

## Self-review

**Spec coverage (§7.2–§7.3):**

- ✅ §7.2 specifier schemes — git+https parsed by manifest + markspec.yaml
  parsers (existing).
- ✅ §7.2 git fetch mechanics —
  `--depth=1 --branch --filter=blob:none --sparse --no-checkout` +
  `sparse-checkout set` + `checkout` (Task 4.4).
- ✅ §7.2 auth inherits from git config — no markspec auth code added; implicit
  since `Deno.Command("git", …)` uses the user's ambient git config.
- ✅ §7.3 cache layout: `<project-root>/.markspec/cache/<sha>/…` — Task 4.1.
- ✅ §7.3 cache-hit reuse — Task 4.3.
- ✅ §7.3 `.gitignore` hygiene — Task 4.5.
- ✅ §7.3 immutable tags, no staleness checks — Tasks 4.3+4.4 assume this.
- ➖ §7.2 "subpath selects a profile within a monorepo" — covered for the leaf
  specifier; `subpath` is also honored when computing `manifestPath`.

**Placeholder scan:** No TBDs. Every TDD step has complete code blocks. The Task
4.8 e2e test notes "pick Option A or B" for the tempdir integration; this is an
implementation detail, not a placeholder — the alternatives are both fully
specified and a choice is expected.

**Type consistency:** `ResolveGitOptions`, `LoadChainOptions`, `RunGit`,
`AppendFile`, `CacheLocation`, `GitCacheKeyInput` used consistently across tasks
with the same field names.

**Scope check:** single subsystem (git specifier resolution). No
validator/compiler changes. Fits in one PR.

**Known risks:**

- E2E tests depend on real `git` being installed on the test runner. The repo
  already uses git for commits, so this is a safe assumption, but documented
  explicitly here.
- Permissions required by the CLI subprocess grow: `--allow-run=git` +
  `--allow-env`. Phase 4 must update `tests/e2e/helpers.ts` caller or document
  the expanded default permission set if needed.
- `subpath` traversal (e.g., `subpath: "../../../etc"`) is not explicitly
  sanitized beyond the Phase 1/2 specifier parser's regex.
  `git sparse-checkout set` likely rejects absolute and `..`-containing paths,
  but worth a defense-in-depth check in Task 4.4 if the reviewer flags it.

---

## Execution handoff

Plan complete and saved to
`docs/superpowers/plans/2026-04-22-adr-008-profile-system-v1-phase-4.md`. Two
execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task,
   review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans,
   batch execution with checkpoints.

Which approach?
