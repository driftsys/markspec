# Federated Upstream Resolution — Slice 4: Graph Integration + Validator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed the already-cached upstream entries (slice 1's
`loadUpstreamCorpus`, slice 2's lockfile rows + cache) into the compiled graph
at every site, so a downstream `Satisfies:` resolves to an upstream entry; land
`MSL-T014` for unresolved-after-federation refs; generalize the `MSL-R014`
collision pass and coverage semantics to upstream origins; and make upstream
entries read-only, validation-exempt graph citizens.

**Architecture:** Slice 4 of the federated-upstream design
(`docs/wip/2026-07-04-federated-upstream-resolution-design.md`, §4.6 feed sites,
§4.7 validator behaviour, §4.8 surface table, §4.9 root/diamond pattern). The
upstream loader, lockfile rows, and cache all exist; this slice is the WIRING +
the validator/coverage generalization. Everything upstream entries need to be
read-only already keys on `Entry.origin`; the gaps are: (a) nothing loads +
feeds them yet, (b) origin entries are today _downgraded_ not _skipped_ by the
validator, (c) `MSL-T014` and (d) coverage leaf-semantics don't exist.

**Tech Stack:** Deno/TypeScript strict, `@std/assert`, colocated unit tests,
blackbox e2e via `tests/e2e/helpers.ts`, Conventional Commits.

## Plan-time scope decisions

- **References are the only upstreams that load in slice 4.** Git
  `dependencies:` aren't fetched until slice 3, so no dependency cache exists.
  The feed path filters lockfile `[[upstream.registry]]` rows (slice-2
  references). The row→ref mapping and coverage classification are built to also
  accept `[[upstream.dependency]]` rows so slice 3 drops in without a validator
  change, but slice 4 is tested end-to-end with `file://` references only.
- **DEFERRED to slice 3** (needs dependency rows from the git fetcher, which
  slice 4 does not produce — building the gate now would be untestable
  end-to-end): the §4.4 unreleased-pin advisory + `check --strict` pin-level
  gate (every `[[upstream.dependency]]` row must be tag-resolved). References
  are released-by-publication and have no tags, so nothing to gate here.
