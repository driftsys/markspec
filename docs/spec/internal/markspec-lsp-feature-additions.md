# MarkSpec — LSP Feature Additions

Status: Draft\
Date: 2026-05-25\
Scope: New LSP server capabilities that build on the existing `markspec lsp`
surface (diagnostics, completions, hover, definition, references, symbols,
rename, folding, highlights, code actions, semantic tokens) — covering
formatting, the custom `markspec/profile` request, and inline information
surfaces (code lens, inlay hints, document links). All capabilities are
editor-agnostic: they serve every LSP client (VS Code, Neovim, Helix, …).\
Builds on: [markspec-vscode-authoring.md](markspec-vscode-authoring.md)
(consumes `textDocument/formatting` and `markspec/profile` as v1 prerequisites),
[markspec-toolchain-distribution.md](markspec-toolchain-distribution.md) (single
binary, lazy loading), `packages/markspec/lsp/server.ts` (current capability
set), `packages/markspec/core/formatter/` (the formatter the LSP wraps), LSP
3.17 specification

This spec specifies new server-side capabilities. It does not specify
client-side wiring — the VS Code extension's consumption is owned by
markspec-vscode-authoring.md; other editors (Neovim's `nvim-lspconfig`, Helix,
Zed) consume the same capabilities through their standard LSP client plumbing.

---

## 0. Terminology

| Term                   | Meaning in this spec                                                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **the LSP server**     | The `markspec lsp` subcommand, dispatched from `main.ts` and implemented in `packages/markspec/lsp/`.                                                                                                                                     |
| **capability**         | An LSP feature the server advertises in its `initialize` response — e.g. `documentFormattingProvider`, `codeLensProvider`. Clients use these to decide which requests to send.                                                            |
| **custom request**     | A non-standard LSP method the server handles, namespaced under `markspec/…`. Clients that don't recognize it are unaffected.                                                                                                              |
| **inline surface**     | Any LSP capability that renders extra information attached to a position or range in the document text — code lens, inlay hints, document links. Distinct from diagnostics (which are problem reports) or completions (which are inputs). |
| **must-have for v1**   | A capability whose absence blocks a load-bearing workflow specified by another v1 spec (currently markspec-vscode-authoring.md).                                                                                                          |
| **should-have for v1** | A capability that significantly improves the v1 experience but is not load-bearing — its absence degrades UX but does not block any specified workflow.                                                                                   |
| **deferred**           | A capability identified as valuable but explicitly out of v1 scope.                                                                                                                                                                       |

---

## 1. Scope and boundaries

In scope: the new LSP capabilities the server MUST or SHOULD advertise in v1,
how each request is handled, what core modules they delegate to, and the
performance / lazy-loading constraints they MUST respect.

Out of scope (and where each piece is owned):

- **Client-side wiring.** How VS Code or Neovim consume these capabilities is
  not specified here. The VS Code consumption is owned by
  [markspec-vscode-authoring.md](markspec-vscode-authoring.md). Other editors
  use standard LSP client tooling.
- **Existing capabilities.** Diagnostics, completions, hover, definition,
  references, document/workspace symbols, rename, folding, document highlights,
  code actions, semantic tokens are already shipped — see
  `packages/markspec/lsp/server.ts`. This spec adds to them, does not modify
  them.
- **CLI subcommands.** The `format`, `compile`, and `report` CLI surfaces are
  owned by the implementation under `packages/markspec/cli/commands/`. The LSP
  capabilities specified here delegate to the same `core/` modules but expose
  them via LSP protocol.
- **Background indexing changes.** Workspace indexing strategy is owned by
  [markspec-background-indexing.md](markspec-background-indexing.md). This spec
  assumes the existing `WorkspaceIndex` (`lsp/workspace.ts`) and does not change
  indexing semantics.

---

## 2. Capability set (v1 priorities)

