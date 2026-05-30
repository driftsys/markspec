# MarkSpec — Toolchain Distribution

Status: Draft (Prompt 3 of the next-gen refactor)\
Date: 2026-05-16\
Scope: How the MarkSpec toolchain is packaged and installed — the single binary,
the `lsp install` / `mcp install` surfaces, version/schema alignment, and
config-write safety\
Builds on: [markspec-core-data-model.md](markspec-core-data-model.md) (Prompt 1
output), [markspec-profile-schema.md](markspec-profile-schema.md) (Prompt 2 —
`markspec-schema:` core-schema pin), ADR-001 (Markdown format), ADR-003
(information & traceability model), ADR-004 (authoring model), ADR-005 (CLI
architecture — subcommand dispatch, single binary), clig.dev (Command Line
Interface Guidelines)

This spec freezes the **distribution model** (one bundled binary, three
entrypoints), the **install surfaces** for the LSP and MCP servers
(`markspec lsp install` / `markspec mcp install`), the **version / schema
alignment** contract, and the **config-write safety** rules every installer
obeys. It does not specify the e2e test strategy
([markspec-e2e-test-strategy.md](markspec-e2e-test-strategy.md)) or the end-user
documentation (Prompt 4 — `markspec-user-docs.md`, which cites this spec for
install surface details).

The companion file
[markspec-e2e-test-strategy.md](markspec-e2e-test-strategy.md) exercises the
install commands specified here in its Ring 3 integration tests;
cross-references are flagged inline.

> **ADR-002bis note.** The Prompt-3 brief lists "ADR-002bis" as an input.
> ADR-002bis does not exist as a separate file (core-data-model §6 Open Question
> 1). This spec treats ADR-002 §Part 1 and core-data-model §2.3/§3.3 as the
> authoritative trailers reference, consistent with core-data-model's resolution
> of the same dangling citation.

---

## 0. Terminology

