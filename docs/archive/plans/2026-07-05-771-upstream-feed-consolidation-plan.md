# Upstream Feed-Site Consolidation (#771 PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared core function (`loadProjectUpstreams` in
`core/upstream/project.ts`) performs the lockfile→upstream-corpus hydration for
all four feed surfaces (CLI `compileProject`, `check`, LSP `seedUpstreamCorpus`,
MCP `loadLockedUpstreams`), plus two adjacent plumbing fixes: `report.ts` stops
double-loading `project.yaml`, and the LSP routes a `markspec.lock`-only change
to a cheap upstream re-seed instead of a full profile reload.

**Architecture:** Lift the existing `cli/helpers.ts` `loadProjectUpstreams` into
`core/upstream/` with an injected `ReadFile` (same purity rule as
`loadUpstreamCorpus`), then repoint the four call sites. The LSP gains a pure
classifier (`lsp/watched_files.ts`) so the watched-files dispatcher can tell a
lock-only batch from a profile-affecting one.

**Tech Stack:** Deno/TypeScript, `@std/assert` unit tests, colocated `_test.ts`
convention.

## Global Constraints

- `core/mod.ts` is the library boundary — everything outside `core/` imports
  from it, never from internal core paths.
- No `Deno.*` APIs in core library code — I/O via injected `ReadFile`.
- Zero warnings from `deno check`, `deno lint`, `deno test`.
- Single PR = code + tests + docs; ONE squashed commit at PR time (intermediate
  task commits get squashed in Task 8).
- Soft-fail posture is behavior-preserving: a missing/cold upstream cache
  surfaces `UPSTREAM-SNAPSHOT-00x` diagnostics, never throws, never aborts.

---

### Task 1: Core loader `loadProjectUpstreams`

**Files:**

- Create: `packages/markspec/core/upstream/project.ts`
- Create: `packages/markspec/core/upstream/project_test.ts`
- Modify: `packages/markspec/core/mod.ts` (add export after the
  `upstreamRefsFromLockfile` export, ~line 490)

**Interfaces:**

- Consumes: `upstreamRefsFromLockfile` (`core/upstream/refs.ts`),
  `loadUpstreamCorpus` + `LoadUpstreamCorpusResult` (`core/upstream/mod.ts`),
  `Lockfile` (`core/lock/model.ts`), `ReadFile` (`core/config/mod.ts`).
- Produces:
  `loadProjectUpstreams(projectRoot: string, lockfile: Lockfile |
  undefined, readFile: ReadFile): Promise<LoadUpstreamCorpusResult>`
  — Tasks 2, 4, 5, 6 call exactly this signature via `core/mod.ts`.

- [ ] **Step 1: Write the failing test**

`packages/markspec/core/upstream/project_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { loadProjectUpstreams } from "./project.ts";
import type { Lockfile } from "../lock/mod.ts";

function lf(upstreams: Lockfile["upstreams"]): Lockfile {
  return {
    schema: 1,
    meta: { markspecSchema: 1, lockedAt: "2026-07-04T00:00:00Z" },
    upstreams,
    boundEntries: [],
    edges: [],
    generatedCache: { edgesHash: "sha256:0", edgesCount: 0 },
  };
}

Deno.test("loadProjectUpstreams: no lockfile → empty, no reads", async () => {
  let reads = 0;
  const result = await loadProjectUpstreams("/proj", undefined, () => {
    reads++;
    return Promise.resolve(undefined);
  });
  assertEquals(result, { entries: [], diagnostics: [] });
  assertEquals(reads, 0);
});

Deno.test("loadProjectUpstreams: no snapshot rows → empty, no reads", async () => {
  let reads = 0;
  const result = await loadProjectUpstreams(
    "/proj",
    lf([{
      kind: "registry",
      id: "old",
      api: "https://x",
      resolvedManifestHash: "sha256:a",
      markspecSchema: 1,
    }]),
    () => {
      reads++;
      return Promise.resolve(undefined);
    },
  );
  assertEquals(result, { entries: [], diagnostics: [] });
  assertEquals(reads, 0);
});

Deno.test("loadProjectUpstreams: snapshot row hydrates via loadUpstreamCorpus", async () => {
  // A readFile with no cache proves delegation: the shared loader surfaces
  // loadUpstreamCorpus's UPSTREAM-SNAPSHOT-002 missing-manifest diagnostic.
  const result = await loadProjectUpstreams(
    "/proj",
    lf([{
      kind: "registry",
      id: "refhub",
      api: "https://x",
      resolvedManifestHash: "sha256:a",
      markspecSchema: 1,
      version: "1.4.0",
      snapshot: "sha256:b",
      lockedAt: "2026-07-04T00:00:00Z",
    }]),
    () => Promise.resolve(undefined),
  );
  assertEquals(result.entries, []);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "UPSTREAM-SNAPSHOT-002");
});
```

