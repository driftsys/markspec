# MCP project discovery: layered root resolution (override → roots → cwd)

**Date:** 2026-07-01 **Status:** approved (brainstorm), awaiting implementation
plan **Drives:** `markspec mcp` project-root discovery **Fixes:** #641

## Problem

The MarkSpec MCP server fails to locate a valid project in some session contexts
even though the project is correctly configured and `markspec check` passes from
the terminal.

Root cause (confirmed in code): the server discovers its project root by walking
**up from its own launch working directory** and nothing else.

- `mcp/server.ts` calls `createProject(defaultEnv())` _before_
  `server.connect()`.
- `defaultEnv()` sets `cwd: () => Deno.cwd()` (`mcp/project.ts`).
- `createProject` walks up from that `cwd` via `discoverProjectRoot` /
  `detectMarkspecProject` and never consults any other signal.
- The install adapters write `{ command, args: ["mcp"] }` — **no `cwd`, no
  `env`** — so the server inherits whatever directory the client happened to
  launch it from (home, a temp dir, or an editor root above the project).

When that launch directory is not inside the project tree, discovery fails and
every tool/resource returns the soft-gate message, while the CLI — already
positioned at the project root — works. The current soft-gate message also does
not say _which_ directory was searched, so the failure is hard to diagnose.

## Guiding principle

**The server should ask, not guess.** MCP defines a first-class primitive —
_roots_ — for the client to tell the server which workspace directories it
operates in. The launch `cwd` is the least reliable signal and must be the last
resort, not the only one. An explicit operator override always wins, for CI and
for clients that do not implement roots.

## Decisions

| #  | Decision               | Choice                                                                                                                                                               |
| -- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 | Discovery signals      | Three layers: explicit override, MCP roots, launch `cwd`                                                                                                             |
| D2 | Precedence             | override **>** roots **>** cwd (explicit user intent beats auto-detection beats launch dir)                                                                          |
| D3 | Idiomatic primary path | MCP `roots/list` via `server.listRoots()` after `initialized`; zero per-project config for clients that declare the capability                                       |
| D4 | Override surface       | Repeatable `markspec mcp --root <path>` **and** `MARKSPEC_PROJECT_ROOT` env (`:`-separated); both are just high-priority _candidate start dirs_                      |
| D5 | Re-discovery           | Handle `notifications/roots/list_changed` → re-resolve → reuse existing invalidation → resource-update notifications                                                 |
| D6 | `Project` restructure  | Keep one stable `Project` reference; make root-derived fields getters over mutable state + add `resolveRoots(candidates, source)`; **no tool/resource file changes** |
| D7 | Soft-gate message      | Report the directories actually searched and name `--root` / roots as remedies; keep the literal `"No MarkSpec project found"` prefix (ADR-023 trigger language)     |

## Design

### 1. Unified resolution model — ranked candidate start dirs

All three signals reduce to the same operation: **a directory to start discovery
from.** Resolution walks up from a candidate looking for `project.yaml` (→
`projectRoot`) or `.markspec.yaml` (→ `markspecDetected`), exactly as today via
`discoverProjectRoot` / `detectMarkspecProject`.

Each candidate carries a **source priority**:

| Source                             | Priority | When known          |
| ---------------------------------- | -------- | ------------------- |
| `--root` / `MARKSPEC_PROJECT_ROOT` | 3        | startup (sync)      |
| MCP roots (`listRoots()`)          | 2        | after `initialized` |
| launch `cwd`                       | 1        | startup (sync)      |

**Resolution algorithm** (`resolveRoots(candidates, sourcePriority)`):

1. If `sourcePriority < currentPriority`, return unchanged (a lower-priority
   signal never downgrades a higher one).
2. Walk each candidate in order; adopt the **first** whose walk-up finds a
   project (`project.yaml` → sets `projectRoot`; `.markspec.yaml` →
   `markspecDetected`). Record the winning candidate +
   `currentPriority =
   sourcePriority`, load config + profile, and kick a
   fresh background compile.
3. If **no** candidate resolves: for an explicit override (priority 3) still
   record the searched dirs so the soft gate can name them; for roots/cwd, keep
   the existing (possibly-provisional) resolution rather than wiping it.

The candidate lists are: overrides = `[--root…, …MARKSPEC_PROJECT_ROOT split]`;
roots = the `file://`→path mapping from `listRoots()` (first match wins across
multiple workspace folders); cwd = `[Deno.cwd()]`.

### 2. `Project` restructure — stable reference, re-pointable internals

Tools and resources read `project.projectRoot`, `.markspecDetected`, `.config`,
`.profileChain`, `.profile` and call `.getCompiled()` / `.forceRefresh()` off a
single reference passed once into `registerTools(server, project)` /
`registerResources(server, project)`.

Keep that reference identity. Change only `mcp/project.ts`:

- The five root-derived fields become **getters** over module-internal `let`
  state instead of set-once locals.
- Add `resolveRoots(candidates: string[], source: RootSource): Promise<void>`
  implementing §1. It re-points the internal state and re-runs the existing
  compile/invalidation machinery (`cached`, `tracked`, `handlers` already close
  over mutable state — no change there).
- Add `softGateMessage` (getter, §5) computed from the searched candidates.

`createProject(env)` at startup:

- Reads `env.rootOverrides()`. If non-empty → `resolveRoots(overrides, 3)` now
  (immediate background compile).
- Else → `resolveRoots([env.cwd()], 1)` now, so clients **without** roots keep
  working exactly as today.

