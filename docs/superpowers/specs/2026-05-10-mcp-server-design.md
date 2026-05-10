# MCP Server — Design Specification

**Date**: 2026-05-10 **Scope**: `packages/markspec/mcp/` **References**:
[ADR-005](../../architecture/adr-005-cli-architecture.md), GitHub issues #60–#63,
[2026-04-23 LSP design](2026-04-23-lsp-server-design.md),
[MCP specification](https://spec.modelcontextprotocol.io)

## 1. Overview

This spec defines v1 of the MarkSpec MCP server — a stdio JSON-RPC server that
exposes MarkSpec's traceability data to AI coding agents (Claude Desktop, Claude
Code, and any other MCP client).

**Design principle: idiomatic MCP.** Static, addressable data is exposed as MCP
**resources** with Markdown bodies. Parameterized actions are exposed as MCP
**tools** that return Markdown content. Nothing is dumped as JSON-in-a-text-blob
— agents read Markdown natively, clients render it, and the URI scheme makes
entries first-class objects that can be browsed and subscribed to.

V1 is **read-only**. Write operations (`requirement_insert`) are deferred until
`markspec insert` lands as its own epic.

| Issue | Feature                          | v1 status                              |
| ----- | -------------------------------- | -------------------------------------- |
| #60   | `mcp/` module + `markspec mcp`   | In scope — server scaffold + lifecycle |
| #61   | Lookup tool (id → entry)         | In scope — replaced by `markspec://entry/{id}` resource |
| #62   | Search tool (query → entries)    | In scope — `entry_search` tool         |
| #63   | `requirement_insert` write tool  | **Deferred** — see §9                  |

### Tool/resource naming

The original issues use `registry_*`. "Registry" now implies external
RefHub-style standard lookup (a separate future tool family); local
project entries are surfaced under `markspec://entry/...` resources.
Issues #61/#62 will be updated when the spec is approved.

## 2. Architecture

### 2.1 Compile target

`mcp/server.ts` is **not** a separate compile target. It is dynamically imported
by `main.ts` when the user runs `markspec mcp`, identical to how
`lsp/server.ts` is dispatched. There is one binary — `markspec` — and `markspec
validate` never loads the MCP SDK.

```bash
deno compile packages/markspec/main.ts  # → markspec (single binary)
```

This matches the lazy-loading invariant in
[CLAUDE.md / AGENTS.md](../../../AGENTS.md).

### 2.2 Module structure

```text
packages/markspec/mcp/
├── server.ts          ← entry: stdio transport, server lifecycle, registration
├── project.ts         ← project context: discover, compile cache, mtime check, refresh
├── resources/
│   ├── mod.ts         ← register resources, handle resources/list and resources/read
│   ├── profile.ts     ← markspec://profile renderer
│   ├── entries.ts     ← markspec://entries (index) renderer
│   └── entry.ts       ← markspec://entry/{displayId} renderer
└── tools/
    ├── mod.ts         ← register tools
    ├── search.ts      ← entry_search
    ├── context.ts     ← entry_context
    ├── validate.ts    ← validate
    └── refresh.ts     ← markspec_refresh
```

Resources and tools are siblings under `mcp/`. Each file has one responsibility.
No barrel `mod.ts` at the top of `mcp/` — nothing outside `mcp/` imports these
modules. Unit tests are colocated as `<name>_test.ts`; the e2e test lives at
`tests/e2e/mcp_test.ts`.

### 2.3 Dependency flow

```text
core/mod.ts ← project.ts
core/mod.ts ← resources/*.ts
core/mod.ts ← tools/*.ts
project.ts  ← resources/*.ts
project.ts  ← tools/*.ts
resources/mod.ts ← server.ts
tools/mod.ts     ← server.ts
project.ts       ← server.ts

npm:@modelcontextprotocol/sdk ← server.ts, resources/mod.ts, tools/mod.ts
```

The MCP module imports exclusively from `core/mod.ts` — never from internal core
paths.

