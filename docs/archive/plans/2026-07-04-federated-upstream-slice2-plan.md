# Federated Upstream Resolution — Slice 2: Org Manifest Adoption + Lock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the org project-manifest contract (`dependencies:`/`references:`
projectRef lists, closed schema, org SSOT), migrate markspec tool config to
`.markspec.yaml`, and implement the lock-mediated references flow: fetch a
published compile-output snapshot (https + `file://`), cache it under
`.markspec/cache/upstreams/<id>/`, pin it in `markspec.lock` rows with
first-lock/restore/update flows, and gate cache drift with a new MSL-L212 case.

**Architecture:** Slice 2 of the federated-upstream design
(`docs/wip/2026-07-04-federated-upstream-resolution-design.md`, §4.1, §4.2,
§4.4, §4.10, §6 row 2). Core stays pure (D10): the fetch/cache logic lives in
`core/lock/` with injected `fetchUrl`/`readFile`/`writeFile`; the Deno bindings
live in `cli/commands/lock.ts` (whose `defaultFetchUrl` already handles both
`https` and `file://`). The cache this slice writes is exactly the input slice
1's `loadUpstreamCorpus` reads — graph feed sites are slice 4, so no CLI/LSP
surface consumes the entries yet.

**Tech Stack:** Deno/TypeScript strict, `@std/assert`, `@std/toml`, colocated
unit tests, blackbox e2e via `tests/e2e/helpers.ts`, Conventional Commits.

## Plan-time decisions (resolving the spec's §10 open questions)

