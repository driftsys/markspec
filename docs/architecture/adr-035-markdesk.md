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
  and shall reject any request that carries a non-loopback `Host` header. It
  shall also reject any request that lacks the per-launch nonce token, except a
  CORS preflight answered under SAD_DESK_0011. It owns the workspace and index
  service, the forge client, the agent adapters, and the secrets bridge. It
  ships inside the one `markspec` binary rather than as an additional compile
  target. When `--root` is given, the backend shall search only that folder and
  its parent folders for a MarkSpec project and shall exit with status 1,
  without printing a handshake, when it finds none; it shall not fall back to
  the process working directory. When `--exit-on-stdin-eof` is given, the
  backend shall stop and exit with status 0 when its standard input closes.

      Id: 01M4JXA5WQQY7VB23KBP23TRFK

- [SAD_DESK_0010] Origin allowlist for browser callers

  The desk backend shall reject with HTTP status 403 any request that carries an
  `Origin` header which is not an origin passed with `--allow-origin` or one of
  the three built-in Tauri origins: `https://tauri.localhost`,
  `http://tauri.localhost`, and `tauri://localhost`. The backend shall not apply
  this rejection to a request that carries no `Origin` header.

      Id: 01M55JJWA39HEQ7P5T2WXAQ805

- [SAD_DESK_0011] CORS preflight answered before the token check

  The desk backend shall answer an `OPTIONS` request from an allowed origin with
  HTTP status 204 before the backend checks the bearer token. The response shall
  carry `Access-Control-Allow-Origin` set to the request `Origin`,
  `Access-Control-Allow-Methods: GET, OPTIONS`,
  `Access-Control-Allow-Headers: Authorization`, `Access-Control-Max-Age: 600`,
  and `Vary: Origin`.

      Id: 01M55JNXSH4RRPH8Z1SQ6M1V54

- [SAD_DESK_0012] Read endpoints for documents, rendered entries, and source
  text

  The desk backend shall serve `GET /api/v1/documents?path=P`,
  `GET /api/v1/entries/{id}/html`, and `GET /api/v1/files?path=P`. The backend
  shall answer HTTP status 404 with code `not-found` for a `path` that is not
  the project-relative path of a Markdown or source file holding at least one
  entry without an `origin`, and shall require a `.md` extension for
  `/documents`. The backend shall answer HTTP status 400 with code `bad-request`
  for a request without `path`.

      Id: 01M5607VYZ373VZA9KAAYW1VZF

The per-launch nonce token is the only credential of the desk API. The `Origin`
check limits which browser pages can call the API; it does not authenticate the
caller. The `tauri://localhost` origin is shared by every Tauri application on
the machine, a non-browser local process can send any `Origin` value, and
`--allow-origin http://localhost:5173` admits any page served on that port. The
nonce check therefore stays mandatory and must never be relaxed because the
`Origin` check passed.

- [SAD_DESK_0003] React UI in a thin Tauri shell with the binary as sidecar

  The UI shall live in `apps/markdesk/` as a React and Vite application. A thin
  Rust shell in `apps/markdesk/src-tauri/` shall own only the window, the
  installer, the updater, OS keychain access, the OAuth deep link, the folder
  picker, the recent-products store, and the sidecar lifecycle. The shell shall
  bundle the `markspec` binary as a sidecar, launch it with
  `desk --serve --port 0 --exit-on-stdin-eof --root` and the workspace path, and
  read the one-line JSON handshake (`url`, `token`, `apiVersion`, `root`) from
  its stdout, where `root` is the absolute path of the discovered product root.
  In development the shell shall run the sidecar from this repository's sources,
  not from a release.

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

  The assistant shall drive Claude Code, Codex, and GitHub Copilot (the
  standalone `copilot` CLI), detected on PATH and in the standard install
  directories, headless, with the MarkSpec MCP server (`markspec mcp`) attached.
  Agents shall only propose changes; MarkDesk shall apply a change only on the
  author's explicit accept. Every write — the author's or an agent's — shall
  pass `markspec fmt` before the view refreshes. With no agent CLI installed,
  the assistant column shall show the setup card until the author dismisses the
  card. After the author dismisses the card, the assistant column shall show a
  pointer to Settings. Every other feature shall still work without an agent
  CLI.

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
SAD_DESK_0002 and SAD_DESK_0004: `markspec desk --serve` with its first read
endpoints (`GET /api/v1/tree`, `GET /api/v1/entries/{id}`; the document,
rendered-entry, and source-text endpoints follow under SAD_DESK_0012), loopback
binding, the nonce token, and the stdout handshake. It is hidden from
`markspec --help` until the API is a stable surface. It reuses the MCP server's
project service (`mcp/project.ts` — discovery, profile, delivered corpus, locked
upstreams, and an mtime-refreshed compiled cache) instead of building a third
index.

