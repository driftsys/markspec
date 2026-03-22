# MarkSpec

A Markdown flavor for traceable industrial documentation, and a CLI toolchain
that processes it.

> Early development. The [language specification](docs/specification.md) is
> stable. Tooling is not yet functional.

## Tools

```text
markspec doc build       # document PDF
markspec doc export      # JSON export
markspec doc validate    # check ID graph, gaps
markspec doc format      # format Markdown, assign ULIDs
markspec doc insert      # scaffold requirement block

markspec book build      # PDF + HTML book
markspec book dev        # live preview

markspec deck build      # presentation PDF
markspec deck dev        # live preview

markspec lsp             # LSP server
markspec mcp             # MCP server
```

## Packages

```text
packages/
  core/     ← parser, validator, Typst WASM, Mustache, config
  cli/      ← the markspec binary (subcommands: doc, book, deck)
  lsp/      ← LSP server
  mcp/      ← MCP server
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
