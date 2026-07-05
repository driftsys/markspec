# MarkSpec

[![CI](https://github.com/driftsys/markspec/actions/workflows/ci.yaml/badge.svg)](https://github.com/driftsys/markspec/actions/workflows/ci.yaml)
[![JSR](https://jsr.io/badges/@driftsys/markspec)](https://jsr.io/@driftsys/markspec)
[![npm](https://img.shields.io/npm/v/@driftsys/markspec)](https://www.npmjs.com/package/@driftsys/markspec)
[![Docs](https://img.shields.io/badge/docs-driftsys.github.io%2Fmarkspec-blue)](https://driftsys.github.io/markspec/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Markdown flavor for traceable industrial documentation, and a CLI toolchain
that processes it.

> Pre-1.0. The toolchain is functional end-to-end for authoring, validation,
> traceability, rendering, and editor / agent integration. The
> [language specification](docs/spec/language/language.md) and wire formats
> (compile-output JSON, lockfile) may still change without
> backward-compatibility shims until 1.0.

## Tools

**Authoring and validation**

```text
markspec fmt                # stamp ULIDs, normalize attributes
markspec check              # check broken refs, missing Ids, duplicates
markspec lint               # prose analysis (modal verbs, EARS, passive, …)
markspec insert <type>      # append a scaffolded entry to a file
markspec create <type>      # scaffold a new entry block (stdout)
markspec next-id <type>     # next available display ID for a type
```

**Traceability and querying**

```text
markspec compile <paths>    # build traceability graph → JSON
markspec show <id>          # show one entry by display ID or ULID
markspec context <id>       # walk the Satisfies chain upward
markspec dependents <id>    # list entries that depend on an entry
markspec report <kind>      # traceability matrix or coverage report
markspec export <format>    # compile-graph → json, yaml, csv
```

**Lockfile and external sync**

```text
markspec lock               # generate or refresh markspec.lock
markspec sync status        # group bound entries by remote_state
markspec sync log           # tail per-system sync log (NDJSON)
markspec sync show <id>     # full sync state for one bound entry
```

**Profiles and diagnostics**

```text
markspec profile show       # show active profile chain
markspec doctor             # project health check
```

**Rendering**

```text
markspec doc build          # single document → PDF (Typst WASM)
markspec book build         # multi-chapter → static HTML site
```

**Editor and agent integration**

```text
markspec lsp                # LSP server (stdio JSON-RPC)
markspec lsp install        # print LSP config for vscode, neovim, zed
markspec mcp                # MCP server (stdio JSON-RPC)
markspec mcp install        # write/print MCP config for claude,
                            #   copilot, cursor, opencode, vscode
```

**Not yet implemented** (registered but exit with an error):

```text
markspec export reqif       # ReqIF XML export
markspec book dev           # live preview with hot reload
markspec deck build         # slides → PDF via Touying/Typst
markspec deck dev           # live slide preview
```

## Modules

```text
core/      ← parser, validator, compiler, reporter, formatter
render/    ← Typst WASM, entry block rendering, Mustache substitution, captions
book/      ← multi-file PDF + HTML book builder
deck/      ← Touying-based slide deck builder
cli/       ← subcommand handlers
lsp/       ← LSP server
mcp/       ← MCP server
```

One binary. One install. Three rendering targets (document, book, deck).

## Markdown extensions

MarkSpec extends CommonMark with constructs that render as plain Markdown on
GitHub and GitLab — no tooling required to read.

**Entry blocks** — a list item with a display ID and an indented body:

```markdown
- [SRS_BRK_0001] Sensor input debouncing

  The sensor driver shall debounce raw inputs to eliminate electrical noise
  before processing.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\
  Satisfies: SYS_BRK_0042\
  Labels: ASIL-B
```

Every entry carries a single `Id:` attribute. A ULID value identifies an
**identified** entry (content the project authors); a URI value (`urn:`, `doi:`,
`pkg:`, `https:`, …) identifies a **referenced** entry (citation of an external
artifact). The entry's type (requirement, test, unit, standard, dependency, …)
is inferred by the active profile from the display-ID prefix (`SRS_` →
`type: software-requirement`); compliance vocabulary comes from the active
profile.

In PDF output, entry blocks render as admonition-style blocks with
profile-driven color-coding by type, label pills on the title line, and italic
metadata with dashed-underline cross-references. See
[`docs/examples/entry-rendering.md`](docs/examples/entry-rendering.md) for a
full showcase.

**Table captions** — emphasized paragraph above a pipe table:

```markdown
_Table: Sensor thresholds_

| Sensor   | Min | Max  |
| -------- | --- | ---- |
| Pressure | 0   | 1023 |
```

**Figure captions** — emphasized paragraph below an image:

```markdown
![System overview](overview.svg)

_Figure: High-level architecture of the braking system_
```

**In-code entries** — entries in doc comments, same format:

```rust
/// [SRS_BRK_0001] Sensor input debouncing
///
/// The sensor driver shall reject transient noise shorter
/// than the configured debounce window.
///
/// Id: 01HGW2Q8MNP3RSTVWXYZABCDEF \
/// Satisfies: SYS_BRK_0042 \
/// Labels: ASIL-B
#[test]
fn swt_brk_0001_debounce_filters_noise() {
    // test implementation
}
```

**Mustache variables** — `{{project.name}}` substitution from `project.yaml`,
resolved at build time.

## Install

See [`docs/guide/installation.md`](docs/guide/installation.md) for the VS Code
extension, the macOS / Linux install script, the
[Windows PowerShell install script](docs/guide/installation.md#windows-powershell-install-script),
manual binary downloads, and the Deno install path.

## License

[MIT](LICENSE)

---

Part of the [DriftSys](https://github.com/driftsys) ecosystem.

<!-- git-std:bootstrap -->

## Post-clone setup

Run `./bootstrap` after `git clone` or `git worktree add`.
