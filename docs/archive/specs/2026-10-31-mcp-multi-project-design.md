# MCP server: cover every MarkSpec project under the opened folder

Status: design, awaiting approval. Branch `feat/mcp-multi-project-roots`,
stacked on PR #844 (`fix/lsp-per-document-project-root`).

Related: #645 (downward discovery, deferred by ADR-028 §7), #644, #840, #694,
#845.

## Intent

A user opens VS Code (or Claude Code) on a folder that contains several MarkSpec
projects: a monorepo with sub-projects, or a parent folder of separate clones.
Today the MCP server resolves one project root and answers only for that
project. If the opened folder is a parent with no config of its own, the server
reports "No MarkSpec project found", and the agent stops using it.

The goal: one MCP server process sees every MarkSpec project under the folder it
was started in, and the agent can search, show, and validate across all of them
without knowing in advance which project holds an entry.

PR #844 already solves the same problem for the LSP. This design reuses its
discovery so the LSP and the MCP server agree on what the projects are.

## Goals

1. The MCP server discovers every project root at or below its starting folder,
   using the same rules as the LSP registry in #844.
2. Each discovered project is compiled and validated on its own, against its own
   profile, exactly as `markspec check` run inside that project would.
3. Every read tool answers across all projects by default, and labels each
   result with the project it came from.
4. Every read tool accepts an optional `project` argument that limits it to one
   project.
5. A new `project_list` tool lists the discovered projects.
6. When exactly one project is discovered, output is byte-identical to today.
   Existing MCP tests stay green without edits.

## Non-goals

- One combined traceability graph across projects. Projects stay separate.
  Cross-project references continue to go through `dependencies:` and
  `markspec.lock` (ADR-031). No change to the flat-ID-space rule or MSL-R014.
- Detecting duplicate checkouts (same ULID in two projects) or grouping
  "copies". Two projects with `STK_0001` simply yield two labeled results.
- A special check for git worktrees. Worktrees inside the repo live in hidden or
  gitignored folders (`.claude/worktrees/`, `.worktrees/`), which discovery
  already skips. A worktree in a visible folder counts as another project.
- VS Code multi-root workspaces (several workspace folders). The extension keeps
  starting the server in the first workspace folder; projects under that folder
  are covered. Other folders are a follow-up.
- New diagnostics.
- Changing the CLI (`check`, `lint`, `fmt`) scope rules. That is #845.

## Anti-goals

- Slower first answer for single-project users. Discovery must not compile a
  project until a tool needs it.
- An error, or a changed answer, for a single-project workspace.
- Indexing a file twice. A file belongs only to its nearest project.

## Design

### 1. Project discovery moves to core

Move the pure discovery parts of `lsp/project_registry.ts` to a new core module
`core/discovery/projects.ts`, exported through `core/mod.ts`:

- `isWithin(root, path)`, `nearestRoot(roots, path)`,
  `resolveConfigRoot(startDir, readFile)` — moved unchanged.
- New `discoverProjectRoots(startDir, io, options): Promise<string[]>`:
  1. Primary root = `resolveConfigRoot(startDir)` (walk up: nearest
     `project.yaml`, else nearest `.markspec.yaml`). If none is found, the
     primary root is `startDir` itself, and it counts as a project only if the
     scan below finds nothing (see step 3).
  2. Scan below the primary root with `discoverFiles` (gitignore-aware, hidden
     folders skipped, `exclude:` of the enclosing project honoured) for
     `project.yaml` and `.markspec.yaml`. Resolve each hit with
     `resolveConfigRoot` from its own folder, as `findNestedRoots` does today.
     Keep roots strictly below the primary root.
  3. Return the primary root (when it has a config) plus the nested roots,
     sorted by path. A primary root without a config is dropped when nested
     roots exist; with no config anywhere, return an empty list.
- `ownerRoot(roots, filePath)` = the nearest root that contains the file.

`ProjectRegistry.findNestedRoots` calls `discoverProjectRoots` (or its scan
step) instead of its own loop. LSP behaviour does not change; the #844 tests are
the guard.

Core stays Node-compatible: `io` carries `readDir` and `readFile`, no `Deno.*`.

### 2. MCP server holds a set of projects

New `mcp/workspace.ts`:

```ts
interface McpWorkspace {
  readonly startRoot: string;          // where discovery started
  readonly projects: readonly Project[]; // sorted by root
  readonly softGateMessage?: string;   // set when projects is empty
  select(projectArg?: string): Project[] | string; // string = error text
  label(project: Project): string;     // root relative to startRoot, "." for itself
}
async function createWorkspace(env: ProjectEnv): Promise<McpWorkspace>;
```

- The start folder is the first candidate from ADR-028's order (`--root`,
  `MARKSPEC_PROJECT_ROOT`, `CLAUDE_PROJECT_DIR`, cwd) that detects a project by
  walking up, or, when none does, that contains at least one project below it.
  Same candidate list as today; a candidate now also matches downward.
- Each project is a `Project` from `mcp/project.ts`, built per root. Compile
  stays lazy and per project (`getCompiled()` on first use), so startup cost is
  the discovery scan only.
- A project's file walk must skip the subtrees of nested projects. `Project`
  gets an optional `ownsFile(path)` filter used by its `walk` and staleness
  check, built from `ownerRoot`.
- Discovery runs once at startup (ADR-028 §2). `markspec_refresh` re-runs
  discovery, so a project added after startup appears after a refresh.

### 3. Tools

Handler signature changes from `(args, project)` to `(args, workspace)`. A
shared helper does the fan-out:

