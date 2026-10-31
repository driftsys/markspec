# MCP Multi-Project Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `markspec mcp` process discovers every MarkSpec project at or
below its start folder and answers every read tool and resource across all of
them, labeled by project.

**Architecture:** Project discovery (today private to `lsp/project_registry.ts`
on the #844 branch) moves to `core/discovery/projects.ts`. The MCP server
replaces its single `Project` with an `McpWorkspace` holding one lazily compiled
`Project` per discovered root. Tool and resource handlers fan out through one
helper that leaves single-project output byte-identical.

**Tech Stack:** Deno, TypeScript (strict), `@modelcontextprotocol/sdk`,
`@std/path`, `@std/assert`.

**Spec:** `docs/wip/2026-10-31-mcp-multi-project-design.md`

**Working tree:**
`/Users/sebastientasson/Workspace/driftsys/markspec-mcp-multi-root`, branch
`feat/mcp-multi-project-roots`, stacked on `fix/lsp-per-document-project-root`
(PR #844). All paths below are relative to `packages/markspec/` unless they
start with `docs/`, `tests/`, `editors/` or `.`.

## Global Constraints

- Core stays Node-compatible: no `Deno.*` in `core/`; I/O through injected
  `readFile` / `readDir`.
- Outside `core/`, import core only through `core/mod.ts`.
- When discovery finds exactly one project, every tool and resource output is
  byte-identical to today. Existing MCP tests pass without edits.
- No new diagnostic codes. No combined cross-project graph.
- No downward scan from the filesystem root or from `$HOME`.
- Nested projects are always separate projects (same as the LSP).
- Multi-project section heading: `## Project: <label>`. Labels are paths
  relative to `startRoot`, POSIX separators; the primary project is `.`.
- Compile stays lazy per project; startup does discovery only.
- Conventional Commits with git-std scopes (`core`, `mcp`, `lsp`, `docs`,
  `repo`). Commit trailer:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run `just fmt` before each commit; `deno fmt --check && dprint check` must
  pass.

## Review Focus

1. One project fails to load (malformed `project.yaml`, broken profile): the
   other projects still answer; the broken one shows its error in its own
   section. → Task 3 test
   `createWorkspace: one broken project does not
   hide the others`.
2. Nested project inside a project: a file in the nested folder is indexed only
   by the nested project; the parent's `entry_list` does not show it. → Task 2
   test `openProject: ownsFile skips nested subtree`.
3. Symlinked start folder (macOS `/tmp` → `/private/tmp`): labels and `project`
   argument still match. → Task 3 test
   `createWorkspace: labels
   are computed after realPath`.
4. A project added after startup appears after `markspec_refresh`; a deleted one
   disappears without an error. → Task 5 test
   `markspec_refresh: rediscovers projects`.
5. `project: "."` with a single project returns the same text as no argument; an
   unknown label returns an error that lists valid labels. → Task 4 tests.

---

### Task 1: Core project discovery

**Files:**

- Create: `core/discovery/projects.ts`
- Create: `core/discovery/projects_test.ts`
- Modify: `core/mod.ts` (export the new module's public items)
- Modify: `lsp/project_registry.ts:49-97` (remove the moved helpers, import them
  from `core/mod.ts`), `lsp/project_registry.ts:557-579` (`findNestedRoots`
  delegates to core)
- Modify: `lsp/server.ts:54` (import `isWithin` from `core/mod.ts`)

**Interfaces:**

- Produces (all exported from `core/mod.ts`):
  - `isWithin(root: string, path: string): boolean` — moved unchanged.
  - `nearestRoot(dir: string, roots: Iterable<string>): string | undefined` —
    moved unchanged.
  - `resolveConfigRoot(startDir: string, readFile: (path: string) => Promise<string | undefined>): Promise<string | undefined>`
    — moved unchanged.
  - `findNestedProjectRoots(root: string, io: DiscoveryIO, exclude?: readonly string[]): Promise<string[]>`
    — the body of today's `findNestedRoots`: roots strictly below `root`,
    sorted.
  - `interface ProjectDiscoveryOptions { readonly homeDir?: string }`
  - `discoverProjectRoots(startDir: string, io: DiscoveryIO, options?: ProjectDiscoveryOptions): Promise<{ primaryRoot: string; roots: string[] }>`
    — algorithm in spec §1: `primaryRoot` = `resolveConfigRoot(startDir)` or
    `startDir`; `roots` = primary (when it has a config) + nested roots, sorted.
    No downward scan when `primaryRoot` has no config and equals `/` (or a drive
    root) or `options.homeDir`. The nested scan honours the primary project's
    `.markspec.yaml` `exclude:` (read with `loadToolConfig`).

- [ ] **Step 1: Write failing tests** in `core/discovery/projects_test.ts`,
      using `makeTree` / `realIO` from `core/discovery/mod_test.ts` (export them
      from a shared `core/discovery/test_helpers.ts` if they are not
      importable). Tests and assertions:
  - `discoverProjectRoots: parent without config, two children` → `roots` =
    `[<tmp>/a, <tmp>/b]`, `primaryRoot` = `<tmp>`.
  - `discoverProjectRoots: project with nested project` → `roots` =
    `[<tmp>, <tmp>/sub]`.
  - `discoverProjectRoots: .markspec.yaml below project.yaml is not a root` →
    `roots` = `[<tmp>]`.
  - `discoverProjectRoots: hidden, gitignored and excluded folders skipped`
    (configs in `.hidden/`, in a `.gitignore`d `ignored/`, in an `exclude:`d
    `fixtures/`) → `roots` = `[<tmp>]`.
  - `discoverProjectRoots: start in a subfolder walks up first` → start
    `<tmp>/a/docs`, `primaryRoot` = `<tmp>/a`.
  - `discoverProjectRoots: no config anywhere` → `roots` = `[]`.
  - `discoverProjectRoots: no downward scan from homeDir` → `homeDir` = `<tmp>`,
    child `<tmp>/a` has config → `roots` = `[]`.
- [ ] **Step 2: Run**
      `deno test --allow-read --allow-write packages/markspec/core/discovery/projects_test.ts`
      — expected FAIL (module not found).
- [ ] **Step 3: Implement** `core/discovery/projects.ts` and the exports; point
      `lsp/project_registry.ts` and `lsp/server.ts` at core.
- [ ] **Step 4: Run** the new tests plus
      `deno test --allow-read --allow-write --allow-env packages/markspec/lsp/ tests/e2e/lsp_project_resolution_test.ts`
      — expected PASS, no LSP test edited.
- [ ] **Step 5: Commit**
      `refactor(core): move project discovery from the LSP registry to core`

### Task 2: A `Project` opened at a known root, owning only its files

**Files:**

- Modify: `mcp/project.ts:153-182` (`ProjectEnv`), `:330-...` (`createProject`),
  `:381`, `:564` (walk call sites)
- Test: `mcp/project_test.ts` (add tests only)

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces:
  - `interface OpenProjectOptions { readonly ownsFile?: (path: string) => boolean }`
  - `openProject(root: string, env: ProjectEnv, options?: OpenProjectOptions): Promise<Project>`
    — everything `createProject` does after root resolution (config, profile,
    cache, staleness). `markspecDetected` is `true`, `softGateMessage` is
    `undefined`. Both `env.walk(root)` call sites drop paths for which
    `ownsFile` returns `false`.
  - `createProject(env)` keeps its signature and behaviour; it resolves the root
    as today and delegates to `openProject`.

- [ ] **Step 1: Write failing tests** in `mcp/project_test.ts` with `makeEnv`:
  - `openProject: compiles entries under the given root` → an entry in
    `/proj/a/req.md` is in `getCompiled()` for `openProject("/proj/a", env)`.
  - `openProject: ownsFile skips nested subtree` → files `/proj/req.md` and
    `/proj/sub/req.md` (each with a distinct entry); `ownsFile` rejects
    `/proj/sub/...` → `getCompiled()` holds only the `/proj/req.md` entry, and
    creating `/proj/sub/new.md` does not make the project stale.
- [ ] **Step 2: Run**
      `deno test --allow-read packages/markspec/mcp/project_test.ts` — expected
      FAIL (`openProject` not exported).
- [ ] **Step 3: Implement** `openProject` by extracting from `createProject`.
- [ ] **Step 4: Run**
      `deno test --allow-read --allow-write --allow-env packages/markspec/mcp/`
      — expected PASS, existing tests unedited.
- [ ] **Step 5: Commit**
      `refactor(mcp): open a project at a known root with a file-ownership filter`

### Task 3: `McpWorkspace`

**Files:**

- Create: `mcp/workspace.ts`, `mcp/workspace_test.ts`
- Modify: `mcp/project.ts` (`ProjectEnv` gains `readDir` and `homeDir()`;
  `defaultEnv` implements them with `Deno.readDir` and `Deno.env.get("HOME")`;
  `buildSoftGateMessage` gains the line
  `Also searched below each directory for nested MarkSpec projects.`)
- Modify: `mcp/project_test.ts` `makeEnv` (add `readDir` over the in-memory
  store and `homeDir: () => undefined`)

**Interfaces:**

- Consumes: `discoverProjectRoots`, `nearestRoot` (Task 1); `openProject` (Task
  2).
- Produces:
  ```ts
  interface WorkspaceProject { readonly label: string; readonly project: Project }
  interface McpWorkspace {
    readonly startRoot: string;                 // realPath'd primaryRoot
    projects(): readonly WorkspaceProject[];    // sorted by label
    readonly softGateMessage?: string;          // set when projects() is empty
    select(label?: string): readonly WorkspaceProject[] | string; // string = error text
    ownerOf(absPath: string): WorkspaceProject | undefined;
    rediscover(): Promise<void>;                // re-runs discovery, reuses Project objects for unchanged roots
    subscribeInvalidation(handler: () => void): () => void; // fires when any project recompiles or rediscover changes the set
  }
  createWorkspace(env: ProjectEnv): Promise<McpWorkspace>
  ```
  Candidate order (ADR-028) is unchanged: the first candidate whose
  `discoverProjectRoots` returns a non-empty `roots` wins. Each root is opened
  with
  `openProject(root, env, { ownsFile: p => nearestRoot(dirname(p), roots) === root })`.
  `select(undefined)` → all; `select(".")` with one project → that one; unknown
  → `Unknown project "<x>". Known projects: <labels comma-separated>.`

- [ ] **Step 1: Write failing tests** in `mcp/workspace_test.ts`:
  - `createWorkspace: parent folder with two projects` → labels `["a", "b"]`.
  - `createWorkspace: single project is labeled "."`.
  - `createWorkspace: no project → softGateMessage set, projects() empty`.
  - `createWorkspace: one broken project does not hide the others` → `a` has
    malformed `project.yaml`; `b` still compiles its entries.
  - `createWorkspace: labels are computed after realPath` → env whose `realPath`
    maps `/link` to `/real`, cwd `/link` → labels relative to `/real`.
  - `select: unknown label lists known labels`.
  - `rediscover: adds a new project and drops a removed one`.
- [ ] **Step 2: Run**
      `deno test --allow-read packages/markspec/mcp/workspace_test.ts` —
      expected FAIL.
- [ ] **Step 3: Implement** `mcp/workspace.ts` and the env additions.
- [ ] **Step 4: Run**
      `deno test --allow-read --allow-write --allow-env packages/markspec/mcp/`
      — expected PASS.
- [ ] **Step 5: Commit**
      `feat(mcp): discover every project below the start folder`

### Task 4: Tool fan-out and `project_list`

**Files:**

- Create: `mcp/tools/fan_out.ts`, `mcp/tools/fan_out_test.ts`,
  `mcp/tools/project_list.ts`, `mcp/tools/project_list_test.ts`
- Modify: `mcp/tools/mod.ts` (`ToolHandler`, `HANDLERS`, `dispatchTool`,
  `registerTools`, `TOOL_DESCRIPTORS`), the input schema of each of `search.ts`,
  `show.ts`, `list.ts`, `context.ts`, `neighborhood.ts`, `validate.ts`,
  `profile_describe.ts`, `refresh.ts`
- Modify: `mcp/server.ts:~112` (build the workspace instead of the project)

**Interfaces:**

- Consumes: `McpWorkspace`, `WorkspaceProject` (Task 3).
- Produces:
  - `perProject(workspace: McpWorkspace, projectArg: string | undefined, render: (wp: WorkspaceProject) => Promise<string | undefined>, emptyText: string): Promise<string>`
    — one selected project → `render` result (or `emptyText` if `undefined`),
    unchanged. Several → non-empty results joined as
    `## Project: <label>\n\n<text>`, separated by a blank line; all empty →
    `emptyText`. Unknown label → the `select` error text.
  - `ToolHandler = (args: any, workspace: McpWorkspace) => Promise<string>`;
    `dispatchTool(name, args, workspace)`; `registerTools(server, workspace)`.
    Soft gate checks `workspace.softGateMessage`.
  - Every existing input schema gains
    `project: { type: "string", description: "Limit to one project; a label from project_list." }`
    (not required).
  - `PROJECT_LIST_DESCRIPTOR` (`name: "project_list"`, read-only annotations)
    and `renderProjectList(workspace): Promise<string>` — one line per project:
    `- <label> — <absolute root> — profile: <name or "none"> — <N entries | not compiled yet>`.
  - `validate` `files`: resolve against `workspace.startRoot`, group by
    `workspace.ownerOf`, validate only the owning projects.
  - `markspec_refresh` calls `workspace.rediscover()` first, then refreshes
    every project.

- [ ] **Step 1: Write failing tests**:
  - `fan_out_test.ts`:
    `perProject: single project returns render output unchanged`;
    `perProject: two projects get headings`;
    `perProject: empty results are dropped`;
    `perProject: project "." equals no argument`;
    `perProject: unknown label returns error`.
  - `project_list_test.ts`: `renders one line per project` (exact lines).
  - In `mcp/tools/show_test.ts` (new test, existing ones untouched):
    `entry_show across two projects returns both under headings` — both projects
    declare `STK_0001` with titles `Alpha` / `Beta`.
  - In `mcp/tools/validate_test.ts`:
    `validate files arg routes to the owning project`.
- [ ] **Step 2: Run**
      `deno test --allow-read --allow-write --allow-env packages/markspec/mcp/`
      — expected FAIL on the new tests only.
- [ ] **Step 3: Implement** the helper, the handler signature change, the
      schemas, `project_list`, and the server wiring.
- [ ] **Step 4: Run** the same command — expected PASS, existing tests unedited
      except where they call `dispatchTool` with a `Project` (wrap it with a
      one-project workspace test helper; do not change assertions).
- [ ] **Step 5: Commit**
      `feat(mcp): answer every tool across all discovered projects`

### Task 5: Resources, refresh and end-to-end

**Files:**

- Modify: `mcp/resources/mod.ts` (`registerResources(server, workspace)`,
  `listResourceDescriptors`, `readResource`), `mcp/server.ts` (invalidation
  subscription via `workspace.subscribeInvalidation`)
- Test: `mcp/server_test.ts` (add), `tests/e2e/mcp_test.ts` (add)

**Interfaces:**

- Consumes: `McpWorkspace` (Task 3), `perProject` (Task 4).
- Produces: resource behaviour per spec §4 and the "Other resources" call:
  `markspec://entry/{id}` lists each distinct ID once and reads every holder
  through `perProject`; `markspec://entries`, `markspec://profile`,
  `markspec://profile/{kind}/{name}` read through `perProject`;
  `markspec://delivered/...` reads from the first project, in label order, whose
  profile chain includes the profile id.

- [ ] **Step 1: Write failing tests**:
  - `server_test.ts`:
    `resources: entry URI listed once and read from both projects`;
    `resources: delivered doc read from first project in label order`.
  - `tests/e2e/mcp_test.ts`: add
    `setupMulti(): Promise<{ proc: McpProcess; cwd: string }>` writing
    `a/project.yaml`, `a/.markspec.yaml`, `a/req.md` (`STK_0001` "Alpha") and
    the same under `b/` ("Beta"), cwd = parent. Tests:
    `mcp multi: project_list shows a and b`;
    `mcp multi: entry_show STK_0001 returns both projects`;
    `mcp multi: project "a" narrows to Alpha`;
    `mcp multi: validate reports per project with no MSL-R014`;
    `mcp multi: starting inside a/ gives single-project output` (no
    `## Project:` in the text); `markspec_refresh: rediscovers projects` (create
    `c/` then refresh → `project_list` shows three).
- [ ] **Step 2: Run**
      `deno test --allow-read --allow-write --allow-run --allow-env tests/e2e/mcp_test.ts packages/markspec/mcp/server_test.ts`
      — expected FAIL on the new tests.
- [ ] **Step 3: Implement** the resource changes and the invalidation wiring.
- [ ] **Step 4: Run** the same command — expected PASS.
- [ ] **Step 5: Commit**
      `feat(mcp): serve resources across all discovered projects`

### Task 6: Repository exclude and records

**Files:**

- Modify: `.markspec.yaml` (add `- "tests/fixtures/"` to `exclude:`)
- Modify: `docs/architecture/adr-028-mcp-project-discovery.md` §7 (rewrite in
  place: downward discovery now runs; all projects are answered; bounds: not
  from `/` or `$HOME`; nested projects are separate) and Consequences (one line)
- Modify: `docs/guide/ai-agents.md` `## MCP server` (new subsection "Several
  projects in one folder": discovery, labels, `project` argument,
  `project_list`, `exclude:` to keep a nested folder in its parent)
- Modify: `docs/guide/editor-vscode.md:137` and `editors/vscode/README.md:76`
  (one line each: the server covers every project under the first workspace
  folder)
- Modify: `AGENTS.md` (repository layout: `core/discovery/projects.ts`; ADR-028
  bullet mentions downward discovery)

- [ ] **Step 1: Record the baseline** before editing `.markspec.yaml`:
      `deno run -A packages/markspec/main.ts check --format json > "$SCRATCH/check-before.json"`
      where `$SCRATCH` is any directory outside the repository.
- [ ] **Step 2: Edit** `.markspec.yaml`, then run the same command into
      `check-after.json` and diff the diagnostic lists. Expected: no diagnostic
      removed except ones located under `tests/fixtures/`; if any are removed,
      list them in the PR body.
- [ ] **Step 3: Edit** the docs listed above.
- [ ] **Step 4: Run**
      `just fmt && deno fmt --check && dprint check && just build` — expected
      all green.
- [ ] **Step 5: Commit**
      `docs(mcp): document multi-project discovery and update ADR-028`

## After the last task

- Whole-branch review (`/review` passes 1 and 2), per the per-task review gate
  rule.
- Garden `docs/wip/` with `sdd-gardening` before opening the PR.
- PR body: first line `Closes #645.`; note the stack on #844.