(If the `lf()` fixture's `Lockfile` shape drifts from `core/lock/model.ts`, copy
the current fixture from `core/upstream/refs_test.ts` — it builds the same
object.)

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test packages/markspec/core/upstream/project_test.ts` Expected: FAIL
— `Module not found ... project.ts`.

- [ ] **Step 3: Write the implementation**

`packages/markspec/core/upstream/project.ts`:

```typescript
/**
 * @module upstream/project
 *
 * Shared lockfile→upstream hydration (#771): the one function every
 * surface that feeds locked upstream snapshots into the graph goes
 * through — the CLI compiler (`compileProject`), `check`, the LSP
 * (`seedUpstreamCorpus`), and the MCP server (`loadLockedUpstreams`).
 * Composes {@linkcode upstreamRefsFromLockfile} +
 * {@linkcode loadUpstreamCorpus} with the shared no-lockfile /
 * empty-refs short-circuit so the four surfaces' soft-fail and
 * diagnostic semantics cannot drift. Pure — file access via the
 * injected {@linkcode ReadFile}, same rule as `loadUpstreamCorpus`;
 * never throws on a missing or cold cache (failures surface as
 * UPSTREAM-SNAPSHOT-00x diagnostics).
 */

import type { Lockfile } from "../lock/model.ts";
import type { ReadFile } from "../config/mod.ts";
import { loadUpstreamCorpus, type LoadUpstreamCorpusResult } from "./mod.ts";
import { upstreamRefsFromLockfile } from "./refs.ts";

/**
 * Hydrate a project's locked upstream snapshots into read-only
 * `Entry[]`. Returns empty when there is no lockfile or no
 * snapshot-carrying upstream rows (without touching `readFile`).
 */
export async function loadProjectUpstreams(
  projectRoot: string,
  lockfile: Lockfile | undefined,
  readFile: ReadFile,
): Promise<LoadUpstreamCorpusResult> {
  if (!lockfile) return { entries: [], diagnostics: [] };
  const refs = upstreamRefsFromLockfile(lockfile, projectRoot);
  if (refs.length === 0) return { entries: [], diagnostics: [] };
  return await loadUpstreamCorpus(refs, readFile);
}
```

In `packages/markspec/core/mod.ts`, directly after the
`export { upstreamRefsFromLockfile } from "./upstream/refs.ts";` line, add:

```typescript
export { loadProjectUpstreams } from "./upstream/project.ts";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test packages/markspec/core/upstream/` Expected: PASS (new tests +
existing `mod_test.ts` / `refs_test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/upstream/project.ts \
  packages/markspec/core/upstream/project_test.ts \
  packages/markspec/core/mod.ts
