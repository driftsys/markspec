# MarkSpec

[![CI](https://github.com/driftsys/markspec/actions/workflows/ci.yaml/badge.svg)](https://github.com/driftsys/markspec/actions/workflows/ci.yaml)
[![JSR](https://jsr.io/badges/@driftsys/markspec)](https://jsr.io/@driftsys/markspec)
[![npm](https://img.shields.io/npm/v/@driftsys/markspec)](https://www.npmjs.com/package/@driftsys/markspec)
[![Docs](https://img.shields.io/badge/docs-driftsys.github.io%2Fmarkspec-blue)](https://driftsys.github.io/markspec/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Markdown flavor for traceable industrial documentation, and a CLI toolchain
that processes it.

> Early development. The [language specification](docs/spec/language.md) is
> stable. Tooling is not yet functional.

## Tools

```text
markspec format          # stamp ULIDs, normalize attributes
markspec validate        # check broken refs, missing Ids
markspec compile <paths> # build traceability graph → JSON
markspec export          # JSON → csv, reqif, yaml
markspec insert          # scaffold requirement block

markspec doc build       # document PDF
markspec book build      # PDF + HTML book
markspec book dev        # live preview
markspec deck build      # presentation PDF
markspec deck dev        # live preview

markspec lsp             # LSP server
markspec mcp             # MCP server
```

## Modules

```text
core/      ← parser, validator, compiler, reporter, formatter
render/    ← Typst WASM, Mustache substitution, captions
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

**Entry blocks** — a list item with a typed ID and an indented body:

```markdown
- [SRS_BRK_0001] Sensor input debouncing

  The sensor driver shall debounce raw inputs to eliminate electrical noise
  before processing.

  Id: SRS_01HGW2Q8MNP3\
  Satisfies: SYS_BRK_0042\
  Labels: ASIL-B
```

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

**In-code entries** — requirements in doc comments, same format:

```rust
/// [SRS_BRK_0001] Sensor input debouncing
///
/// The sensor driver shall reject transient noise shorter
/// than the configured debounce window.
///
/// Id: SRS_01HGW2Q8MNP3 \
/// Satisfies: SYS_BRK_0042 \
/// Labels: ASIL-B
#[test]
fn swt_brk_0001_debounce_filters_noise() {
    // test implementation
}
```

**Mustache variables** — `{{project.name}}` substitution from `project.yaml`,
resolved at build time.

## License

[MIT](LICENSE)

---

Part of the [DriftSys](https://github.com/driftsys) ecosystem.