```ts
async function perProject(
  workspace, args, render: (project) => Promise<string | undefined>,
): Promise<string>
```

- Resolves `args.project` through `workspace.select`. Unknown value → returns an
  error listing the valid labels.
- With one selected project: returns `render(project)` unchanged (keeps goal 6).
- With several: renders each, drops empty results, and joins them under a
  `## Project: <label>` heading each. All empty → the tool's normal "no results"
  text.

Per tool:

| Tool                                                | Across projects                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `entry_search`                                      | hits from every project, grouped by project                                               |
| `entry_show`, `entry_context`, `entry_neighborhood` | every project that holds the ID; "not found" only when none does                          |
| `entry_list`                                        | grouped by project                                                                        |
| `validate`                                          | one section per project; paths relative to that project's root, as today                  |
| `profile_describe`                                  | one section per project whose profile declares the element                                |
| `markspec_refresh`                                  | re-runs discovery, then refreshes every project; reports per-project counts               |
| `project_list` (new)                                | one line per project: label, absolute root, profile name, entry count if already compiled |

Every tool's input schema gains `project?: string` — the label shown by
`project_list`. Tool descriptions mention it in one sentence.

### 4. Resources

- `markspec://entry/{id}` URIs stay unchanged. Listing returns each distinct ID
  once. Reading returns the entry from every project that holds the ID, with a
  `## Project: <label>` heading each when there is more than one.
- `markspec://profile`: one section per project when several, unchanged when
  one.

### 5. Soft gate

When discovery finds no project, the soft-gate message is unchanged, plus one
line saying the folder was also searched downward.

### 6. VS Code extension

No code change. It already starts the server in the first workspace folder, and
the server now scans below it. Add one line to the extension README.

### 7. Records

- ADR-028: edit §7 in place (downward search now happens; the ambiguity it
  feared is resolved by answering for all projects). Add a Consequences line.
  Close #645 from the PR.
- `docs/guide/` MCP page: document multi-project behaviour, the `project`
  argument and `project_list`.
- `AGENTS.md`: list `core/discovery/projects.ts` in the layout.

## Testing

- Core unit tests for `discoverProjectRoots`: parent without config + two
  children; project with nested project; `.markspec.yaml` under `project.yaml`
  (not a separate root); hidden and gitignored folders skipped; no config
  anywhere → empty.
- LSP: the #844 registry tests pass unchanged.
- MCP unit tests (`project_test.ts`-style in-memory env) for `createWorkspace`,
  `select`, `label`, and nested-file ownership.
- MCP e2e (`tests/e2e/mcp_test.ts` pattern): a temp parent folder with two
  projects that both declare `STK_0001` with different titles. Assert:
  `project_list` shows two; `entry_show STK_0001` returns both under project
  headings; `project: "a"` narrows to one; `validate` reports per project with
  no MSL-R014; starting inside one project gives today's output.
- All existing MCP tests pass without edits.

## Alternatives considered

- **One combined graph across projects.** Rejected: shared IDs across
  independent projects would raise MSL-R014, which contradicts ADR-031's model
  where cross-project links go through the lock.
- **One MCP server per project, launched by the extension.** Rejected: agents
  would have to know which server to ask, and clients list each server
  separately.
- **Detect duplicate checkouts by ULID.** Dropped as complexity without a
  current need (user decision, 2026-10-31).
- **Keep discovery in `lsp/` and copy it into `mcp/`.** Rejected: two discovery
  implementations would drift, which is the problem #845 already describes for
  the CLI.

## Nested projects (author's recommendation, pending approval)

A project inside another project is always a separate project, in the MCP server
as in the LSP (#844). Goal 6 applies when discovery finds exactly one project.
To keep a nested folder as part of its parent, list it in the parent's
`exclude:`. This repo does so for `tests/fixtures/` (which holds `desk-project/`
with its own config), so the MarkSpec repo itself still answers as one project;
the PR checks that `markspec check` results for the repo do not change because
of that exclusion.

## Calls made after the builder check

These are the author's calls (not user decisions), recorded so the plan does not
have to guess:

- **File set per project.** Each project keeps today's MCP file walk (`walkFs`
  with its fixed skip list), plus a skip of nested-project subtrees. Switching
  MCP to the gitignore-aware `discoverFiles` walk is out of scope. Goal 2 means
  "against its own profile and its own files", not "the same file list as
  `markspec check`".
- **Bound on the downward scan.** No downward scan from the filesystem root or
  from `$HOME`. Upward resolution from those candidates still works as today. No
  depth limit otherwise; the scan is gitignore-aware and skips hidden folders.
- **Labels and `startRoot`.** `startRoot` is the primary root from
  `discoverProjectRoots` step 1 (the walked-up root, or the start folder when
  nothing is above it). Labels are relative to it; the primary project is `.`.
  Starting the server in a subfolder of a project therefore gives the same
  labels as starting it at the project root.
- **Other resources.** `markspec://entries` lists entries grouped by project.
  `markspec://profile/{kind}/{name}` behaves like `markspec://profile` (one
  section per project that declares it). `markspec://delivered/...` reads from
  the first project, in label order, whose active profile chain includes that
  profile id; URI shape unchanged.
- **`validate` `files` argument.** Relative paths resolve against `startRoot`.
  Each file is routed to the project that owns it (`ownerRoot`); only those
  projects are validated.

## Left to the builder

- Exact heading text and ordering inside multi-project output, as long as the
  label from `project_list` appears.
- Whether `ownsFile` lives on `Project` or in `ProjectEnv.walk`.
- Internal structure of the fan-out helper.