- **TOML row naming:** the new projectRef-reference rows **extend the existing
  `[[upstream.registry]]` kind** (spec §2 already frames this as
  "resolveRegistries: extended from pin-only to pin+snapshot"). The spec's
  sketch name `[[upstream.reference]]` is NOT used — it collides with the
  existing per-entry citation rows of the same name. Dependencies get a new
  `[[upstream.dependency]]` row kind (model/parser/serializer land now; no
  producer until slice 3's git fetcher).
- **Org lock-schema reconciliation (carried criterion 5):** resolved — the org
  repo's `markspec/lock/v1.json` describes `.markspec.lock`, a per-entry
  frozen-metadata sidecar no tool writes; it is a different artifact from
  ADR-022's `markspec.lock`. Slice 2 extends the ADR-022 TOML lockfile. Tracked
  upstream as driftsys/schemas#7.
- **Reference drift is offline:** after first lock, plain `markspec lock`,
  `lock --check`, and `compile --frozen` do **not** re-fetch a pinned reference.
  Presence drift (declared vs locked) is a pure id comparison; content drift is
  the offline cache check (MSL-L212). Only `lock --update` (or a broken cache
  needing restore) touches the network. This is the lock-mediated model (D3)
  applied consistently.
- **`manifest.json` gains `project.version`** (optional, additive — spec §10
  bullet 3 resolved "yes"): `markspec compile` now records the publishing
  project's `version:` so reference rows can pin `refhub@1.4.0` and origin
  badges have a version label.
- **New diagnostic codes:** `MSL-L213` (error — declared project reference could
  not be locked) and `MSL-L214` (error — restore verification mismatch). Like
  MSL-L202/L203/L210/L211 these surface via `lock` and are not added to
  `language.md` §8.10 (which documents only offline-`check` codes; the extended
  L212 case reuses the existing code/section).
- **`labels:` in project.yaml** is dead config today (parsed, consumed nowhere —
  the enforced vocabulary comes from `profile.labels`). It is dropped from
  `ProjectConfig` with no `.markspec.yaml` replacement, per spec §4.10
  ("retired; vocabulary lives in profiles"). The org schema still _accepts_ a
  `labels:` key (tags on the project) — the loader treats it as inert.

## Global Constraints

- **Worktree:** all work happens in
  `/Users/sebastientasson/Workspace/driftsys/markspec-worktrees/federated-slice2`
  (branch `feat/federated-upstream-slice2`, already bootstrapped, 9
  `grammars/*.wasm` verified). The Bash tool's cwd resets between calls — `cd`
  into the worktree at the start of every Bash call and use absolute paths with
  file tools.
- Core must stay Node-compatible: no `Deno.*` in `packages/markspec/core/`
  library code — I/O only via injected callbacks. `Deno.*` is fine in `cli/`,
  `lsp/`, tests.
- Zero warnings from `deno check` / `deno lint` / tests. `deno check` entry
  points:
  `deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts`
- Format before committing: `deno fmt` (TS); `dprint fmt` for edited `.md`
  files.
- Conventional Commits, imperative mood. Allowed scopes: auto, repo, ci, spec,
  core, cli, lsp, mcp, render, book, deck, docs, deps.
- Commit messages containing backticks: write the message to a scratch file and
  use `git commit -F <file>` (harness heredoc limitation).
- Pre-1.0, **no back-compat shims**: retired keys get clear migration errors,
  not silent acceptance.
- Determinism: no wall-clock in core except through the existing
  `now?: () => Date` seam; lockfile output byte-stable given identical inputs.

---

### Task 1: Shared path-containment helper (carried criterion 1)

**Files:**

- Create: `packages/markspec/core/util/paths.ts`
- Create: `packages/markspec/core/util/paths_test.ts`
- Modify: `packages/markspec/core/upstream/mod.ts` (delete local
  `isUnsafeRelPath` + its two regexes at lines 133–147; import instead)
- Modify: `packages/markspec/core/profile/manifest.ts:1395-1410` (replace the
  inlined PROFILE-DELIVERS-003 containment expression)
- Modify: `packages/markspec/core/mod.ts` (barrel: export `isUnsafeRelPath` next
  to the `./util/fence.ts` block at lines 382–383)

**Interfaces:**

- Produces: `export function isUnsafeRelPath(relPath: string): boolean` — true
  when the path is absolute (POSIX `/…` or Windows drive letter) or contains a
  `..` segment (POSIX or Windows separators). Later tasks (Task 5 fetcher)
  import it from `../util/paths.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/markspec/core/util/paths_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { isUnsafeRelPath } from "./paths.ts";

Deno.test("isUnsafeRelPath: plain relative paths are safe", () => {
  for (const p of ["compiled.json", "sub/entries.ndjson", "a.b-c_d.json"]) {
    assertEquals(isUnsafeRelPath(p), false, p);
  }
});

Deno.test("isUnsafeRelPath: absolute paths are unsafe", () => {
  for (const p of ["/etc/passwd", "C:\\win\\x", "c:/win/x"]) {
    assertEquals(isUnsafeRelPath(p), true, p);
  }
});

Deno.test("isUnsafeRelPath: parent segments are unsafe", () => {
  for (const p of ["..", "../x", "a/../b", "a\\..\\b", "x/.."]) {
    assertEquals(isUnsafeRelPath(p), true, p);
  }
});

Deno.test("isUnsafeRelPath: dot-dot inside a name is safe", () => {
  for (const p of ["a..b", "..hidden", "x/..y"]) {
    assertEquals(isUnsafeRelPath(p), false, p);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run (from the worktree): `deno test packages/markspec/core/util/paths_test.ts`
Expected: FAIL — module `./paths.ts` not found.

- [ ] **Step 3: Implement `core/util/paths.ts`**

Move the implementation verbatim from `core/upstream/mod.ts:133-147`, exported:

```ts
/**
 * @module util/paths
 *
 * Path-containment guard shared by every loader that joins an
 * externally-controlled relative path onto a trusted base directory
 * (upstream snapshot cache, profile `delivers:` lists).
 */

/** Absolute path prefix — POSIX `/…` or a Windows drive letter (`C:\…` /
 * `C:/…`). */
const ABSOLUTE_PATH_RE = /^(\/|[A-Za-z]:[\\/])/;

/** A `..` path segment anywhere in the string, POSIX or Windows separators. */
const PARENT_SEGMENT_RE = /(^|[\\/])\.\.([\\/]|$)/;

/**
 * Reject an externally-controlled relative path that could escape its
 * base directory when joined as `${base}/${relPath}` — an absolute path
 * or any `..` segment both qualify.
 */
export function isUnsafeRelPath(relPath: string): boolean {
  return ABSOLUTE_PATH_RE.test(relPath) || PARENT_SEGMENT_RE.test(relPath);
}
```

- [ ] **Step 4: Rewire the two call sites**

In `core/upstream/mod.ts`: delete the local `ABSOLUTE_PATH_RE`,
`PARENT_SEGMENT_RE`, and `isUnsafeRelPath` (lines 133–147); add
`import { isUnsafeRelPath } from "../util/paths.ts";`.

In `core/profile/manifest.ts` (the PROFILE-DELIVERS-003 block at ~1395): replace
the condition

```ts
const normalized = path.replaceAll("\\", "/");
if (
  normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) ||
  normalized.split("/").includes("..")
) {
```

with

```ts
if (isUnsafeRelPath(path)) {
```

(keep the diagnostic push and `continue` unchanged; delete the now-unused
`normalized` binding). Add `import { isUnsafeRelPath } from "../util/paths.ts";`
to the file's imports.

In `core/mod.ts`, next to the `./util/fence.ts` exports add:

```ts
export { isUnsafeRelPath } from "./util/paths.ts";
```

- [ ] **Step 5: Run the affected suites**

```bash
deno test packages/markspec/core/util/ packages/markspec/core/upstream/ packages/markspec/core/profile/ --allow-read --allow-write --allow-env
```

Expected: PASS — including the existing PROFILE-DELIVERS-003 cases in the
profile manifest tests and the path-escape case in `upstream/mod_test.ts` (these
prove behavior parity of the two replaced implementations).

- [ ] **Step 6: Commit**

```bash
deno fmt packages/markspec/core/
git add -A packages/markspec/core/
git commit -m "refactor(core): shared isUnsafeRelPath path-containment helper"
```

### Task 2: Schema-version + type dedupes (carried criteria 2–4)

**Files:**

- Modify: `packages/markspec/core/model/mod.ts` (new `CORE_SCHEMA_VERSION`
  const)
- Modify: `packages/markspec/core/mod.ts` (line 12: re-export instead of define;
  add `ExtractedEntries` type export)
- Modify: `packages/markspec/core/compiler/deserialize.ts` (line 13: import from
  `../model/mod.ts`; use `MANIFEST_SCHEMA_VERSION`)
- Modify: `packages/markspec/core/compiler/manifest.ts` (new
  `MANIFEST_SCHEMA_VERSION` const, used at lines 29/73 and for
  `generator.coreSchema`)
- Modify: `packages/markspec/core/upstream/mod.ts` (line 38: delete local
  `ReadFile`, import the canonical one)

**Interfaces:**

- Produces:
  - `core/model/mod.ts`: `export const CORE_SCHEMA_VERSION = 1;` (the barrel
    keeps re-exporting it, so all existing consumers — `main.ts`,
    `lsp/server.ts`, `mcp/server.ts`, `cli/helpers.ts` — are untouched).
  - `core/compiler/manifest.ts`: `export const MANIFEST_SCHEMA_VERSION = 1;`
  - `core/mod.ts` additionally exports `type ExtractedEntries` from
    `./compiler/deserialize.ts`.
  - `core/upstream/mod.ts` re-exports `ReadFile` imported from
    `../config/mod.ts` (its public signature is unchanged:
    `(path: string) => Promise<string | undefined>`).

- [ ] **Step 1: Move `CORE_SCHEMA_VERSION` to the model leaf**

In `core/model/mod.ts` (near the top, after the module doc comment) add:

```ts
/**
 * Version of the core entry/graph schema. Bumped only when the compiled
 * representation changes incompatibly; compared by the snapshot skew
 * guard (`checkSnapshotSchema`) and printed by `--version`.
 */
export const CORE_SCHEMA_VERSION = 1;
```

In `core/mod.ts` replace line 12 (`export const CORE_SCHEMA_VERSION = 1;`) with
a re-export added to the existing `./model/mod.ts` export block:
`CORE_SCHEMA_VERSION,` (value export list). `VERSION` stays where it is (the
release-bump tooling rewrites it in place).

In `core/compiler/deserialize.ts` change line 13 from
`import { CORE_SCHEMA_VERSION } from "../mod.ts";` to
`import { CORE_SCHEMA_VERSION } from "../model/mod.ts";` — this kills the barrel
import cycle.

- [ ] **Step 2: Dedupe the manifest schema literal**

In `core/compiler/manifest.ts` add above the `ManifestJson` interface:

```ts
/** Version of the compile-output wire schema (`manifest.json` et al.). */
export const MANIFEST_SCHEMA_VERSION = 1;
```

Keep the interface's literal types (`readonly markspecSchemaVersion: 1;`) but
change `buildManifest`'s return to use the constant:
`markspecSchemaVersion: MANIFEST_SCHEMA_VERSION,` and
`coreSchema: MANIFEST_SCHEMA_VERSION,` → **no**: `generator.coreSchema` must use
`CORE_SCHEMA_VERSION` imported from `../model/mod.ts` (it is the core schema,
not the manifest schema; both happen to be 1 today). In
`core/compiler/deserialize.ts` `checkSnapshotSchema`, replace the two `1`
literals in the comparison and message with `MANIFEST_SCHEMA_VERSION` (imported
from `./manifest.ts`).

If the interface literal type `1` vs the `number`-typed constant fights the
type-checker, declare the constant `as const`:
`export const MANIFEST_SCHEMA_VERSION = 1 as const;` (same for the `coreSchema`
field with `CORE_SCHEMA_VERSION` — if that errors because the model const is
plain `number`-widened, declare it `= 1 as const` in the model too).

- [ ] **Step 3: Dedupe `ReadFile` + export `ExtractedEntries`**

In `core/upstream/mod.ts`: delete the local
`export type ReadFile = (path: string) => Promise<string | undefined>;`
(line 38) and replace with:

```ts
import type { ReadFile } from "../config/mod.ts";
export type { ReadFile };
```

(Keeping the re-export preserves the module's public surface.) In `core/mod.ts`,
extend the `./compiler/deserialize.ts` block with
`export type { ExtractedEntries } from "./compiler/deserialize.ts";`.

- [ ] **Step 4: Type-check + run compiler/upstream/model tests**

```bash
deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts
deno test packages/markspec/core/compiler/ packages/markspec/core/upstream/ packages/markspec/core/model/ packages/markspec/core/mod_test.ts --allow-read --allow-write --allow-env
```

Expected: clean check (the `core/mod_test.ts` assertion that
`CORE_SCHEMA_VERSION === 1` via the barrel still passes); all tests PASS.

- [ ] **Step 5: Commit**

```bash
deno fmt packages/markspec/core/
git add -A packages/markspec/core/
git commit -m "refactor(core): move CORE_SCHEMA_VERSION to model leaf, dedupe ReadFile and manifest schema literal"
```

### Task 3: `ProjectRef` model + additive org-manifest parsing

**Files:**

- Modify: `packages/markspec/core/model/mod.ts` (new `ProjectRef`; extend
  `ProjectConfig` + `DEFAULT_PROJECT_CONFIG`)
- Modify: `packages/markspec/core/config/mod.ts` (`parseProjectConfig` gains
  `dependencies:`/`references:` parsing)
- Modify: `packages/markspec/core/mod.ts` (barrel: export `ProjectRef` type)
- Test: `packages/markspec/core/config/mod_test.ts` (extend)

This task is **additive only** — `labels`/`parents`/`parent-fallback`/
`exclude`/`caption-conventions` keep parsing exactly as today. The breaking flip
is Task 8, after the lock rewire stops needing `parents`.

**Interfaces:**

- Produces (Tasks 5/6/8 and slice 3 rely on these exact shapes):

  ```ts
  export interface ProjectRef {
    readonly url: string;
    readonly version?: string; // intent: exact tag | branch | absent = auto
    readonly name?: string; // upstream id: cache dir, lock rows, badges
  }
  // ProjectConfig gains:
  //   readonly dependencies: readonly ProjectRef[];
  //   readonly references: readonly ProjectRef[];
  // DEFAULT_PROJECT_CONFIG gains: dependencies: [], references: []
  ```

- [ ] **Step 1: Write the failing tests**

Append to `packages/markspec/core/config/mod_test.ts`:

```ts
Deno.test("parseProjectConfig: parses dependencies and references projectRefs", () => {
  const config = parseProjectConfig(
    `name: io.acme.brake
version: "1.0.0"
dependencies:
  - url: https://github.com/acme/aeb-product
    name: product
  - url: ../aeb-sensor
    name: sensor
    version: main
references:
  - url: https://driftsys.github.io/refhub
    name: refhub
`,
    "/proj/project.yaml",
  );
  assertEquals(config.dependencies, [
    { url: "https://github.com/acme/aeb-product", name: "product" },
    { url: "../aeb-sensor", name: "sensor", version: "main" },
  ]);
  assertEquals(config.references, [
    { url: "https://driftsys.github.io/refhub", name: "refhub" },
  ]);
});

Deno.test("parseProjectConfig: dependencies/references default to empty", () => {
  const config = parseProjectConfig("name: t\n", "/proj/project.yaml");
  assertEquals(config.dependencies, []);
  assertEquals(config.references, []);
});

Deno.test("parseProjectConfig: projectRef without url is a ConfigError", () => {
  assertThrows(
    () =>
      parseProjectConfig(
        "name: t\nreferences:\n  - name: refhub\n",
        "/proj/project.yaml",
      ),
    ConfigError,
    "url",
  );
});

Deno.test("parseProjectConfig: unknown projectRef key is a ConfigError", () => {
  assertThrows(
    () =>
      parseProjectConfig(
        "name: t\nreferences:\n  - url: https://x.example\n    kind: git\n",
        "/proj/project.yaml",
      ),
    ConfigError,
    "kind",
  );
});

Deno.test("parseProjectConfig: unsafe projectRef name is a ConfigError", () => {
  assertThrows(
    () =>
      parseProjectConfig(
        "name: t\nreferences:\n  - url: https://x.example\n    name: ../evil\n",
        "/proj/project.yaml",
      ),
    ConfigError,
    "name",
  );
});
```

(`assertThrows` and `ConfigError` are already imported/available in this test
file; add whichever import is missing.)

- [ ] **Step 2: Run to verify failure**

Run:
`deno test packages/markspec/core/config/mod_test.ts --allow-read --allow-env`
Expected: FAIL — `dependencies` not a property / ConfigError not thrown.

- [ ] **Step 3: Implement**

In `core/model/mod.ts`, above `ProjectConfig`:

```ts
/**
 * Reference to an external project (org project-manifest contract,
 * `driftsys/schemas` `project/v1.json` `$defs/projectRef`). Used by the
 * `dependencies:` (git repositories) and `references:` (published sites)
 * lists. `version` carries intent: an exact tag is a frozen baseline, a
 * branch name tracks its head, absent means auto (latest semver release
 * tag, else default-branch head). `name` is the upstream id used for the
 * cache directory, lockfile rows, and origin badges; derived from the URL
 * when absent.
 */
export interface ProjectRef {
  readonly url: string;
  readonly version?: string;
  readonly name?: string;
}
```

Extend `ProjectConfig` with `readonly dependencies: readonly ProjectRef[];` and
`readonly references: readonly ProjectRef[];` (keep every existing field for
now), and `DEFAULT_PROJECT_CONFIG` with `dependencies: [], references: []`.

In `core/config/mod.ts` add a helper below `parseProjectConfig`'s existing field
blocks and call it for both keys:

```ts
/** Safe upstream id: single path segment, no separators or traversal. */
const PROJECT_REF_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const PROJECT_REF_KEYS = new Set(["url", "version", "name"]);

function parseProjectRefList(
  value: unknown,
  field: "dependencies" | "references",
  yaml: string,
  errors: ConfigFieldError[],
): ProjectRef[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push({
      field,
      message: "must be a list of projectRef objects ({ url, version?, name? })",
      line: findLineNumber(yaml, field),
    });
    return [];
  }
  const out: ProjectRef[] = [];
  value.forEach((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      errors.push({
        field: `${field}[${i}]`,
        message: "must be a mapping with a required 'url' key",
        line: findLineNumber(yaml, field),
      });
      return;
    }
    const record = item as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!PROJECT_REF_KEYS.has(key)) {
        errors.push({
          field: `${field}[${i}]`,
          message: `unknown projectRef key '${key}' (allowed: url, version, name)`,
          line: findLineNumber(yaml, key),
        });
      }
    }
    const url = record.url;
    if (typeof url !== "string" || url.length === 0) {
      errors.push({
        field: `${field}[${i}].url`,
        message: "projectRef requires a non-empty 'url' string",
        line: findLineNumber(yaml, field),
      });
      return;
    }
    const ref: { url: string; version?: string; name?: string } = { url };
    if (record.version !== undefined) {
      if (typeof record.version !== "string" || record.version.length === 0) {
        errors.push({
          field: `${field}[${i}].version`,
          message: "must be a non-empty string when present",
          line: findLineNumber(yaml, field),
        });
      } else {
        ref.version = record.version;
      }
    }
    if (record.name !== undefined) {
      if (
        typeof record.name !== "string" || !PROJECT_REF_NAME_RE.test(record.name)
      ) {
        errors.push({
          field: `${field}[${i}].name`,
          message:
            "must match [A-Za-z0-9][A-Za-z0-9._-]* (used as a cache directory name)",
          line: findLineNumber(yaml, field),
        });
      } else {
        ref.name = record.name;
      }
    }
    out.push(ref);
  });
  return out;
}
```

Wire into `parseProjectConfig` beside the other optional-field blocks:

```ts
const dependencies = parseProjectRefList(obj["dependencies"], "dependencies", yaml, errors);
const references = parseProjectRefList(obj["references"], "references", yaml, errors);
```

and include both in the returned config object. (Match the function's actual
local variable names for the raw parsed object and error list — follow the
surrounding code.) Export `ProjectRef` from `core/config/mod.ts` if the model
re-export pattern requires it, and add `ProjectRef` to the barrel's
`./model/mod.ts` type-export block in `core/mod.ts`.

- [ ] **Step 4: Run to verify pass**

Run:
`deno test packages/markspec/core/config/ packages/markspec/core/mod_test.ts --allow-read --allow-env`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
deno fmt packages/markspec/core/
git add -A packages/markspec/core/
git commit -m "feat(core): parse org-manifest dependencies/references projectRef lists"
```