| Term                    | Meaning in this spec                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **binary**              | The single `markspec` executable produced by `deno compile packages/markspec/main.ts`.                                                               |
| **entrypoint**          | One of the three runtime faces of the binary: the CLI, the LSP server (`markspec lsp`), the MCP server (`markspec mcp`).                             |
| **install surface**     | The `markspec lsp install` / `markspec mcp install` command set that writes editor / client configuration.                                           |
| **adapter**             | A per-target module that knows one editor's or client's config location, format, and managed-region convention.                                      |
| **managed block**       | A delimited, idempotent region the installer owns inside an otherwise user-owned config file (§6).                                                   |
| **core-schema version** | The core-data-model contract version the binary implements (core-data-model §3.1/§5; [markspec-profile-schema.md §8.2](markspec-profile-schema.md)). |
| **scope**               | Where config is written: `user` (the editor's per-user config) or `workspace` (the project, next to a workspace marker — see §4.4).                  |

---

## 1. Scope and boundaries

In scope: the binary's shape, the `install` command surfaces, what they write
and how safely, and how versions line up.

Out of scope (and their owners):

- **Editor-extension internals** (the VS Code extension's activation, the LSP
  client wiring) — that code already exists (`editors/vscode/`); this spec
  governs only the CLI-side `install` commands and how they interact with it.
- **Quickstart / "single command to install"** narrative — Prompt 4
  (`markspec-user-docs.md`) owns the user-facing story and **cites this spec**
  for the surface.
- **Profile distribution** (`markspec profile add`, npm/git specifiers) — owned
  by ADR-008 §2 and [markspec-profile-schema.md §2](markspec-profile-schema.md).
  This spec covers _toolchain_ distribution, not _profile_ distribution.
- **Release engineering** (signing, notarization, the GitHub release pipeline) —
  Stage 2 / out of scope; §3.4 only fixes the version contract the pipeline must
  honor.

---

## 2. One bundled binary, three entrypoints

### 2.1 Decision

MarkSpec ships **one** executable. The CLI, the LSP server, and the MCP server
are three entrypoints of the same binary, dispatched by subcommand (ADR-005
§subcommand dispatch; CLAUDE.md "One compile target — one binary"):

```bash
deno compile packages/markspec/main.ts   # → markspec   (the only artifact)

markspec <subcommand> …                  # CLI
markspec lsp                             # LSP server (stdio JSON-RPC)
markspec mcp                             # MCP server (stdio JSON-RPC)
```

`lsp/server.ts` and `mcp/server.ts` are dynamically imported by `main.ts` only
when their subcommand runs (lazy loading — CLAUDE.md "Single binary, lazy
loading"; `markspec check` never loads the MCP SDK). There is **no**
`markspec-lsp` or `markspec-mcp` artifact.

### 2.2 Options analysis — packaging

| Alternative                                          | Rejected because                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One bundled binary, subcommand dispatch (**chosen**) | One artifact to download, one version to reason about, zero version-skew between CLI/LSP/MCP. Lazy import keeps cold-start fast (ADR-005). Matches the already-shipped architecture.                                                             |
| Separate `markspec-lsp` / `markspec-mcp` binaries    | Three artifacts, three version numbers, three PATH entries — the exact version-skew the Prompt-3 Context flags ("Separate binaries create version-skew the user has to debug"). The editor would need to discover and version-match three files. |
| npm/PyPI wrapper that shells to a runtime            | Reintroduces a runtime dependency (Deno/Node) on the user's machine — defeats the `deno compile` single-file-distribution property. Acceptable later as an _additional_ channel, not the primary artifact.                                       |
| Editor extension bundles its own server build        | Forks the server: the extension's bundled copy drifts from the CLI the user runs in the terminal. The extension must spawn the _same_ binary the user installed (the current `editors/vscode` design already does this — §4.3).                  |

---

## 3. Version and schema alignment

### 3.1 One release ⇒ one binary ⇒ one core-schema version

Because the three entrypoints are one binary, their versions are **identical by
construction** — there is no CLI-vs-LSP-vs-MCP version to reconcile. The single
axis that matters across the toolchain _and_ the profile layer is the
**core-schema version**.

- The binary embeds, and `markspec --version` reports, both the **release
  version** (semver of the `markspec` package) and the **core-schema version**
  (the integer contract version of core-data-model.md it implements —
  [markspec-profile-schema.md §8.2](markspec-profile-schema.md); core-data-model
  §3.1 determinism contract / §5 round-trip invariants).

  ```text
  $ markspec --version
  markspec 0.5.0 (core-schema 1)
  ```

- A profile's `markspec-schema:` pin
  ([markspec-profile-schema.md §8.2](markspec-profile-schema.md)) is checked
  against the binary's core-schema version at profile load. This spec defines
  only the _binary side_ of that contract: the binary MUST advertise its
  core-schema version both on `--version` and in the LSP/MCP handshake (§3.3).

### 3.2 Options analysis — version axes

| Alternative                                                     | Rejected because                                                                                                                                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release version + core-schema version, CLI=LSP=MCP (**chosen**) | The only two axes that vary independently (the tool can patch without the data model changing). One binary makes CLI/LSP/MCP version identity free.                                                        |
| Independent LSP / MCP protocol versions surfaced to the user    | The user never picks an LSP/MCP protocol; the editor negotiates it. Surfacing it as a user-facing version is noise. Protocol capability is negotiated in the handshake (§3.3), not versioned for the user. |
| Core-schema folded into the release semver major                | Couples the data-model contract to the tool's release cadence; a tooling bugfix that bumps semver would falsely imply a model change. core-data-model §3.1 freezes the model independently of the tool.    |

### 3.3 Skew detection

- **LSP.** The server reports its release + core-schema version in an
  `initialize` result `serverInfo` extension and as a `markspec/version`
  notification. A client whose expected core-schema differs SHOULD surface a
  visible warning (the existing `editors/vscode` status bar is the natural home;
  the _mechanism_ — version in the handshake — is fixed here, the UI is
  extension territory).
- **MCP.** The server advertises the same pair in the MCP `serverInfo` /
  `initialize` response. An MCP client on a mismatched core-schema MUST be able
  to detect it from that field.
- **CLI.** `markspec doctor` (ADR-008 §9) reports binary core-schema vs the
  active profile's `markspec-schema:` pin and flags a mismatch
  (`PROFILE-SCHEMA-001`,
  [markspec-profile-schema.md §8.2](markspec-profile-schema.md)).

### 3.4 Release contract (boundary only)

Release engineering is out of scope, but the version contract it must honor is
fixed here: a release publishes exactly one binary per platform; all carry the
same release + core-schema version; the core-schema version changes only at a
core-data-model major boundary (core-data-model §3.1). The platform set and
signing are Stage-2 concerns.

---

## 4. LSP install surface

### 4.1 Command

```text
markspec lsp install --editor=<id> [--scope=user|workspace]
                      [--binary-path=<path>]
                      [--print] [--force] [--no-color]
```

| Flag                   | Meaning                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--editor=<id>`        | Required. One of the first-class adapter ids (§4.2). An unknown id errors with the list of known ids + a typo suggestion (clig.dev "suggest corrections").                                                                                                                                                                              |
| `--scope`              | `workspace` (default when a workspace marker — `markspec.yaml`, `.markspec.yaml`, or `project.yaml` — is found by walking up, §4.4) or `user`. Explicit flag overrides detection.                                                                                                                                                       |
| `--binary-path=<path>` | Override the binary path written into the adapter's managed block. Default is the invoked name `markspec` (relying on `PATH`), which survives package-manager upgrades — see §8 Q3 resolution. Use the flag for isolated builds (e.g. `./dist/markspec`) or Nix-store / asdf-shim layouts where pinning a resolved path is intentional. |
| `--print`              | Write nothing; print the exact config block to **stdout** and the target path to **stderr** (clig.dev stream split). The universal fallback for any editor without an adapter.                                                                                                                                                          |
| `--force`              | Apply the change without the interactive confirm (and the only way to write in a non-TTY context — §6.4).                                                                                                                                                                                                                               |
| `--no-color`           | Standard clig.dev color control; `NO_COLOR` env honored identically.                                                                                                                                                                                                                                                                    |

### 4.2 First-class editor adapters (v1)

| `--editor` id | Target                                  | Config artifact                                                 |
| ------------- | --------------------------------------- | --------------------------------------------------------------- |
| `vscode`      | VS Code / VS Codium                     | Verifies the MarkSpec extension is the LSP host; see §4.3.      |
| `neovim`      | Neovim (`nvim-lspconfig` or native LSP) | A Lua managed block in the user's MarkSpec LSP config fragment. |

Any other editor — including Zed — uses `--print` only (a documented, copyable
snippet). Two LSP adapters ship in v1; adding more later is additive and does
not change the command surface (Open Question 1).

### 4.3 VS Code is extension-hosted

VS Code does not get a config-file write. The shipped `editors/vscode` extension
is already the LSP host and already spawns the bundled binary
(`serverOptions.ts` resolves the binary; the extension is "a thin LSP client" —
`editors/vscode/src/extension.ts`). `markspec lsp install --editor=vscode`
therefore **verifies and reports**, it does not mutate config:

- Confirms the extension is installed and points at _this_ binary (path +
  core-schema match, §3.3).
- On mismatch, prints the remediation (the `markspec.server.path` setting value)
  rather than silently rewriting user settings.

This keeps the single-binary invariant (§2): the extension must spawn the same
binary the user installed, never a divergent bundled copy (§2.2 last row).

### 4.4 Workspace detection

`--scope=workspace` resolves the project root by walking up from the working
directory for any of three workspace markers, in priority order:

1. `markspec.yaml` (typed configuration)
2. `.markspec.yaml` (dotfile configuration)
3. `project.yaml` (legacy / mid-adoption convention)

The first two match the profile loader's discovery rule
([markspec-profile-schema.md §2.2](markspec-profile-schema.md)). `project.yaml`
is accepted in addition so repos that have a project descriptor but have not yet
adopted `.markspec.yaml` are still treated as workspaces for install purposes
(§8 Q2 resolution). The installer does not parse the contents of any marker —
its presence is the signal; the actual schema is the profile loader's concern.

No marker found and `--scope` not given explicitly → the installer selects
`user` scope and prints
`markspec lsp install: no workspace marker found,
using --scope=user` to stderr
(it never silently writes a workspace file into a non-project directory —
clig.dev "explicit over implicit"). The exact stderr phrasing is fixed here so
automation can rely on it.

---

## 5. MCP install surface

### 5.1 Command

Symmetrical with §4:

```text
markspec mcp install --client=<id> [--scope=user|workspace]
                      [--binary-path=<path>]
                      [--print] [--force] [--no-color]
```

`--binary-path` has identical semantics to the LSP install variant (§4.1 table):
default is the invoked name `markspec`; pass an explicit path for isolated
builds or path-pinning layouts.

### 5.2 First-class client adapters (v1)

| `--client` id    | Target                | Config artifact                                                                       |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `claude-desktop` | Claude Desktop        | A JSON managed region under `mcpServers` in the Claude Desktop config file.           |
| `vscode`         | VS Code (Copilot/MCP) | Verifies the shipped extension's MCP provider; see §5.3. No `.vscode/mcp.json` write. |

Any other client — including Cursor — uses `--print` to emit the stdio server
definition (`command: markspec`, `args: ["mcp"]`) for manual paste. Two MCP
adapters ship in v1; promotion to a first-class adapter is the topic of Open
Question 1.

### 5.3 VS Code MCP is provider-hosted

The shipped extension registers the MCP server via the stable VS Code 1.101+
`lm.registerMcpServerDefinitionProvider` API (`editors/vscode/src/extension.ts`;
`mcpDefinition.ts`) — VS Code sees the same binary as the LSP with **no**
`.vscode/mcp.json`. `markspec mcp install --client=vscode` therefore verifies
the provider is active and the binary matches (§3.3); it does not write a config
file (parity with §4.3).

### 5.4 Stdio definition is canonical

Every MCP adapter writes the same logical definition — a stdio server spawning
`markspec mcp`. The adapter's only per-client knowledge is _where_ and in _what
serialization_ that definition lives. The definition content is identical across
clients (the single-binary invariant again).

---

## 6. Config-write safety

The Prompt-3 Context is explicit: "Config-write is destructive by default in
most tools. The installer must preview every change, never overwrite without
explicit `--force`, and produce config the user can read and verify." This
section is normative.

### 6.1 The managed-block model

An installer never owns the user's config file. It owns a single delimited,
idempotent **managed block** inside it:

- **JSON targets** (Zed, Cursor, Claude Desktop, VS Code-when-applicable): a
  single object under a stable, namespaced key (e.g. an `markspec` entry inside
  `mcpServers`/`lsp`), written via structure-preserving edit — sibling keys, key
  order, comments (JSONC) preserved. Never a whole-file rewrite.
- **Block-style targets** (Neovim Lua): a fenced region delimited by
  `-- >>> markspec (managed) >>>` … `-- <<< markspec (managed) <<<`. Content
  between the fences is owned by the installer; everything else is the user's.

### 6.2 Idempotence

Re-running `install` with the same binary + scope is a **no-op**: the managed
block is regenerated and compared; if byte-identical, nothing is written and the
command reports "already up to date" (exit 0). This makes `install` safe to run
from a provisioning script repeatedly (mirrors the determinism discipline of
core-data-model §3.1 — same input, same output).

### 6.3 Preview, confirm, backup

Default (TTY, no `--force`):

1. Compute the new managed block; diff it against the current file.
2. Print the unified diff to **stderr** (clig.dev: diagnostics/preview to
   stderr; the only thing on stdout is the block itself under `--print`).
3. Prompt for confirmation. On decline, exit 0 having written nothing.
4. On accept: write a timestamped sidecar backup
   (`<config>.markspec-bak-<ISO8601>`) **then** apply the edit. Report both
   paths on stderr.

`install` is never destructive: the only bytes it changes are inside the managed
block; the backup makes even that reversible.

### 6.4 Non-TTY behavior (clig.dev)

When stdin is not a TTY (CI, provisioning, piped):

- `--force` present → apply (still writes the backup first). Used by automation.
- `--force` absent → **error, exit non-zero**, with the remediation message
  ("re-run with `--force`, or `--print` and apply manually"). A missing
  confirmation in a non-interactive context is an **error, not a silent
  default** (clig.dev "No interactive prompts when stdin is not a TTY";
  AGENTS.md CLI rules). `--print` always works in any context (it writes
  nothing).

### 6.5 Options analysis — write model

| Alternative                                                                 | Rejected because                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Managed block, idempotent, preview+backup (**chosen**)                      | Re-runnable, reviewable (the diff is the audit surface — same property ADR-008 §Context wants for profiles), reversible, and minimally invasive. Matches "produce config the user can read and verify".                                   |
| Whole-file template the installer owns                                      | Destroys user customizations on every run — the exact "destructive by default" failure the Context rejects.                                                                                                                               |
| Separate dedicated file the installer fully owns (e.g. `markspec.lsp.json`) | Clean ownership, but many targets (Claude Desktop, Zed, Neovim) have a single config file with no include mechanism; a separate file would simply be ignored. Falls back to `--print` for those — strictly worse UX than a managed block. |
| Blind deep-merge into the target's JSON                                     | Cannot express Neovim Lua or comment-bearing JSONC; merge conflicts resolve silently and unreviewably; no clean removal path. The managed block gives a single region to add, update, or delete atomically.                               |

### 6.6 Uninstall / update

`markspec lsp install --editor=<id> --remove` (and the MCP analogue) deletes
exactly the managed block (and, for JSON, the namespaced key), leaving the rest
of the file and a backup. Update is just re-running `install` (§6.2). No
separate `update` verb (clig.dev: fewer verbs; idempotent install subsumes it).

---

## 7. clig.dev conformance

The install surface follows the project CLI standard (AGENTS.md §"CLI standard:
clig.dev"; <https://clig.dev/>):

| Rule (clig.dev / AGENTS.md)              | How `install` complies                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| stdout = data, stderr = messaging        | `--print` block → stdout; diffs, prompts, paths, progress → stderr.                                                      |
| Exit codes (0 ok, 1 error, 2 warnings)   | 0 = applied or already-up-to-date or user-declined; 1 = unknown target / write failure / non-TTY without `--force`.      |
| `-h`/`--help` everywhere, examples first | `markspec lsp install --help` leads with the common invocation, then flags. `markspec help lsp install` works.           |
| Suggest corrections on typos             | Unknown `--editor`/`--client` id → "did you mean `<closest>`?" + full list.                                              |
| `NO_COLOR` + `--no-color`                | Diff/preview coloring suppressed; honored identically.                                                                   |
| No interactive prompts when not a TTY    | §6.4 — error, not prompt; `--force` is the automation path.                                                              |
| Progress for >1s operations              | Adapter resolution / backup / write are sub-second; if a future adapter is slow it must print a progress line to stderr. |
| Deterministic, reviewable artifacts      | §6.2 idempotence; the managed block is byte-stable for a given binary + scope.                                           |

---

## 8. Open questions

Capped at five (Prompt-3 constraint). Three were resolved on 2026-05-25; their
decisions are recorded inline so the rationale stays with the question.

1. **Adapter growth policy.** v1 ships two LSP + two MCP adapters (§4.2/§5.2 —
   narrowed from the original three-per-surface scope on 2026-05-19). Who owns
   the criteria for promoting an editor from `--print` to a first-class adapter,
   and is the adapter set versioned with the binary or independently extensible
   (a hooks-style contribution, cf. ADR-008 §10)?
2. **`markspec.yaml` vs `.markspec.yaml` as the workspace marker.** §4.4 treats
   either as the project root signal, matching the profile loader. If a repo has
   `project.yaml` but no `.markspec.yaml`, is that still a workspace for
   install-scope purposes? (Touches
   [markspec-profile-schema.md §2.2](markspec-profile-schema.md) discovery.)

   **Resolved (2026-05-25): `project.yaml` also counts as a workspace marker for
   `markspec lsp install` / `markspec mcp install`.** §4.4 now accepts any of
   `markspec.yaml`, `.markspec.yaml`, or `project.yaml` as the workspace signal.
   Rationale: repos mid-adoption frequently have a `project.yaml` (the legacy /
   cross-tool descriptor) but have not yet added `.markspec.yaml`; treating
   those as `--scope=user` by default forces an explicit flag for the common
   case. The looser rule does **not** change profile loading — the profile
   loader still uses only the first two
   ([markspec-profile-schema.md §2.2](markspec-profile-schema.md)). The install
   command is the only consumer that reads `project.yaml` as a workspace signal;
   its presence is checked, its contents are not parsed.
3. **Binary self-path resolution.** Adapters must write the path to _this_
   binary. Under `deno compile` that is `Deno.execPath()`, but a symlinked /
   PATH-shimmed install may resolve to the shim. Should the installer write the
   resolved real path, the invoked name (`markspec`, relying on PATH), or make
   it a flag?

   **Resolved (2026-05-25): the invoked name (`markspec`) is the default; an
   explicit `--binary-path=<path>` flag is the override.** Writing a resolved
   real path by default silently pins the editor to a specific binary version —
   a real failure mode under version managers (asdf, mise, brew-cellar,
   Nix-store) where `brew upgrade markspec` would leave the editor launching the
   stale cellar path. The invoked name survives upgrades cleanly; §3.3's runtime
   skew detection is the safety net when multiple `markspec` binaries end up on
   `PATH`. The flag covers the genuine pinning cases (Nix-store,
   `./dist/markspec` development builds, multi-version installs) without making
   the default clever.

4. **Backup retention.** §6.3 writes a timestamped backup on every apply.
   Unbounded backups accumulate. Is pruning (keep last N) in scope for the
   installer, or left to the user / OS?

   **Resolved (2026-05-25): no pruning in v1; backup retention is the user's /
   OS's responsibility.** Backups land only on _actual_ apply (idempotence §6.2
   skips no-op re-runs), so accumulation is slow. Silent deletion of user files
   contradicts §6.3's "preview every change" ethos. If real complaints arrive,
   an opt-in `--keep-backups=N` flag can be added in a follow-up — YAGNI until
   then.

5. **VS Code verify-only vs offer-to-fix.** §4.3/§5.3 make VS Code verify-only.
   When the extension is absent entirely, should `install` attempt
   `code --install-extension`, or strictly stay out of the editor's extension
   manager and only print instructions?

   **Resolved (2026-05-25): print instructions only; never invoke
   `code --install-extension`.** Stays consistent with §4.3's already-committed
   "verifies and reports, does not mutate config" posture for VS Code.
   Auto-invoking `code --install-extension` invites a long tail of edge cases —
   VS Codium and Cursor share the `code` binary but route to different
   marketplaces; proxy/firewall blocks; publisher-id mismatches — and the
   extension install bypasses the diff/preview/backup contract that §6.3 makes
   load-bearing. The user cost of running one extra command is trivial; the
   support tail of doing it ourselves is not.

---

## Annex — Cross-reference summary

| Section here                  | Source                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| §2 Single binary              | ADR-005 §subcommand dispatch; CLAUDE.md "One compile target"; `packages/markspec/main.ts`                                      |
| §3 Version / schema alignment | core-data-model §3.1/§5; [markspec-profile-schema.md §8.2](markspec-profile-schema.md); ADR-008 §9                             |
| §4 LSP install                | `editors/vscode/src/extension.ts`, `serverOptions.ts`; clig.dev; [markspec-profile-schema.md §2.2](markspec-profile-schema.md) |
| §5 MCP install                | `editors/vscode/src/mcpDefinition.ts`; `packages/markspec/mcp/server.ts`; clig.dev                                             |
| §6 Config-write safety        | Prompt-3 Context; clig.dev; AGENTS.md §CLI rules; core-data-model §3.1 (determinism analogy)                                   |
| §7 clig.dev conformance       | <https://clig.dev/>; AGENTS.md §"CLI standard: clig.dev"                                                                       |
| Ring 3 exercises §4/§5        | [markspec-e2e-test-strategy.md](markspec-e2e-test-strategy.md) §2/§6                                                           |