git commit -m "refactor(core): add shared loadProjectUpstreams loader"
```

---

### Task 2: Repoint the CLI sites (`compileProject`, `check`)

**Files:**

- Modify: `packages/markspec/cli/helpers.ts:271-298` (delete the local
  `loadProjectUpstreams` + `ProjectUpstreams`), `:334` (dynamic import),
  `:357-360` (call site)
- Modify: `packages/markspec/cli/commands/check.ts:17-25` (import list), `:81`
  (dynamic import), `:107-109` (call site)

**Interfaces:**

- Consumes: Task 1's `loadProjectUpstreams` via `core/mod.ts`.
- Produces: no signature changes visible to other tasks.

- [ ] **Step 1: Delete the local helper**

In `cli/helpers.ts`, delete the entire block from
`/** Result of {@linkcode loadProjectUpstreams}. */` through the end of the old
`loadProjectUpstreams` function (lines 271–298). First confirm nothing else
imports the deleted names:

Run: `grep -rn "ProjectUpstreams" packages/markspec --include="*.ts"` Expected:
only `check.ts`'s `loadProjectUpstreams` import remains (fixed in Step 3); no
other consumer.

- [ ] **Step 2: Repoint `compileProject`**

In `compileProject` (same file), change the dynamic import line

```typescript
const { compile, parseLockfile } = await import("../core/mod.ts");
```

to

```typescript
const { compile, parseLockfile, loadProjectUpstreams } = await import(
  "../core/mod.ts"
);
```

and the call

```typescript
const upstreams = await loadProjectUpstreams(
  configResult.projectRoot,
  lockfile,
);
```

to

```typescript
const upstreams = await loadProjectUpstreams(
  configResult.projectRoot,
  lockfile,
  readFile,
);
```

- [ ] **Step 3: Repoint `check.ts`**

Remove `loadProjectUpstreams,` from the `../helpers.ts` import list. Change line
81 from

```typescript
const { parseLockfile } = await import("../../core/mod.ts");
```

to

```typescript
const { loadProjectUpstreams, parseLockfile } = await import(
  "../../core/mod.ts"
);
```

and the call site to

```typescript
const upstreams = scope.projectWide && projectRoot !== undefined
  ? await loadProjectUpstreams(projectRoot, lockParse?.lockfile, readFile)
  : { entries: [], diagnostics: [] };
```

- [ ] **Step 4: Verify with type-check + federated e2e**

Run:

```bash
deno check packages/markspec/main.ts packages/markspec/core/mod.ts
deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi \
  tests/e2e/federated_resolve_test.ts tests/e2e/federated_check_test.ts \
  2>/dev/null || deno test --allow-read --allow-write --allow-run \
  --allow-env --allow-ffi tests/e2e/
```

(First try the two federated files; if those exact names don't exist, run the
whole `tests/e2e/` dir.) Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/cli/helpers.ts packages/markspec/cli/commands/check.ts
git commit -m "refactor(cli): use core loadProjectUpstreams in compileProject and check"
```

---

### Task 3: `report.ts` double-load — `compileProject` returns its config

**Files:**

- Modify: `packages/markspec/cli/helpers.ts` (`compileProject` return type +
  return object)
- Modify: `packages/markspec/cli/commands/report.ts:8`, `:47`, `:54-59`

**Interfaces:**

- Consumes: `compileProject`'s existing `configResult` local.
- Produces: `compileProject` return type gains `config: ProjectConfig` (additive
  — the 12 other callers destructure only what they need).

- [ ] **Step 1: Return the config**

In `cli/helpers.ts`, add `ProjectConfig` to the type-only import list from
`../core/mod.ts`. Change `compileProject`'s declared return type from

```typescript
Promise<{
  result: CompileResult;
  chain: ProfileChain | null;
  corpusIndex: ReadonlyMap<string, DeliveredDocument>;
}>
```

to

```typescript
Promise<{
  result: CompileResult;
  chain: ProfileChain | null;
  corpusIndex: ReadonlyMap<string, DeliveredDocument>;
  config: ProjectConfig;
}>
```

and the final `return { result, chain, corpusIndex };` (at the end of
`compileProject`) to
`return { result, chain, corpusIndex, config: configResult.config };`. Also
extend the doc comment: the returned `config` is the `project.yaml` the compile
already resolved, so callers don't re-load it.

- [ ] **Step 2: Use it in `report.ts`**

Change line 8 to `import { compileProject } from "../helpers.ts";`, line 47 to

```typescript
const { result: compiled, config } = await compileProject(paths);
```

and delete the line `const { config } = await requireProjectConfig();` (keep the
comment block above it — it explains dependency vs reference semantics, still
true).