## 3. Server Lifecycle (#60)

### 3.1 Transport

stdio only. The server is launched as a child process by the MCP client; the
client writes JSON-RPC messages to stdin and reads responses from stdout. This
matches Claude Desktop's default and the LSP's transport choice. HTTP / SSE is
out of scope for v1.

### 3.2 Capabilities

The server advertises three capabilities:

- `resources` — with `subscribe: true` and `listChanged: true`
- `tools` — with `listChanged: false` (tool set is static across the session)
- (no `prompts`, no `sampling`)

Subscriptions and list-changed notifications are essential for the live-feel
behaviour described in §4.7.

### 3.3 Initialize sequence

1. Client connects on stdio. Server constructs `Server` and
   `StdioServerTransport` from `@modelcontextprotocol/sdk`.
2. Client sends `initialize`. Server responds with capabilities and version.
3. **In parallel** (background, fire-and-forget): the server kicks off a
   `compile()` of the project rooted at `Deno.cwd()`. The in-flight promise is
   stored in module state. See §4.
4. Clients typically follow with `resources/list` and/or `tools/list`.
   `tools/list` does not require the compile (tool list is static).
   `resources/list` awaits the compile (entries are listed as resources).
5. `resources/read` and `tools/call` use the cached compile, triggering a
   recompile only when the mtime check detects changes.

### 3.4 Shutdown

The server listens for stdio EOF and the standard MCP `shutdown` notification.
On either signal it stops accepting new requests and exits the process. The
in-flight compile (if any) is abandoned by process exit — `compile()` has no
cancel API, but it touches no shared state, so abandoning is safe.

## 4. Project Context, Caching, and Notifications

### 4.1 Discovery

On `initialize`, the server calls `discoverProjectRoot(Deno.cwd(), readFile)`
from `core/mod.ts`. If no `project.yaml` is found, the server still starts and
`tools/list` works, but every `resources/*` and `tools/call` returns a clean
error:

> `"MarkSpec MCP server: no project.yaml found from <cwd>. Operations require project context."`

This mirrors the project-aware CLI subcommands.

### 4.2 Compile cache

Module-level state in `project.ts`:

```text
ProjectCache = {
  projectRoot: string,
  config: ProjectConfig,
  profile: ProfileChain | null,
  inFlight: Promise<CompileResult> | null,
  result: CompileResult | null,
  compiledAt: number,
  trackedFiles: { path: string, mtime: number }[],
  prevEntryIds: Set<string>,    // last-known entry IDs, for resource list diffing
}
```

### 4.3 Invalidation: mtime check on every call

`getCompiled()` is the single entry point used by every resource handler and
tool. Algorithm:

1. If `result === null` and `inFlight !== null`: await `inFlight`, populate
   `result`, return.
2. Stat every path in `trackedFiles`. Glob the project root for new `.md` and
   supported source files (same set the CLI uses). Compute:
   - `anyMtimeNewer` — any tracked file's current mtime > `compiledAt`
   - `anyNewFile` — a discovered file is not in `trackedFiles`
   - `anyMissing` — a tracked file no longer exists
3. If any of those is true: await a fresh `compile()`, swap into `result`,
   update `compiledAt` and `trackedFiles`, fire notifications (§4.7), return.
4. Otherwise: return `result`.

The stat sweep is single-digit milliseconds for projects with hundreds of files
— well under the cost of a recompile (100–500 ms typical). No filesystem
watcher in v1; we can add one later if profiling shows the stat sweep dominates.

### 4.4 Explicit refresh

`markspec_refresh` is a no-arg tool that forces a recompile. It exists as an
escape hatch for agents that just edited files and don't want to depend on mtime
resolution. It also fires the §4.7 notifications.

### 4.5 Concurrency

`getCompiled()` is `async`. If two calls land while a recompile is in-flight,
both await the same `inFlight` promise — `compile()` is not run twice. A simple
per-process mutex (one `inFlight: Promise | null` slot) is sufficient for
stdio's single-client model.