| Capability                                 | Tier             | Purpose                                                                                         | Backing core module   |
| ------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------- | --------------------- |
| `textDocument/formatting`                  | **must-have**    | Format-on-save / Format Document. Stamp ULIDs, normalize indentation, fix attribute formatting. | `core/formatter`      |
| `markspec/profile` (custom)                | **must-have**    | Active profile metadata — types, prefixes, colors. Drives client-side profile-aware coloring.   | `core/profile`        |
| `textDocument/codeLens`                    | should-have      | Inline counts ("5 dependents") and chain links above entry titles.                              | `WorkspaceIndex`      |
| `textDocument/inlayHint`                   | should-have      | Inline resolved type / dependent count without explicit screen real estate.                     | `WorkspaceIndex`      |
| `textDocument/documentLink`                | should-have      | `Verified-by:` paths and file-references as clickable links to test files / source.             | parser-extracted      |
| `textDocument/rangeFormatting`             | deferred (v1.1)  | Format a selected range only.                                                                   | `core/formatter`      |
| `textDocument/onTypeFormatting`            | deferred (v1.1)  | Format as user types (e.g. on `:`, newline).                                                    | `core/formatter`      |
| `textDocument/selectionRange`              | deferred (v1.1)  | Expand-selection (inline → line → trailer → entry → section).                                   | parser positions      |
| `textDocument/prepareTypeHierarchy` / etc. | deferred (v1.1+) | Satisfies-chain as a tree view (LSP type hierarchy protocol).                                   | `core/compiler`       |
| `workspace/willRenameFiles`                | deferred (v1.1+) | Auto-update path references when a file is renamed.                                             | parser + path-rewrite |

Rationale for tiering:

- **must-have** capabilities are explicitly load-bearing for
  markspec-vscode-authoring.md. Without `textDocument/formatting` there is no
  format-on-save for the author cohort. Without `markspec/profile` the web
  preview's profile-aware coloring (vscode-authoring §4.4) degrades to
  monochrome.
- **should-have** capabilities make the editor experience significantly richer
  for traceability work — the load-bearing use case of MarkSpec — without being
  blocked-on by any other v1 spec.
- **deferred** capabilities are valuable but additive. Each can ship in a point
  release without rework of the v1 surface (LSP capabilities are additive;
  clients ignore those they don't recognize).

---

## 3. `textDocument/formatting` (must-have)

### 3.1 Behavior

The server advertises `documentFormattingProvider: true` in its `initialize`
response. On a `textDocument/formatting` request, the server:

1. Loads the document's current text from the LSP `TextDocuments` cache (the
   already-open buffer, not the disk file).
2. Invokes the existing `core/formatter/` module to compute the formatted text.
   Same code path as `markspec format` CLI — single source of truth.
3. Computes a minimal-diff `TextEdit[]` between the current text and the
   formatted text (so the editor preserves cursor position, scroll, undo stacks
   accurately).
4. Returns the `TextEdit[]`.

The server MUST NOT write to disk. The client (editor) is responsible for
applying the returned edits to its buffer; saving is the user's normal flow.

### 3.2 Determinism

The formatter is already deterministic (CLAUDE.md "Deterministic output"): same
input always produces identical output. The LSP wrapper preserves this — no
environmental dependencies, no timestamps. The same content fed through
`markspec format` and through the LSP request yield byte-identical output.

### 3.3 ULID stamping

`markspec format` stamps `Id:` ULIDs when missing. The LSP wrapper does the same
— every save (with formatOnSave) generates ULIDs for newly-authored entries that
lack them. This is the load-bearing reason the LSP needs a formatter: without
it, authors save unformatted entries and the validator flags them on every
reload.

### 3.4 Edge cases

- **Document not a MarkSpec file.** Files that are not `.md` or a supported
  source extension MUST return an empty `TextEdit[]` (no-op). The
  `isMarkspecFile` guard already exists in `lsp/context.ts`.
- **Parse errors.** A file that fails to parse cannot be safely formatted. The
  server MUST return an empty `TextEdit[]` and surface a diagnostic (already
  happens via the parser's existing diagnostic emission).
- **Concurrent edits.** Between the client's request and the server's response,
  the user may have typed. Standard LSP semantics apply: the client's
  `applyEdit` rebases over concurrent changes. The server's job is to return
  edits valid for the document version it received.

### 3.5 Performance

`core/formatter/` is fast — the existing CLI runs it on hundreds of files per
second. The LSP request runs it on a single buffer, so latency MUST be < 50ms
even on documents with hundreds of entries. No additional caching is required;
the existing parser's incremental update path (already used by the diagnostic
pipeline) keeps the WorkspaceIndex warm.

### 3.6 Options analysis