### Task 4: Lockfile rows — extended registry + new dependency kind

**Files:**

- Modify: `packages/markspec/core/lock/model.ts` (extend `UpstreamRegistry`; add
  `UpstreamDependency`; widen the `Upstream` union)
- Modify: `packages/markspec/core/lock/parser.ts` (parse the new optional
  registry fields + `[[upstream.dependency]]`)
- Modify: `packages/markspec/core/lock/serializer.ts` (emit them)
- Modify: `packages/markspec/core/lock/mod.ts` + `packages/markspec/core/mod.ts`
  (export `UpstreamDependency`)
- Test: `packages/markspec/core/lock/parser_test.ts`,
  `packages/markspec/core/lock/serializer_test.ts` (extend)

**Interfaces:**

- Produces (Tasks 5/6/9 and slice 3 rely on these exact shapes):

  ```ts
  export interface UpstreamRegistry {
    readonly kind: "registry";
    readonly id: string; // upstream id (projectRef name or derived)
    readonly api: string; // published-site base URL
    readonly resolvedManifestHash: string; // sha256 of manifest.json bytes
    readonly markspecSchema: number;
    readonly version?: string; // upstream project.version, when published
    readonly snapshot?: string; // sha256 of the entries data-file bytes
    readonly lockedAt?: string; // RFC3339 — when this pin was created/moved
  }
  export interface UpstreamDependency {
    readonly kind: "dependency";
    readonly id: string;
    readonly url: string; // git repository URL (remote or local path)
    readonly intent: string; // "auto" | <tag> | <branch>
    readonly resolved: string; // "tag:<t>" | "branch:<b>" | "sha:<s>"
    readonly sha: string; // exact commit
    readonly snapshot: string; // sha256 of the cached entries data file
    readonly lockedAt: string;
  }
  export type Upstream =
    | UpstreamReference
    | UpstreamProfile
    | UpstreamRegistry
    | UpstreamDependency;
  ```

  TOML: registry rows gain optional `version` / `snapshot` / `locked-at` keys;
  new `[[upstream.dependency]]` tables carry
  `id/url/intent/resolved/sha/snapshot/locked-at`, sorted by `id`, emitted
  between the registry and bound-entry sections.

- [ ] **Step 1: Write the failing round-trip tests**

Append to `packages/markspec/core/lock/serializer_test.ts` (reuse the file's
existing minimal-lockfile fixture pattern):

```ts
Deno.test("serialize/parse round-trip: extended registry row", () => {
  const lockfile: Lockfile = {
    ...EMPTY_LOCKFILE,
    upstreams: [{
      kind: "registry",
      id: "refhub",
      api: "https://driftsys.github.io/refhub",
      resolvedManifestHash: "sha256:aaa",
      markspecSchema: 1,
      version: "1.4.0",
      snapshot: "sha256:bbb",
      lockedAt: "2026-07-04T12:00:00Z",
    }],
  };
  const toml = serializeLockfile(lockfile);
  const parsed = parseLockfile(toml);
  assertEquals(parsed.diagnostics, []);
  assertEquals(parsed.lockfile?.upstreams, lockfile.upstreams);
});

Deno.test("serialize/parse round-trip: dependency row", () => {
  const lockfile: Lockfile = {
    ...EMPTY_LOCKFILE,
    upstreams: [{
      kind: "dependency",
      id: "product",
      url: "https://github.com/acme/aeb-product",
      intent: "auto",
      resolved: "tag:v2.1.0",
      sha: "3cdde94aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      snapshot: "sha256:ccc",
      lockedAt: "2026-07-04T12:00:00Z",
    }],
  };
  const toml = serializeLockfile(lockfile);
  const parsed = parseLockfile(toml);
  assertEquals(parsed.diagnostics, []);
  assertEquals(parsed.lockfile?.upstreams, lockfile.upstreams);
});

Deno.test("parse: registry row without new optional fields still parses", () => {
  const minimal = serializeLockfile({
    ...EMPTY_LOCKFILE,
    upstreams: [{
      kind: "registry",
      id: "urn:markspec:registry:https://x",
      api: "https://x",
      resolvedManifestHash: "sha256:aaa",
      markspecSchema: 1,
    }],
  });
  const parsed = parseLockfile(minimal);
  assertEquals(parsed.diagnostics, []);
  const row = parsed.lockfile?.upstreams[0];
  assertEquals(row?.kind, "registry");
  assertEquals((row as UpstreamRegistry).snapshot, undefined);
});
```

If `EMPTY_LOCKFILE` in that test file does not exist under that name, reuse
whatever empty-lockfile fixture the file already defines (lines ~7–14).

- [ ] **Step 2: Run to verify failure**

Run: `deno test packages/markspec/core/lock/ --allow-read --allow-env` Expected:
FAIL — `dependency` not assignable to `Upstream`; unknown fields.

- [ ] **Step 3: Implement model + parser + serializer**

`model.ts`: apply the shapes from **Interfaces** (extend `UpstreamRegistry` with
the three optional fields + doc comments; add `UpstreamDependency`; widen the
union).

`parser.ts`: in the registry-row block (lines ~171–195), read the optional keys
— `version` (string), `snapshot` (string), `locked-at` (string) — and attach
them only when present (conditional spread, matching how optional fields are
handled in the reference-row block). Add a new block after it parsing
`raw.upstream.dependency[]` with required string fields `id`, `url`, `intent`,
`resolved`, `sha`, `snapshot`, `locked-at` — any missing/non-string field → the
existing `MSL-L001` malformed-field diagnostic pattern used by the sibling
blocks.

`serializer.ts`: extend the registry section to emit `version` / `snapshot` /
`locked-at` lines when present (follow the reference-section pattern for
optional keys, keeping the aligned-key style of the section). Add a
`[[upstream.dependency]]` section after registries, sorted by `id`, emitting all
seven keys. Keep the fixed table order documented in the file header comment up
to date.

`core/lock/mod.ts` + `core/mod.ts`: export `UpstreamDependency` alongside
`UpstreamRegistry`.

- [ ] **Step 4: Run to verify pass**

Run: `deno test packages/markspec/core/lock/ --allow-read --allow-env` Expected:
PASS — new round-trips plus all existing serializer determinism tests
(byte-identical repeat, ordering).

- [ ] **Step 5: Commit**

```bash
deno fmt packages/markspec/core/lock/
git add packages/markspec/core/lock/ packages/markspec/core/mod.ts
git commit -m "feat(core): lockfile rows for federated upstreams — extended registry + dependency kind"
```

### Task 5: References fetcher with first-lock/keep/restore/update flows

**Files:**

- Create: `packages/markspec/core/lock/upstream_refs.ts`
- Create: `packages/markspec/core/lock/upstream_refs_test.ts`
- Modify: `packages/markspec/core/lock/mod.ts` + `packages/markspec/core/mod.ts`
  (exports)

**Interfaces:**