### 4.6 Subscriptions

The server tracks per-resource subscribers via the SDK's built-in subscription
machinery. We do not implement a custom subscription registry; we just call
`server.sendResourceUpdated(uri)` and `server.sendResourceListChanged()` when
appropriate.

### 4.7 Change notifications

After a successful recompile (whether from auto-invalidation in step 3 or from
`markspec_refresh`), the server fires:

- `notifications/resources/list_changed` — always. Entries may have appeared or
  disappeared, so the resource list is potentially different.
- `notifications/resources/updated` for `markspec://profile` — if the profile
  chain changed (profile mtime tracked separately).
- `notifications/resources/updated` for `markspec://entries` — always.
- `notifications/resources/updated` for `markspec://entry/{id}` — for each
  entry whose attributes, location, forward links, or reverse links changed.
  The diff is computed by serializing the entry's rendered Markdown and
  comparing to the previous-rendered version (hashed).

Clients that subscribed to specific entry resources thus get pinpoint update
notifications; clients that listed resources get list-change notifications.

## 5. Resources

All resources are read-only. URIs use the `markspec://` scheme. All bodies are
`text/markdown`.

### 5.1 `markspec://profile`

Distilled summary of the active profile chain, rendered as Markdown.

**MIME**: `text/markdown`

**Body example**:

```markdown
# MarkSpec Profile

**Active**: @org/aspice-swe-mini@1.0.0
**Inherits**: @driftsys/markspec-default@0.3.0

ASPICE software-engineering subset profile.

## Entry types

### stakeholder-requirement

- **Display-ID pattern**: `STK_{DOMAIN}_{NNNN}`
- **Shape**: identified
- **Color**: blue
- **Required attributes**: Id
- **Allowed attributes**: Satisfies, Labels, Status
- **Outgoing links**: satisfies
- **Incoming links**: verified-by

A stakeholder need or expectation expressed at the contract level.

### software-requirement

…

## Universal attributes

These apply to all identified entries regardless of type.

- **Id** (required) — ULID or URI

## Link kinds

| Kind          | Direction | Allowed between                       |
| ------------- | --------- | ------------------------------------- |
| satisfies     | outgoing  | software-requirement → system-requirement |
| derived-from  | outgoing  | software-requirement → software-requirement |
| verified-by   | outgoing  | software-requirement → software-test  |

## Labels

ASIL-A, ASIL-B, ASIL-C, ASIL-D — ISO 26262 ASIL classifications.
```

Sections are omitted when the profile has nothing in them (e.g., a profile
with no labels declared has no "Labels" section).

### 5.2 `markspec://entries`

Index of all entries in the project, grouped by type, with display-ID and
title only — a table of contents.

**MIME**: `text/markdown`

**Body example**:

```markdown
# Entries (1,247)

## stakeholder-requirement (12)

- [STK_AEB_0001](markspec://entry/STK_AEB_0001) — Stop on imminent collision
- [STK_AEB_0002](markspec://entry/STK_AEB_0002) — Driver override at any time
…

## software-requirement (243)

- [SRS_AEB_0001](markspec://entry/SRS_AEB_0001) — Sensor debouncing
…
```

Links use the `markspec://entry/...` URI scheme, so MCP clients that follow
resource links navigate naturally.

### 5.3 `markspec://entry/{displayId}`

A single entry rendered with attributes, location, body, outgoing and incoming
links. Each entry in the project registers as its own resource, so
`resources/list` enumerates `entries.size` URIs of this form.

**MIME**: `text/markdown`

**Body example**:

```markdown
# STK_AEB_0001 — Stop on imminent collision

**Type**: stakeholder-requirement
**Shape**: identified
**Id**: `01HGW2Q8MNP3RSTVWXYZABCDEF`
**Location**: [docs/product/stakeholder-requirements.md:42](file:///…/docs/product/stakeholder-requirements.md)

When the system detects an imminent collision with a stationary object,
it shall command emergency braking sufficient to stop the vehicle before
contact.

## Attributes

- **Labels**: ASIL-B

## Outgoing links

- **satisfies** → [SYS_AEB_0012](markspec://entry/SYS_AEB_0012) — Object threat assessment

## Incoming links

- **verified-by** ← [VAL_AEB_0001](markspec://entry/VAL_AEB_0001) — Vehicle stops before collision
- **verified-by** ← [SIT_AEB_0030](markspec://entry/SIT_AEB_0030) — Threat from radar track
```

Reverse links are included inline. This is why we do not ship a separate
`entry_dependents` tool — the entry resource already answers that question
naturally.

### 5.4 Resource listing

`resources/list` returns descriptors for:

- `markspec://profile` — name "Active profile", description "Distilled
  profile manifest for this project"
- `markspec://entries` — name "Entry index", description "All entries grouped
  by type"
- one descriptor per entry: name = displayId, description = title

Servers receiving a `resources/list` call with pagination cursors page through
the entry resources. The SDK handles pagination; we pass it the full list and
let it slice.

## 6. Tools

All tool outputs are Markdown content in the MCP `CallToolResult.content` array
(single `{ type: "text", text: <markdown> }` item).

### 6.1 `entry_search`

Rank-search entries by display-ID and title.

- **Input**: `{ query: string, limit?: number }` — `limit` defaults to 20,
  capped at 100.
- **Output**: Markdown list of ranked matches with links into
  `markspec://entry/…`.

**Ranking algorithm (v1)**:

1. Normalize `query` and each candidate field to lowercase.
2. Tokenize on whitespace and underscores.
3. Score per entry:
   - +10 if `query` is a prefix of `displayId`
   - +5 if `query` is a substring of `displayId`
   - +3 per query-token matching a title-token (exact)
   - +1 per query-token matching a title-token (substring)
   - +2 if all query-tokens appear in title (any order)
4. Drop entries with score 0. Sort descending. Take `limit`.

**Body example**:

```markdown
# Search results for "braking" (3 matches)

1. [STK_AEB_0001](markspec://entry/STK_AEB_0001) — Stop on imminent collision (score 11)
2. [SRS_AEB_0010](markspec://entry/SRS_AEB_0010) — Apply continuous braking force (score 8)
3. [VAL_AEB_0001](markspec://entry/VAL_AEB_0001) — Vehicle stops before collision (score 6)
```

### 6.2 `entry_context`

Walk the `Satisfies` chain upward from an entry. Returns a Markdown tree.

- **Input**: `{ id: string, depth?: number }` — `depth` defaults to 10.
- **Output**: Markdown nested-list rendering of the chain. Cycle protection via
  `visited` set.

**Body example**:

```markdown
# Context for [SRS_AEB_0010](markspec://entry/SRS_AEB_0010)

- **SRS_AEB_0010** — Apply continuous braking force
  - satisfies → [SYS_AEB_0012](markspec://entry/SYS_AEB_0012) — Object threat assessment
    - satisfies → [STK_AEB_0001](markspec://entry/STK_AEB_0001) — Stop on imminent collision
```

Indentation level = hops from the start entry.

### 6.3 `validate`

Run the validator pipeline; return a Markdown diagnostics report.

- **Input**: `{ files?: string[] }` — when omitted, validate the full project.
  Relative paths resolved against the project root; absolute used as-is.
  When provided, the result is filtered to diagnostics whose `location.file`
  matches an input path after normalization.
- **Output**: Markdown report. Empty diagnostics produce a one-line success
  message.

**Body example** (with issues):