- [ ] **Step 3: Verify**

Run:

```bash
deno check packages/markspec/main.ts
deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi \
  tests/e2e/report_test.ts 2>/dev/null || deno test --allow-read \
  --allow-write --allow-run --allow-env --allow-ffi tests/e2e/
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/markspec/cli/helpers.ts packages/markspec/cli/commands/report.ts
git commit -m "refactor(cli): compileProject returns resolved config; report stops double-loading"
```

---

### Task 4: Repoint the MCP site

**Files:**

- Modify: `packages/markspec/mcp/project.ts:14-34` (import list), `:412-425`
  (`loadLockedUpstreams` body)

**Interfaces:**

- Consumes: Task 1's `loadProjectUpstreams` via `core/mod.ts`.
- Produces: `loadLockedUpstreams`'s local return shape unchanged
  (`{ entries, diagnostics, mtime }`).

- [ ] **Step 1: Swap the hydration chain**

In the import block, remove `loadUpstreamCorpus,` and
`upstreamRefsFromLockfile,`; add `loadProjectUpstreams,` (keep `parseLockfile`
and the `Lockfile` type). Replace the `try` body of `loadLockedUpstreams`:

```typescript
try {
  const lockRaw = await env.readFile(lockPath);
  const lockfile: Lockfile | undefined = lockRaw !== undefined
    ? parseLockfile(lockRaw).lockfile
    : undefined;
  const upstream = await loadProjectUpstreams(
    projectRoot,
    lockfile,
    env.readFile,
  );
  return {
    entries: upstream.entries,
    diagnostics: upstream.diagnostics,
    mtime,
  };
} catch (err) {
```