| Alternative                                              | Rejected because                                                                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LSP wraps the existing `core/formatter/` (**chosen**)    | Single source of truth between CLI and LSP. No drift risk. The formatter is already pure (content in, content out) — perfect fit for LSP `TextEdit[]` return shape.         |
| LSP gets its own re-implementation of the formatter      | Two implementations to keep in sync. Inevitable drift. The CLI tests would not cover the LSP path. Rejected outright.                                                       |
| Server writes the formatted text to disk; client reloads | Bypasses the editor's buffer / undo stack / cursor preservation. Hostile to interactive editing. Violates the LSP contract that the server returns edits, not writes files. |
| Client shells out to `markspec format` for every save    | Process spawn overhead per save (~50-200ms). Worse latency, no benefit. The LSP server is already running and has the buffer in memory.                                     |

---

## 4. `markspec/profile` custom request (must-have)

### 4.1 Method

```text
markspec/profile
```

A custom (non-standard) LSP request method, namespaced under `markspec/` so
clients that do not recognize it return a method-not-found error without side
effects.

### 4.2 Request params

```typescript
interface MarkspecProfileParams {
  /** Workspace URI to query. When omitted, server uses its rootUri. */
  uri?: string;
}
```

### 4.3 Response shape

```typescript
interface MarkspecProfileResponse {
  /** Profile chain — outermost to innermost (project profile last). */
  readonly chain: ReadonlyArray<ProfileLayer>;

  /** Effective merged profile (the topmost element in the chain). */
  readonly effective: EffectiveProfile;
}

interface ProfileLayer {
  readonly name: string;
  readonly source: string; // file path or package specifier
}

interface EffectiveProfile {
  readonly name: string;
  readonly types: ReadonlyArray<ProfileType>;
}

interface ProfileType {
  /** Type name (e.g. "stakeholder-requirement", "software-architecture-description"). */
  readonly name: string;

  /** Display-ID prefix (e.g. "STK_AEB_", "SAD_"). */
  readonly prefix: string;

  /** Category bucket for coloring — "req" / "spec" / "test" / etc. */
  readonly category: string;

  /** Color metadata, per palette. */
  readonly color: {
    readonly print: string;  // hex e.g. "#4477AA"
    readonly screen: string; // hex e.g. "#0077BB"
  };
}
```

The shapes match the existing `EffectiveProfile` returned by
`core/profile/mod.ts`. The LSP wrapper serializes the in-memory representation
to JSON; no additional metadata.

### 4.4 Caching and invalidation

The server caches the response from the last `core/profile` load. It MUST
invalidate the cache when:

- The profile chain changes (`.markspec.yaml` or `project.yaml` modified —
  detected via `workspace/didChangeWatchedFiles` or the existing periodic
  reload).
- The workspace root changes (typically only on editor restart).

On cache invalidation, the server fires a `markspec/profileChanged` notification
so clients can refresh derived state (e.g., the VS Code preview's color
stylesheet).

### 4.5 Empty / no-profile case

When no profile is loaded (no `.markspec.yaml`, file-local mode), the response
returns:

```json
{ "chain": [], "effective": { "name": "(none)", "types": [] } }
```

Clients MUST tolerate this shape and fall back to neutral / monochrome
rendering.

### 4.6 Why a custom request, not a standard one

There is no standard LSP method that returns "the user's project schema
metadata." This is a domain-specific concept; encoding it via overloaded use of
`workspace/configuration` or `workspace/symbol` would be a misuse. Namespacing
under `markspec/` is the standard LSP convention for domain-specific extensions
(e.g., `rust-analyzer/syntaxTree`, `typescript/goToProjectConfig`).

---

## 5. Inline information surfaces (should-have)

Three capabilities that surface traceability information inline in the editor
without consuming dedicated screen real estate.

### 5.1 `textDocument/codeLens`

For each entry, the server emits up to two code lenses positioned on the entry's
title line:

| Lens                      | Displayed              | Click action                                   |
| ------------------------- | ---------------------- | ---------------------------------------------- |
| `↑ N dependents`          | when N > 0             | Opens the LSP `references` view for the entry. |
| `↓ Satisfies: ID (Title)` | per `Satisfies:` value | Opens the LSP `definition` for the target.     |

Backing: the server already has the workspace index (`lsp/workspace.ts`).
Dependent counts are computed via the same scan that powers
`textDocument/references` — no new walking. Satisfies chains are read directly
from the entry's `rawAttributes`.

Configurable via client capabilities: clients that don't want code lens can omit
the registration; per-lens enable is controlled by client-side settings (in VS
Code: `markspec.lsp.codeLens.dependents` / `…satisfies`, declared in
vscode-authoring §10).

