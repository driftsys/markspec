# Federated upstream — Slice 3 (git dependency fetcher) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acquire and compile `dependencies:` git repositories inside
`markspec lock`, writing each as a cached compiled snapshot + an
`[[upstream.dependency]]` lockfile row, so `check`/`compile`/LSP resolve
cross-repo traces from the cache alone.

**Architecture:** Slices 2 and 4 already built the entire _consumption_ side —
the `UpstreamDependency` model, serializer/parser rows,
`upstreamRefsFromLockfile` (which already includes `dependency` snapshots),
`loadUpstreamCorpus` hydration, the MSL-L212 cache-drift gate, and
graph/validator integration. Slice 3 is purely the _producer_: turn a
`dependencies:` projectRef into a cached snapshot. A new core module
(`upstream_deps.ts`) parallels the reference fetcher (`upstream_refs.ts`), with
two extra pieces references don't need — `git ls-remote` intent resolution and
an **in-process, deterministic compile** of the acquired tree.

**Tech Stack:** Deno/TypeScript, `@std/semver` (tag sort), `@std/path`,
`Deno.Command` (git subprocess, CLI layer only), `@std/crypto` via existing
`sha256Bytes`.

## Global Constraints

- **Node-safe core.** No `Deno.*` in `core/lock/**`; all world access (git, fs,
  temp dirs) flows through injected seams. `Deno.*` is allowed only in `cli/`
  entry points, tests, and scripts.
- **`jsr:` imports only** in library code; use `@std/*` / Web APIs, never Node
  built-ins.
- **Deterministic snapshot.** The cached `compiled.json` (whose sha256 becomes
  the lockfile `snapshot` pin, shared across machines) MUST be byte-reproducible
  from `(source tree at sha, markspec version)`. Achieved by compiling with
  **sorted, tree-relative paths** and **omitting `statFile`/`gitFile`** so no
  absolute path, mtime, or git history leaks into the output.
- **Warn-and-write policy (decision 1).** A dependency (or reference) that fails
  to acquire produces a **warning**, and `markspec lock` still writes every pin
  that resolved. This reverses slice-2's all-or-nothing abort for references;
  both paths unify here.
- **Clone-only acquisition (decision 2).** v1 acquires via a shallow
  `git fetch`-by-sha; the forge-tarball optimization is a deferred fast-follow.
- **Zero warnings** from `deno check`, `deno lint`, `deno test`.
- **Conventional Commits**, imperative mood. One commit per task during
  development (squashed at PR — matches slices 1/2/4).
- **Cache layout is fixed** by the already-shipped consumer: each upstream's
  snapshot lives at `.markspec/cache/upstreams/<id>/` as `manifest.json` (Tier-1
  inline form) + `compiled.json`; `snapshot = sha256(compiled.json bytes)`.

---

## File Structure

| File                                                                   | Responsibility                                                                                                                      |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `packages/markspec/core/lock/git_intent.ts` (create)                   | Pure: parse `git ls-remote` output → `RefList`; resolve an `auto`/`<tag>`/`<branch>`/`<sha>` intent to `{ sha, resolved }`. No I/O. |
| `packages/markspec/core/lock/git_intent_test.ts` (create)              | Unit tests: semver tag sort, intent resolution vs. fixture ref lists.                                                               |
| `packages/markspec/core/lock/acquire_compile.ts` (create)              | Deterministic in-process compile of an acquired tree → `{ manifestJson, compiledBytes, snapshot }`. Pure (injected IO).             |
| `packages/markspec/core/lock/acquire_compile_test.ts` (create)         | Unit tests: byte-reproducibility, tree-relative `location.file`, hydratable output.                                                 |
| `packages/markspec/core/lock/upstream_deps.ts` (create)                | `GitIO` seam + `resolveProjectDependencies` (first-lock / keep / restore / update flows). Pure.                                     |
| `packages/markspec/core/lock/upstream_deps_test.ts` (create)           | Unit tests: flows, warn-and-write, idempotence, `--update`, with fake git + fake compile.                                           |
| `packages/markspec/core/lock/pin_assurance.ts` (create)                | `dependencyPinAssurance(lockfile)` → MSL-L215 advisory per non-tag pin. Pure.                                                       |
| `packages/markspec/core/lock/pin_assurance_test.ts` (create)           | Unit tests: tag vs. branch vs. sha pins.                                                                                            |
| `packages/markspec/core/lock/mod.ts` (modify)                          | Barrel: export the new symbols.                                                                                                     |
| `packages/markspec/core/mod.ts` (modify)                               | Re-export the new symbols at the library boundary.                                                                                  |
| `packages/markspec/core/lock/upstream_refs.ts` (modify)                | Relax `l213`/L214 error→warning (decision 1).                                                                                       |
| `packages/markspec/core/lock/upstream_refs_test.ts` (modify)           | Update severity expectations.                                                                                                       |
| `packages/markspec/cli/commands/lock.ts` (modify)                      | `denoGitIO` + real `compileTree` binding; replace the dependency placeholder; drop the ref-error abort.                             |
| `packages/markspec/cli/commands/check.ts` (modify)                     | Emit the MSL-L215 advisory into the diagnostics stream (so `--strict` promotes it).                                                 |
| `tests/e2e/federated_dependency_test.ts` (create)                      | Offline local-bare-repo fixture: pin resolution, idempotence, `--strict`, cross-repo `Satisfies`.                                   |
| `docs/wip/2026-07-04-federated-upstream-resolution-design.md` (modify) | Fold decisions 1–3 into §4.2/§4.3/§4.4.                                                                                             |
| `docs/spec/language/language.md` (modify)                              | Add the MSL-L215 catalogue row (§8.3).                                                                                              |
| `docs/guide/**` (modify)                                               | CI cache recipe; `dependencies:` acquisition note.                                                                                  |

---

## Task 1: `git_intent.ts` — ls-remote parsing + intent resolution

**Files:**

- Create: `packages/markspec/core/lock/git_intent.ts`
- Test: `packages/markspec/core/lock/git_intent_test.ts`

**Interfaces:**