Rejected alternative: a mutable `{ current: Project }` holder threaded through
every consumer. It forces a mechanical edit across ~8 tool/resource files for no
behavioural gain. The getter approach confines the change to one file.

### 3. `ProjectEnv` seam additions

`ProjectEnv` stays filesystem-only; the roots _query_ is a server capability and
lives in `server.ts`, not here.

- Add `rootOverrides(): string[]`. `defaultEnv(flagRoots)` returns the CLI
  `--root` values followed by `MARKSPEC_PROJECT_ROOT` split on `:` (empty
  segments dropped).
- `cwd`, `readFile`, `stat`, `walk` unchanged.

This keeps the whole module testable with an in-memory shim, including override
precedence, by supplying `rootOverrides` + a fake FS.

### 4. `startServer` reorder + roots plumbing (`mcp/server.ts`)

1. `const project = await createProject(defaultEnv(flagRoots))` — resolves via
   override or cwd-provisional (§2).
2. `registerResources` / `registerTools` / `subscribeInvalidation` as today.
3. `await server.connect(transport)`.
4. `server.oninitialized = async () => { … }`:
   - If `project` was resolved by an override (priority 3) → skip roots.
   - Else if `server.getClientCapabilities()?.roots` →
     `const { roots } = await
     server.listRoots()`, map each `file://` URI
     to a path, call `project.resolveRoots(paths, 2)`. Guard the whole block in
     try/catch — `listRoots` failure must not crash the server; fall through to
     the cwd provisional.
5. Register a `notifications/roots/list_changed` handler → re-query
   `listRoots()` → `project.resolveRoots(paths, 2)`. The existing
   `subscribeInvalidation` chain then fires `resources/list_changed` +
   `resources/updated`.

`oninitialized` fires before any `tools/call`, so there is no window where a
tool runs against an unresolved project beyond the cwd provisional that already
covers today's behaviour.

### 5. Soft-gate message

`SOFT_GATE_MESSAGE` becomes the literal **prefix** constant (unchanged text,
preserved for ADR-023 and any tests keying on it). `project.softGateMessage`
composes:

```
No MarkSpec project found in this workspace.
Searched from: <dir1>, <dir2> (walked upward for .markspec.yaml / project.yaml).
Set `markspec mcp --root <path>` or the MARKSPEC_PROJECT_ROOT env var, or run
this server from a client that provides MCP roots. This server has no work to
do here — stop calling MarkSpec tools.
```

The two dispatch sites (`tools/mod.ts`, `resources/mod.ts`) switch from the
const to `project.softGateMessage`.

### 6. Install adapter wiring

Where a client interpolates a workspace variable, add `--root` to `args` so
discovery is deterministic even before roots negotiation:

- claude-code / cursor / opencode: append
  `["mcp", "--root", "${workspaceFolder}"]` (exact variable token confirmed per
  adapter during implementation).
- claude-desktop: no workspace variable exists → relies on roots (if the app
  provides them) then cwd; unchanged `args: ["mcp"]`.
- vscode markspec-ide: registered via `lm.registerMcpServerDefinitionProvider`;
  the extension already knows the workspace folder and passes roots — no
  `--root` needed.

Adapter changes are additive and covered by the existing adapter unit tests
(snapshot/`args` assertions updated).

## Error handling

- `listRoots()` / roots negotiation failures are caught and logged to
  `console.error`; the server continues on the cwd provisional.
- A malformed `file://` root URI is skipped, not fatal.
- An override path that resolves to no project is honored as the searched start
  dir and surfaces the §5 message naming it — deterministic, not a silent
  fallback to cwd.
- Existing compile-failure recovery (`inFlight` reset in `finally`) is
  untouched.

## Testing

Unit (`mcp/project_test.ts`, in-memory `ProjectEnv` + fake overrides):

- override beats a valid cwd; override with no project → searched-dirs recorded.
- cwd provisional resolves when no override.
- `resolveRoots(paths, 2)` adopts a project root and does **not** downgrade an
  override (priority guard).
- multi-candidate: first candidate that resolves wins.
- `softGateMessage` names the searched dirs and keeps the literal prefix.

Unit (`mcp/server_test.ts` or a new seam): `oninitialized` calls `listRoots`
only when the capability is present; `list_changed` triggers re-resolution;
`listRoots` rejection is swallowed.

Adapter unit: `--root ${workspaceFolder}` present for interpolating clients,
absent for claude-desktop.

E2E (blackbox `markspec mcp`, `tests/e2e/`): launch from a non-project cwd with
`MARKSPEC_PROJECT_ROOT` pointing at a fixture project → a tool call returns real
data, not the soft gate. Launch from a non-project cwd with no override and no
roots → soft-gate message includes the searched dir.

## Alternatives considered

- **Per-tool-call `cwd` argument.** Rejected: not idiomatic, pushes the burden
  onto the model on every call, and it forgets. Roots is the host-managed
  equivalent and strictly better.
- **Env/flag override only (no roots).** Rejected as the primary: still requires
  per-project config for Claude Code / VS Code, which the roots path removes
  entirely. Kept as the escape hatch (D4).
- **Mutable holder object.** Rejected (see §2).

## Out of scope / non-goals

- No filesystem watcher — staleness is still mtime/hash on `getCompiled`
  (unchanged).
- No change to the compile pipeline, cache, or invalidation semantics beyond
  re-running them on re-resolution.
- No multi-project support: the first root that resolves wins; MarkSpec remains
  single-root.
- Writes remain CLI-only (ADR-023).
