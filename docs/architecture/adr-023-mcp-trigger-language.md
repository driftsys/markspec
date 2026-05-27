# ADR-023 — MCP trigger language and project-detection soft gate

Status: Proposed (2026-05-27)\
Supersedes: none\
Related: none — first ADR scoping the MCP layer's agent-facing surface.

## Context

The MCP server in [packages/markspec/mcp/](../../packages/markspec/mcp/) exposes
the project's traceability graph as five tools (`entry_search`, `entry_context`,
`validate`, `markspec_refresh`, `profile_describe`) and three resources
(`markspec://entries`, `markspec://profile`, `markspec://entry/{id}`). Agents
are observed to **never invoke** these tools when run inside GitHub Copilot,
even on questions about requirements, traceability, or display IDs that are
clearly in scope. They default to `grep` / `Read` / `Glob` on Markdown files
instead.

Root cause is in the trigger surface, not the tools themselves:

1. `SERVER_INSTRUCTIONS` in
   [packages/markspec/mcp/server.ts](../../packages/markspec/mcp/server.ts)
   opens with a definition ("MarkSpec exposes a project's…") rather than a
   directive ("Use this for X").
2. Tool descriptions are descriptive ("Find entries by keyword…") instead of
   trigger-oriented ("Use when the user asks to …").
3. No tool description tells the agent to **prefer** the MCP over built-in file
   tools.
4. No project-detection signal — the server starts and registers tools even in
   workspaces without `.markspec.yaml` or `project.yaml`, so agents in
   misconfigured Copilot setups can get tools that have nothing to operate on.

Client support for the MCP `Implementation.instructions` field is uneven (Claude
Code and Cursor surface it; Copilot does not reliably). Top-level guidance alone
cannot fix the Copilot failure mode — the trigger signal must live in every tool
description as well.

## Decisions

### 1. Defense in depth — same trigger vocabulary in both layers

Both `SERVER_INSTRUCTIONS` and every individual tool description carry the same
trigger language. Copilot misses `SERVER_INSTRUCTIONS`; without per-tool
triggers it has no signal at all. Other clients get reinforcement when the same
vocabulary appears in two places. Duplication is the redundancy, by design.

### 2. Shared trigger grammar

Every TRIGGER block follows three labelled sections in this order:

```text
TRIGGER when: <user-phrasing patterns, comma-separated>
PREFER over: <built-in tools this replaces>
SKIP when: <anti-triggers>
```

