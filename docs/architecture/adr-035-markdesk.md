# ADR-035: MarkDesk desktop authoring app

**Status:** Accepted **Date:** 2026-10-10 **Related:** ADR-005 (CLI
architecture), ADR-009 (Core / Profile Boundary), ADR-023 / ADR-028 (MCP
server), ADR-029 (whole-document formatting)

## Context

MarkSpec's authoring surfaces today assume an engineer: the CLI, the LSP server,
the VS Code extension, and the MCP server for coding agents. The people who own
what a product must do — product owners, business analysts, safety engineers,
architects — share the profile of Marie, the technical-writer persona of the
[authoring-experience spec](../spec/internal/markspec-authoring-experience.md):
domain-fluent, not a coder, WYSIWYG-minded. For them the editor, Markdown, Git,
and MarkSpec syntax are four barriers in front of the one thing they came to do.
MarkDesk is a desktop app that removes all four. Its spirit and journeys are in
[docs/product/markdesk.md](../product/markdesk.md); this ADR records how it is
built.

Two structural forces shaped the decisions:

- **The core is TypeScript, and it is large and tested.** `packages/markspec/`
  holds about 56k lines of production TypeScript (301 files) backed by about 75k
  lines of tests (349 files) — better than one line of test per line of code.
  The parser, validator, formatter, compiler, profile system, and MCP server
  that MarkDesk needs all live there. Any architecture that does not reuse that
  code verbatim starts by re-earning its correctness.
- **MarkSpec ships one binary.** `deno compile packages/markspec/main.ts`
  produces the only artifact; the LSP and MCP servers are lazily-imported
  subcommands of it (see the toolchain-distribution spec §2, which rejected
  separate binaries for version skew). A desktop app should consume that
  artifact, not fork it.

## Decision

MarkDesk is a React UI in a thin Tauri shell, talking over a loopback HTTP API
to a new `markspec desk --serve` subcommand of the existing binary. The core
stays TypeScript. Everything lives in this repository.

- [SAD_DESK_0001] Three-pane authoring scope for 1.0

  MarkDesk 1.0 shall present three panes: a navigator that shows the product as
  the traceability graph read top-down (stakeholder → system → software,
  hazards, tests), an assistant column, and a document pane with three modes —
  Spec (rendered, read-only), Edit (the entry form), and Source (a read-only
  drawer). The entry form shall be the only editing surface. MarkDesk shall not
  embed a WYSIWYG editor, a code editor, or an LSP client. Block editing of free
  prose is deferred to 2.0.

      Id: 01M4JXA5WQDWD7C2QPSBRJJ4JB

- [SAD_DESK_0002] Backend as a lazily-loaded desk subcommand

  The MarkDesk backend shall be `markspec desk --serve`, implemented under
  `packages/markspec/desk/` and dynamically imported by `main.ts` like the `lsp`
  and `mcp` subcommands, so no other command pays for it. It shall serve an HTTP
  and WebSocket API bound to 127.0.0.1 only, on a port chosen with `--port 0`,
  and shall reject any request that lacks the per-launch nonce token or carries
  a non-loopback `Host` header. It owns the workspace and index service, the
  forge client, the agent adapters, and the secrets bridge. It ships inside the
  one `markspec` binary rather than as an additional compile target.

      Id: 01M4JXA5WQQY7VB23KBP23TRFK

- [SAD_DESK_0003] React UI in a thin Tauri shell with the binary as sidecar

  The UI shall live in `apps/markdesk/` as a React and Vite application. A thin
  Rust shell in `apps/markdesk/src-tauri/` shall own only the window, the
  installer, the updater, OS keychain access, and the OAuth deep link. The shell
  shall bundle the `markspec` binary as a sidecar, launch it with
  `desk --serve --port 0 --root` and the workspace path, and read the one-line
  JSON handshake (`url`, `token`, `apiVersion`) from its stdout. In development
  the shell shall run the sidecar from this repository's sources, not from a
  release.

      Id: 01M4JXA5WQCDQ77Y81K0G90BGK

- [SAD_DESK_0004] desk-api.json as the single API contract

  `schemas/desk-api.json` (OpenAPI 3.1) shall be the contract between the UI and
  the backend. The UI's typed client shall be generated from it, never written
  by hand, and the backend's tests shall validate their responses against it.

      Id: 01M4JXA5WQD6D97TT6AMP89X9C

- [SAD_DESK_0005] Core stays TypeScript

  MarkDesk shall reuse `packages/markspec/core/` unchanged through the desk
  backend. There shall be no Rust port of the core and no WASM build of it as
  part of MarkDesk; the existing WASM migration path for `parser/` and
  `formatter/` stays an independent, later decision.

      Id: 01M4JXA5WQ6BDBEQMXKB1F81Y1

- [SAD_DESK_0006] One Forge interface, GitLab first

  Forge access shall go through one `Forge` interface with a GitLab REST
  implementation first and a GitHub implementation as preview. The API shall
  cover repository listing, merge or pull request creation, request status, and
  whoami; `git` shall do clone, branch, commit, and push. MarkDesk shall not
  depend on the `glab` or `gh` CLIs. Authentication shall use the browser device
  flow or a pasted token, stored in the OS keychain; the same token shall serve
  both the REST API and git-over-HTTPS through a credential helper. When a
  GitLab token lacks `api` scope, proposing shall fall back to push options
  (`-o merge_request.create`).

      Id: 01M4JXA5WPQBZ6PVSCPE0WH0BB