`GET /api/v1/tree` returns a flat graph, not a nested tree: `roots` (display
IDs), one node per entry, and one edge per (child, parent) pair, with a
refinement link kept over a verification link. Its size is proportional to
entries plus links, and the UI expands it lazily. A nested tree would rebuild an
entry under each of its parents, so its size grows with the number of
root-to-leaf paths, which is exponential in depth on diamond-shaped
traceability. Edges may form cycles; the lowest display ID of each link cycle
that has no parent outside the cycle is added as an extra root, so every entry
is reachable from a root. The change was breaking, so `DESK_API_VERSION`
became 2. The read-path endpoints of SAD_DESK_0012, project-relative file paths,
and the `root` handshake field were again breaking, so it is now 3. The contract
is `schemas/desk-api.json`.

### As built: the shell and the read path

The first MarkDesk app (DESK-1 local variant and DESK-6) is read-only. It opens
a product from a folder on the computer, shows the traceability graph in the
navigator, and shows the whole document an entry lives in.

- **Opening.** The shell shows a native folder picker and keeps up to 10 recent
  products (folder path and name) in `recents.json` in the OS app-data
  directory. MarkDesk writes nothing into the product folder. At launch it
  reopens the most recent product; a start screen appears only when there is
  none. A product menu lists recent products and "Open folder…". Choosing a
  subfolder opens the enclosing product, and the recent list stores the `root`
  from the handshake. A folder that is not a product is reported in one plain
  sentence; the sidecar's stderr sits behind a "Details" toggle.
- **Sidecar lifecycle.** One sidecar runs per opened product. When the author
  switches product, the shell starts the new sidecar first and stops the old one
  only after the new handshake succeeds. The shell holds the sidecar's stdin
  open, so the sidecar exits when the shell exits or crashes
  (`--exit-on-stdin-eof`). Debug builds run `packages/markspec/main.ts` with
  Deno and pass `--allow-origin http://localhost:5173`; release builds run the
  bundled binary and pass no `--allow-origin`, because the server has the Tauri
  origins built in. The shell checks the handshake `apiVersion` before the new
  sidecar replaces the old one: on a mismatch it stops the new sidecar, keeps
  the current product, and reports a version mismatch. The UI repeats the check
  against the version its client was generated against. A sidecar that exits
  before its handshake means "not a product" only when it exits with code 1 and
  prints "No MarkSpec project found"; any other early exit is a start failure.
- **Rendering.** The server renders documents with the book renderer
  (`renderChapterHtml`); the UI contains no Markdown renderer. The renderer
  gives each entry block a stable anchor and wraps display IDs in a
  cross-reference element carrying `data-display-id`: in every attribute value
  except `Labels`, each ID token (found with an ID-token pattern, not a
  whitespace split) that is in `knownDisplayIds`, and IDs in body prose that
  resolve to a known entry. `knownDisplayIds` is passed only by the desk
  endpoints; the `markspec book build` call sites are unchanged. The UI turns
  cross-references into navigation and opens ordinary web links in the system
  browser.
- **Images.** Images with a `data:` source are kept. Every other `<img>`,
  including `http(s)` sources, is replaced by a placeholder box with its alt
  text, because the content security policy blocks remote images and an `<img>`
  request cannot carry the bearer token.
- **Entries from outside the product.** Federated upstream entries and
  profile-delivered entries stay in the navigator, marked with their origin.
  Selecting one shows the single-entry rendering from
  `GET /api/v1/entries/{id}/html` with a read-only origin line, and no Source
  drawer. Entries that live in source-code doc comments also use the
  single-entry rendering.
- **Navigator.** A node's children are the nodes whose edge points to it.
  Refining children (`satisfies`, `derived-from`) come first, then verifying
  children (`verifies`) after a separator, each group in natural display-ID
  order. Every selection is a history step with Back and Forward.
- **Source drawer.** It shows the exact file text in Plex Mono with line
  numbers. In dark mode it follows the sheet paper colour, in line with
  SAD_DESK_0008.
- **Assistant column.** MarkDesk detects the three assistants each time a
  product opens. When no assistant is selected and the author has not dismissed
  the setup card, the column shows the card: one row per assistant with its
  state, a "Use" button for a ready assistant (and for an installed Copilot,
  whose sign-in only a Test can confirm), the sign-in command with a Copy button
  and a "Re-check" button for any assistant in the needs-sign-in state (a
  signed-out Claude Code or Codex, or a Copilot whose sign-in is not confirmed),
  and an "Install…" control that opens the install guide in Settings. "Not now"
  dismisses the card and the dismissal is stored. After dismissal, the column
  shows a pointer with a "Set up" button that opens Settings. When an assistant
  is selected, the column shows its name and state ("Ready", "needs sign-in", or
  "is not installed"), a disabled prompt box, and a "Settings" button. Settings
  holds the assistant choice, the Test, and the install guide. MarkDesk shows
  install and sign-in commands but never runs them and never opens a terminal.
  Prompt features and the propose and accept flow arrive with #837.