This mirrors the imperative pattern that works for Anthropic skills ("Use when
X") and for high-trigger MCP servers like context7. `PREFER over:` is the
anti-fallback directive currently missing — it's what explicitly outranks `grep`
/ `Read` / `Glob`. `SKIP when:` prevents over-triggering on adjacent intents.

### 3. Locked trigger vocabulary

User-facing nouns to match in trigger blocks. The internal noun "entries" is
**excluded** from trigger phrasings (users say "requirement" or "spec";
"entries" is MarkSpec-internal vocabulary) and appears only in mechanical
return-type descriptions where unavoidable (`markspec://entry/{id}`).

| Category                 | Terms                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generic                  | requirement(s), specification(s), spec(s)                                                                                                                           |
| Level-specific           | stakeholder requirement, system requirement, software requirement                                                                                                   |
| Architecture / Interface | architecture description, interface control document, ICD                                                                                                           |
| Trace                    | traceability, satisfies-chain                                                                                                                                       |
| Process verbs            | verification, validation                                                                                                                                            |
| Safety                   | safety, ASIL-A/B/C/D                                                                                                                                                |
| Patterns                 | EARS, acceptance criteria                                                                                                                                           |
| **Anchor regex**         | `[A-Z]{2,}_[A-Z0-9_]+` — catches any uppercase-prefixed display ID like `STK_AEB_0001`, `SAD_BRK_0042`, `ICD_…`, or any profile-specific prefix without enumerating |

**Deliberately dropped** (over-trigger risk): test, test case, design, module,
component, AC, Gherkin scenario, ASPICE, ISO 26262. The display-ID regex anchor
catches the `TST_` / `SWT_` / `SIT_` prefixes for test-shaped entries; ASPICE
and ISO 26262 are workflow standards rather than entry-level vocabulary.

### 4. Rewritten `SERVER_INSTRUCTIONS`

Replace the current `SERVER_INSTRUCTIONS` constant in
[packages/markspec/mcp/server.ts](../../packages/markspec/mcp/server.ts) with
the following text:

```text
MarkSpec is this project's traceability graph — requirements, specifications,
and tests with their cross-references. Use this server for ALL questions
about requirements, specs, IDs, and traceability in this project.

TRIGGER when the user:
  - mentions a display ID matching [A-Z]{2,}_[A-Z0-9_]+ (e.g. STK_0001,
    SAD_AEB_0042, ICD_BRK_0010, or any uppercase-prefixed underscored token)
  - asks about requirements, specifications, specs, interface control
    documents (ICDs), architecture descriptions, verification, validation,
    safety requirements, ASIL levels, EARS requirements, acceptance
    criteria, or traceability in this project
  - asks what a requirement satisfies, what depends on it, what it traces
    to, or what implements it
  - asks whether a file or the project is valid, has broken refs, or has
    duplicate IDs

PREFER over: grep, Read, Glob, or file-system search whenever the question
is about requirements or traceability. Built-in tools see Markdown text;
this server sees the compiled traceability graph.

Pick the right surface per intent:
  - Find requirements by keyword      → entry_search
  - Show one requirement by ID        → resources/read markspec://entry/{id}
  - Walk satisfies-chain upward       → entry_context
  - See what depends on a requirement → "Incoming links" in markspec://entry/{id}
  - Check project health              → validate
  - Refresh after external file edits → markspec_refresh

SKIP when:
  - any MarkSpec tool returns "No MarkSpec project found" — this workspace
    doesn't use MarkSpec (no .markspec.yaml or project.yaml in scope);
    stop calling MarkSpec tools for the rest of this session
  - the user asks about source-code symbols, language features, framework
    APIs, or library documentation — use context7 / language servers /
    Read instead
  - the user wants to edit a file directly ("change line 42 to X", "fix
    this typo") — MarkSpec MCP is read-only; use Edit
  - the user wants to create or insert a new requirement — writes are
    CLI-only (markspec format, markspec insert)
  - the user wants a rendered preview of a Markdown file — use markspec
    doc build / markspec book build via Bash, not the MCP

Do NOT use this server to edit entries. Writes are CLI-only:
  markspec format, markspec insert.

All resource bodies are Markdown with markspec:// URIs you can follow with
resources/read.
```

### 5. Rewritten tool descriptions

#### 5.1 `entry_search` — [packages/markspec/mcp/tools/search.ts](../../packages/markspec/mcp/tools/search.ts)

Replace the `description` field of `ENTRY_SEARCH_DESCRIPTOR`:

```text
TRIGGER when: user asks to find/list/show/search requirements,
specifications, ICDs, architecture descriptions, or tests about X; mentions
a display ID like STK_0001, SAD_AEB_0042, or ICD_BRK_0010; or asks "what
requirements cover X", "where is Y specified", "list stakeholder
requirements", "show ASIL-B safety requirements". PREFER over: grep, Read,
Glob on Markdown files — this returns ranked matches from the compiled
traceability graph in one call instead of N file reads.

Returns up to 100 ranked matches as Markdown links to markspec://entry/{id}
resources, searching across display IDs and titles. Limit: 5–20 for broad
exploration, 50+ only when listing every match in a domain.

SKIP when: returns "No MarkSpec project found" — this workspace doesn't use
MarkSpec; stop calling MarkSpec tools.
```

#### 5.2 `entry_context` — [packages/markspec/mcp/tools/context.ts](../../packages/markspec/mcp/tools/context.ts)

Replace the `description` field of `ENTRY_CONTEXT_DESCRIPTOR`:

```text
TRIGGER when: user asks "what does this requirement satisfy", "why does
this spec exist", "what does this trace up to", "what does X implement",
"what higher-level requirement covers Y", or wants the upward chain from
any display ID to its parents. PREFER over: grep'ing Satisfies: lines
across files — this walks the compiled graph deterministically.

For the opposite direction (what depends on this requirement), read
markspec://entry/{id} and inspect its "Incoming links" section.

Returns a nested Markdown list with markspec://entry/{id} links. Depth
defaults to 10; lower to 2–3 for quick orientation, raise only for full
transitive context.
```

#### 5.3 `validate` — [packages/markspec/mcp/tools/validate.ts](../../packages/markspec/mcp/tools/validate.ts)

Replace the `description` field of `VALIDATE_DESCRIPTOR`:

```text
TRIGGER when: user asks "is this file valid", "are there broken refs",
"check the project for errors", "run validate", or after entry-bearing
files were edited and traceability needs confirming. PREFER over:
re-reading every file to spot dangling Satisfies: targets — the validator
runs the full diagnostic pipeline (broken refs, missing or duplicate IDs,
malformed entries, profile rule violations) in one call.

Returns a Markdown report grouped by severity. Optional 'files' restricts
diagnostics to a subset of paths (relative to project root); empty 'files'
list means all files.

SKIP when: returns "No MarkSpec project found" — this workspace doesn't use
MarkSpec.
```

#### 5.4 `markspec_refresh` — [packages/markspec/mcp/tools/refresh.ts](../../packages/markspec/mcp/tools/refresh.ts)

Replace the `description` field of `REFRESH_DESCRIPTOR`:

```text
TRIGGER when: files were modified outside this MCP session (CLI commands,
editor saves, git checkout, branch switch) and subsequent reads need to
see fresh state. PREFER over: re-running validate or entry_search hoping
to see fresh data — this guarantees the cache picks up disk changes.

Do NOT call between back-to-back reads — the cache is already coherent
within a session. Unnecessary calls slow down subsequent tool calls.

Returns a one-line confirmation with entry and link counts.
```

#### 5.5 `profile_describe` — [packages/markspec/mcp/tools/profile_describe.ts](../../packages/markspec/mcp/tools/profile_describe.ts)

Replace the `description` field of `PROFILE_DESCRIBE_DESCRIPTOR`:

```text
TRIGGER when: user asks "what does <Type> mean in this project", "what
attribute is X", "is Y a valid label", "what relations does this profile
define", "what's the EARS convention here", or any question about the
project's profile-declared vocabulary. PREFER over: reading profile YAML
files directly — this returns resolved element details from the compiled
profile chain.

Supply `name` (required) and optionally `kind`
(type/attribute/relation/label/convention) to narrow the search. Fuzzy
matching when no exact match; response lists candidates if multiple match.
```

### 6. Server-side soft gate — D2 (soft) over D1 (hard)

Today the MCP server starts and registers tools regardless of whether the
workspace is a MarkSpec project. Add a soft gate so tools self-describe "not
applicable" instead of returning empty or confusing results.

**D2 (soft) chosen over D1 (hard, refuse to start without config):** D2 is
friendlier to client retry logic — the server appears healthy and registers
normally; only the per-call behavior changes. Some clients log launch failures
or back off when the server exits 0 without tools.

#### 6.1 Detection signal

A workspace is a MarkSpec project when, walking up from the server's cwd:

1. **`project.yaml`** exists (canonical config — strongest signal), OR
2. **`.markspec.yaml`** exists (profile activation chain).

The detection reuses `discoverProjectRoot()` from
[packages/markspec/core/config/mod.ts](../../packages/markspec/core/config/mod.ts).
Markdown files containing `[TYPE_NNNN]` entry blocks would be a weaker third
signal for ad-hoc adoption, but searching is too costly at startup and is left
out of the baseline.

#### 6.2 Code changes

| File                                                                                   | Change                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [packages/markspec/mcp/project.ts](../../packages/markspec/mcp/project.ts)             | Add `markspecDetected: boolean` to the `Project` interface. Set during `createProject()` by checking for `.markspec.yaml` OR `project.yaml` via `discoverProjectRoot()`.                                                                                                                                                                                                                |
| [packages/markspec/mcp/tools/mod.ts](../../packages/markspec/mcp/tools/mod.ts)         | At the top of every handler in the `HANDLERS` map, if `!project.markspecDetected` return the uniform message below **as normal content** (`{ content: [{ type: "text", text: SOFT_GATE_MESSAGE }] }`), **not** with `isError: true`. The SKIP rule depends on the agent seeing the message text in the response body — `isError: true` causes some clients to suppress message content. |
| [packages/markspec/mcp/resources/mod.ts](../../packages/markspec/mcp/resources/mod.ts) | Same early-return guard in `resources/read` handlers, returning the same string as a normal `text/plain` resource content (not an error).                                                                                                                                                                                                                                               |

#### 6.3 Uniform error string (load-bearing)

The SKIP rule keys on the **exact phrase** "No MarkSpec project found". Do not
paraphrase across handlers. Canonical text:

```text
No MarkSpec project found in this workspace (looked for .markspec.yaml and
project.yaml from cwd upward). This MCP server has no work to do here —
stop calling MarkSpec tools.
```

#### 6.4 What stays the same

- Server still starts in any cwd, opens stdio transport, registers all
  tools/resources, and responds to `tools/list` / `resources/list`.
- Tool descriptions (per decision 5) are identical regardless of detection
  result — the SKIP rule teaches the agent to stop calling; the server just
  enforces the response.
- No structural change to project loading, resource subscription, or cache
  invalidation.

## Consequences

### Token budget

One-shot cost per MCP session (sent during `initialize` + `tools/list`, not per
turn):

| Surface                        | Today        | Proposed      | Delta    |
| ------------------------------ | ------------ | ------------- | -------- |
| `SERVER_INSTRUCTIONS`          | ~150 tok     | ~280 tok      | +130     |
| `entry_search` description     | ~95 tok      | ~190 tok      | +95      |
| `entry_context` description    | ~95 tok      | ~165 tok      | +70      |
| `validate` description         | ~85 tok      | ~155 tok      | +70      |
| `markspec_refresh` description | ~70 tok      | ~110 tok      | +40      |
| `profile_describe` description | ~55 tok      | ~135 tok      | +80      |
| **Total**                      | **~550 tok** | **~1035 tok** | **+485** |

Acceptable. Worth it given the current Copilot zero-fire failure mode.

### Verification plan

Failure mode is anecdotal (Copilot ignores the MCP); success is also anecdotal
in v1. Smoke tests after implementation:

1. **Copilot in a MarkSpec project** — open a workspace with `project.yaml` and
   ask "find requirements about braking". Confirm Copilot calls `entry_search`
   instead of grep.
2. **Copilot in a non-MarkSpec project** — open a workspace with no
   `.markspec.yaml` / `project.yaml`, register the MCP server, ask "find
   requirements about X". Confirm the soft-gate message appears and Copilot does
   not retry.
3. **Claude Code in a MarkSpec project** — same first test, confirm
   reinforcement from both `SERVER_INSTRUCTIONS` and tool descriptions does not
   produce double-firing or self-contradictory plans.
4. **Display-ID trigger** — ask "what does STK_0001 satisfy" in any client;
   confirm `entry_context` fires (the regex anchor working).

No automated regression suite for prompt copy — these descriptors are not
unit-testable for trigger behavior, only for content shape.

### Out of scope

- **No new markspec skill.** Refinement of the markspec-core skills bundle with
  a dedicated MCP-trigger skill is a separate, Phase-2 effort. Phase 2 builds on
  top of this baseline once impact is observed.
- **No client-config documentation.** GitHub Copilot / Cursor / Claude Desktop
  registration instructions are an ops concern, not changed here.
- **No telemetry.** No instrumentation of "did the trigger fire?". Success is
  measured by anecdotal user reports.
- **No hard server-side gate (D1).** Server still starts in non-MarkSpec
  workspaces; only response content changes.