### 5.2 `textDocument/inlayHint`

For each entry, the server emits inline hints positioned after the title:

| Hint             | Displayed                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `: <type>`       | When the entry has no explicit `Type:` attribute and the parser resolved one from the display-ID prefix. |
| `(N dependents)` | When N > 0 and the dependents code lens is disabled (avoids duplication).                                |

Hints are tooltip-clickable to drill into details. Same backing as code lens —
no separate computation.

### 5.3 `textDocument/documentLink`

For each `Verified-by:` attribute value that looks like a file path
(`src/foo.rs:test_name`, `tests/sit_bar.rs`), the server emits a document link
covering the path portion. Clicking jumps to the file (and line, when present).

Backing: parser already extracts `Verified-by:` values as `rawAttributes`. The
link resolver does a simple path-shape match — paths with a `.rs`, `.kt`, `.c`,
`.cpp`, etc. extension and optional `:line` or `:line:col` suffix. Non-path
values (display IDs) are not linkified (those are handled by the existing
`textDocument/definition`).

### 5.4 Performance

All three capabilities share the same in-memory data the validator already
walks. No new full-graph computations. Per-document cost is O(entries in
document) — sub-millisecond for typical files. The server SHOULD compute them
lazily on first request, then cache until the document changes.

### 5.5 Lazy-loading constraint

Inline surfaces MUST NOT pull in `core/compiler/` or any module that loads
Typst, ReqIF, or the full traceability graph builder. The data they need
(dependent counts, resolved types) is already maintained by the existing LSP
`WorkspaceIndex` from the validation pipeline.

This is the CLAUDE.md "single binary, lazy loading" discipline — adding inline
surfaces MUST NOT inflate the LSP server's cold-start cost.

---

## 6. Capability negotiation and opt-out

### 6.1 Server-side

The server advertises capabilities in its `initialize` response based on a
static configuration — there is no runtime feature flag for "which capabilities
to expose." Clients that don't want a capability simply don't send requests for
it (standard LSP semantics).

The `initialize` capabilities object grows by:

```typescript
{
  // existing capabilities preserved...
  documentFormattingProvider: true,
  codeLensProvider: { resolveProvider: false },
  inlayHintProvider: { resolveProvider: false },
  documentLinkProvider: { resolveProvider: false },
}
```

`resolveProvider: false` means the server returns fully-resolved data in the
initial response; no follow-up `resolve` calls are needed. This is appropriate
because the data is cheap to compute (see §5.4).

### 6.2 Client-side (informational)