- **DEFERRED to slice 5** (per the design slice table): the LSP/MCP user-facing
  surfaces — completion badges (`— from product@v2.1.0`), hover on upstream
  entries, go-to-definition no-op, read-only decorations. Slice 4 makes upstream
  entries _present + resolving + read-only_ at the LSP/MCP feed sites; slice 5
  polishes the editor UX. (The completion `— from <origin>` badge already exists
  from ADR-030 and will light up for upstream IDs for free once they enter the
  index — that's incidental, not the slice-5 work.)
- **`MSL-T014` severity = warning** (language.md §8.3 reserves it "warning
  severity"), replacing the L006 warning when upstreams are declared. It does
  NOT fail `check` on its own (matches L006); `--strict` promotes it like any
  warning.
- **Validation-exemption is a SKIP, not a downgrade, for `kind:"upstream"`
  only.** Delivered corpus (`kind:"profile"`) keeps its existing
  validate-then-downgrade behaviour (a profile-shipped baseline can carry
  lint-worthy prose). Upstream entries are another repo's already-validated
  compile output — never re-validated. They stay in the resolution maps (so refs
  _to_ them resolve) but are excluded from every per-entry emitting check, and
  refs _from_ them never fire unresolved-ref diagnostics (§4.7).

## Global Constraints

- **Worktree:** all work in
  `/Users/sebastientasson/Workspace/driftsys/markspec-worktrees/federated-slice4`
  (branch `feat/federated-upstream-slice4`, bootstrapped, 9 `grammars/*.wasm`
  verified). Bash cwd resets between calls — `cd` into the worktree at the start
  of every Bash call; use absolute paths with file tools.
- Core stays Node-compatible: no `Deno.*` in `packages/markspec/core/` library
  code — I/O only via injected callbacks. `Deno.*` is fine in `cli/`, `lsp/`,
  `mcp/` entry points and tests.
- Zero warnings from `deno check` / `deno lint` / tests. `deno check` entry
  points:
  `deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts`
- Format before committing: `deno fmt` (TS); `dprint fmt` for edited `.md`.
- Conventional Commits, imperative mood. Allowed scopes: auto, repo, ci, spec,
  core, cli, lsp, mcp, render, book, deck, docs, deps.
- Commit messages containing backticks: write to a scratch file,
  `git commit
  -F <file>`.
- Determinism preserved: upstream entries are injected AHEAD of project entries
  (like corpus) so first-entry-wins graph slots resolve deterministically.
- The authoritative-source rule (in `loadUpstreamCorpus` already) is load-
  bearing for the root/diamond pattern — never weaken it.

---

### Task 1: `upstreamRefsFromLockfile` mapping helper + `loadProjectUpstreams`

**Files:**

- Create: `packages/markspec/core/upstream/refs.ts` (pure mapping) +
  `packages/markspec/core/upstream/refs_test.ts`
- Modify: `packages/markspec/core/mod.ts` (barrel export)
- Create: a CLI loader in `packages/markspec/cli/helpers.ts` next to
  `loadProjectCorpus` (`loadProjectUpstreams`)

**Interfaces:**

- Consumes: `Lockfile`, `Upstream`, `UpstreamRegistry`, `UpstreamDependency`
  from `../lock/model.ts`; `upstreamCacheRoot` from `../lock/upstream_refs.ts`
  (barrel: `core/mod.ts`); `UpstreamSnapshotRef`, `loadUpstreamCorpus`,
  `ReadFile` from `./mod.ts` / `../config/mod.ts`.
- Produces (pure core helper — every feed site uses it):

  ```ts
  /**
   * Map a parsed lockfile's snapshot-carrying upstream rows to
   * UpstreamSnapshotRef[] for loadUpstreamCorpus. Registry + dependency
   * rows with a `snapshot` are included; rows without a snapshot (legacy
   * pin-only) are skipped. `version` falls back to `"unversioned"` when the
   * row has none (UpstreamSnapshotRef.version is required; the loader only
   * uses it for the origin badge).
   */
  export function upstreamRefsFromLockfile(
    lockfile: Lockfile,
    projectRoot: string,
  ): UpstreamSnapshotRef[];
  ```

  Mapping precedent is `verifyUpstreamCache` (`core/lock/cache_check.ts:40-56`):
  filter `u.kind === "registry" || u.kind === "dependency"`, skip
  `u.snapshot === undefined`, `dir = ${upstreamCacheRoot(projectRoot)}/${u.id}`.

- Produces (CLI helper mirroring `loadProjectCorpus`, `cli/helpers.ts`):

  ```ts
  export interface ProjectUpstreams {
    readonly entries: Entry[];
    readonly diagnostics: readonly Diagnostic[];
  }
  /** Read markspec.lock, map rows → refs, hydrate via loadUpstreamCorpus.
   * Returns empty when no lockfile / no snapshot rows. Cold-cache soft-fail:
   * a missing/corrupt cache surfaces UPSTREAM-SNAPSHOT-00x diagnostics but
   * never throws (mirrors loadProjectCorpus). */
  export async function loadProjectUpstreams(
    projectRoot: string,
    lockfile: Lockfile | undefined,
  ): Promise<ProjectUpstreams>;
  ```

- [ ] **Step 1: Failing tests for the pure mapping** (`refs_test.ts`)

```ts
import { assertEquals } from "@std/assert";
import { upstreamRefsFromLockfile } from "./refs.ts";
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

Deno.test("upstreamRefsFromLockfile: registry row → ref with cache dir", () => {
  const refs = upstreamRefsFromLockfile(
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
    "/proj",
  );
  assertEquals(refs, [{
    id: "refhub",
    version: "1.4.0",
    dir: "/proj/.markspec/cache/upstreams/refhub",
  }]);
});

Deno.test("upstreamRefsFromLockfile: snapshot-less row is skipped", () => {
  const refs = upstreamRefsFromLockfile(
    lf([{
      kind: "registry",
      id: "old",
      api: "https://x",
      resolvedManifestHash: "sha256:a",
      markspecSchema: 1,
    }]),
    "/proj",
  );
  assertEquals(refs, []);
});

Deno.test("upstreamRefsFromLockfile: version falls back to 'unversioned'", () => {
  const refs = upstreamRefsFromLockfile(
    lf([{
      kind: "registry",
      id: "refhub",
      api: "https://x",
      resolvedManifestHash: "sha256:a",
      markspecSchema: 1,
      snapshot: "sha256:b",
      lockedAt: "2026-07-04T00:00:00Z",
    }]),
    "/proj",
  );
  assertEquals(refs[0].version, "unversioned");
});

Deno.test("upstreamRefsFromLockfile: reference/profile (non-snapshot) rows skipped", () => {
  const refs = upstreamRefsFromLockfile(
    lf([
      { kind: "reference", slug: "ISO", id: "urn:iso" },
      {
        kind: "profile",
        id: "p",
        specifier: "npm:x",
        resolved: "1",
        hash: "sha256:z",
      },
    ]),
    "/proj",
  );
  assertEquals(refs, []);
});
```

(Confirm the exact `Lockfile`/row field names against `core/lock/model.ts`
before finalizing the fixture — mirror the real interfaces.)

- [ ] **Step 2: Run to verify failure**

`deno test packages/markspec/core/upstream/refs_test.ts --allow-read` → FAIL
(module not found).

- [ ] **Step 3: Implement `core/upstream/refs.ts`**

```ts
/**
 * @module upstream/refs
 *
 * Map a parsed markspec.lock's snapshot-carrying upstream rows to the
 * UpstreamSnapshotRef[] loadUpstreamCorpus consumes. Pure — no I/O.
 */

import type { Lockfile } from "../lock/model.ts";
import { upstreamCacheRoot } from "../lock/upstream_refs.ts";
import type { UpstreamSnapshotRef } from "./mod.ts";

/** Fallback version label when a registry row carries no `version`. */
const UNVERSIONED = "unversioned";

/** See module doc. */
export function upstreamRefsFromLockfile(
  lockfile: Lockfile,
  projectRoot: string,
): UpstreamSnapshotRef[] {
  const cacheRoot = upstreamCacheRoot(projectRoot);
  const refs: UpstreamSnapshotRef[] = [];
  for (const u of lockfile.upstreams) {
    if (u.kind !== "registry" && u.kind !== "dependency") continue;
    if (u.snapshot === undefined) continue;
    refs.push({
      id: u.id,
      version: ("version" in u && u.version) ? u.version : UNVERSIONED,
      dir: `${cacheRoot}/${u.id}`,
    });
  }
  return refs;
}
```

(`UpstreamDependency` has no `version` field — the `"version" in u` guard
handles that; a dependency's version label comes later in slice 3. Adjust to the
real row shapes.)

Export `upstreamRefsFromLockfile` from `core/mod.ts` next to
`loadUpstreamCorpus`.

- [ ] **Step 4: Implement `loadProjectUpstreams` in `cli/helpers.ts`**

Beside `loadProjectCorpus` (lines ~253-268). Reads via `Deno.readTextFile`
(entry point — Deno OK), maps rows→refs, calls `loadUpstreamCorpus`:

```ts
export interface ProjectUpstreams {
  readonly entries: Entry[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Hydrate locked upstream snapshots into read-only Entry[]. Empty when no
 * lockfile or no snapshot rows; cold-cache failures surface as diagnostics,
 * never throw (mirrors loadProjectCorpus). */
export async function loadProjectUpstreams(
  projectRoot: string,
  lockfile: Lockfile | undefined,
): Promise<ProjectUpstreams> {
  if (!lockfile) return { entries: [], diagnostics: [] };
  const refs = upstreamRefsFromLockfile(lockfile, projectRoot);
  if (refs.length === 0) return { entries: [], diagnostics: [] };
  const result = await loadUpstreamCorpus(
    refs,
    (p) => Deno.readTextFile(p).then((t) => t).catch(() => undefined),
  );
  return { entries: result.entries, diagnostics: result.diagnostics };
}
```

(Import `upstreamRefsFromLockfile`, `loadUpstreamCorpus`, `parseLockfile`,
`Lockfile` from `core/mod.ts`. Match the file's existing `readFile` helper if it
already defines one.)

- [ ] **Step 5: Run + commit**

```bash
deno test packages/markspec/core/upstream/ --allow-read
deno check packages/markspec/main.ts packages/markspec/core/mod.ts
deno fmt packages/markspec/core/ packages/markspec/cli/helpers.ts
git add -A packages/markspec/core/ packages/markspec/cli/helpers.ts
git commit -m "feat(core): map lockfile upstream rows to snapshot refs; loadProjectUpstreams helper"
```

### Task 2: Feed upstream entries into `compile()` (compiler + compileProject)

**Files:**

- Modify: `packages/markspec/core/compiler/mod.ts` (`compile` — accept upstream
  entries; extend the Phase-5 corpus-post-pass predicate)
- Modify: `packages/markspec/cli/helpers.ts` (`compileProject` — load + pass
  upstream entries)
- Test: `packages/markspec/core/compiler/mod_test.ts` (extend)

**Interfaces:**

- The cleanest wiring: `compile()` gains no new option — upstream entries are
  merged into the SAME "injected ahead" bucket as corpus. Change
  `compileProject` to concatenate corpus + upstream entries and pass them as
  `corpusEntries` (they are all origin-carrying, read-only, injected-ahead). BUT
  the Phase-5 post-pass guard is `if (options.corpusEntries && length > 0)` —
  that still fires because the merged bucket is non-empty. So **no compiler
  signature change is needed**; `compileProject` merges the two lists. This
  keeps the change minimal and the origin-generic post-pass covers upstream.
- Verify the Phase-5 `detectCorpusCollisions(allEntries)` (compiler/mod.ts ~377)
  sees upstream entries → R014 works (Task 6 refines the message).

- [ ] **Step 1: Failing compiler test** — a compile with an upstream-origin
      entry in `corpusEntries` resolves a project `Satisfies:` to it and does
      NOT produce a broken-ref/unresolved diagnostic; the upstream entry appears
      in `result.entries`. (Follow `mod_test.ts`'s existing `compile` fixture;
      build an upstream entry via `parseFile` + stamped
      `origin: {kind:"upstream",…}`.)

- [ ] **Step 2-3: Run red → wire `compileProject`**

In `cli/helpers.ts` `compileProject` (lines ~294-315): after
`loadProjectCorpus`, also `loadProjectUpstreams(projectRoot, lockfile)` (read
the lockfile once via `parseLockfile` — `compileProject` needs `projectRoot`;
confirm it's in scope, else discover it), then pass
`corpusEntries: [...corpus.entries, ...upstreams.entries]` and prepend
`upstreams.diagnostics` to `result.diagnostics` like corpus. Upstream load is
soft-fail (never `Deno.exit`, unlike corpus's fatal path — a stale cache
shouldn't kill `show`).

- [ ] **Step 4-5: Run compiler + a CLI e2e smoke, commit**

```bash
deno test packages/markspec/core/compiler/ --allow-read --allow-env
deno check packages/markspec/main.ts packages/markspec/core/mod.ts
deno fmt packages/markspec/
git add -A packages/markspec/
git commit -m "feat(core): feed locked upstream entries into compile via compileProject"
```

### Task 3: Upstream entries are validation-exempt (skip, not downgrade)

**Files:**

- Modify: `packages/markspec/core/validator/mod.ts` (`validate` structural +
  `checkReferences` T005/T012 — skip `kind:"upstream"` emitters)
- Modify: `packages/markspec/core/validator/pipeline.ts` (Stages 1.5-4 per-
  entry loops — skip upstream emitters; KEEP upstream in the resolution maps)
- Modify: `packages/markspec/core/lint/runner.ts` (already skips `entry.origin`
  — verify upstream covered; it is, since it keys on any origin)
- Add: a shared `isUpstreamEntry(entry): boolean` predicate (in
  `core/model/mod.ts` next to the origin helpers)
- Test: `packages/markspec/core/validator/mod_test.ts`, `pipeline_test.ts`
  (extend)

**Interfaces:**

- Produces: `export function isUpstreamEntry(entry: Entry): boolean` →
  `entry.origin?.kind === "upstream"`.
- Behaviour: per-entry EMITTING loops (structural checks, T005/T012, Stage 1.5-3
  attribute checks, Stage 4 trace) `continue` when `isUpstreamEntry`. The
  resolution maps (`graph`, `byDisplayId` in pipeline.ts:163-172;
  `byDisplayId`/`byId` in mod.ts checkReferences) are built over ALL entries
  INCLUDING upstream — so refs TO upstream resolve, refs FROM upstream are never
  checked (their entry is skipped before the per-entry loop).
- Delivered corpus (`kind:"profile"`) is UNCHANGED — still validated then
  downgraded. Only `kind:"upstream"` is skipped. (Rationale in scope decisions.)

- [ ] **Step 1: Failing tests** — (a) an upstream entry with deliberately
      malformed prose / a missing required attribute produces NO diagnostic; (b)
      an upstream entry whose `Satisfies:` points at a nonexistent ID produces
      NO L006/broken-ref (refs from upstream are inert); (c) a PROJECT entry
      whose `Satisfies:` points at an upstream ID resolves cleanly (upstream
      still in the maps). Add to `pipeline_test.ts` / `mod_test.ts`.

- [ ] **Step 2-3: Run red → implement**

Add `isUpstreamEntry` to `core/model/mod.ts`. In each per-entry emitting loop,
add `if (isUpstreamEntry(entry)) continue;` — but build the resolution maps
BEFORE/independently of the skip so upstream stays a resolution target. Audit
every loop the research named: `validate()` structural (`mod.ts`),
`checkReferences` (`mod.ts:434`), pipeline Stages 1.5-3 + Stage 4
(`pipeline.ts`). Do NOT skip in the map-building loops.

- [ ] **Step 4-5: Run validator suites, full type-check, commit**

```bash
deno test packages/markspec/core/validator/ packages/markspec/core/lint/ --allow-read --allow-env
deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts
deno fmt packages/markspec/core/
git add -A packages/markspec/core/
git commit -m "feat(core): upstream entries are validation-exempt but stay resolution targets"
```

### Task 4: Feed upstream entries into `check` (runPipeline path)

**Files:**

- Modify: `packages/markspec/cli/commands/check.ts` (push upstream entries into
  `allEntries`; thread declared upstream ids for Task 5)
- Test: `tests/e2e/check_project_test.ts` or a new e2e (a project-wide check
  resolving a cross-file upstream Satisfies) — the real proof is Task 10's e2e

**Interfaces:**

- `check` already reads the lockfile + `cacheRoot` (check.ts:178-181) for drift
  gates. Reuse `lockParse.lockfile` →
  `loadProjectUpstreams(projectRoot,
  lockParse.lockfile)`;
  `allEntries.push(...upstreams.entries)` at line ~89 (after corpus). Prepend
  upstream diagnostics to the merged set.
- Project-wide only (like corpus): file-local `check <file>` does not load
  upstreams.

- [ ] Steps: failing e2e (project entry Satisfies an upstream ID → check exits
      0, no L006) → wire → run
      `deno test tests/e2e/check_project_test.ts
  --allow-read --allow-write --allow-run --allow-env --allow-ffi --allow-net`
      → commit
      `feat(cli): check resolves trace targets against locked upstreams`.

### Task 5: `MSL-T014` — unresolved-after-federation ref

**Files:**

- Modify: `packages/markspec/core/validator/traceability.ts` (emit T014 vs L006
  based on a new "declared upstreams" input)
- Modify: `packages/markspec/core/validator/pipeline.ts` (`PipelineOptions`
  gains `declaredUpstreamIds?: readonly string[]`; thread to
  `validateTraceabilityForEntry`)
- Modify: `packages/markspec/cli/commands/check.ts` (derive declared upstream
  ids from `config.dependencies`+`config.references` via `deriveUpstreamId`,
  pass into `runPipeline`)
- Modify: `packages/markspec/lsp/workspace.ts` (`validateAll` — pass declared
  upstream ids; the LSP has config? — if not, pass `[]`, T014 only fires in
  check; confirm)
- Modify: `docs/spec/language/language.md` §8.3 (T014 reservation → active row)
- Test: `packages/markspec/core/validator/traceability_test.ts`

**Interfaces:**

- `validateTraceabilityForEntry(entry, profile, graph, byDisplayId,
  declaredUpstreamIds?: readonly string[])`.
  At the L006 emit site (traceability.ts:148-163): when `declaredUpstreamIds` is
  non-empty AND the target is unresolved (and not a URI scheme), emit `MSL-T014`
  (warning) with message:
  `` `${entry.displayId}: link '${linkName}' target '${v}' not found in project or upstreams: ${declaredUpstreamIds.join(", ")}` ``
  instead of L006. When `declaredUpstreamIds` is empty, keep L006 unchanged.
- T014 is scope-gated the same way L006 is (project-wide only).

- [ ] **Step 1: Failing tests** — (a) no upstreams declared + unresolved ref →
      L006 (unchanged); (b) upstreams declared + unresolved ref → T014 (warning)
      with the searched-set message, NO L006; (c) upstreams declared + ref
      resolves to an upstream entry → neither. Add to `traceability_test.ts`.

- [ ] **Step 2-4: red → implement → language.md row → run**

Move the language.md §8.3 T014 line from "reserved" prose to an active table row
(`MSL-T014 | warning | trace target unresolved after upstream federation`).
`dprint fmt` the doc.

- [ ] **Step 5: Commit**
      `feat(core): MSL-T014 for refs unresolved after upstream federation`.

### Task 6: Generalize the R014 collision message to name origins

**Files:**

- Modify: `packages/markspec/core/validator/corpus.ts` (R014 message text →
  origin-generic; keep the mechanism)
- Test: `packages/markspec/core/validator/corpus_test.ts` (add `kind:"upstream"`
  collision cases)

**Interfaces:**

- The detection already generalizes (keys on `e.origin`/`sameOriginSource`).
  Only the MESSAGE is corpus-specific ("delivered corpus entries are
  read-only"). Refine to name the origin generically and the remedy:
  project↔upstream:
  `` `display ID '${e.displayId}' is already provided by
  ${formatEntryOrigin(owner.origin!)}; rename this entry — upstream and corpus
  entries are read-only` ``.
  For upstream↔upstream / upstream↔corpus, name both origins. Keep the
  `'${token}'` single-quote contract that `attributeCorpusDiagnostics` keys on
  for suppression.

- [ ] Steps: failing tests (project entry colliding with an upstream ID → R014
      naming `<upstreamId>@<version>`; two upstreams declaring the same ID →
      R014 naming both) → refine message → run
      `deno test
  packages/markspec/core/validator/ --allow-read --allow-env` →
      commit
      `feat(core): generalize MSL-R014 collision message to upstream origins`.

### Task 7: Coverage leaf-semantics for references

**Files:**

- Modify: `packages/markspec/core/reporter/mod.ts` (`computeCoverage` —
  reference-origin entries are leaves)
- Modify: `packages/markspec/cli/commands/report.ts` (pass the dep/ref
  classification down)
- Test: `packages/markspec/core/reporter/mod_test.ts`

**Interfaces:**

- `computeCoverage(result, entries, opts?: { dependencyUpstreamIds?:
  ReadonlySet<string> })`.
  Rule: an entry with `origin.kind === "upstream"` whose `upstreamId` is NOT in
  `dependencyUpstreamIds` (i.e. a reference) is a LEAF — excluded from `orphans`
  (no coverage expectation) and from `unsatisfied`. An upstream entry whose id
  IS a declared dependency participates like a project entry (this path is inert
  in slice 4 — no dependency entries load yet — but the mechanism is present +
  unit-tested via a hand-built dependency-origin entry). Project + corpus
  entries: unchanged.
- `report.ts` builds `dependencyUpstreamIds` from `config.dependencies` via
  `deriveUpstreamId`.

- [ ] Steps: failing tests (a reference-origin entry with no `Satisfies:` is NOT
      reported as an orphan; a reference-origin typed entry is NOT reported as
      unsatisfied; a dependency-origin entry with no coverage IS reported) →
      implement → run → commit
      `feat(core): references are coverage leaves; dependencies participate`.

### Task 8: LSP `seedUpstreamCorpus` + read-only guards

**Files:**

- Modify: `packages/markspec/lsp/server.ts` (add `seedUpstreamCorpus()`; call
  beside `seedDeliveredCorpus()` at onInitialized + reloadProfile; add upstream
  file paths to the read-only guard set; thread declared upstream ids to
  `validateAll`)
- Modify: `packages/markspec/lsp/workspace.ts` if `validateAll` needs the
  declared-upstream-ids param (Task 5)

**Interfaces:**

- `seedUpstreamCorpus()` mirrors `seedDeliveredCorpus` (server.ts:237-268): drop
  previously-seeded upstream files,
  `upstreamRefsFromLockfile(lockfile,
  projectRoot)` (lockfile already loaded
  at server.ts:578-597), `loadUpstreamCorpus`, group entries by `location.file`,
  `index.updateFile` each, and add each file path to `corpusFilePaths` (the
  existing read-only guard set — reuse it; the guards at server.ts
  336/346/819/854/869/1403/1485 then cover upstream files for free). Cold-cache
  soft-fail like the delivered version.
- Call order: seed delivered corpus, then upstream, then the project walk (so
  origin entries win first-entry-wins).
- Re-seed on lockfile change: register a watcher for `markspec.lock` (beside the
  profile-file watcher at server.ts) OR re-seed in `reloadProfile`. Minimal:
  re-seed upstream in `onInitialized` + when `markspec.lock` changes (add it to
  the existing `DidChangeWatchedFiles` glob list).

- [ ] Steps: this is LSP wiring — verify via `deno check` + a focused
      `lsp/workspace` unit test if practical (the real proof is that upstream
      IDs resolve in diagnostics, exercised by Task 10's CLI e2e which shares
      the validator path). Run the full type-check +
      `deno test packages/markspec/lsp/
  --allow-read --allow-env`. Commit
      `feat(lsp): seed locked upstream corpus as read-only graph citizens`.

### Task 9: MCP `runCompile` upstream feeding

**Files:**

- Modify: `packages/markspec/mcp/project.ts` (`runCompile` — read lockfile, load
  upstreams, feed into `compile`; add lockfile staleness to `isStale`)
- Test: `packages/markspec/mcp/project_test.ts` (extend)

**Interfaces:**

- MCP has no lockfile access today. In `runCompile` (mcp/project.ts:381-455):
  `const lockRaw = await env.readFile(join(projectRoot, "markspec.lock"));`
  `const lockfile = lockRaw ? parseLockfile(lockRaw).lockfile : undefined;` then
  load upstreams (via `upstreamRefsFromLockfile` + `loadUpstreamCorpus` with
  `env.readFile`) and pass
  `corpusEntries: [...corpus.entries,
  ...upstream.entries]`. Add
  `markspec.lock` mtime to `isStale` (project.ts:470-497) so a re-lock
  invalidates the MCP cache.

- [ ] Steps: failing test (MCP `entry_show` on an upstream ID returns it via the
      compile cache) → wire → run
      `deno test packages/markspec/mcp/ --allow-read
  --allow-env` → commit
      `feat(mcp): feed locked upstream corpus into the compile cache`.

### Task 10: E2E — cross-repo resolution + root/diamond

**Files:**

- Modify/extend: `tests/e2e/federated_lock_test.ts` OR new
  `tests/e2e/federated_resolve_test.ts`

**Interfaces:** blackbox CLI only. Build on the slice-2 `file://` fixture
(`toFileUrl(join(dir,"api"))`).

- [ ] **Step 1: Scenarios**

1. **Cross-repo Satisfies resolves:** A compiles to `api/` with `[SYS_0001]`; B
   declares `references:` at A and authors `[SWE_0001]` with
   `Satisfies:
   SYS_0001`. `markspec lock` in B, then `markspec check` in B →
   exit 0, NO MSL-L006/T014 for `SYS_0001`.
2. **Broken upstream ID → T014:** B authors `Satisfies: SYS_9999` (nonexistent
   in A). `check` → the ref reports `MSL-T014` (not L006) with `producta` in the
   message.
3. **Colliding ID → R014:** B authors its own `[SYS_0001]` (same ID A delivers).
   `check` → `MSL-R014` naming the upstream origin.
4. **Reference is a coverage leaf:** `markspec report coverage` in B → A's
   `[SYS_0001]` is NOT listed as an orphan/uncovered (it's an upstream leaf);
   B's own entries are.
5. **Upstream entry appears with origin:** `markspec show SYS_0001` in B →
   works, `Origin: producta@…`; `markspec report matrix` shows the origin
   column.
6. **Root/diamond (§4.9):** three projects — B and C both compile to `api/`;
   ROOT declares `references:` at both B and C; C also references B (diamond).
   Compile ROOT → assert: no duplicate/collision diagnostic for B's entries
   (authoritative-source rule — C's snapshot re-exports B's entries with origin,
   which `loadUpstreamCorpus` skips); a C→B cross-repo edge resolves in ROOT's
   matrix; `dependents` at ROOT crosses the repo boundary; ROOT's published
   `/api/` entry count = B-authored + C-authored + ROOT-authored.

- [ ] **Step 2-3: Run + commit**

```bash
deno test tests/e2e/federated_resolve_test.ts --allow-read --allow-write --allow-run --allow-env --allow-ffi --allow-net
deno test tests/e2e/ --allow-read --allow-write --allow-run --allow-env --allow-ffi --allow-net
```

If a scenario reveals a real bug, STOP and report — do not weaken the test.
Commit
`test(cli): cross-repo resolution, T014, R014, coverage, and root/diamond e2e`.

### Task 11: Docs + full gate

**Files:**

- Modify: `docs/guide/cli.md` (the `references:` section: entries now resolve in
  the graph; `report`/`show`/`context`/`dependents` see upstream entries; T014
  vs L006; coverage-leaf note). `docs/spec/language/language.md` §8.3 T014 row
  was done in Task 5 — verify.
- The ADR + full language.md §3.2/compile-output rewrites stay slice 6.

- [ ] Steps: edit guide, `dprint fmt`, then the full gate:

```bash
just fmt
just build
deno fmt --check && dprint check
```

Everything green. Commit
`docs(docs): guide reflects upstream entries resolving in the graph`.

### Task 12: PR

- [ ] **Step 1: Push + PR** (write body to scratch, backtick-safe)

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/federated-slice4
git push -u origin feat/federated-upstream-slice4   # ≥300s: pre-push runs full just check
gh pr create --base main --title "feat(core): federated upstream slice 4 — graph integration + validator" --body-file <scratch>/pr-body.md
```

PR body: slice 4 of the design (§4.6/4.7/4.8/4.9); `Closes #744`; the feed
sites, T014, generalized R014, coverage leaves, validation-exemption; the scope
deferrals (unreleased-pin gate → slice 3, LSP/MCP surfaces → slice 5, git-dep
e2e → slice 3). List new public API (`upstreamRefsFromLockfile`,
`loadProjectUpstreams`, `isUpstreamEntry`).

- [ ] **Step 2: Run `/review` on the PR, post findings as a PR comment.** Watch
      CI (esp. Windows) to green; fix any failure.

## Self-review notes (plan vs design)

- §4.6 three feed sites → Tasks 2 (compiler/compileProject, covers 5 cmds), 4
  (check), 8 (LSP), 9 (MCP). Read-only semantics: Tasks 3 (validation-exempt) +
  8 (LSP file-path guards); the rest key on `Entry.origin` already.
- §4.7 resolution (L006 stops for upstream IDs) → automatic via Tasks 2/4
  (feeding into the resolution maps). T014 → Task 5. Generalized R014 → Task 6.
  Coverage deps-vs-refs → Task 7. Validation-exempt → Task 3.
- §4.8 surface table: `show`/`context`/`dependents`/`report` → Task 2
  (compileProject). `check` → Task 4. LSP/MCP feed → Tasks 8/9. `lint`/`fmt`/
  `score` untouched (already origin-exempt). `[[edge]]` ledger unchanged.
- §4.9 root/diamond → Task 10 scenario 6 (authoritative-source rule already in
  `loadUpstreamCorpus`).
- DEFERRED (documented): §4.4 unreleased-pin advisory + `--strict` gate (slice
  3, needs dependency rows); LSP/MCP user-facing surfaces (slice 5); ADR + full
  spec rewrites (slice 6).