- Produces:
  ```ts
  export interface GitRef {
    readonly name: string;              // "v2.1.0" | "main"
    readonly kind: "tag" | "branch";
    readonly sha: string;               // 40-hex commit sha
  }
  export interface RefList {
    readonly refs: readonly GitRef[];
    readonly headSha?: string;          // remote HEAD tip
    readonly defaultBranch?: string;    // branch HEAD points at, when derivable
  }
  export interface ResolvedIntent {
    readonly sha: string;
    readonly resolved: string;          // "tag:v2.1.0" | "branch:main" | "sha:<40hex>"
  }
  export function parseLsRemote(stdout: string): RefList;
  export function resolveIntent(
    intent: string,
    refs: RefList,
  ): ResolvedIntent | { error: string };
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/markspec/core/lock/git_intent_test.ts
import { assertEquals } from "@std/assert";
import { parseLsRemote, resolveIntent } from "./git_intent.ts";

// `git ls-remote --symref <url>` sample. Annotated tag v2.0.0 has a peeled
// `^{}` line whose sha is the underlying commit — that is the sha we pin.
const LS_REMOTE = [
  "ref: refs/heads/main\tHEAD",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tHEAD",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/main",
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/heads/dev",
  "1111111111111111111111111111111111111111\trefs/tags/v1.0.0",
  "cccccccccccccccccccccccccccccccccccccccc\trefs/tags/v2.0.0",
  "2222222222222222222222222222222222222222\trefs/tags/v2.0.0^{}",
  "dddddddddddddddddddddddddddddddddddddddd\trefs/tags/nightly",
].join("\n");

Deno.test("parseLsRemote: extracts branches, tags (peeled), and HEAD", () => {
  const rl = parseLsRemote(LS_REMOTE);
  assertEquals(rl.headSha, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assertEquals(rl.defaultBranch, "main");
  // Peeled annotated tag resolves to the commit (2222…), not the tag object.
  assertEquals(
    rl.refs.find((r) => r.name === "v2.0.0")?.sha,
    "2222222222222222222222222222222222222222",
  );
  assertEquals(rl.refs.find((r) => r.name === "main")?.kind, "branch");
});

Deno.test("resolveIntent auto: highest semver tag wins", () => {
  const rl = parseLsRemote(LS_REMOTE);
  assertEquals(resolveIntent("auto", rl), {
    sha: "2222222222222222222222222222222222222222",
    resolved: "tag:v2.0.0",
  });
});

Deno.test("resolveIntent auto: no semver tags → default branch head", () => {
  const rl = parseLsRemote(
    "ref: refs/heads/main\tHEAD\n" +
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tHEAD\n" +
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/main",
  );
  assertEquals(resolveIntent("auto", rl), {
    sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    resolved: "branch:main",
  });
});

Deno.test("resolveIntent: explicit tag name", () => {
  const rl = parseLsRemote(LS_REMOTE);
  assertEquals(resolveIntent("v1.0.0", rl), {
    sha: "1111111111111111111111111111111111111111",
    resolved: "tag:v1.0.0",
  });
});

Deno.test("resolveIntent: explicit branch name", () => {
  const rl = parseLsRemote(LS_REMOTE);
  assertEquals(resolveIntent("dev", rl), {
    sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    resolved: "branch:dev",
  });
});

Deno.test("resolveIntent: bare sha passthrough", () => {
  const rl = parseLsRemote(LS_REMOTE);
  assertEquals(
    resolveIntent("2222222222222222222222222222222222222222", rl),
    {
      sha: "2222222222222222222222222222222222222222",
      resolved: "sha:2222222222222222222222222222222222222222",
    },
  );
});

Deno.test("resolveIntent: unknown ref errors", () => {
  const rl = parseLsRemote(LS_REMOTE);
  const r = resolveIntent("v9.9.9", rl);
  assertEquals("error" in r, true);
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `deno test packages/markspec/core/lock/git_intent_test.ts` Expected: FAIL —
module `./git_intent.ts` not found.

- [ ] **Step 3: Implement `git_intent.ts`**

```ts
/**
 * @module core/lock/git_intent
 *
 * Pure git-intent resolution for federated dependencies (design §4.3).
 * Parses `git ls-remote --symref` output into a {@linkcode RefList} and
 * resolves a declared version intent (`auto` | `<tag>` | `<branch>` |
 * `<sha>`) to an exact commit + a resolution-kind label. No I/O — the CLI
 * runs git and hands the raw stdout in; unit tests feed fixture strings.
 */

import { compare, parse as parseSemver, tryParse } from "@std/semver";

export interface GitRef {
  readonly name: string;
  readonly kind: "tag" | "branch";
  readonly sha: string;
}

export interface RefList {
  readonly refs: readonly GitRef[];
  readonly headSha?: string;
  readonly defaultBranch?: string;
}

export interface ResolvedIntent {
  readonly sha: string;
  readonly resolved: string;
}

const SHA_RE = /^[0-9a-f]{40}$/;
/** Strip a single leading `v`/`V` so `v2.1.0` parses as semver. */
function semverText(tag: string): string {
  return /^[vV]/.test(tag) ? tag.slice(1) : tag;
}

/**
 * Parse `git ls-remote --symref <url>` output. Peeled annotated-tag lines
 * (`refs/tags/x^{}`) override the tag-object sha with the underlying commit
 * — that commit is what a checkout resolves to and what we pin.
 */
export function parseLsRemote(stdout: string): RefList {
  const branches = new Map<string, string>();
  const tags = new Map<string, string>();
  let headSha: string | undefined;
  let defaultBranch: string | undefined;

  for (const raw of stdout.split("\n")) {
    const line = raw.trimEnd();
    if (line.length === 0) continue;
    if (line.startsWith("ref: ")) {
      // `ref: refs/heads/main\tHEAD` — the symref for HEAD.
      const m = line.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/);
      if (m) defaultBranch = m[1];
      continue;
    }
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const sha = line.slice(0, tab);
    const ref = line.slice(tab + 1);
    if (ref === "HEAD") {
      headSha = sha;
    } else if (ref.startsWith("refs/heads/")) {
      branches.set(ref.slice("refs/heads/".length), sha);
    } else if (ref.startsWith("refs/tags/")) {
      const rest = ref.slice("refs/tags/".length);
      const peeled = rest.endsWith("^{}");
      const name = peeled ? rest.slice(0, -3) : rest;
      // A peeled line always wins; a bare tag line only sets the sha if no
      // peeled sha was recorded yet.
      if (peeled || !tags.has(name)) tags.set(name, sha);
    }
  }

  const refs: GitRef[] = [
    ...[...branches].map(([name, sha]): GitRef => ({
      name,
      kind: "branch",
      sha,
    })),
    ...[...tags].map(([name, sha]): GitRef => ({ name, kind: "tag", sha })),
  ];
  return { refs, headSha, defaultBranch };
}

/**
 * Resolve a declared intent to an exact `{ sha, resolved }`.
 *
 * - `auto` → highest valid-semver tag (leading `v` tolerated); if none, the
 *   default-branch head.
 * - a name matching a tag → `tag:<name>` (tag wins if a branch shares the name).
 * - a name matching a branch → `branch:<name>`.
 * - a 40-hex string → `sha:<sha>` (passthrough; the acquire step validates it).
 * - otherwise → `{ error }`.
 */