- [SAD_DESK_0007] Agents propose, the author accepts, fmt gates every write

  The assistant shall drive Claude Code and GitHub Copilot CLI, detected on
  PATH, headless, with the MarkSpec MCP server (`markspec mcp`) attached. Agents
  shall only propose changes; MarkDesk shall apply a change only on the author's
  explicit accept. Every write — the author's or an agent's — shall pass
  `markspec fmt` before the view refreshes. With no agent CLI installed, the
  assistant column shall be empty and every other feature shall still work.

      Id: 01M4JXA5WP5KAYFWTZARAGH031

- [SAD_DESK_0008] Two token layers and three typographic registers

  Styling shall use two token layers generated from `theme/tokens.yaml`:
  `--ms-*` for MarkSpec content, unchanged and identical to what the book
  renders, and `--md-*` for app chrome (the `app:` block). Chrome shall be
  monochrome with one ink-coloured primary action; colour shall only carry
  meaning. One window shall hold three registers: the document in Plex Serif
  15/24 on an A4 sheet, source in Plex Mono 12/19 on the same paper with only
  the gutter recessed, and the app in Plex Sans 13/18. Paul Tol shall remain the
  only categorical palette — vibrant in light mode, Tol light in dark mode,
  because vibrant blue reaches only 2.6:1 on a dark ground. The Source view
  shall not be a dark code editor.

      Id: 01M4JXA5WP1WZ22HJYJHF6N3R4

- [SAD_DESK_0009] One repository for CLI and app

  MarkDesk shall live in this repository. CI workflows for `apps/markdesk/`
  shall be path-filtered, as `vsix-verify.yaml` already is for the VS Code
  extension, and app releases shall use their own tag prefix (for example
  `markdesk-v*`), which the CLI's `v*` release trigger never matches.

      Id: 01M4JXA5WN174DN8AKM7WCMYRG

The walking skeleton that ships with this ADR implements the first slice of
SAD_DESK_0002 and SAD_DESK_0004: `markspec desk --serve` with two read endpoints
(`GET /api/v1/tree`, `GET /api/v1/entries/{id}`), loopback binding, the nonce
token, and the stdout handshake. It is hidden from `markspec --help` until the
API is a stable surface. It reuses the MCP server's project service
(`mcp/project.ts` — discovery, profile, delivered corpus, locked upstreams, and
an mtime-refreshed compiled cache) instead of building a third index.

## Alternatives rejected

### All-Rust (Tauri UI plus a Rust port of the core)

A single-language Rust stack would give the smallest binary and one toolchain.
It would also mean re-implementing about 56k lines of TypeScript whose behaviour
is pinned by more than its own weight in tests, then keeping two cores in
agreement — or freezing the TypeScript one, which still serves the CLI, the LSP,
the MCP server, and the npm package. The port buys nothing an author can see.
The shell is Rust because Tauri is; the logic is not.

### Two repositories (CLI and app)

Separate repositories would isolate CI and release cadence. Both costs are
already solved here: path-filtered workflows keep app CI off CLI changes and
vice versa, and a separate tag prefix gives the app its own release line. What
two repositories would add is real cost — the app's dev mode runs the backend
from source, the API contract would have to be versioned and published across a
repository boundary, and every backend change would need a coordinated pair of
merge requests.

### Solid instead of React

Solid's fine-grained reactivity is attractive for a large tree view, but React
is what the existing 56k-line TypeScript codebase's contributors and the coding
agents that help write it are most reliable with. Settled; not to be
re-litigated per component.

### Embedding an editor or an LSP client

An embedded Monaco/CodeMirror with the MarkSpec LSP would be quick to build and
would turn MarkDesk into a second VS Code — exactly what it is not. Engineers
keep their editor; Marie gets a form.

### Wrapping `glab` / `gh`

Shelling out to the forge CLIs would save writing a REST client but adds two
installs, two auth stores, and output formats MarkDesk does not control. The
REST surface MarkDesk needs is four calls.

### A separate `markspec-desk` binary

A desk-only compile target (`desk/main.ts`) would make the sidecar smaller: it
would leave out Typst, the tree-sitter grammars, and every subcommand the desk
does not call. It would not reduce version skew — the app bundles its own
backend either way, so the engineers' installed `markspec` can always differ
from it. It was rejected for 1.0 because the assistant attaches `markspec mcp`
to the agents it runs: with the full binary as sidecar, the desk, `fmt`, and the
agents' MCP server are one file at one version, and the release pipeline is
unchanged (toolchain-distribution spec §2). If sidecar size becomes a problem, a
desk-only entry point is a small, local change that this decision does not
block.

## Consequences

- Authors get a door into MarkSpec repositories that needs no knowledge of
  Markdown, Git, or MarkSpec syntax, while the repository content stays exactly
  what the CLI produces.
- The backend reuses the core verbatim; every rule the CLI enforces, the desk
  enforces, with no second implementation to drift.
- `markspec` gains a long-running HTTP server. It binds loopback only and
  demands a nonce, but it is a new attack surface on the author's machine and
  each new endpoint must keep that posture.
- The repository gains a Node/npm toolchain (Vite, React) and a Rust toolchain
  (Tauri) alongside Deno, each confined to `apps/markdesk/`.
- The MCP project service becomes shared infrastructure for two servers. Before
  the desk grows writes or a WebSocket, it should move out of `mcp/` into a
  module both import.
- The bundled binary is the full `markspec` CLI, so the desktop install is
  larger than a purpose-built backend would be.

## Open questions

These are deliberately left open.

1. **Offline propose queue.** Should a proposal made without network be queued
   and pushed later, and how does the author see a queued proposal?
2. **SQLite index cache.** Does the desk need the on-demand SQLite index
   evaluated in ADR-020 for large products, or is the in-memory compiled cache
   enough for 1.0?
3. **Multi-repository products via Repofolio.** How does the navigator show a
   product whose stakeholder, system, and software layers live in different
   repositories?