- Consumes: `FetchUrl`, `ReadFile` (lock's bytes variant) from `./resolve.ts`;
  `sha256Bytes` from `./hash.ts`; `UpstreamRegistry` from `./model.ts`;
  `ProjectRef` from `../model/mod.ts`; `checkSnapshotSchema` from
  `../compiler/deserialize.ts`; `isUnsafeRelPath` from `../util/paths.ts`;
  `Diagnostic` from `../model/mod.ts`.
- Produces (Task 6 wires these into the CLI; Task 9's gate shares the cache
  layout):

  ```ts
  export interface UpstreamRefsIO {
    readonly fetchUrl: FetchUrl;
    readonly readFile: ReadFile; // bytes; probes the existing cache
    readonly writeFile: (
      path: string,
      bytes: Uint8Array,
    ) => Promise<{ error?: string }>; // creates parent dirs
  }
  export interface ResolveProjectReferencesOptions {
    readonly references: readonly ProjectRef[];
    readonly existing: readonly UpstreamRegistry[]; // rows from the parsed old lockfile
    readonly cacheRoot: string; // <root>/.markspec/cache/upstreams
    readonly update: boolean | string; // --update / --update=<id>
    readonly io: UpstreamRefsIO;
    readonly lockedAt: string; // stamp for rows created/moved this run
  }
  export interface ResolveProjectReferencesResult {
    readonly registries: UpstreamRegistry[];
    readonly diagnostics: Diagnostic[];
  }
  export function deriveUpstreamId(ref: ProjectRef): string | undefined;
  export async function resolveProjectReferences(
    opts: ResolveProjectReferencesOptions,
  ): Promise<ResolveProjectReferencesResult>;
  ```

  Flow per declared reference (design §4.2):
  - id = `ref.name` ?? `deriveUpstreamId` (URL: strip trailing `/`, take the
    last non-empty path segment, strip a `.git` suffix; must match
    `[A-Za-z0-9][A-Za-z0-9._-]*`, else `undefined`). Underivable id or a
    duplicate id across the declared list → `MSL-L213` error, row skipped.
  - **Keep:** a row with this id exists and `update` doesn't select it → verify
    the cache offline (manifest.json present, entries file present,
    `sha256Bytes(entries bytes)` equals `row.snapshot`). Intact → return the row
    unchanged, **no network**. Broken/missing → **restore**: fetch, and the
    fetched snapshot hash must equal `row.snapshot`, else `MSL-L214` error (row
    kept unchanged, cache not overwritten with mismatched content).
  - **First lock:** no row with this id → fetch, write cache, build a new row
    (`lockedAt` from opts).
  - **Update:** `update === true` or `update === id` → fetch, write cache,
    rebuild the row with fresh hashes + `lockedAt` (pin moves).
  - **Fetch** = GET `<url minus trailing slash>/manifest.json` → JSON parse →
    `checkSnapshotSchema` (skew → `MSL-L213` naming the versions) → read the
    manifest's `entries` block; reject an unsafe `file`/`index` rel-path via
    `isUnsafeRelPath` → GET each of: the entries `file`, and (ndjson format
    only) the `index` file → cache-write `manifest.json` + those files under
    `<cacheRoot>/<id>/` → row fields: `api` = declared url (trailing slash
    stripped), `resolvedManifestHash` = sha256 of manifest bytes, `snapshot` =
    sha256 of entries-file bytes, `markspecSchema` =
    `manifest.markspecSchemaVersion`, `version` = `manifest.project.version`
    when it is a string.
  - Any fetch/write `{error}` → `MSL-L213`
    (`upstream reference '<id>' could not be locked: <detail>`); processing
    continues with the other references.

- [ ] **Step 1: Write the failing tests**

Create `packages/markspec/core/lock/upstream_refs_test.ts` with an in-memory IO
harness:

```ts
import { assertEquals } from "@std/assert";
import {
  deriveUpstreamId,
  resolveProjectReferences,
  type UpstreamRefsIO,
} from "./upstream_refs.ts";
import type { UpstreamRegistry } from "./model.ts";
import { sha256Bytes } from "./hash.ts";

const enc = new TextEncoder();

function makeManifest(entriesFile = "compiled.json"): string {
  return JSON.stringify({
    markspecSchemaVersion: 1,
    generator: { release: "0.0.0-test", coreSchema: 1 },
    project: { name: "up", root: "/up", version: "1.4.0" },
    counts: { entries: 1, edges: 0, byType: {} },
    entries: { format: "inline", file: entriesFile },
    edges: { format: "inline", file: entriesFile },
    sqliteMirror: null,
    federation: [],
    reserved: {},
  });
}

const COMPILED = JSON.stringify({ entries: {} });

function makeIO(
  site: Record<string, string>,
  cache: Map<string, Uint8Array> = new Map(),
): { io: UpstreamRefsIO; cache: Map<string, Uint8Array>; fetched: string[] } {
  const fetched: string[] = [];
  return {
    cache,
    fetched,
    io: {
      fetchUrl: (url) => {
        fetched.push(url);
        const body = site[url];
        return Promise.resolve(
          body === undefined ? { error: "HTTP 404" } : enc.encode(body),
        );
      },
      readFile: (path) => {
        const bytes = cache.get(path);
        return Promise.resolve(bytes ?? { error: "not found" });
      },
      writeFile: (path, bytes) => {
        cache.set(path, bytes);
        return Promise.resolve({});
      },
    },
  };
}

const SITE = {
  "https://x.example/refhub/manifest.json": makeManifest(),
  "https://x.example/refhub/compiled.json": COMPILED,
};

Deno.test("deriveUpstreamId: from URL path, strips .git and trailing slash", () => {
  assertEquals(deriveUpstreamId({ url: "https://x.example/refhub/" }), "refhub");
  assertEquals(deriveUpstreamId({ url: "git@github.com:acme/aeb-icd.git" }), "aeb-icd");
  assertEquals(deriveUpstreamId({ url: "../aeb-sensor" }), "aeb-sensor");
  assertEquals(deriveUpstreamId({ url: "https://x.example/", name: "n" }), "n");
});

Deno.test("first lock: fetches, caches, and pins a reference", async () => {
  const { io, cache } = makeIO(SITE);
  const result = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: [],
    cacheRoot: "/proj/.markspec/cache/upstreams",
    update: false,
    io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  assertEquals(result.diagnostics, []);
  assertEquals(result.registries.length, 1);
  const row = result.registries[0];
  assertEquals(row.id, "refhub");
  assertEquals(row.api, "https://x.example/refhub");
  assertEquals(row.version, "1.4.0");
  assertEquals(row.snapshot, await sha256Bytes(enc.encode(COMPILED)));
  assertEquals(row.lockedAt, "2026-07-04T12:00:00Z");
  assertEquals(
    cache.has("/proj/.markspec/cache/upstreams/refhub/manifest.json"),
    true,
  );
  assertEquals(
    cache.has("/proj/.markspec/cache/upstreams/refhub/compiled.json"),
    true,
  );
});

Deno.test("keep: intact cache means no network", async () => {
  const first = makeIO(SITE);
  const locked = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: [],
    cacheRoot: "/c",
    update: false,
    io: first.io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  const second = makeIO(SITE, first.cache);
  const result = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: locked.registries,
    cacheRoot: "/c",
    update: false,
    io: second.io,
    lockedAt: "2026-07-05T00:00:00Z",
  });
  assertEquals(result.diagnostics, []);
  assertEquals(second.fetched, []); // offline
  assertEquals(result.registries, locked.registries); // pin unmoved
});

Deno.test("restore: missing cache refetches and verifies against the pin", async () => {
  const first = makeIO(SITE);
  const locked = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: [],
    cacheRoot: "/c",
    update: false,
    io: first.io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  const restored = makeIO(SITE); // empty cache
  const result = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: locked.registries,
    cacheRoot: "/c",
    update: false,
    io: restored.io,
    lockedAt: "2026-07-05T00:00:00Z",
  });
  assertEquals(result.diagnostics, []);
  assertEquals(result.registries, locked.registries); // pin unmoved
  assertEquals(restored.cache.size, 2); // repopulated
});

Deno.test("restore mismatch: moved site → MSL-L214, pin kept", async () => {
  const first = makeIO(SITE);
  const locked = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: [],
    cacheRoot: "/c",
    update: false,
    io: first.io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  const movedSite = {
    "https://x.example/refhub/manifest.json": makeManifest(),
    "https://x.example/refhub/compiled.json": JSON.stringify({
      entries: { CHANGED: {} },
    }),
  };
  const restored = makeIO(movedSite); // empty cache, changed content
  const result = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: locked.registries,
    cacheRoot: "/c",
    update: false,
    io: restored.io,
    lockedAt: "2026-07-05T00:00:00Z",
  });
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "MSL-L214");
  assertEquals(result.registries, locked.registries);
});

Deno.test("update: refetches and moves the pin", async () => {
  const first = makeIO(SITE);
  const locked = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: [],
    cacheRoot: "/c",
    update: false,
    io: first.io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  const movedSite = {
    "https://x.example/refhub/manifest.json": makeManifest(),
    "https://x.example/refhub/compiled.json": JSON.stringify({
      entries: { NEW: {} },
    }),
  };
  const updated = makeIO(movedSite, first.cache);
  const result = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: locked.registries,
    cacheRoot: "/c",
    update: "refhub",
    io: updated.io,
    lockedAt: "2026-07-06T00:00:00Z",
  });
  assertEquals(result.diagnostics, []);
  assertEquals(
    result.registries[0].snapshot !== locked.registries[0].snapshot,
    true,
  );
  assertEquals(result.registries[0].lockedAt, "2026-07-06T00:00:00Z");
});

Deno.test("fetch failure → MSL-L213, other references still resolve", async () => {
  const { io } = makeIO(SITE);
  const result = await resolveProjectReferences({
    references: [
      { url: "https://gone.example/nowhere", name: "ghost" },
      { url: "https://x.example/refhub" },
    ],
    existing: [],
    cacheRoot: "/c",
    update: false,
    io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "MSL-L213");
  assertEquals(result.registries.length, 1);
  assertEquals(result.registries[0].id, "refhub");
});

Deno.test("duplicate derived ids → MSL-L213 for the duplicate", async () => {
  const { io } = makeIO(SITE);
  const result = await resolveProjectReferences({
    references: [
      { url: "https://x.example/refhub" },
      { url: "https://y.example/refhub" },
    ],
    existing: [],
    cacheRoot: "/c",
    update: false,
    io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  assertEquals(result.registries.length, 1);
  assertEquals(result.diagnostics[0].code, "MSL-L213");
});

Deno.test("schema-skewed published site → MSL-L213 at lock time", async () => {
  const skewed = JSON.parse(makeManifest());
  skewed.generator.coreSchema = 99;
  const { io } = makeIO({
    "https://x.example/refhub/manifest.json": JSON.stringify(skewed),
    "https://x.example/refhub/compiled.json": COMPILED,
  });
  const result = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: [],
    cacheRoot: "/c",
    update: false,
    io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  assertEquals(result.registries, []);
  assertEquals(result.diagnostics[0].code, "MSL-L213");
});
```

- [ ] **Step 2: Run to verify failure**

Run:
`deno test packages/markspec/core/lock/upstream_refs_test.ts --allow-read --allow-env`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `core/lock/upstream_refs.ts`**

```ts
/**
 * @module lock/upstream_refs
 *
 * Lock-mediated resolution of org-manifest `references:` projectRefs
 * (design §4.2): fetch a published compile-output snapshot over https or
 * `file://`, cache it under `.markspec/cache/upstreams/<id>/`, and pin it
 * as an extended `[[upstream.registry]]` lockfile row. Three flows:
 * first lock (new declaration → fetch + pin), keep/restore (pin exists →
 * verify cache offline, refetch only to repopulate, never move the pin),
 * update (`--update` → refetch + move the pin).
 *
 * Pure module: network and file access only via {@linkcode UpstreamRefsIO}.
 */

import type { Diagnostic, ProjectRef } from "../model/mod.ts";
import type { UpstreamRegistry } from "./model.ts";
import type { FetchUrl, ReadFile } from "./resolve.ts";
import { sha256Bytes } from "./hash.ts";
import { checkSnapshotSchema } from "../compiler/deserialize.ts";
import { isUnsafeRelPath } from "../util/paths.ts";

/** IO seam — the CLI supplies Deno-backed implementations. */
export interface UpstreamRefsIO {
  readonly fetchUrl: FetchUrl;
  /** Bytes reader used to probe the existing cache (missing → `{error}`). */
  readonly readFile: ReadFile;
  /** Write `bytes` to `path`, creating parent directories. */
  readonly writeFile: (
    path: string,
    bytes: Uint8Array,
  ) => Promise<{ error?: string }>;
}

/** See module doc. */
export interface ResolveProjectReferencesOptions {
  readonly references: readonly ProjectRef[];
  readonly existing: readonly UpstreamRegistry[];
  readonly cacheRoot: string;
  readonly update: boolean | string;
  readonly io: UpstreamRefsIO;
  readonly lockedAt: string;
}

/** Result of {@linkcode resolveProjectReferences}. */
export interface ResolveProjectReferencesResult {
  readonly registries: UpstreamRegistry[];
  readonly diagnostics: Diagnostic[];
}

/** Safe upstream id — a single path segment (also enforced by the config
 * loader on explicit `name:` values). */
const UPSTREAM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Derive the upstream id for a projectRef: the explicit `name`, else the
 * last non-empty path segment of the URL with any `.git` suffix stripped.
 * Returns `undefined` when no safe id can be derived.
 */
export function deriveUpstreamId(ref: ProjectRef): string | undefined {
  if (ref.name !== undefined) {
    return UPSTREAM_ID_RE.test(ref.name) ? ref.name : undefined;
  }
  const trimmed = ref.url.replace(/\/+$/, "");
  const segment = trimmed.split(/[/:]/).filter((s) => s.length > 0).pop();
  if (segment === undefined) return undefined;
  const id = segment.replace(/\.git$/, "");
  return UPSTREAM_ID_RE.test(id) ? id : undefined;
}

interface FetchedSnapshot {
  readonly manifestBytes: Uint8Array;
  readonly manifest: {
    readonly markspecSchemaVersion: number;
    readonly project?: { readonly version?: unknown };
    readonly entries?: {
      readonly format?: string;
      readonly file?: string;
      readonly index?: string;
    };
  };
  readonly files: ReadonlyMap<string, Uint8Array>; // rel path → bytes
  readonly snapshotHash: string; // sha256 of the entries data file
}

function l213(id: string, detail: string): Diagnostic {
  return {
    code: "MSL-L213",
    severity: "error",
    message: `upstream reference '${id}' could not be locked: ${detail}`,
    location: undefined,
  };
}

async function fetchSnapshot(
  id: string,
  baseUrl: string,
  fetchUrl: FetchUrl,
): Promise<FetchedSnapshot | Diagnostic> {
  const manifestUrl = `${baseUrl}/manifest.json`;
  const manifestBytes = await fetchUrl(manifestUrl);
  if ("error" in manifestBytes) {
    return l213(id, `fetch of ${manifestUrl} failed (${manifestBytes.error})`);
  }
  let manifest: FetchedSnapshot["manifest"];
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch (err) {
    return l213(
      id,
      `manifest.json is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const skew = checkSnapshotSchema(manifest, manifestUrl);
  if (skew) return l213(id, skew.message);
  const entriesFile = manifest.entries?.file;
  if (entriesFile === undefined || isUnsafeRelPath(entriesFile)) {
    return l213(id, "manifest entries block missing or names an unsafe path");
  }
  const files = new Map<string, Uint8Array>();
  const dataBytes = await fetchUrl(`${baseUrl}/${entriesFile}`);
  if ("error" in dataBytes) {
    return l213(id, `fetch of '${entriesFile}' failed (${dataBytes.error})`);
  }
  files.set(entriesFile, dataBytes);
  const indexFile = manifest.entries?.index;
  if (manifest.entries?.format === "ndjson" && indexFile !== undefined) {
    if (isUnsafeRelPath(indexFile)) {
      return l213(id, "manifest entries index names an unsafe path");
    }
    const indexBytes = await fetchUrl(`${baseUrl}/${indexFile}`);
    if ("error" in indexBytes) {
      return l213(id, `fetch of '${indexFile}' failed (${indexBytes.error})`);
    }
    files.set(indexFile, indexBytes);
  }
  return {
    manifestBytes,
    manifest,
    files,
    snapshotHash: await sha256Bytes(dataBytes),
  };
}

async function writeCache(
  id: string,
  dir: string,
  fetched: FetchedSnapshot,
  io: UpstreamRefsIO,
): Promise<Diagnostic | undefined> {
  const writes: Array<[string, Uint8Array]> = [
    [`${dir}/manifest.json`, fetched.manifestBytes],
    ...[...fetched.files].map(([rel, bytes]) =>
      [`${dir}/${rel}`, bytes] as [string, Uint8Array]
    ),
  ];
  for (const [path, bytes] of writes) {
    const result = await io.writeFile(path, bytes);
    if (result.error !== undefined) {
      return l213(id, `cache write of '${path}' failed (${result.error})`);
    }
  }
  return undefined;
}

/** Is the cached snapshot for `row` present and hash-intact? */
async function cacheIntact(
  row: UpstreamRegistry,
  dir: string,
  readFile: ReadFile,
): Promise<boolean> {
  if (row.snapshot === undefined) return false;
  const manifestBytes = await readFile(`${dir}/manifest.json`);
  if ("error" in manifestBytes) return false;
  let entriesFile: string | undefined;
  try {
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      entries?: { file?: string };
    };
    entriesFile = manifest.entries?.file;
  } catch {
    return false;
  }
  if (entriesFile === undefined || isUnsafeRelPath(entriesFile)) return false;
  const dataBytes = await readFile(`${dir}/${entriesFile}`);
  if ("error" in dataBytes) return false;
  return await sha256Bytes(dataBytes) === row.snapshot;
}

function buildRow(
  id: string,
  baseUrl: string,
  fetched: FetchedSnapshot,
  manifestHash: string,
  lockedAt: string,
): UpstreamRegistry {
  const version = fetched.manifest.project?.version;
  return {
    kind: "registry",
    id,
    api: baseUrl,
    resolvedManifestHash: manifestHash,
    markspecSchema: fetched.manifest.markspecSchemaVersion,
    ...(typeof version === "string" ? { version } : {}),
    snapshot: fetched.snapshotHash,
    lockedAt,
  };
}

/** See module doc for the flow table. */
export async function resolveProjectReferences(
  opts: ResolveProjectReferencesOptions,
): Promise<ResolveProjectReferencesResult> {
  const registries: UpstreamRegistry[] = [];
  const diagnostics: Diagnostic[] = [];
  const byId = new Map(opts.existing.map((row) => [row.id, row]));
  const seen = new Set<string>();
  for (const ref of opts.references) {
    const id = deriveUpstreamId(ref);
    if (id === undefined) {
      diagnostics.push(l213(
        ref.name ?? ref.url,
        "no safe upstream id could be derived — set an explicit 'name:'",
      ));
      continue;
    }
    if (seen.has(id)) {
      diagnostics.push(l213(
        id,
        `duplicate upstream id (also derived for an earlier entry) — set distinct 'name:' values`,
      ));
      continue;
    }
    seen.add(id);
    const baseUrl = ref.url.replace(/\/+$/, "");
    const dir = `${opts.cacheRoot}/${id}`;
    const existing = byId.get(id);
    const selectedForUpdate = opts.update === true || opts.update === id;

    if (existing !== undefined && !selectedForUpdate) {
      // Keep — verify offline; restore only when the cache is broken.
      if (await cacheIntact(existing, dir, opts.io.readFile)) {
        registries.push(existing);
        continue;
      }
      const fetched = await fetchSnapshot(id, baseUrl, opts.io.fetchUrl);
      if ("code" in fetched) {
        diagnostics.push(fetched);
        registries.push(existing); // keep the pin; cache stays broken
        continue;
      }
      if (fetched.snapshotHash !== existing.snapshot) {
        diagnostics.push({
          code: "MSL-L214",
          severity: "error",
          message:
            `upstream reference '${id}' restore mismatch: fetched snapshot ` +
            `${fetched.snapshotHash} does not match locked ${existing.snapshot} — ` +
            `the published site moved; run 'markspec lock --update=${id}' to move the pin`,
          location: undefined,
        });
        registries.push(existing);
        continue;
      }
      const writeError = await writeCache(id, dir, fetched, opts.io);
      if (writeError) diagnostics.push(writeError);
      registries.push(existing);
      continue;
    }

    // First lock, or explicitly selected for update.
    const fetched = await fetchSnapshot(id, baseUrl, opts.io.fetchUrl);
    if ("code" in fetched) {
      diagnostics.push(fetched);
      if (existing !== undefined) registries.push(existing);
      continue;
    }
    const writeError = await writeCache(id, dir, fetched, opts.io);
    if (writeError) {
      diagnostics.push(writeError);
      if (existing !== undefined) registries.push(existing);
      continue;
    }
    const manifestHash = await sha256Bytes(fetched.manifestBytes);
    registries.push(buildRow(id, baseUrl, fetched, manifestHash, opts.lockedAt));
  }
  return { registries, diagnostics };
}
```

Note on `location: undefined`: match the `Diagnostic` type's optionality — if
the type requires `location` present-but-optional differently, follow the
pattern used by `resolveReferences` in `./resolve.ts` for its MSL-L101
diagnostics.

Export from `core/lock/mod.ts` (values `deriveUpstreamId`,
`resolveProjectReferences`; types `UpstreamRefsIO`,
`ResolveProjectReferencesOptions`, `ResolveProjectReferencesResult`) and add the
same to the `./lock/mod.ts` block in `core/mod.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `deno test packages/markspec/core/lock/ --allow-read --allow-env` Expected:
PASS (all new tests + existing lock suites).

- [ ] **Step 5: Integration test — the cache feeds `loadUpstreamCorpus`**

Append to `upstream_refs_test.ts`:

```ts
import { loadUpstreamCorpus } from "../upstream/mod.ts";
import { parseFile } from "../parser/mod.ts";
import { serializeEntry } from "../compiler/schema.ts";

Deno.test("lock-written cache is loadable by loadUpstreamCorpus", async () => {
  const { entries } = await parseFile(
    `# Up\n\n- [SYS_0001] Threat assessment\n\n  The system shall compute a threat level within 200 ms.\n\n      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG\n`,
    { file: "/up/a.md" },
  );
  const compiled = JSON.stringify({
    entries: Object.fromEntries(
      entries.map((e) => [e.displayId, serializeEntry(e)]),
    ),
  });
  const { io, cache } = makeIO({
    "https://x.example/refhub/manifest.json": makeManifest(),
    "https://x.example/refhub/compiled.json": compiled,
  });
  const locked = await resolveProjectReferences({
    references: [{ url: "https://x.example/refhub" }],
    existing: [],
    cacheRoot: "/c",
    update: false,
    io,
    lockedAt: "2026-07-04T12:00:00Z",
  });
  assertEquals(locked.diagnostics, []);
  const row = locked.registries[0];
  const corpus = await loadUpstreamCorpus(
    [{ id: row.id, version: row.version ?? "unversioned", dir: "/c/refhub" }],
    (path) => {
      const bytes = cache.get(path);
      return Promise.resolve(
        bytes === undefined ? undefined : new TextDecoder().decode(bytes),
      );
    },
  );
  assertEquals(corpus.diagnostics, []);
  assertEquals(corpus.entries.length, 1);
  assertEquals(corpus.entries[0].origin, {
    kind: "upstream",
    upstreamId: "refhub",
    version: "1.4.0",
  });
});
```

Run:
`deno test packages/markspec/core/lock/upstream_refs_test.ts --allow-read --allow-env`
Expected: PASS. This is the "feed loadUpstreamCorpus" acceptance proof for slice
2 (graph feed sites are slice 4).

- [ ] **Step 6: Commit**

```bash
deno fmt packages/markspec/core/
git add -A packages/markspec/core/
git commit -F <scratch-file with message: "feat(core): references fetcher with first-lock/keep/restore/update flows (MSL-L213/L214)">
```

### Task 6: `manifest.json` `project.version` + `federation` from references

**Files:**

- Modify: `packages/markspec/core/compiler/manifest.ts` (`ManifestJson.project`
  gains `version?`; `buildManifest` fills it; `federation` sourced from
  `config.references`)
- Test: `packages/markspec/core/compiler/manifest_test.ts` (extend)

**Interfaces:**

- Produces: `ManifestJson.project` becomes
  `{ readonly name: string; readonly root: string; readonly version?: string }`;
  `federation` carries `config.references.map((r) => r.url)`. Additive —
  `markspecSchemaVersion` stays 1.

- [ ] **Step 1: Write the failing test**

Append to `manifest_test.ts` (follow its existing `buildManifest` fixture
pattern for the `CompileResult`/config arguments):

```ts
Deno.test("buildManifest: records project.version and references federation", () => {
  const config = {
    ...DEFAULT_PROJECT_CONFIG,
    name: "up",
    version: "1.4.0",
    references: [{ url: "https://driftsys.github.io/refhub" }],
  };
  const manifest = buildManifest(emptyResult(), config, "/proj", null, "0.0.0-test");
  assertEquals(manifest.project.version, "1.4.0");
  assertEquals(manifest.federation, ["https://driftsys.github.io/refhub"]);
});
```

(`emptyResult()` — reuse/adapt whatever minimal `CompileResult` helper the test
file already uses; if it builds results inline, inline the same way.)

- [ ] **Step 2: Run to verify failure, implement, verify pass**

Run:
`deno test packages/markspec/core/compiler/manifest_test.ts --allow-read --allow-env`
→ FAIL.

Implement in `manifest.ts`: add `readonly version?: string;` to the `project`
block of `ManifestJson`; in `buildManifest` set
`project: { name: …, root: …, ...(config.version ? { version: config.version } : {}) }`
and `federation: (config.references ?? []).map((r) => r.url)` (replacing the
`config.parents ?? []` source — `parents` retirement completes in Task 8).

Re-run → PASS. Also run the full compiler suite:
`deno test packages/markspec/core/compiler/ --allow-read --allow-env` → PASS
(fix any manifest snapshot/shape assertions that listed `federation` from
parents).

- [ ] **Step 3: Commit**

```bash
deno fmt packages/markspec/core/compiler/
git add packages/markspec/core/compiler/
git commit -m "feat(core): manifest.json records project.version and references federation"
```

### Task 7: Lock CLI rewire — flows online, checks offline

**Files:**

- Modify: `packages/markspec/cli/commands/lock.ts` (always parse the existing
  lockfile; wire `resolveProjectReferences`; implement `--update`; Deno
  `writeFile` binding; gitignore the cache)
- Modify: `packages/markspec/core/lock/resolve.ts` (drop the `resolveRegistries`
  call from `resolveUpstreams`; remove `registries` from `ResolvedUpstreams`;
  delete `resolveRegistries`)
- Modify: `packages/markspec/core/lock/check.ts` (`checkDrift` registry cases
  become pure id-presence comparisons against declared references)
- Modify: `packages/markspec/cli/commands/compile.ts` (`--frozen` call site:
  pass declared reference ids)
- Modify: `packages/markspec/core/lock/mod.ts` + `core/mod.ts` (export churn)
- Test: `packages/markspec/core/lock/check_test.ts`,
  `packages/markspec/core/lock/resolve_test.ts` (update)

**Interfaces:**

- Consumes: Task 5's `resolveProjectReferences`; Task 3's `config.references`.
- Produces:
  - `ResolvedUpstreams` loses `registries` (references/profiles/bound-entries
    unchanged).
  - `checkDrift(locked: Lockfile, resolved: ResolvedUpstreams, declaredReferenceIds: readonly string[]): Diagnostic[]`
    — registry rows: declared id with no row → `MSL-L202`; row whose id is no
    longer declared → `MSL-L203`; hash comparison for registries is dropped
    (content integrity is the offline cache gate, Task 9). Reference/profile
    cases unchanged.
  - `lock.ts` behavior: existing lockfile parsed up front (missing → empty row
    set); registries =
    `await resolveProjectReferences({ references: config.references, existing: <registry rows from parsed lockfile>, cacheRoot: join(projectRoot, ".markspec", "cache", "upstreams"), update: options.update ?? false, io: <Deno-backed>, lockedAt: resolved.lockedAt })`;
    any error-severity diagnostic from the flows → printed via the existing
    diagnostic printer, exit 1 without writing the lockfile; declared
    dependencies (`config.dependencies`) each log a stderr notice
    `dependency '<id>' declared — git dependency acquisition lands in a future release; row not written`
    (slice 3); `--update` stub logging replaced by the real flag pass-through.

- [ ] **Step 1: Update the drift tests (red)**

In `check_test.ts`: update the registry-case tests — `checkDrift` now takes
`declaredReferenceIds`; the L210-for-registry test becomes "registry hash drift
is NOT reported" (delete or invert it — content drift moved to the offline
gate); L202 = declared id absent from lockfile rows; L203 = locked row id not
declared. In `resolve_test.ts`: delete the `resolveRegistries` tests (function
removed).

Run: `deno test packages/markspec/core/lock/ --allow-read --allow-env` → FAIL
(signature).

- [ ] **Step 2: Implement core changes**

`resolve.ts`: delete `resolveRegistries` and the `registries` field + sequential
call inside `resolveUpstreams`; keep `ResolvedUpstreams`'s other fields and
`lockedAt` exactly as they are. `check.ts`: replace the registry-drift section
with:

```ts
const lockedRegistries = locked.upstreams.filter(
  (u): u is UpstreamRegistry => u.kind === "registry",
);
const lockedIds = new Set(lockedRegistries.map((r) => r.id));
for (const id of declaredReferenceIds) {
  if (!lockedIds.has(id)) {
    diagnostics.push({
      code: "MSL-L202",
      severity: "error",
      message:
        `declared reference '${id}' has no lockfile row — run 'markspec lock'`,
      location: undefined,
    });
  }
}
const declared = new Set(declaredReferenceIds);
for (const row of lockedRegistries) {
  if (!declared.has(row.id)) {
    diagnostics.push({
      code: "MSL-L203",
      severity: "error",
      message:
        `locked reference '${row.id}' is no longer declared in project.yaml — run 'markspec lock'`,
      location: undefined,
    });
  }
}
```

(Follow the file's existing message/location conventions — mirror how the
current L202/L203 branches format messages.) Compute declared ids in callers via
`deriveUpstreamId`:

```ts
const declaredReferenceIds = config.references
  .map((ref) => deriveUpstreamId(ref))
  .filter((id): id is string => id !== undefined);
```

- [ ] **Step 3: Implement the CLI wiring in `lock.ts`**

Key additions (keep the existing flow skeleton):

```ts
// Deno-backed writeFile with mkdir -p (beside defaultFetchUrl/defaultReadFile):
export async function defaultWriteFile(
  path: string,
  bytes: Uint8Array,
): Promise<{ error?: string }> {
  try {
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeFile(path, bytes);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
```

In `runLock`: read + parse `markspec.lock` up front (reuse the `--check`
branch's read; tolerate absence → `existing = []`); after `resolveUpstreams`
returns, call `resolveProjectReferences` (options per **Interfaces**), print its
diagnostics, exit 1 if any has `severity === "error"` (before writing); assemble
`upstreams: [...resolved.references, ...resolved.profiles, ...refResult.registries]`;
for each `config.dependencies` entry log the stderr notice from **Interfaces**.
Ensure the cache dir is gitignored: reuse `ensureCacheGitignored` from
`core/profile/git-cache.ts` if it is exported (export it if not, via
`core/mod.ts`), called once before cache writes. Pass `declaredReferenceIds`
into the `--check` branch's `checkDrift` call. Update `compile.ts`'s
`checkDrift` call site the same way.

- [ ] **Step 4: Full lock suites + type-check**

```bash
deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts
deno test packages/markspec/core/lock/ tests/e2e/lock_test.ts tests/e2e/lock_drift_test.ts --allow-read --allow-write --allow-run --allow-env --allow-ffi
```

Expected: PASS (existing e2e lock tests exercise projects with no references —
the new code path is a no-op there).

- [ ] **Step 5: Commit**

```bash
deno fmt packages/markspec/
git add -A packages/markspec/
git commit -F <scratch-file: "feat(cli): lock-mediated reference pinning — cache writes, --update, offline drift checks">
```

### Task 8: Tool-config migration + org closed-schema flip

**Files:**

- Modify: `packages/markspec/core/config/markspec.ts` (`MarkspecYaml` gains
  `exclude` + `captionConventions`; `ALLOWED_MARKSPEC_YAML_KEYS` grows; new
  `loadToolConfig`)
- Modify: `packages/markspec/core/config/mod.ts` (closed-schema flip:
  migrated-key errors, unknown-key rejection, inert org keys, `version`
  required, `name` pattern; drop `labels`/`parents`/`parentFallback`/
  `exclude`/`captionConventions` parsing)
- Modify: `packages/markspec/core/model/mod.ts` (`ProjectConfig` final shape;
  `DEFAULT_PROJECT_CONFIG`)
- Modify: `schemas/markspec/v1.json` (add the two keys); Delete:
  `schemas/project/v1.json`; Delete:
  `packages/markspec/core/config/project_schema_test.ts`
- Modify: `packages/markspec/cli/init/scaffolders/project_yaml.ts` (`SCHEMA_URL`
  → `https://driftsys.github.io/schemas/project/v1.json`; scaffold must emit
  `version:`)
- Modify consumers: `packages/markspec/cli/helpers.ts` (resolveScope),
  `cli/commands/{lock,compile,fmt,doctor,check}.ts`,
  `packages/markspec/lsp/server.ts`, `packages/markspec/mcp/project.ts` (grep
  `.exclude` / `captionConventions` and switch to `loadToolConfig`)
- Modify: root `project.yaml` + `.markspec.yaml` (migrate this repo's own
  config), e2e fixtures (`tests/e2e/compile_frozen_exclude_test.ts`,
  `delivered_test.ts`, `fmt_exclude_ref_index_test.ts`, `config_test.ts`,
  `validate_test.ts` caption fixtures — move keys into `.markspec.yaml` fixture
  files; add `version:` where fixtures rely on full parsing)
- Test: `packages/markspec/core/config/mod_test.ts`, `markspec_test.ts`,
  `schema_test.ts` (update)

**Interfaces:**

- Produces:

  ```ts
  // core/config/markspec.ts
  export interface MarkspecYaml {
    readonly profiles: readonly ProfileSpecifier[];
    readonly defaultProfile?: boolean;
    readonly exclude: readonly string[]; // default []
    readonly captionConventions: CaptionConventions; // default {}
  }
  export interface ToolConfig {
    readonly exclude: readonly string[];
    readonly captionConventions: CaptionConventions;
  }
  export const DEFAULT_TOOL_CONFIG: ToolConfig;
  export async function loadToolConfig(
    projectRoot: string,
    readFile: ReadFile,
  ): Promise<{ config: ToolConfig; diagnostics: readonly Diagnostic[] }>;
  ```

  `loadToolConfig` = `readMarkspecYaml` + `parseMarkspecYaml`; absent file or
  null config → defaults. Parse errors surface as the existing
  `MARKSPEC-YAML-00x` diagnostics.

  ```ts
  // core/model/mod.ts — final shape
  export interface ProjectConfig {
    readonly name: string;
    readonly version: string;
    readonly dependencies: readonly ProjectRef[];
    readonly references: readonly ProjectRef[];
  }
  ```

  Loader behavior: `version` missing → ConfigError
  `"version is required (org project schema)"`; `name` violating
  `^[a-z][a-z0-9.-]*$` → ConfigError; keys `exclude` / `caption-conventions` →
  ConfigError `"'<key>' has moved to .markspec.yaml (markspec tool config)"`;
  keys `parents` / `parent-fallback` → ConfigError
  `"'<key>' is retired — declare a 'references:' projectRef instead"`; org keys
  `category description license keywords labels authors homepage bugs
  repository upstream process classification metadata $schema`
  → accepted, ignored; anything else → ConfigError
  `"unknown key '<key>' (project.yaml follows the closed org schema)"`.

- [ ] **Step 1: Write the failing tests**

`mod_test.ts`: rewrite the full-config test to org shape; add cases for each
loader behavior above (version-required, name-pattern, migrated-key message,
retired-key message, unknown-key rejection, inert org keys accepted).
`markspec_test.ts`: add `exclude:` + `caption-conventions:` parsing cases (valid
lists/mappings, invalid → `MARKSPEC-YAML-003`), and a `loadToolConfig` defaults
case. Run both → FAIL.

- [ ] **Step 2: Implement the `.markspec.yaml` side**

In `markspec.ts`: extend `ALLOWED_MARKSPEC_YAML_KEYS` with `"exclude"`,
`"caption-conventions"`; port the two parse blocks from `config/mod.ts`
(exclude: lines 276–299; caption-conventions: lines 216–274) into
`parseMarkspecYaml`, converting their `ConfigFieldError` pushes into
`MARKSPEC-YAML-003` diagnostics (message text preserved); defaults `[]`/`{}`.
Add `ToolConfig`, `DEFAULT_TOOL_CONFIG`, `loadToolConfig`. Update
`schemas/markspec/v1.json` (copy the two property schemas from the old project
schema before deleting it) and `schema_test.ts`'s lockstep list.

- [ ] **Step 3: Implement the project.yaml flip**

In `config/mod.ts`, `parseProjectConfig`: delete the `labels`, `parents`,
`parent-fallback`, `exclude`, `caption-conventions` blocks; add the key
classifier:

```ts
const ORG_INERT_KEYS = new Set([
  "$schema",
  "category",
  "description",
  "license",
  "keywords",
  "labels",
  "authors",
  "homepage",
  "bugs",
  "repository",
  "upstream",
  "process",
  "classification",
  "metadata",
]);
const PARSED_KEYS = new Set(["name", "version", "dependencies", "references"]);
const MIGRATED_KEY_HINTS: Readonly<Record<string, string>> = {
  "exclude": "has moved to .markspec.yaml (markspec tool config)",
  "caption-conventions": "has moved to .markspec.yaml (markspec tool config)",
  "parents": "is retired — declare a 'references:' projectRef instead",
  "parent-fallback": "is retired — declare a 'references:' projectRef instead",
};

for (const key of Object.keys(obj)) {
  if (PARSED_KEYS.has(key) || ORG_INERT_KEYS.has(key)) continue;
  const hint = MIGRATED_KEY_HINTS[key];
  errors.push({
    field: key,
    message: hint !== undefined
      ? `'${key}' ${hint}`
      : `unknown key '${key}' (project.yaml follows the closed org schema ` +
        `https://driftsys.github.io/schemas/project/v1.json)`,
    line: findLineNumber(yaml, key),
  });
}
```

Add the `version`-required and `name`-pattern (`/^[a-z][a-z0-9.-]*$/`) checks to
the existing name/version blocks (keep the numeric-version coercion warning,
which now precedes the requirement check). Shrink
`ProjectConfig`/`DEFAULT_PROJECT_CONFIG` in `model/mod.ts`; delete `REFHUB_URL`
if now unused (grep first). Delete `schemas/project/v1.json` +
`project_schema_test.ts`; point the init scaffolder's `SCHEMA_URL` at the org
URL and make `buildProjectYaml` emit `version: "0.1.0"`.

- [ ] **Step 4: Rewire the consumers**

For each `config.exclude` site (`cli/helpers.ts:432`, `lock.ts:75`,
`compile.ts:96`, `fmt.ts:71`, `doctor.ts:86`, `lsp/server.ts:664`) and the
`captionConventions` site (`check.ts:51-132`): obtain the values via
`loadToolConfig(projectRoot, readFile)` (each caller already has both), e.g. in
the LSP add a module-scoped `_toolConfig` loaded in `onInitialize` beside
`_config`. Grep `mcp/` for `.exclude` and treat the same. `check.ts`: a
`MARKSPEC-YAML-002/003` error from `loadToolConfig` is fatal (exit 1), matching
the old ConfigError posture so a malformed `caption-conventions:` cannot
silently disable MSL-C072.

- [ ] **Step 5: Migrate this repo + fixtures, run the full gate**

Move the root `project.yaml`'s `exclude:` (and any `caption-conventions:`) into
root `.markspec.yaml`; swap its `$schema` to the org URL; ensure `version:`
present. Update the e2e fixtures listed in **Files** (each writes
`.markspec.yaml` beside `project.yaml` for the moved keys; `config_test.ts`'s
malformed caption case asserts the new `.markspec.yaml` failure message). Then:

```bash
just fmt && just check
```

Expected: everything green. Chase any remaining `config.` field accesses the
type-checker flags.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -F <scratch-file: "feat(cli)!: adopt org project.yaml contract; tool config moves to .markspec.yaml">
```

### Task 9: MSL-L212 offline cache-drift case

**Files:**

- Create: `packages/markspec/core/lock/cache_check.ts` (+ `cache_check_test.ts`)
- Modify: `packages/markspec/core/gates/mod.ts` (`lockfileDriftGate` gains the
  cache check)
- Modify: `packages/markspec/cli/commands/check.ts` (pass cache root + bytes
  reader)
- Modify: `core/lock/mod.ts` + `core/mod.ts` (exports)

**Interfaces:**

- Produces:

  ```ts
  // core/lock/cache_check.ts
  export async function verifyUpstreamCache(
    upstreams: readonly Upstream[],
    cacheRoot: string,
    readFile: ReadFile, // lock bytes variant
  ): Promise<Diagnostic[]>;
  ```

  For every registry/dependency row carrying a `snapshot` hash: missing
  `<cacheRoot>/<id>/manifest.json`, unreadable/unsafe entries file, or
  entries-file hash ≠ `snapshot` → one `MSL-L212` error:
  `upstream '<id>' cache snapshot is missing or does not match markspec.lock — run 'markspec lock'`.
  Reuses the same probe logic as Task 5's `cacheIntact` (extract a shared
  internal helper in `upstream_refs.ts` and import it, rather than duplicating).
- `lockfileDriftGate(lockParse, lockPath, entries, cache?: { cacheRoot: string; readFile: ReadFile })`
  — when `cache` is supplied and the lockfile parsed, append
  `verifyUpstreamCache` results to the existing edge-drift diagnostics.

- [ ] **Step 1: Failing unit tests**

`cache_check_test.ts`: three cases over an in-memory bytes reader — intact cache
→ `[]`; missing manifest → one L212 naming the id; hash mismatch → one L212.
Rows without `snapshot` (legacy) are skipped. Reuse Task 5's fixture helpers
style. Run → FAIL.

- [ ] **Step 2: Implement + wire**

Implement `verifyUpstreamCache`; extend `lockfileDriftGate` (keep it
backward-compatible — the `cache` param optional so existing gate tests pass);
in `check.ts`'s project-wide branch pass
`{ cacheRoot: join(projectRoot, ".markspec", "cache", "upstreams"), readFile: <Deno bytes reader> }`
(reuse/adapt `defaultReadFile` exported from `lock.ts`). Run:

```bash
deno test packages/markspec/core/lock/ packages/markspec/core/gates/ --allow-read --allow-write --allow-env
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
deno fmt packages/markspec/
git add -A packages/markspec/
git commit -m "feat(core): MSL-L212 gains the upstream cache-drift case"
```

### Task 10: E2E — the federated file:// scenario

**Files:**

- Create: `tests/e2e/federated_lock_test.ts`

**Interfaces:**

- Consumes: the CLI only (blackbox rule — no source imports). Follow
  `tests/e2e/lock_drift_test.ts`'s pattern for running several commands against
  one persistent temp dir; project A is compiled with
  `markspec compile --output <dirA>/api <files>` and project B declares
  `references: [{ url: "file://<dirA>/api", name: "producta" }]`.

- [ ] **Step 1: Write the scenario tests**

One test file, sequential scenarios (each builds A + B fresh; keep helpers local
to the file):

1. **lock pins + caches:** B's `markspec lock` exits 0; `markspec.lock` contains
   `[[upstream.registry]]`, `id       = "producta"`, a `snapshot` key;
   `<B>/.markspec/cache/upstreams/producta/manifest.json` and `compiled.json`
   exist.
2. **check cache drift:** delete `<B>/.markspec/cache/upstreams/producta/`;
   `markspec check` exits 1 with `MSL-L212` and `producta` in stderr.
3. **restore:** `markspec lock` again exits 0 and repopulates the cache;
   `markspec.lock` is byte-identical to the first lock (pin unmoved);
   `markspec check` passes again.
4. **restore mismatch:** regenerate A's api with an extra entry (recompile),
   delete B's cache, `markspec lock` exits 1 with `MSL-L214`.
5. **update moves the pin:** after the same site change,
   `markspec lock --update=producta` exits 0; the lockfile's `snapshot` value
   changed; `check` passes.
6. **migration errors:** a project.yaml containing `exclude:` (or `parents:`) →
   any command loading config exits 1 with `moved to .markspec.yaml` / `retired`
   in stderr; missing `version:` → `version is required`.

Use `assertEquals` on exit codes and `assertStringIncludes` on stderr/lockfile
text — no snapshots (wording asserted loosely).

- [ ] **Step 2: Run**

```bash
deno test tests/e2e/federated_lock_test.ts --allow-read --allow-write --allow-run --allow-env --allow-ffi
```

Expected: PASS. Then the full e2e suite:
`deno test tests/e2e/ --allow-read --allow-write --allow-run --allow-env --allow-ffi`
→ PASS.

- [ ] **Step 3: Commit**

```bash
deno fmt tests/
git add tests/e2e/
git commit -m "test(cli): federated reference lock/restore/update/drift e2e scenarios"
```

### Task 11: Docs touch-up + full gate

**Files:**

- Modify: `docs/guide/cli.md` (project.yaml section: org contract — required
  `version`, `dependencies:`/`references:` projectRef table, tool config pointer
  to `.markspec.yaml`; delete the "no JSON schema" sentence — link the org
  schema URL; `.markspec.yaml` section gains `exclude` + `caption-conventions`;
  `lock` section: the three flows, `--update`, MSL-L213/L214, cache location)
- Modify: `docs/guide/profiles.md`, `docs/guide/recipes/*.md` — update any
  `exclude:` / `caption-conventions:` snippets shown inside project.yaml
  examples (grep)

Full ADR + language.md §3.2/§6.5 rewrites stay slice 6 (per the design); this
task only keeps the guide from lying about shipped behavior.

- [ ] **Step 1: Edit the docs, run dprint**

```bash
dprint fmt
dprint check
```

- [ ] **Step 2: Full gate**

```bash
just fmt
just build
deno fmt --check && dprint check
```

Expected: all green (`just build` = lint + test + type-check + compile).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs(docs): guide reflects org project.yaml contract and lock flows"
```

### Task 12: PR

- [ ] **Step 1: Push and open the PR**

Write the PR body to the scratchpad (backtick-safe), then:

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/federated-slice2
git push -u origin feat/federated-upstream-slice2   # ≥300s timeout: pre-push runs full just check
gh pr create --title "feat(cli): federated upstream slice 2 — org manifest adoption + lock-mediated references" --body-file <scratchpad>/pr-body.md
```

PR body must state: slice 2 of the federated-upstream design
(`docs/wip/2026-07-04-federated-upstream-resolution-design.md` §4.1/4.2/4.4/
4.10); the plan-time decisions (registry-row reuse, offline drift, manifest
`project.version`, L213/L214); the carried slice-1 criteria closed (1–4 in code,
5 via driftsys/schemas#7); the breaking config migration (version required;
exclude/caption-conventions → `.markspec.yaml`; labels/parents/parent-fallback
retired) — pre-1.0, no compat per project policy; dependencies
declared-but-not-acquired until slice 3. No `Closes #N` (no story issue filed).
Note the external prerequisite landed: driftsys/schemas#6.

- [ ] **Step 2: Run `/review` on the PR and post findings as a PR comment**
      (repo rule).

## Self-review notes (plan vs spec)

- §4.1 declaration surface → Task 3 (projectRef parsing) + Task 8 (closed
  schema, retirements). RefHub-as-explicit-reference falls out of
  `parent-fallback` retirement + `references:`.
- §4.2 flows table → Task 5 (first/restore/update + keep), rows → Task 4, cache
  path `.markspec/cache/upstreams/<id>/` → Tasks 5/7, L212 case → Task 9.
- §4.4 release assurance: `--strict` pin-level gate needs dependency rows —
  slice 3/4 territory (no dependency rows exist to gate yet). References are
  released-by-publication (§4.4) — nothing to gate.
- §4.10 table → Task 8 (all six rows: schema retired, exclude +
  caption-conventions migrated, labels retired, version required,
  markspec/v1.json grows keys) — `schemas/lock`/`schemas/profile` kept.
- §7 testing: loader unit tests (T3/T8), fetcher + hydration integration (T5),
  e2e file:// scenario incl. drift/restore/update (T10). Git-fixture dependency
  e2e is slice 3 (needs the git fetcher).
- Carried criteria: 1→T1, 2→T2, 3→T2, 4→T2, 5→resolved (schemas#7 + registry-row
  decision).
- Non-goals honored: no git fetcher (slice 3), no feed sites/T014/R014
  generalization (slice 4), no LSP/MCP surfaces (slice 5), no transitive
  federation, no vendored snapshots.