(The `!lockfile` and `refs.length === 0` early returns disappear — the shared
loader internalizes both; an empty result flows through the same return.) Update
the function's doc comment: it now delegates to the shared
`loadProjectUpstreams` (#771) instead of mirroring `compileProject` by hand.

- [ ] **Step 2: Verify**

Run: `deno test --allow-read --allow-write --allow-env packages/markspec/mcp/`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/markspec/mcp/project.ts
git commit -m "refactor(mcp): use shared loadProjectUpstreams"
```

---

### Task 5: Repoint the LSP site (`seedUpstreamCorpus`)

**Files:**

- Modify: `packages/markspec/lsp/server.ts` (import list; `seedUpstreamCorpus`
  body)

**Interfaces:**

- Consumes: Task 1's `loadProjectUpstreams` via `core/mod.ts`.
- Produces: `seedUpstreamCorpus(): Promise<void>` unchanged — Task 6's
  dispatcher calls it.

- [ ] **Step 1: Swap the hydration chain**

In `server.ts`'s `../core/mod.ts` import, remove `loadUpstreamCorpus,` and
`upstreamRefsFromLockfile,`; add `loadProjectUpstreams,`. In
`seedUpstreamCorpus`, replace

```typescript
if (!lockfile || !projectRoot) return;
const refs = upstreamRefsFromLockfile(lockfile, projectRoot);
if (refs.length === 0) return;
try {
  const corpus = await loadUpstreamCorpus(refs, readFile);
```

with

```typescript
if (!projectRoot) return;
try {
  const corpus = await loadProjectUpstreams(projectRoot, lockfile, readFile);
```

(An `undefined` lockfile now returns an empty corpus from the shared loader; the
clear pass above already ran, so behavior is identical.) Trim the doc comment's
"maps ... via upstreamRefsFromLockfile and hydrates them with
loadUpstreamCorpus" sentence to name the shared `loadProjectUpstreams` (#771)
instead.

- [ ] **Step 2: Verify**

Run:
`deno check packages/markspec/lsp/server.ts && deno test packages/markspec/lsp/`
Expected: PASS, zero lint warnings about unused imports.

- [ ] **Step 3: Commit**

```bash
git add packages/markspec/lsp/server.ts
git commit -m "refactor(lsp): use shared loadProjectUpstreams in seedUpstreamCorpus"
```

---

### Task 6: LSP lock-only watched-file routing

**Files:**

- Create: `packages/markspec/lsp/watched_files.ts`
- Create: `packages/markspec/lsp/watched_files_test.ts`
- Modify: `packages/markspec/lsp/server.ts` (`onDidChangeWatchedFiles` handler,
  the `debouncedReloadProfile` const, `onShutdown`)

**Interfaces:**

- Consumes: `seedUpstreamCorpus`, `reloadLockfile`, `reloadProfile`,
  `publishAllDiagnostics`, `debounce` — all already in `server.ts`.
- Produces: `isLockfileOnlyChange(uris: readonly string[]): boolean`.

- [ ] **Step 1: Write the failing classifier test**

`packages/markspec/lsp/watched_files_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { isLockfileOnlyChange } from "./watched_files.ts";

Deno.test("isLockfileOnlyChange: lock-only batch → true", () => {
  assertEquals(isLockfileOnlyChange(["file:///proj/markspec.lock"]), true);
});

Deno.test("isLockfileOnlyChange: profile file → false", () => {
  assertEquals(isLockfileOnlyChange(["file:///proj/.markspec.yaml"]), false);
});

Deno.test("isLockfileOnlyChange: mixed batch → false", () => {
  assertEquals(
    isLockfileOnlyChange([
      "file:///proj/markspec.lock",
      "file:///proj/project.yaml",
    ]),
    false,
  );
});

Deno.test("isLockfileOnlyChange: empty batch → false", () => {
  assertEquals(isLockfileOnlyChange([]), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test packages/markspec/lsp/watched_files_test.ts` Expected: FAIL —
module not found.

- [ ] **Step 3: Implement the classifier**

`packages/markspec/lsp/watched_files.ts`:

```typescript
/**
 * @module lsp/watched_files
 *
 * Classifier for the watched-files dispatcher (#771). The server
 * watches three files — `.markspec.yaml`, `project.yaml`, and
 * `markspec.lock`. A change batch touching only `markspec.lock` (a
 * bare `markspec lock` re-run) must not trigger a full profile-chain
 * re-resolve, delivered-corpus re-seed, or `markspec/profileChanged`
 * push — only a lockfile reload + upstream corpus re-seed. Pure and
 * connection-free for unit testing.
 */

/**
 * `true` when every changed URI in the batch is a `markspec.lock`
 * file. An empty batch returns `false` — there is nothing to route.
 * URIs use `/` separators on every platform, so a basename check on
 * the last segment is sufficient.
 */
export function isLockfileOnlyChange(uris: readonly string[]): boolean {
  return uris.length > 0 &&
    uris.every((uri) => uri.split("/").pop() === "markspec.lock");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test packages/markspec/lsp/watched_files_test.ts` Expected: PASS.

- [ ] **Step 5: Wire the dispatcher into `server.ts`**

Add `import { isLockfileOnlyChange } from "./watched_files.ts";` with the other
`./` imports. Directly below
`const debouncedReloadProfile = debounce(reloadProfile, 500);` — replacing it —
add:

```typescript
/** `true` when a profile-affecting file (`.markspec.yaml`,
 * `project.yaml`) changed since the last watched-files reload fired.
 * Accumulates across the debounce window so a lock-only change
 * followed by a profile change escalates to the full reload. */
let pendingProfileFileChange = false;

/**
 * Debounced dispatcher for watched-file changes. A window that saw any
 * profile-file change runs the full {@linkcode reloadProfile} (which
 * also reloads the lockfile and re-seeds both corpora). A
 * `markspec.lock`-only window (#771: a bare `markspec lock` re-run)
 * skips the profile re-resolve, the delivered-corpus re-seed, and the
 * `markspec/profileChanged` push — it refreshes the lockfile, re-seeds
 * the upstream corpus, and republishes diagnostics.
 */
async function reloadWatchedFiles(): Promise<void> {
  const profileChanged = pendingProfileFileChange;
  pendingProfileFileChange = false;
  if (profileChanged) {
    await reloadProfile();
    return;
  }
  await reloadLockfile();
  await seedUpstreamCorpus();
  publishAllDiagnostics();
}

const debouncedReloadWatchedFiles = debounce(reloadWatchedFiles, 500);
```

Replace the `onDidChangeWatchedFiles` handler body with:

```typescript
connection.onDidChangeWatchedFiles((params: { changes: FileEvent[] }) => {
  // We only watch `.markspec.yaml`, `project.yaml`, and `markspec.lock`.
  // Debounce 500ms; the dispatcher routes a markspec.lock-only window
  // to the cheap upstream re-seed and anything else to the full
  // profile reload (#771).
  if (params.changes.length === 0) return;
  if (!isLockfileOnlyChange(params.changes.map((c) => c.uri))) {
    pendingProfileFileChange = true;
  }
  debouncedReloadWatchedFiles();
});
```

In `onShutdown`, replace `debouncedReloadProfile.cancel();` with
`debouncedReloadWatchedFiles.cancel();`. Update the section comment above
`reloadProfile` ("Profile reload — fires ...") to note that routing now lives in
`reloadWatchedFiles` and `reloadProfile` handles the profile-affecting branch.
`reloadProfile` itself is unchanged.

- [ ] **Step 6: Verify**

Run:
`deno check packages/markspec/lsp/server.ts && deno lint packages/markspec/lsp/`
Expected: PASS, no unused-symbol lint (the `debouncedReloadProfile` const is
gone, not orphaned).

- [ ] **Step 7: Commit**

```bash
git add packages/markspec/lsp/watched_files.ts \
  packages/markspec/lsp/watched_files_test.ts packages/markspec/lsp/server.ts
git commit -m "refactor(lsp): route markspec.lock-only changes to upstream re-seed"
```

---

### Task 7: Docs — ADR-031 as-built notes

**Files:**

- Modify: `docs/architecture/adr-031-federated-upstream-resolution.md` (~line
  107 hydration paragraph; ~line 377 as-built inventory)

- [ ] **Step 1: Name the shared loader in the hydration paragraph**

After the sentence ending "…hydrates each cached snapshot into `Entry[]` and
stamps the origin." insert:

```markdown
`loadProjectUpstreams` (`core/upstream/project.ts`) wraps the
lockfile→refs→hydration chain — including the no-lockfile and empty-refs
short-circuits — behind one call, so every feed surface shares the same
soft-fail and diagnostic semantics (#771).
```

- [ ] **Step 2: Extend the as-built inventory**

In the "As-built:" list, after
`` `core/upstream/refs.ts` (`upstreamRefsFromLockfile`) ``, add
`` `core/upstream/project.ts` (`loadProjectUpstreams`), `` .

- [ ] **Step 3: Format + commit**

```bash
just fmt
git add docs/architecture/adr-031-federated-upstream-resolution.md
git commit -m "docs(docs): note shared loadProjectUpstreams in ADR-031"
```

---

### Task 8: Garden, full build, squash, PR

- [ ] **Step 1: Garden working memory** — run the `sdd-gardening` skill so
      `docs/wip/` is empty on the branch (this plan moves to `docs/archive/`;
      the ADR-031 edit is the durable record).

- [ ] **Step 2: Full verification**

```bash
just fmt && just build && deno fmt --check && dprint check
```

Expected: all pass (build = lint + test + typecheck + compile).

- [ ] **Step 3: Squash to one commit** (repo rule: one commit per PR)

```bash
git reset --soft origin/main
git commit -F <message-file>   # backtick-safe: write message to a file
```

Message:
`refactor(core): consolidate lockfile→upstream hydration into
core/upstream (#771)`
with a body listing the four repointed sites, the report.ts double-load fix, and
the LSP lock-only routing. Reference `Part of #771.` — do NOT `Closes`
(partition-once and polish PRs remain).

- [ ] **Step 4: Push + PR** (pre-push hook runs `just check`, allow ≥300s)

```bash
git push -u origin refactor/771-upstream-feed-sites
gh pr create --title "refactor(core): consolidate lockfile→upstream hydration (#771)" --body-file <body-file>
```

- [ ] **Step 5: Run `/review` on the PR** and post findings as a PR comment.