- **Assistant detection and Test.** The shell finds each assistant on PATH and
  in the standard install directories. A signed-out check is available for
  Claude Code and Codex (`codex login status` exits 1 when signed out and 0 when
  signed in). Copilot sign-in cannot be checked without running it, so only a
  successful Test confirms it, and only a `failed` Test result clears that
  confirmation. A Test returns `{ outcome, reply, error }` with `outcome` one of
  `ok`, `usage`, `timeout`, `cancelled`, or `failed`. The Claude Code Test
  arguments omit `--max-turns`, which the installed `claude --help` does not
  list. The Test runs in a newly created directory with mode 0700 that must not
  already exist. On Unix, each assistant process runs in its own process group,
  and a timeout or cancel kills the whole group with
  `/bin/kill -KILL --
  -<pgid>`, because npm and Homebrew launchers start the
  real binary as a grandchild process. On Windows only the direct child is
  killed (Windows testing is #838). None of the three CLIs offers a folder-trust
  skip flag in its help output. The UI never receives an error field from the
  assistant provider: a failed detection shows the three assistants as not
  installed with the detail "Detection failed", and a failed settings load uses
  the defaults. Settings is reachable only from an open product.
- **Visual reference.** "Rendered like the published book" means the output of
  `markspec book build` with `theme/markspec.css`, not the mdBook site, which
  does not render entry blocks (ADR-033). IBM Plex fonts are bundled as WOFF2.
- **Toolchain.** The UI uses npm, a client generated by openapi-typescript from
  `schemas/desk-api.json` (committed, checked for staleness by
  `scripts/check_desk_client.sh`), and openapi-fetch. `apps/markdesk/` is not a
  Deno workspace member. A path-filtered workflow
  (`.github/workflows/markdesk.yaml`) type-checks, tests, and builds the UI,
  runs `scripts/check_desk_client.sh`, and on Linux runs `cargo fmt --check`,
  `cargo clippy --all-targets -- -D warnings`, `cargo test`, and
  `cargo test -- --ignored` for the shell; the ignored tests start the real
  sidecar from `packages/markspec/main.ts` with Deno. The main CI workflow
  checks that the compiled `markspec` binary serves the desk handshake and stops
  when its stdin closes. Tests drive the UI against a mocked client; there is no
  end-to-end test of the real window, only a manual smoke test in
  `apps/markdesk/README.md`.
- **Known limitation.** The UI caches each rendered document for the session of
  an opened product. A document does not refresh after its file is edited
  outside MarkDesk until the product is opened again.

## Alternatives rejected

### A nested tree with stubs for shared subtrees

Keeping the nested response and emitting each shared subtree once, with `ref`
stubs elsewhere, would still hand the UI a recursive shape. Which parent holds
the full subtree would depend on sort order, which is harder to reason about
than a flat graph.

### Keeping `apiVersion` 1 for the graph response

The version constant exists to signal breaking changes, and the handshake
carries it so the shell can detect a mismatch. Changing the tree shape without a
bump would hide the break.

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

### A fixed Vite dev origin, a `*` wildcard, or preflight header validation

The Origin policy (SAD_DESK_0010, SAD_DESK_0011) rejected three simpler shapes.
Always allowing `http://localhost:5173` would admit any local page on that port;
the nonce would still protect the data, but the opt-in `--allow-origin` flag
keeps the default policy at the Tauri origins only. Answering every preflight
with `*` would remove the Origin check as an additional protection layer next to
the Host guard and the nonce. Validating `Access-Control-Request-Method` and
`Access-Control-Request-Headers` on preflight adds code without adding
protection, because the browser enforces the response headers itself.

### Forge sign-in and clone as the first step

DESK-1 as written starts with forge sign-in and a clone. Both need the GitLab
connection that DESK-5 (propose) also needs, so they ship together with DESK-5.
The first release opens a folder that is already on the computer.

### A start screen on every launch

Showing the start screen at every launch was rejected. Reopening the last
product, with a product menu for the others, gets the author back to work in
zero steps.

### One entry per page in the Spec view

Rendering only the selected entry and its links was rejected because it does not
match "renders as the published book". The Spec view shows the whole document,
scrolled to the entry and highlighted. The single-entry rendering remains as the
fallback for entries in source files and for upstream and delivered entries.

### Free or local assistants for the next story

An opencode plus Ollama or local-model option was considered and dropped. Cloud
free tiers raise data-governance concerns, OpenCode Zen still needs an account,
and local models need 16 to 32 GB of RAM. The assistant-setup story supports
Claude Code, Codex, and GitHub Copilot only, detects installation and sign-in,
offers a guided installation, and never installs silently.

### The mdBook site as the visual reference

The published site is built by mdBook (ADR-033), which does not render entry
blocks, so it cannot be the parity target for the Spec view.

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