```markdown
# Validation: 2 errors, 1 warning

## Errors

### MSL-R004: unresolved reference

[docs/product/software-requirements.md:128:3](file:///…)

> `Satisfies: SYS_NONEXISTENT`

`SYS_NONEXISTENT` is not declared in the project corpus.

### MSL-R001: missing ULID

[docs/product/stakeholder-requirements.md:67:1](file:///…)

Entry `[STK_AEB_0014]` is missing an `Id:` attribute.

## Warnings

### MSL-R010: unrecognized attribute

[docs/product/software-requirements.md:200:3](file:///…)

> `Priority: high`

`Priority` is not an allowed attribute for `software-requirement` under the
active profile.
```

**Body example** (clean):

```markdown
✓ All 1,247 entries pass validation under @org/aspice-swe-mini@1.0.0.
```

### 6.4 `markspec_refresh`

Force-invalidate the compile cache. Always recompiles. Fires the §4.7
notifications.

- **Input**: `{}`
- **Output**:

  ```markdown
  Refreshed. 1,247 entries, 3,891 links.
  ```

## 7. SDK and Dependencies

`@modelcontextprotocol/sdk` (TypeScript MCP SDK), imported via `npm:` because
no JSR mirror exists today:

```typescript
import { Server } from "npm:@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "npm:@modelcontextprotocol/sdk/types.js";
```

This matches the existing precedent (`vscode-languageserver` is also `npm:`).
Node.js compatibility is preserved.

No additional dependencies. JSON Schema for tool inputs is hand-written
(schemas are tiny — three fields max). No Zod.

## 8. Errors

Two categories:

**Setup errors** — surface as MCP errors on the offending request:

| Code              | Trigger                                              |
| ----------------- | ---------------------------------------------------- |
| `NO_PROJECT_ROOT` | No `project.yaml` found from `Deno.cwd()`            |
| `COMPILE_FAILED`  | `compile()` returned errors of severity `error`      |

**Per-request errors** — returned as `isError: true` content (tools) or as
JSON-RPC errors (resources):

| Code              | Trigger                                       |
| ----------------- | --------------------------------------------- |
| `ENTRY_NOT_FOUND` | `markspec://entry/{id}` or `entry_context` miss |
| `INVALID_INPUT`   | JSON-schema validation failed (tools only)    |
| `INVALID_URI`     | `resources/read` for an unrecognized URI      |

`COMPILE_FAILED` is a hard error — the cache is left empty and subsequent
calls retry. We do not silently return partial graphs.

## 9. Client Compatibility

The design works in the three MCP clients we care about today. Coverage as of
2026-05-10:

| Feature                                                      | Claude Code | GitHub Copilot (VS Code) | OpenCode    |
| ------------------------------------------------------------ | ----------- | ------------------------ | ----------- |
| stdio transport                                              | ✓           | ✓                        | ✓           |
| `tools/list`, `tools/call`                                   | ✓           | ✓                        | ✓           |
| `resources/list`, `resources/read`                           | ✓           | ✓                        | ✓           |
| `resources/subscribe` + `resources/updated` notifications    | ✓           | ✗ (ignored)              | ⚠ partial   |

Subscriptions (§4.6, §4.7) are a **latency optimization**, never a correctness
mechanism. Every `resources/read` and `tools/call` runs through
`getCompiled()` (§4.3), which stats tracked files and recompiles on staleness.
A Copilot agent that re-reads `markspec://entry/STK_AEB_0001` after an edit
sees the updated content even though Copilot ignored the `resources/updated`
notification — because the read itself triggered the recompile.

The server still advertises `subscribe: true` and emits notifications
unconditionally. Clients that honor them get push updates; clients that don't
are no worse off than they would be without subscriptions at all.

Stdio is the only transport in v1 (§3.1) because Copilot does not yet support
HTTP/SSE for MCP and the other two support stdio natively. Adding HTTP later
is additive.

## 10. Out of Scope for v1