Clients control per-capability opt-out via their own settings. The
`markspec-vscode-authoring.md` settings table (§10) lists VS Code-specific
toggles for code lens and inlay hints. Other editors use their standard LSP
client configuration (e.g., Neovim's `vim.lsp.handlers` overrides).

The server does not honor client-side opt-out flags directly — the LSP
protocol's design is that clients simply don't send requests for capabilities
they've disabled.

---

## 7. Performance and binary size

### 7.1 Lazy loading discipline

Per CLAUDE.md "Single binary, lazy loading": `markspec validate` MUST NOT load
Typst WASM; `markspec book build` MUST NOT load ReqIF. The same discipline
applies to the LSP server.

Adding the capabilities specified here MUST NOT pull in:

- `render/typst/` (Typst WASM, ~5MB)
- `render/mustache/` (rendering pipeline)
- `book/site/` (HTML book generator)
- `deck/` (slide layouts)
- `render/captions/` (figure/table numbering)

All new capabilities delegate to `core/formatter`, `core/profile`,
`core/parser`, and `core/validator` — modules already loaded by the existing LSP
server.

### 7.2 Cold-start budget

Current `markspec lsp` cold-start (from process spawn to `initialize` response)
is < 200ms on typical hardware. Adding the v1 capabilities MUST keep cold-start
under 250ms — the new modules are small (<10KB each).

### 7.3 Per-request latency budgets

| Capability                  | Budget | Rationale                                                                         |
| --------------------------- | ------ | --------------------------------------------------------------------------------- |
| `textDocument/formatting`   | < 50ms | Format-on-save must feel instant. Existing CLI formatter benchmarks support this. |
| `markspec/profile`          | < 10ms | Cached response; serialization only.                                              |
| `textDocument/codeLens`     | < 20ms | Per-document; reuses already-indexed data.                                        |
| `textDocument/inlayHint`    | < 20ms | Same.                                                                             |
| `textDocument/documentLink` | < 10ms | Per-document; regex match on already-parsed attribute values.                     |

These are warm-cache budgets. Cold cache (immediately after
`workspace/didChangeContent`) may be 2-3× higher; that's acceptable because
clients debounce these requests.

---

## 8. Skew detection (no new surface)

The existing `markspec/version` notification (toolchain-distribution.md §3.3)
already advertises release + core-schema version. No additional skew-detection
mechanism is introduced — clients that mismatch on core-schema use the existing
channel to surface a warning.

The new capabilities defined here ride on the same versioning contract: a client
built against core-schema N cannot rely on capabilities introduced in
core-schema N+1. Capability discovery via `initialize` is the standard LSP
mechanism for graceful degradation.

---

## 9. clig.dev / LSP conformance

The LSP server is not a CLI surface, so clig.dev applies indirectly. The
relevant disciplines:

| Discipline             | How the new capabilities comply                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| Deterministic output   | Formatter is already deterministic; LSP wrapper preserves that property.                                        |
| Same code path as CLI  | Both `markspec format` (CLI) and `textDocument/formatting` (LSP) call `core/formatter`. Single source of truth. |
| No interactive prompts | LSP is a structured protocol; no prompts on the server side.                                                    |
| Stream conventions     | LSP uses JSON-RPC over stdio; server writes to stdout (protocol), debug log to stderr. Already enforced.        |
| `NO_COLOR`             | Server doesn't write color output; N/A. Clients honor `NO_COLOR` in their own rendering.                        |
| Stable contract        | Capability set is additive — capabilities are added, never removed without a version-major change.              |

---

## 10. Open questions

Capped at five. None blocks v1 implementation.

1. **`markspec/profileChanged` notification cadence.** §4.4 fires on every
   profile reload. If a future workspace watcher fires on _every_
   `.markspec.yaml` keystroke, clients re-render colors on every char. Debounce
   on the server side, debounce in clients, or both?

2. **Inlay-hint vs. code-lens overlap policy.** §5.2's "dependents count" hint
   is suppressed when the code lens for the same data is enabled. Is that
   suppression server-side (server omits the hint) or client-side (server emits
   both, client picks)? Server-side is simpler but less flexible.

3. **Document-link line-number heuristic.** §5.3 matches `path:line:col`
   patterns. Some languages use other separators (`.rs#L42`). Is the pattern
   recognizer profile-configurable, or fixed to the common `:line:col` form?

4. **Formatter idempotence under partial edits.** §3.1 returns a minimal-diff
   `TextEdit[]`. If the user is mid-edit on a partial entry block (missing
   trailer, unfinished title), what's the safe behavior? Format only complete
   entries, leaving partials untouched? Or skip formatting entirely when any
   entry in the file fails to parse? §3.4 says "empty edits on parse error" —
   but that's harsh for files where one entry is broken and twenty others are
   fine.

5. **Per-capability core-schema gating.** §8 says capabilities ride on the
   release version. Is each new capability tied to a core-schema increment (so
   the profile schema's `markspec-schema:` pin can warn "this profile was
   written for a tool without `markspec/profile`")? Or are LSP capabilities
   orthogonal to the core-schema contract?

---

## Annex — Cross-reference summary

| Section here        | Source                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2 Capability set   | LSP 3.17 spec; `packages/markspec/lsp/server.ts` existing capabilities; [markspec-vscode-authoring.md §1, §4.4, §6.1](markspec-vscode-authoring.md) |
| §3 Formatting       | `core/formatter/`; `markspec format` CLI; CLAUDE.md "Deterministic output"                                                                          |
| §4 markspec/profile | `core/profile/`; [markspec-profile-schema.md](markspec-profile-schema.md); rust-analyzer / typescript-language-server custom-request conventions    |
| §5 Inline surfaces  | LSP `textDocument/codeLens` / `inlayHint` / `documentLink`; existing `WorkspaceIndex` (`lsp/workspace.ts`)                                          |
| §7 Performance      | CLAUDE.md "Single binary, lazy loading"; existing cold-start measurements                                                                           |
| §8 Skew detection   | [markspec-toolchain-distribution.md §3.3](markspec-toolchain-distribution.md); existing `markspec/version` notification                             |