export function resolveIntent(
  intent: string,
  refs: RefList,
): ResolvedIntent | { error: string } {
  if (intent === "auto") {
    const semverTags = refs.refs
      .filter((r) => r.kind === "tag")
      .map((r) => ({ r, v: tryParse(semverText(r.name)) }))
      .filter((x): x is { r: GitRef; v: ReturnType<typeof parseSemver> } =>
        x.v !== undefined
      )
      .sort((a, b) => compare(b.v, a.v));
    if (semverTags.length > 0) {
      const top = semverTags[0].r;
      return { sha: top.sha, resolved: `tag:${top.name}` };
    }
    if (refs.headSha !== undefined) {
      return {
        sha: refs.headSha,
        resolved: `branch:${refs.defaultBranch ?? "HEAD"}`,
      };
    }
    return { error: "intent 'auto': remote has no tags and no HEAD" };
  }

  const tag = refs.refs.find((r) => r.kind === "tag" && r.name === intent);
  if (tag) return { sha: tag.sha, resolved: `tag:${tag.name}` };
  const branch = refs.refs.find((r) =>
    r.kind === "branch" && r.name === intent
  );
  if (branch) return { sha: branch.sha, resolved: `branch:${branch.name}` };
  if (SHA_RE.test(intent)) return { sha: intent, resolved: `sha:${intent}` };
  return { error: `intent '${intent}' matched no tag or branch on the remote` };
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `deno test packages/markspec/core/lock/git_intent_test.ts` Expected: PASS
(7 tests).

- [ ] **Step 5: Lint + type-check**

Run:
`deno lint packages/markspec/core/lock/git_intent.ts && deno check packages/markspec/core/lock/git_intent.ts`
Expected: no findings.

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/lock/git_intent.ts \
        packages/markspec/core/lock/git_intent_test.ts
git commit -m "feat(core): git ls-remote parsing + version-intent resolution"
```

---

## Task 2: `acquire_compile.ts` — deterministic in-process compile

**Files:**

- Create: `packages/markspec/core/lock/acquire_compile.ts`
- Test: `packages/markspec/core/lock/acquire_compile_test.ts`

**Interfaces:**

- Consumes: `loadConfig`, `loadProfileForCommand`, `loadToolConfig`,
  `discoverFiles`, `compile`, `buildManifest`, `serializeCompileResult`,
  `sha256Bytes` (all existing), plus `DiscoveryIO`/`ReadFile`.
- Produces:
  ```ts
  export interface AcquireCompileIO {
    /** Config/profile reader — returns text or undefined (core `ReadFile`). */
    readonly readFile: (path: string) => Promise<string | undefined>;
    /** Throwing reader compile() consumes (`(path) => Promise<string>`). */
    readonly readText: (path: string) => Promise<string>;
    /** Discovery seam (`{ readDir, readFile }`) — same as `denoDiscoveryIO()`. */
    readonly discovery: DiscoveryIO;
  }
  export interface CompiledSnapshot {
    readonly manifestJson: ManifestJson;
    readonly compiledBytes: Uint8Array; // exact bytes written to compiled.json
    readonly snapshot: string;          // sha256(compiledBytes)
  }
  export async function compileAcquiredTree(
    treeRoot: string,
    io: AcquireCompileIO,
    release: string,
  ): Promise<CompiledSnapshot | { error: string }>;
  ```

**Why this exists:** a git dependency is a raw source tree we compile locally,
unlike a `references:` published site we fetch as ready JSON. The output's
sha256 becomes the `snapshot` pin shared across machines, so it must be
byte-reproducible. Determinism comes from (a) **sorted, tree-relative** paths
passed to `compile` — which fixes both `entry.location.file` and
`properties.file.path` to stable relative strings and fixes entry order — and
(b) **omitting `statFile`/`gitFile`** so no mtime or git history leaks in.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/markspec/core/lock/acquire_compile_test.ts
import { assertEquals, assertStringIncludes } from "@std/assert";
import { compileAcquiredTree } from "./acquire_compile.ts";

// Build an in-memory tree fixture: project.yaml + one requirements file.
function fixtureIO(files: Record<string, string>) {
  const norm = (p: string) => p.replaceAll("\\", "/");
  return {
    readFile: (p: string) => Promise.resolve(files[norm(p)]),
    readText: (p: string) => {
      const c = files[norm(p)];
      if (c === undefined) return Promise.reject(new Error("ENOENT"));
      return Promise.resolve(c);
    },
    discovery: {
      // deno-lint-ignore require-yield
      async *readDir(dir: string) {
        const prefix = norm(dir).replace(/\/$/, "") + "/";
        const seen = new Set<string>();
        for (const path of Object.keys(files)) {
          if (!path.startsWith(prefix)) continue;
          const rest = path.slice(prefix.length);
          const seg = rest.split("/")[0];
          if (seen.has(seg)) continue;
          seen.add(seg);
          yield {
            name: seg,
            isFile: !rest.includes("/"),
            isDirectory: rest.includes("/"),
            isSymlink: false,
          };
        }
      },
      readFile: (p: string) => Promise.resolve(files[norm(p)]),
    },
  };
}

const PROJECT = {
  "/dep/project.yaml": "name: aeb-icd\nversion: 1.2.0\n",
  "/dep/docs/reqs.md": [
    "# Reqs",
    "",
    "- [STK_ICD_0001] Brake torque interface",
    "",
    "  The interface shall carry brake torque within 5 ms.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
    "",
  ].join("\n"),
};

Deno.test("compileAcquiredTree: byte-reproducible snapshot", async () => {
  const a = await compileAcquiredTree("/dep", fixtureIO(PROJECT), "0.0.0-test");
  const b = await compileAcquiredTree("/dep", fixtureIO(PROJECT), "0.0.0-test");
  if ("error" in a || "error" in b) throw new Error("unexpected error");
  assertEquals(a.snapshot, b.snapshot);
});

Deno.test("compileAcquiredTree: location.file is tree-relative", async () => {
  const r = await compileAcquiredTree("/dep", fixtureIO(PROJECT), "0.0.0-test");
  if ("error" in r) throw new Error(r.error);
  const json = new TextDecoder().decode(r.compiledBytes);
  assertStringIncludes(json, '"file":"docs/reqs.md"');
  // No absolute temp path leaked in.
  assertEquals(json.includes("/dep/docs/reqs.md"), false);
});

Deno.test("compileAcquiredTree: no project.yaml → error", async () => {
  const r = await compileAcquiredTree(
    "/dep",
    fixtureIO({ "/dep/docs/x.md": "# x\n" }),
    "0.0.0-test",
  );
  assertEquals("error" in r, true);
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run:
`deno test --allow-read packages/markspec/core/lock/acquire_compile_test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `acquire_compile.ts`**

```ts
/**
 * @module core/lock/acquire_compile
 *
 * Deterministic in-process compile of an acquired dependency tree
 * (design §4.3). Produces the same `manifest.json` + `compiled.json` layout
 * a published `references:` site serves, so `loadUpstreamCorpus` /
 * `probeCacheSnapshot` read a dependency snapshot identically to a reference
 * snapshot. The output is byte-reproducible from (tree, markspec version):
 * files are compiled in sorted, tree-relative order with no stat/git IO, so
 * `entry.location.file`, `properties.file.path`, and entry ordering are all
 * stable. Pure — every file touch flows through {@linkcode AcquireCompileIO}.
 */

import { join, relative } from "@std/path";
import { compile } from "../compiler/mod.ts";
import { buildManifest, type ManifestJson } from "../compiler/manifest.ts";
import { serializeCompileResult } from "../compiler/schema.ts";
import { loadConfig } from "../config/mod.ts";
import { loadToolConfig } from "../config/markspec.ts";
import { loadProfileForCommand } from "../profile/load.ts";
import { discoverFiles, type DiscoveryIO } from "../discovery/mod.ts";
import { sha256Bytes } from "./hash.ts";

export interface AcquireCompileIO {
  readonly readFile: (path: string) => Promise<string | undefined>;
  readonly readText: (path: string) => Promise<string>;
  readonly discovery: DiscoveryIO;
}

export interface CompiledSnapshot {
  readonly manifestJson: ManifestJson;
  readonly compiledBytes: Uint8Array;
  readonly snapshot: string;
}

export async function compileAcquiredTree(
  treeRoot: string,
  io: AcquireCompileIO,
  release: string,
): Promise<CompiledSnapshot | { error: string }> {
  const configResult = await loadConfig(treeRoot, io.readFile);
  if (!configResult) {
    return { error: "dependency tree has no discoverable project.yaml" };
  }
  const profileResult = await loadProfileForCommand(treeRoot, io.readFile);
  const profile = profileResult.chain?.effective;
  const toolConfig = await loadToolConfig(treeRoot, io.readFile);

  // Discover → relativize → sort. Sorting fixes compile()'s entry order,
  // which fixes the JSON key order in serializeCompileResult's output.
  const abs: string[] = [];
  for await (
    const f of discoverFiles(treeRoot, io.discovery, {
      exclude: toolConfig.config.exclude,
    })
  ) {
    abs.push(f);
  }
  const rel = abs.map((p) => relative(treeRoot, p)).sort();

  // Compile with a root-resolving reader and NO stat/git callbacks →
  // deterministic properties (no mtime, no contributors, relative path).
  const result = await compile(rel, {
    readFile: (r) => io.readText(join(treeRoot, r)),
    profile,
  });

  // `root` is cosmetic here — manifest.json is not hashed (only compiled.json
  // is) and lives in the gitignored cache; pass "." so no temp path leaks.
  const manifestJson = buildManifest(
    result,
    configResult.config,
    ".",
    profile,
    release,
    false,
  );
  const compiled = serializeCompileResult(result);
  const compiledBytes = new TextEncoder().encode(
    JSON.stringify(compiled, null, 2),
  );
  return {
    manifestJson,
    compiledBytes,
    snapshot: await sha256Bytes(compiledBytes),
  };
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run:
`deno test --allow-read packages/markspec/core/lock/acquire_compile_test.ts`
Expected: PASS (3 tests).

> If the byte-reproducibility test fails, the cause is a non-deterministic field
> slipping through `serializeEntry`. Check that `compile` was called with no
> `statFile`/`gitFile` and that `rel` is sorted; do NOT add per-field stripping
> — fix the input determinism.

- [ ] **Step 5: Lint + type-check; commit**

Run:
`deno lint packages/markspec/core/lock/acquire_compile.ts && deno check packages/markspec/core/lock/acquire_compile.ts`

```bash
git add packages/markspec/core/lock/acquire_compile.ts \
        packages/markspec/core/lock/acquire_compile_test.ts
git commit -m "feat(core): deterministic in-process compile of an acquired dependency tree"
```

---

## Task 3: `upstream_deps.ts` — `GitIO` seam + three-flow resolver

**Files:**

- Create: `packages/markspec/core/lock/upstream_deps.ts`
- Test: `packages/markspec/core/lock/upstream_deps_test.ts`
- Modify: `packages/markspec/core/lock/mod.ts`, `packages/markspec/core/mod.ts`

**Interfaces:**

- Consumes: `deriveUpstreamId`, `upstreamCacheRoot`, `probeCacheSnapshot`
  (existing, `upstream_refs.ts`); `resolveIntent`/`RefList` (Task 1);
  `CompiledSnapshot` (Task 2); `UpstreamDependency`, `ProjectRef`, `Diagnostic`.
- Produces:
  ```ts
  export interface GitIO {
    lsRemote(url: string): Promise<RefList | { error: string }>;
    acquireTree(
      url: string,
      sha: string,
      destDir: string,
    ): Promise<{ error?: string }>;
  }
  export interface UpstreamDepsIO {
    readonly git: GitIO;
    readonly compileTree: (
      treeRoot: string,
    ) => Promise<CompiledSnapshot | { error: string }>;
    readonly readFile: ReadFile;         // bytes reader for probeCacheSnapshot
    readonly writeFile: (
      path: string,
      bytes: Uint8Array,
    ) => Promise<{ error?: string }>;
    readonly makeTempDir: () => Promise<string>;
    readonly removeDir: (path: string) => Promise<void>;
  }
  export interface ResolveProjectDependenciesOptions {
    readonly dependencies: readonly ProjectRef[];
    readonly existing: readonly UpstreamDependency[];
    readonly cacheRoot: string;
    readonly update: boolean | string;
    readonly io: UpstreamDepsIO;
    readonly lockedAt: string;
  }
  export interface ResolveProjectDependenciesResult {
    readonly dependencies: UpstreamDependency[];
    readonly diagnostics: Diagnostic[];
  }
  export async function resolveProjectDependencies(
    opts: ResolveProjectDependenciesOptions,
  ): Promise<ResolveProjectDependenciesResult>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/markspec/core/lock/upstream_deps_test.ts
import { assertEquals } from "@std/assert";
import {
  type GitIO,
  resolveProjectDependencies,
  type UpstreamDepsIO,
} from "./upstream_deps.ts";
import { parseLsRemote } from "./git_intent.ts";
import type { CompiledSnapshot } from "./acquire_compile.ts";
import type { ManifestJson } from "../compiler/manifest.ts";
import { sha256Bytes } from "./hash.ts";

const MANIFEST = {
  markspecSchemaVersion: 1,
  generator: { release: "0.0.0", coreSchema: 1 },
  project: { name: "dep", root: "." },
  counts: { entries: 0, edges: 0, byType: {} },
  entries: { format: "inline", file: "compiled.json" },
  edges: { format: "inline", file: "compiled.json" },
  sqliteMirror: null,
  federation: [],
  reserved: {},
} as unknown as ManifestJson;

const LS = parseLsRemote(
  "ref: refs/heads/main\tHEAD\n" +
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tHEAD\n" +
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/main\n" +
    "cccccccccccccccccccccccccccccccccccccccc\trefs/tags/v2.0.0",
);

// Fake IO: records git calls; compileTree returns a fixed snapshot; writes go
// to an in-memory FS keyed by join()'d path (Windows-safe per slice-2/4 gotcha).
function makeIO(overrides: Partial<GitIO> = {}) {
  const fs = new Map<string, Uint8Array>();
  const acquired: string[] = [];
  const compiledBytes = new TextEncoder().encode('{"entries":{}}');
  let snapPromise: Promise<string> | undefined;
  const io: UpstreamDepsIO = {
    git: {
      lsRemote: () => Promise.resolve(LS),
      acquireTree: (_u, sha, _d) => {
        acquired.push(sha);
        return Promise.resolve({});
      },
      ...overrides,
    },
    compileTree: async (): Promise<CompiledSnapshot> => {
      snapPromise ??= sha256Bytes(compiledBytes);
      return {
        manifestJson: MANIFEST,
        compiledBytes,
        snapshot: await snapPromise,
      };
    },
    readFile: (p) => {
      const b = fs.get(p);
      return Promise.resolve(b ?? { error: "ENOENT" });
    },
    writeFile: (p, bytes) => {
      fs.set(p, bytes);
      return Promise.resolve({});
    },
    makeTempDir: () => Promise.resolve("/tmp/acq"),
    removeDir: () => Promise.resolve(),
  };
  return { io, fs, acquired, compiledBytes };
}

Deno.test("first-lock: resolves auto → tag, writes row + cache", async () => {
  const { io, fs, acquired } = makeIO();
  const r = await resolveProjectDependencies({
    dependencies: [{ url: "https://example.test/dep.git" }],
    existing: [],
    cacheRoot: "/cache",
    update: false,
    io,
    lockedAt: "2026-07-04T00:00:00Z",
  });
  assertEquals(r.diagnostics, []);
  assertEquals(r.dependencies.length, 1);
  const row = r.dependencies[0];
  assertEquals(row.resolved, "tag:v2.0.0");
  assertEquals(row.sha, "cccccccccccccccccccccccccccccccccccccccc");
  assertEquals(row.intent, "auto");
  assertEquals(acquired, ["cccccccccccccccccccccccccccccccccccccccc"]);
  // manifest.json + compiled.json written under /cache/dep.
  assertEquals(fs.has("/cache/dep/manifest.json"), true);
  assertEquals(fs.has("/cache/dep/compiled.json"), true);
});

Deno.test("keep: intact cache → no git, row preserved", async () => {
  const { io, fs, compiledBytes } = makeIO();
  const snapshot = await sha256Bytes(compiledBytes);
  // Seed an intact cache matching the existing row's snapshot.
  fs.set(
    "/cache/dep/manifest.json",
    new TextEncoder().encode(JSON.stringify(MANIFEST)),
  );
  fs.set("/cache/dep/compiled.json", compiledBytes);
  const existing = {
    kind: "dependency" as const,
    id: "dep",
    url: "https://example.test/dep.git",
    intent: "auto",
    resolved: "tag:v2.0.0",
    sha: "cccccccccccccccccccccccccccccccccccccccc",
    snapshot,
    lockedAt: "2026-07-04T00:00:00Z",
  };
  const acquired: string[] = [];
  io.git.acquireTree = (_u, sha) => {
    acquired.push(sha);
    return Promise.resolve({});
  };
  const r = await resolveProjectDependencies({
    dependencies: [{ url: existing.url }],
    existing: [existing],
    cacheRoot: "/cache",
    update: false,
    io,
    lockedAt: "2026-07-05T00:00:00Z",
  });
  assertEquals(acquired, []); // idempotent — no re-acquire
  assertEquals(r.dependencies[0], existing); // unchanged row
});

Deno.test("warn-and-write: ls-remote failure is a warning, others still resolve", async () => {
  const { io } = makeIO({
    lsRemote: () => Promise.resolve({ error: "network down" }),
  });
  const r = await resolveProjectDependencies({
    dependencies: [{ url: "https://example.test/dep.git" }],
    existing: [],
    cacheRoot: "/cache",
    update: false,
    io,
    lockedAt: "2026-07-04T00:00:00Z",
  });
  assertEquals(r.dependencies.length, 0);
  assertEquals(r.diagnostics.length, 1);
  assertEquals(r.diagnostics[0].code, "MSL-L213");
  assertEquals(r.diagnostics[0].severity, "warning");
});

Deno.test("update: re-resolves and moves the pin", async () => {
  const { io, acquired } = makeIO();
  const existing = {
    kind: "dependency" as const,
    id: "dep",
    url: "https://example.test/dep.git",
    intent: "auto",
    resolved: "branch:main",
    sha: "0000000000000000000000000000000000000000",
    snapshot: "stale",
    lockedAt: "2026-01-01T00:00:00Z",
  };
  const r = await resolveProjectDependencies({
    dependencies: [{ url: existing.url }],
    existing: [existing],
    cacheRoot: "/cache",
    update: true,
    io,
    lockedAt: "2026-07-04T00:00:00Z",
  });
  assertEquals(r.dependencies[0].resolved, "tag:v2.0.0");
  assertEquals(acquired.length, 1); // re-acquired despite existing row
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `deno test packages/markspec/core/lock/upstream_deps_test.ts` Expected:
FAIL — module not found.

- [ ] **Step 3: Implement `upstream_deps.ts`**

```ts
/**
 * @module core/lock/upstream_deps
 *
 * Lock-mediated acquisition of org-manifest `dependencies:` git repositories
 * (design §4.3), the sibling of `upstream_refs.ts`. Unlike a `references:`
 * published site (fetched as ready JSON), a dependency is a git tree we
 * resolve, acquire at one sha, and compile in-process into the same cache
 * layout. Three flows: first-lock (resolve intent → acquire → compile → pin),
 * keep/restore (pin exists → verify cache offline, re-acquire the *pinned* sha
 * only to repopulate), update (`--update` → re-resolve + move the pin).
 *
 * Warn-and-write policy (design §4.2, decision 1): an unreachable dependency
 * yields a warning and the resolvable pins still lock. Pure — git, fs, and
 * temp-dir access flow through {@linkcode UpstreamDepsIO}.
 */

import { join } from "@std/path";
import type { Diagnostic, ProjectRef } from "../model/mod.ts";
import type { UpstreamDependency } from "./model.ts";
import type { ReadFile } from "./resolve.ts";
import { deriveUpstreamId, probeCacheSnapshot } from "./upstream_refs.ts";
import { type RefList, resolveIntent } from "./git_intent.ts";
import type { CompiledSnapshot } from "./acquire_compile.ts";

export interface GitIO {
  lsRemote(url: string): Promise<RefList | { error: string }>;
  acquireTree(
    url: string,
    sha: string,
    destDir: string,
  ): Promise<{ error?: string }>;
}

export interface UpstreamDepsIO {
  readonly git: GitIO;
  readonly compileTree: (
    treeRoot: string,
  ) => Promise<CompiledSnapshot | { error: string }>;
  readonly readFile: ReadFile;
  readonly writeFile: (
    path: string,
    bytes: Uint8Array,
  ) => Promise<{ error?: string }>;
  readonly makeTempDir: () => Promise<string>;
  readonly removeDir: (path: string) => Promise<void>;
}

export interface ResolveProjectDependenciesOptions {
  readonly dependencies: readonly ProjectRef[];
  readonly existing: readonly UpstreamDependency[];
  readonly cacheRoot: string;
  readonly update: boolean | string;
  readonly io: UpstreamDepsIO;
  readonly lockedAt: string;
}

export interface ResolveProjectDependenciesResult {
  readonly dependencies: UpstreamDependency[];
  readonly diagnostics: Diagnostic[];
}

/** Warn-and-write diagnostic — one dependency could not be locked (decision 1). */
function l213(id: string, detail: string): Diagnostic {
  return {
    code: "MSL-L213",
    severity: "warning",
    message: `upstream dependency '${id}' could not be locked: ${detail}`,
    location: undefined,
  };
}

/** Acquire the tree at `sha` into a fresh temp dir, compile it, clean up. */
async function acquireAndCompile(
  url: string,
  sha: string,
  io: UpstreamDepsIO,
): Promise<CompiledSnapshot | { error: string }> {
  const tmp = await io.makeTempDir();
  try {
    const acq = await io.git.acquireTree(url, sha, tmp);
    if (acq.error !== undefined) {
      return { error: `acquire ${sha.slice(0, 12)} failed (${acq.error})` };
    }
    return await io.compileTree(tmp);
  } finally {
    await io.removeDir(tmp);
  }
}

/** Write `manifest.json` + `compiled.json` for a snapshot under `dir`. */
async function writeSnapshotCache(
  dir: string,
  snap: CompiledSnapshot,
  io: UpstreamDepsIO,
): Promise<Diagnostic | undefined> {
  const writes: Array<[string, Uint8Array]> = [
    [
      join(dir, "manifest.json"),
      new TextEncoder().encode(JSON.stringify(snap.manifestJson, null, 2)),
    ],
    [join(dir, "compiled.json"), snap.compiledBytes],
  ];
  for (const [path, bytes] of writes) {
    const res = await io.writeFile(path, bytes);
    if (res.error !== undefined) {
      return l213(dir, `cache write of '${path}' failed (${res.error})`);
    }
  }
  return undefined;
}

export async function resolveProjectDependencies(
  opts: ResolveProjectDependenciesOptions,
): Promise<ResolveProjectDependenciesResult> {
  const dependencies: UpstreamDependency[] = [];
  const diagnostics: Diagnostic[] = [];
  const byId = new Map(opts.existing.map((row) => [row.id, row]));
  const seen = new Set<string>();

  for (const ref of opts.dependencies) {
    const id = deriveUpstreamId(ref);
    if (id === undefined) {
      diagnostics.push(l213(
        ref.name ?? ref.url,
        "no safe upstream id could be derived — set an explicit 'name:'",
      ));
      continue;
    }
    if (seen.has(id)) {
      diagnostics.push(l213(id, "duplicate upstream id — set distinct 'name:'"));
      continue;
    }
    seen.add(id);
    const dir = join(opts.cacheRoot, id);
    const existing = byId.get(id);
    const selectedForUpdate = opts.update === true || opts.update === id;

    // KEEP / RESTORE
    if (existing !== undefined && !selectedForUpdate) {
      if (await probeCacheSnapshot(dir, existing.snapshot, opts.io.readFile)) {
        dependencies.push(existing); // idempotent — no git
        continue;
      }
      // Restore: re-acquire the *pinned* sha (intent is NOT re-resolved).
      const snap = await acquireAndCompile(existing.url, existing.sha, opts.io);
      if ("error" in snap) {
        diagnostics.push(l213(id, `restore failed: ${snap.error}`));
        dependencies.push(existing);
        continue;
      }
      if (snap.snapshot !== existing.snapshot) {
        // Same sha but a different compiled hash → markspec wire-format skew
        // (the source is byte-identical by git's guarantee). Keep the pin,
        // do not clobber the cache; tell the user to re-pin explicitly.
        diagnostics.push(l213(
          id,
          `restore recompiled to a different snapshot (markspec version skew?) — run 'markspec lock --update=${id}' to re-pin`,
        ));
        dependencies.push(existing);
        continue;
      }
      const writeErr = await writeSnapshotCache(dir, snap, opts.io);
      if (writeErr) {
        diagnostics.push(writeErr);
        dependencies.push(existing);
        continue;
      }
      dependencies.push(existing);
      continue;
    }

    // FIRST-LOCK or UPDATE — resolve the declared intent → sha.
    const intent = ref.version ?? "auto";
    const refs = await opts.io.git.lsRemote(ref.url);
    if ("error" in refs) {
      diagnostics.push(l213(id, `ls-remote failed (${refs.error})`));
      if (existing !== undefined) dependencies.push(existing);
      continue;
    }
    const ri = resolveIntent(intent, refs);
    if ("error" in ri) {
      diagnostics.push(l213(id, ri.error));
      if (existing !== undefined) dependencies.push(existing);
      continue;
    }
    const snap = await acquireAndCompile(ref.url, ri.sha, opts.io);
    if ("error" in snap) {
      diagnostics.push(l213(id, snap.error));
      if (existing !== undefined) dependencies.push(existing);
      continue;
    }
    const writeErr = await writeSnapshotCache(dir, snap, opts.io);
    if (writeErr) {
      diagnostics.push(writeErr);
      if (existing !== undefined) dependencies.push(existing);
      continue;
    }
    dependencies.push({
      kind: "dependency",
      id,
      url: ref.url,
      intent,
      resolved: ri.resolved,
      sha: ri.sha,
      snapshot: snap.snapshot,
      lockedAt: opts.lockedAt,
    });
  }

  return { dependencies, diagnostics };
}
```

- [ ] **Step 4: Add barrel exports**

In `packages/markspec/core/lock/mod.ts`, after the `upstream_refs` export block,
add:

```ts
export {
  type GitIO,
  resolveProjectDependencies,
  type ResolveProjectDependenciesOptions,
  type ResolveProjectDependenciesResult,
  type UpstreamDepsIO,
} from "./upstream_deps.ts";
export {
  type AcquireCompileIO,
  compileAcquiredTree,
  type CompiledSnapshot,
} from "./acquire_compile.ts";
export {
  type GitRef,
  parseLsRemote,
  type RefList,
  resolveIntent,
  type ResolvedIntent,
} from "./git_intent.ts";
```

Then in `packages/markspec/core/mod.ts`, add the same names to the existing
`export { … } from "./lock/mod.ts";` re-export block (append the identifiers to
the value/type lists that are already re-exported from `lock/mod.ts`).

- [ ] **Step 5: Run tests + type-check**

Run: `deno test packages/markspec/core/lock/upstream_deps_test.ts` Expected:
PASS (4 tests). Run: `deno check packages/markspec/core/mod.ts` Expected: no
errors.

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/lock/upstream_deps.ts \
        packages/markspec/core/lock/upstream_deps_test.ts \
        packages/markspec/core/lock/mod.ts packages/markspec/core/mod.ts
git commit -m "feat(core): resolveProjectDependencies — git dependency lock flows"
```

---

## Task 4: Relax the references path to warn-and-write (decision 1)

**Files:**

- Modify: `packages/markspec/core/lock/upstream_refs.ts`
- Modify: `packages/markspec/core/lock/upstream_refs_test.ts`

**Rationale:** decision 1 unifies references + dependencies under
warn-and-write. Today `l213` (line ~97) and the MSL-L214 restore-mismatch (line
~292) are `severity: "error"`, and `lock.ts` aborts the whole write on any
error. Relax both to `warning` here; Task 5 removes the command-level abort.

- [ ] **Step 1: Update the severity in `upstream_refs.ts`**

Change the `l213` helper:

```ts
function l213(id: string, detail: string): Diagnostic {
  return {
    code: "MSL-L213",
    severity: "warning",
    message: `upstream reference '${id}' could not be locked: ${detail}`,
    location: undefined,
  };
}
```

And the MSL-L214 diagnostic object (in the keep/restore branch): change
`severity: "error"` to `severity: "warning"`. Leave its message unchanged.

- [ ] **Step 2: Update `upstream_refs_test.ts` expectations**

Find every assertion that expects `severity === "error"` for an `MSL-L213` or
`MSL-L214` diagnostic and change the expected value to `"warning"`. Run the
suite to see which fail first:

Run: `deno test packages/markspec/core/lock/upstream_refs_test.ts` Expected
before edit: FAIL on severity mismatches. After edit: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/markspec/core/lock/upstream_refs.ts \
        packages/markspec/core/lock/upstream_refs_test.ts
git commit -m "refactor(core): relax reference lock failures to warn-and-write (decision 1)"
```

---

## Task 5: Wire dependency acquisition into `markspec lock`

**Files:**

- Modify: `packages/markspec/cli/commands/lock.ts`

**Interfaces:**

- Consumes: `resolveProjectDependencies`, `compileAcquiredTree`,
  `parseLsRemote`, `upstreamCacheRoot`, `UpstreamDependency` (all now exported);
  `denoDiscoveryIO` (`cli/helpers.ts`).

- [ ] **Step 1: Add the Deno-backed git + IO seams**

Add to `lock.ts` (near the other `default*` helpers):

```ts
import { denoDiscoveryIO } from "../helpers.ts";
import {
  compileAcquiredTree,
  type GitIO,
  parseLsRemote,
  resolveProjectDependencies,
  type UpstreamDependency,
  VERSION,
} from "../../core/mod.ts";

/** Run a git subprocess, returning stdout or `{ error }`. Never throws. */
async function runGit(
  args: string[],
): Promise<{ stdout: string } | { error: string }> {
  try {
    const cmd = new Deno.Command("git", {
      args,
      stdout: "piped",
      stderr: "piped",
    });
    const out = await cmd.output();
    if (!out.code) return { stdout: new TextDecoder().decode(out.stdout) };
    return { error: new TextDecoder().decode(out.stderr).trim() || `git exit ${out.code}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const denoGitIO: GitIO = {
  async lsRemote(url) {
    const r = await runGit(["ls-remote", "--symref", url]);
    return "error" in r ? r : parseLsRemote(r.stdout);
  },
  async acquireTree(url, sha, destDir) {
    // Shallow fetch-by-sha, no history, no blobs until needed, then detach.
    // (Requires the remote to allow reachable-sha fetches — GitHub/GitLab do;
    // the e2e bare-repo fixture sets uploadpack.allowReachableSHA1InWant.)
    for (
      const args of [
        ["-C", destDir, "init", "-q"],
        ["-C", destDir, "remote", "add", "origin", url],
        ["-C", destDir, "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", sha],
        ["-C", destDir, "checkout", "-q", "FETCH_HEAD"],
      ]
    ) {
      const r = await runGit(args);
      if ("error" in r) return { error: r.error };
    }
    // Drop the .git directory so it never enters discovery or lingers on disk.
    try {
      await Deno.remove(`${destDir}/.git`, { recursive: true });
    } catch { /* best-effort */ }
    return {};
  },
};

/** Compile an acquired tree with Deno-backed IO. */
function denoCompileTree(treeRoot: string) {
  return compileAcquiredTree(treeRoot, {
    readFile: readFileOrUndefined,
    readText: (p) => Deno.readTextFile(p),
    discovery: denoDiscoveryIO(),
  }, VERSION);
}
```

- [ ] **Step 2: Replace the dependency placeholder**

Delete the placeholder loop
(`for (const dep of config.dependencies) { … row not written }`, lines ~167–175)
and, right after the `resolveProjectReferences` block, add:

```ts
  const existingDependencies = (existingLockfile?.upstreams ?? [])
    .filter((u): u is UpstreamDependency => u.kind === "dependency");

  const depResult = await resolveProjectDependencies({
    dependencies: config.dependencies,
    existing: existingDependencies,
    cacheRoot: upstreamCacheRoot(projectRoot),
    update: options.update ?? false,
    io: {
      git: denoGitIO,
      compileTree: denoCompileTree,
      readFile: defaultReadFile,
      writeFile: defaultWriteFile,
      makeTempDir: () => Deno.makeTempDir({ prefix: "markspec-dep-" }),
      removeDir: (p) => Deno.remove(p, { recursive: true }).catch(() => {}),
    },
    lockedAt: resolved.lockedAt,
  });
  for (const d of depResult.diagnostics) {
    console.error(`${d.severity}: ${d.code}: ${d.message}`);
  }
```

- [ ] **Step 3: Drop the ref-error abort; merge dependency rows**

Remove the abort guard (decision 1):

```ts
// DELETE these lines:
if (refResult.diagnostics.some((d) => d.severity === "error")) {
  Deno.exit(1);
}
```

Add the dependency rows to the lockfile `upstreams` array:

```ts
upstreams: [
  ...resolved.references.map((r) => r.upstream),
  ...resolved.profiles.map((p) => p.upstream),
  ...refResult.registries,
  ...depResult.dependencies,
],
```

- [ ] **Step 4: Surface the count in both summaries**

In the `--format json` summary object add
`dependencies: { resolved: depResult.dependencies.length },` and in the
human-readable `wrote markspec.lock (…)` string append
`, ${depResult.dependencies.length} dependencies`.

- [ ] **Step 5: Type-check + run existing lock e2e**

Run: `deno check packages/markspec/cli/commands/lock.ts` Run:
`deno test --allow-read --allow-write --allow-run --allow-env tests/e2e/federated_lock_test.ts`
Expected: PASS (the reference flows still lock; no dependency declared in those
fixtures).

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/cli/commands/lock.ts
git commit -m "feat(cli): acquire git dependencies during markspec lock"
```

---

## Task 6: `--strict` release-assurance advisory (MSL-L215, §4.4)

**Files:**

- Create: `packages/markspec/core/lock/pin_assurance.ts`
- Test: `packages/markspec/core/lock/pin_assurance_test.ts`
- Modify: `packages/markspec/core/lock/mod.ts`, `packages/markspec/core/mod.ts`
- Modify: `packages/markspec/cli/commands/check.ts`

**Design:** `check` already promotes `warning`→`error` under `--strict`. So the
§4.4 gate is just a warning-severity advisory per non-`tag:` dependency pin;
`--strict` turns it into a failing gate, and below `--strict` it is the gentle
project-level advisory the design calls for.

- [ ] **Step 1: Write the failing test**

```ts
// packages/markspec/core/lock/pin_assurance_test.ts
import { assertEquals } from "@std/assert";
import { dependencyPinAssurance } from "./pin_assurance.ts";
import type { Lockfile, UpstreamDependency } from "./model.ts";

function dep(resolved: string): UpstreamDependency {
  return {
    kind: "dependency",
    id: "icd",
    url: "https://example.test/icd.git",
    intent: "main",
    resolved,
    sha: "abcdef0123456789abcdef0123456789abcdef01",
    snapshot: "sha",
    lockedAt: "2026-07-04T00:00:00Z",
  };
}
function lf(...ups: UpstreamDependency[]): Lockfile {
  return {
    schema: 1,
    meta: { markspecSchema: 1, lockedAt: "2026-07-04T00:00:00Z" },
    upstreams: ups,
    boundEntries: [],
    edges: [],
    generatedCache: { edgesHash: "", edgesCount: 0 },
  };
}

Deno.test("tag pin → no advisory", () => {
  assertEquals(dependencyPinAssurance(lf(dep("tag:v1.0.0"))), []);
});

Deno.test("branch pin → one MSL-L215 warning", () => {
  const d = dependencyPinAssurance(lf(dep("branch:main")));
  assertEquals(d.length, 1);
  assertEquals(d[0].code, "MSL-L215");
  assertEquals(d[0].severity, "warning");
});

Deno.test("sha pin → one MSL-L215 warning", () => {
  assertEquals(dependencyPinAssurance(lf(dep("sha:abcdef0"))).length, 1);
});

Deno.test("undefined lockfile → no advisory", () => {
  assertEquals(dependencyPinAssurance(undefined), []);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `deno test packages/markspec/core/lock/pin_assurance_test.ts` Expected:
FAIL — module not found.

- [ ] **Step 3: Implement `pin_assurance.ts`**

```ts
/**
 * @module core/lock/pin_assurance
 *
 * Release-assurance advisory for federated dependencies (design §4.4). Every
 * `[[upstream.dependency]]` pin that resolved to a branch or bare sha (rather
 * than a tag) is an "unreleased" pin. Below `check --strict` this is a gentle
 * project-level advisory; `check --strict` promotes the warning to an error,
 * making it the release gate — you cannot release against a dependency that
 * never baselined. Pure.
 */

import type { Diagnostic } from "../model/mod.ts";
import type { Lockfile } from "./model.ts";

export function dependencyPinAssurance(
  lockfile: Lockfile | undefined,
): Diagnostic[] {
  if (!lockfile) return [];
  const out: Diagnostic[] = [];
  for (const u of lockfile.upstreams) {
    if (u.kind !== "dependency") continue;
    if (u.resolved.startsWith("tag:")) continue;
    out.push({
      code: "MSL-L215",
      severity: "warning",
      message:
        `dependency '${u.id}' is pinned to an unreleased state (${u.resolved} @ ${
          u.sha.slice(0, 12)
        }); release builds (check --strict) require a tagged pin — ask the upstream to cut a tag, then run 'markspec lock --update=${u.id}'`,
      location: undefined,
    });
  }
  return out;
}
```

- [ ] **Step 4: Export it**

Add to `core/lock/mod.ts`:

```ts
export { dependencyPinAssurance } from "./pin_assurance.ts";
```

and append `dependencyPinAssurance` to the `core/mod.ts` re-export from
`./lock/mod.ts`.

- [ ] **Step 5: Wire into `check.ts`**

`check.ts` already parses the lockfile for its drift gate (the block producing
`lockDiagnostics`). Locate where the parsed `Lockfile` is available (or add a
`parseLockfile` on `markspec.lock` next to it), then include the advisory in the
merged `allDiagnostics` array — it MUST be added before the `--strict` promotion
and MUST NOT be added to `strictExempt` (it is the consumer's own, fixable pin):

```ts
import { dependencyPinAssurance } from "../../core/mod.ts";
// …after the lockfile is parsed (call it `parsedLock: Lockfile | undefined`)…
const pinDiagnostics = scope.projectWide
  ? dependencyPinAssurance(parsedLock)
  : [];
// …then in the allDiagnostics array literal, add:  ...pinDiagnostics,
```

If `check.ts` does not already hold a parsed `Lockfile`, add, in the
`projectWide` branch only:

```ts
const { parseLockfile } = await import("../../core/mod.ts");
const lockRaw = await readFile(join(projectRoot, "markspec.lock"));
const parsedLock = lockRaw !== undefined
  ? parseLockfile(lockRaw).lockfile
  : undefined;
```

- [ ] **Step 6: Run tests + type-check**

Run: `deno test packages/markspec/core/lock/pin_assurance_test.ts` Expected:
PASS (4 tests). Run: `deno check packages/markspec/cli/commands/check.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/markspec/core/lock/pin_assurance.ts \
        packages/markspec/core/lock/pin_assurance_test.ts \
        packages/markspec/core/lock/mod.ts packages/markspec/core/mod.ts \
        packages/markspec/cli/commands/check.ts
git commit -m "feat: MSL-L215 unreleased-dependency-pin advisory (check --strict gate)"
```

---

## Task 7: End-to-end — offline local bare-repo fixture

**Files:**

- Create: `tests/e2e/federated_dependency_test.ts`

**Approach:** build a real bare git repo in a temp dir with a tag and a branch,
declare it as a `dependencies:` entry in a consumer project whose `Satisfies:`
targets an ID that lives only in the dependency, then run the real CLI binary
(no network). Mirror the invocation/permission pattern of
`tests/e2e/federated_lock_test.ts`, **adding `--allow-run`** so the lock command
can spawn `git`.

- [ ] **Step 1: Write the e2e test**

```ts
// tests/e2e/federated_dependency_test.ts
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const CLI = new URL("../../packages/markspec/main.ts", import.meta.url).pathname;

async function run(args: string[], cwd: string) {
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      CLI,
      ...args,
    ],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const o = await cmd.output();
  return {
    code: o.code,
    stdout: new TextDecoder().decode(o.stdout),
    stderr: new TextDecoder().decode(o.stderr),
  };
}

async function git(args: string[], cwd: string) {
  const o = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" }).output();
  if (o.code) throw new Error(new TextDecoder().decode(o.stderr));
  return new TextDecoder().decode(o.stdout).trim();
}

/** Create an upstream repo with one entry, commit, tag v1.0.0; return bare URL + tag sha. */
async function makeUpstream(root: string) {
  const work = join(root, "up-work");
  await Deno.mkdir(join(work, "docs"), { recursive: true });
  await Deno.writeTextFile(join(work, "project.yaml"), "name: aeb-icd\nversion: 1.0.0\n");
  await Deno.writeTextFile(
    join(work, "docs", "icd.md"),
    [
      "# ICD",
      "",
      "- [STK_ICD_0001] Brake torque interface",
      "",
      "  The interface shall carry brake torque within 5 ms.",
      "",
      "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
      "",
    ].join("\n"),
  );
  await git(["init", "-q", "-b", "main"], work);
  await git(["config", "user.email", "t@t.test"], work);
  await git(["config", "user.name", "t"], work);
  await git(["add", "."], work);
  await git(["commit", "-q", "-m", "init"], work);
  await git(["tag", "v1.0.0"], work);
  // Bare clone as the "remote"; allow fetch-by-sha for the restore path.
  const bare = join(root, "up.git");
  await git(["clone", "-q", "--bare", work, bare], root);
  await git(["config", "uploadpack.allowReachableSHA1InWant", "true"], bare);
  const sha = await git(["rev-parse", "v1.0.0"], work);
  return { bare, sha };
}

Deno.test("lock acquires a git dependency and resolves a cross-repo Satisfies", async () => {
  const root = await Deno.makeTempDir();
  try {
    const { bare, sha } = await makeUpstream(root);
    const proj = join(root, "consumer");
    await Deno.mkdir(join(proj, "docs"), { recursive: true });
    await Deno.writeTextFile(
      join(proj, "project.yaml"),
      `name: aeb\nversion: 0.1.0\ndependencies:\n  - url: ${bare}\n    name: icd\n    version: v1.0.0\n`,
    );
    await Deno.writeTextFile(
      join(proj, "docs", "sys.md"),
      [
        "# Sys",
        "",
        "- [SAD_AEB_0001] Brake actuation",
        "",
        "  The system shall actuate braking.",
        "",
        "      Id: 01HGW3A2BCD5ABCDEFGHJKMNPQ",
        "      Satisfies: STK_ICD_0001",
        "",
      ].join("\n"),
    );

    // First lock — pins the tag.
    const lock1 = await run(["lock"], proj);
    assertEquals(lock1.code, 0);
    const lockText = await Deno.readTextFile(join(proj, "markspec.lock"));
    assertStringIncludes(lockText, "[[upstream.dependency]]");
    assertStringIncludes(lockText, 'resolved = "tag:v1.0.0"');
    assertStringIncludes(lockText, sha);

    // check resolves the cross-repo Satisfies (no broken-ref error).
    const chk = await run(["check"], proj);
    assertEquals(chk.stderr.includes("STK_ICD_0001"), false);
    assertEquals(chk.code, 0);

    // Idempotence — second lock does not re-acquire (cache intact).
    const before = (await Deno.stat(join(proj, ".markspec/cache/upstreams/icd/compiled.json"))).mtime;
    const lock2 = await run(["lock"], proj);
    assertEquals(lock2.code, 0);
    const after = (await Deno.stat(join(proj, ".markspec/cache/upstreams/icd/compiled.json"))).mtime;
    assertEquals(before?.getTime(), after?.getTime());
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("auto intent pins the highest tag; --strict passes on a tag pin", async () => {
  const root = await Deno.makeTempDir();
  try {
    const { bare } = await makeUpstream(root);
    const proj = join(root, "consumer");
    await Deno.mkdir(proj, { recursive: true });
    await Deno.writeTextFile(
      join(proj, "project.yaml"),
      `name: aeb\nversion: 0.1.0\ndependencies:\n  - url: ${bare}\n    name: icd\n`,
    );
    const lock = await run(["lock"], proj);
    assertEquals(lock.code, 0);
    assertStringIncludes(
      await Deno.readTextFile(join(proj, "markspec.lock")),
      'resolved = "tag:v1.0.0"',
    );
    // Tag pin → --strict has no unreleased-pin error.
    const strict = await run(["check", "--strict"], proj);
    assertEquals(strict.stderr.includes("MSL-L215"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("branch pin trips MSL-L215 under --strict", async () => {
  const root = await Deno.makeTempDir();
  try {
    const { bare } = await makeUpstream(root);
    const proj = join(root, "consumer");
    await Deno.mkdir(proj, { recursive: true });
    await Deno.writeTextFile(
      join(proj, "project.yaml"),
      `name: aeb\nversion: 0.1.0\ndependencies:\n  - url: ${bare}\n    name: icd\n    version: main\n`,
    );
    assertEquals((await run(["lock"], proj)).code, 0);
    const strict = await run(["check", "--strict"], proj);
    assertStringIncludes(strict.stderr, "MSL-L215");
    assertEquals(strict.code, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
```

- [ ] **Step 2: Run the e2e**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env tests/e2e/federated_dependency_test.ts`
Expected: PASS (3 tests).

> Debugging note: if `check` reports `STK_ICD_0001` as a broken ref, the
> dependency snapshot did not hydrate — inspect
> `.markspec/cache/upstreams/icd/compiled.json`. If `git fetch <sha>` fails in
> the restore path, confirm `uploadpack.allowReachableSHA1InWant` is set on the
> bare fixture.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/federated_dependency_test.ts
git commit -m "test(e2e): git dependency acquisition, idempotence, --strict gate"
```

---

## Task 8: Docs — CI recipe, design-doc fold, language.md row

**Files:**

- Modify: `docs/wip/2026-07-04-federated-upstream-resolution-design.md`
- Modify: `docs/spec/language/language.md`
- Modify: `docs/guide/` (the lockfile/federation page and CLI reference)

- [ ] **Step 1: Fold decisions 1–3 into the design doc**

In `§4.2`, replace the "never record a partial pin" note for references with the
warn-and-write policy (decision 1), noting it applies to both `references:` and
`dependencies:`. In `§4.3`, mark the forge-tarball rung as **deferred to a
fast-follow** (decision 2) and state that v1 acquires via shallow
`git fetch`-by-sha; add the determinism paragraph (sorted tree-relative paths,
no stat/git). In `§4.4`, state that the `check --strict` gate + MSL-L215
advisory ship in slice 3 (decision 3).

- [ ] **Step 2: Add the MSL-L215 catalogue row to `language.md` §8.3**

Insert after the MSL-L214 row (keep the table's column style):

```markdown
| `MSL-L215` | warning | A `dependencies:` pin resolved to a branch or bare sha,
not a tag (an unreleased state). Advisory by default; promoted to an error under
`markspec check --strict` — release builds require every dependency to be
tag-pinned. |
```

- [ ] **Step 3: Add the CI cache recipe to the guide**

In the federation/lockfile guide page, add a short "CI caching" subsection:

```markdown
### Caching upstream snapshots in CI

`markspec lock` is the only online step. `check`/`compile` read the cached
snapshots under `.markspec/cache/upstreams/`. Cache that directory keyed on the
lockfile hash so CI re-acquires a dependency only when a pin actually moves:

    # GitHub Actions
    - uses: actions/cache@v4
      with:
        path: .markspec/cache/upstreams
        key: markspec-upstreams-${{ hashFiles('markspec.lock') }}
```

Also add one line to the CLI reference `lock` entry noting that `dependencies:`
git repositories are acquired (shallow, at the resolved sha) and compiled into
the cache, and that `--strict` on `check` enforces tag-pinned dependencies.

- [ ] **Step 4: Format docs + commit**

Run: `dprint fmt docs/`

```bash
git add docs/
git commit -m "docs: federated git dependencies — design fold, MSL-L215, CI cache recipe"
```

---

## Final verification (before opening the PR)

- [ ] Run the full gate from the worktree: `just build` (lint + test +
      type-check + compile). All must pass, zero warnings.
- [ ] Confirm `deno fmt --check` and `dprint check` both pass (separate CI
      gates).
- [ ] Confirm `docs/wip/` still holds only the epic design doc + this plan + the
      slice plans (no stray files); gardening is slice 6's deliverable, so the
      ungardened-wip debt stays declared in the PR body (matches slices 2/4).

## After execution (not code)

- File the **forge-tarball optimization** fast-follow issue (deferred per
  decision 2): "prefer the GitHub/GitLab tarball endpoint over shallow clone for
  recognized hosts", linking design §4.3 and this slice.
- Note the **v1 boundaries** in the PR body: (a) a dependency that itself
  declares `dependencies:` is compiled against its own tree only — its
  cross-repo refs surface as diagnostics baked into its snapshot; its
  own-authored entries still hydrate. (b) a dependency's profile-**delivered**
  corpus is not loaded during the dependency compile. Both are graceful
  degradations, not blockers.