| Item                    | Reason                                                    |
| ----------------------- | --------------------------------------------------------- |
| `requirement_insert`    | Requires `markspec insert` (epic:insert, #38–#41) first.  |
| External RefHub registry | Separate tool family; distinct concept from local entries. |
| HTTP / SSE transport    | Not supported by Copilot today; stdio is universal.       |
| Prompts                 | No agent use case yet.                                    |
| Sampling                | Relevant only for nested-LLM workflows.                   |
| Multi-root workspace    | Single project root matches CLI semantics.                |
| Filesystem watcher      | Stat sweep is cheap enough; revisit if profiling demands. |
| Hot profile reload      | Profile chain loaded once; refresh tool re-reads.         |
| Document resources      | `markspec://document/{path}` for full source bodies — defer until use case is clear. |

## 11. Tests

### 11.1 Unit tests

Each `resources/<name>.ts` and `tools/<name>.ts` has a colocated `<name>_test.ts`.
Tests build a minimal fixture `CompileResult` (or use a shared builder) and
assert the rendered Markdown body — usually via `assertStringIncludes` for
behavioural assertions and `assertSnapshot` for layout-level checks.

The ranking algorithm in `tools/search.ts` gets focused tests per scoring rule.

`project.ts` gets unit tests for the cache invalidation logic with an in-memory
readFile / stat shim.

### 11.2 E2E test

`tests/e2e/mcp_test.ts` spawns `deno run main.ts mcp` with a fixture project in
a temp directory. It exchanges a real JSON-RPC sequence over stdio:

1. `initialize` → assert capabilities include `resources` and `tools`.
2. `tools/list` → assert all four tools present.
3. `resources/list` → assert `markspec://profile`, `markspec://entries`, and at
   least one `markspec://entry/...` present.
4. `resources/read markspec://profile` → assert Markdown body includes profile
   id.
5. `resources/read markspec://entry/STK_AEB_0001` → assert body includes
   "Outgoing links" section.
6. `tools/call entry_search { query: "braking" }` → assert at least one hit
   formatted as a link.
7. `tools/call validate {}` → assert success message on the clean fixture.
8. Subscribe to `markspec://entry/STK_AEB_0001`. Mutate the underlying file to
   change its title. Trigger `markspec_refresh`. Assert that
   `notifications/resources/updated` arrives for that URI.
9. `shutdown` notification → assert clean exit.

This is the integration boundary; it never imports from `mcp/` directly.

### 11.3 Snapshot tests

`tests/e2e/mcp_test.ts` snapshots the `tools/list` response and the rendered
Markdown of the fixture's `markspec://profile` so wording or schema regressions
are caught on review.

## 12. Rollout

One PR with the full v1:

1. Add `mcp/server.ts`, `mcp/project.ts`, `mcp/resources/*.ts`, `mcp/tools/*.ts`,
   colocated unit tests.
2. Add `tests/e2e/mcp_test.ts`.
3. Wire `markspec mcp` in `main.ts` to `await import("./mcp/server.ts")`,
   removing the `notImplemented("mcp")` placeholder.
4. Add `npm:@modelcontextprotocol/sdk` to the dependency graph.
5. Update [docs/guide/commands.md](../../guide/commands.md) — promote `mcp`
   from "not implemented" to documented, with a worked example connecting from
   Claude Desktop.
6. Update GitHub issues #60–#63 with the resource/tool layout and the deferral
   of #63.

## 13. Open Questions

None blocking implementation. Items for follow-up after v1 ships:

- **Telemetry**: tool/resource invocation counts. Defer.
- **Caching across processes**: each `markspec mcp` process keeps its own
  cache. Two MCP clients connecting (e.g., Claude Desktop and Claude Code
  simultaneously) compile twice. Acceptable for v1.
- **Profile changes**: editing `.markspec.yaml` doesn't currently invalidate
  the cache (mtime check only watches parsed files). If profile-driven
  attribute validation lands, add `.markspec.yaml` to the watched set.
- **Document resources**: exposing whole `.md` files as
  `markspec://document/{path}` resources may be useful for agents that want
  to "read the architecture spec." Defer until there's a clear request.
