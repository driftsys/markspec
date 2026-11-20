# ADR-029 — Whole-Document Markdown Formatting

## Status

Accepted (2026-07-02). Closes #649. Amended by #984: the line width and the line
ending come from `.editorconfig`. Amended by #978: the prose wrapping is a
`.markspec.yaml` setting, `always` by default.

## Context

`markspec fmt` formatted only entry-block mechanics — ULID stamping, trailer
indentation, trailing backslashes, modal-keyword case. Surrounding Markdown
(overview chapters, context prose, headings, tables, lists) passed through
verbatim, and tables were silently skipped (#649). Authors expect `markspec fmt`
to be _the_ formatter for MarkSpec documents; today a second tool (dprint) is
required for the prose.

## Decision

`markspec fmt` formats the entire Markdown document by default, Markdown files
only, with a fixed style, via the embedded dprint-markdown WASM plugin
(`@dprint/formatter` host, exact-pinned `@dprint/markdown@0.22.1`), lazily
loaded on the fmt code path.

Style: `lineWidth` 80 by default (soft target — table rows, links/references,
and inline code may exceed it and are never split), `textWrap` always, emphasis
underscores, strong asterisks, dashes for lists. A project can change three
values: the line width and the line ending through `.editorconfig`, and the
prose wrapping through `.markspec.yaml` (see below); every other value is fixed.
dprint's `<!-- dprint-ignore -->` directives work as a per-block opt-out, but an
ignore-start/end pair MUST NOT span an entry block (segments format
independently).

Entry-block coexistence (approach B): prose segments outside entry blocks and
each entry's AST-canonical body go through dprint; title lines and trailers
never do. Every dprint rewrite is gated by a CommonMark-semantic equivalence
comparator (`markdownSemanticallyEquivalent`, mdast-based: positions elided,
whitespace runs in text values collapsed) — soft-wrap positions and delimiter
styles compare equal, content changes do not. A rejected rewrite is kept as-was
and reported as MSL-F012 (info). ADR-015's byte-verbatim `astEquivalent` is
unchanged and still guards §5.2 body emission (MSL-F900).

Because a body is formatted dedented and re-indented afterward, the body pass
budgets its `lineWidth` at `width − indent` (floor 20, via a per-call
`ProseFormatOptions.lineWidth` override) so a wrap point landing near the line
width dedented does not exceed it once re-indented — keeping the result in
agreement with a whole-file dprint view of the same content (e.g. the external
dprint CLI on this repo's own tree).

### Style source: `.editorconfig` (amendment, #984)

`markspec fmt` reads the line width and the line ending of each Markdown file
from its `.editorconfig` files, with the same rules as `prim fmt`, so a file
formatted by one tool passes the check of the other:

- `max_line_length` sets the line width. The value is read as prim's `ec4rs`
  reads it, as a Rust `usize`: a non-negative integer, optionally with a leading
  `+`, is used as given (`0` included). `off`, `unset`, an invalid value, or no
  value gives 80.
- `end_of_line` sets the line ending of the output. `lf` and `crlf` are used as
  given. `cr`, an invalid value, an unset key, and a file with no
  `.editorconfig` give `lf`, as in prim (`Style::default()`). A CRLF file is
  therefore written with LF unless `end_of_line = crlf` is set. Before this
  amendment, `fmt` kept the line ending detected in the file.
- The `.editorconfig` files are read from the file's directory upward, and the
  walk stops after the first file whose preamble holds `root = true`. Nearer
  files override farther ones, and a later matching section overrides an earlier
  one. A glob without `/` matches the file name in any directory; a glob with
  `/` matches the path relative to the `.editorconfig` file. A glob that ends
  with `/` matches the files of that directory, and a `[set]` never spans a `/`,
  as in `ec4rs`.
- A line that is not a comment, a section header or a `key = value` pair makes
  the whole chain invalid, and the defaults apply. A file that cannot be read is
  skipped.

Core does no file I/O. `core/config/editorconfig.ts` parses the files through an
injected `readFile` and returns `{ lineWidth, endOfLine }`; the CLI (`fmt`, the
`check` MSL-F010 gate) and the LSP (`onDocumentFormatting`) resolve the style
per file and pass it to `format()` as `FormatOptions.lineWidth` and
`FormatOptions.endOfLine`. `fmt` and `check` use the same resolver, so they
agree on drift. When the only drift is the line ending, MSL-F010 says so: it
names `end_of_line` when `.editorconfig` sets it, and the LF default otherwise.
Paths passed to the resolver must be absolute; core never reads the current
directory. A nested entry that `fmt` formats on its own is formatted at the line
width minus its marker column, so re-indented lines stay within the width.
MarkDesk proposals use the resolved line width, so an applied body passes
MSL-F010; they splice only the target body and do not change line endings.

LSP formatting uses the resolved line width but keeps the line ending of the
editor buffer. Editors convert inserted text to the document's own line ending
(VS Code `files.eol`), so an LF rewrite of a CRLF buffer would be sent again on
every request. Line endings in the editor are left to the editor setting and to
`markspec fmt` and `check`. The LSP caches the resolver for the session and
drops it when a watched `.editorconfig` changes; that change does not reload a
profile. The repository's `.gitattributes` sets `* text=auto eol=lf`, so a
Windows checkout does not turn every file into line-ending drift.

Not read from `.editorconfig`: `insert_final_newline` (`fmt` always ends a
Markdown file with one newline) and `trim_trailing_whitespace`.

### Prose wrapping: `.markspec.yaml` `format.text-wrap` (amendment, #978)

Corpora migrated from a requirements tool store each paragraph on one line, and
block editors change only the lines their author touched. With the `always`
wrapping, a one-word edit near the start of a paragraph re-wraps every following
line, so the review diff shows the whole paragraph changed. The opt-outs above
do not scale: `<!-- dprint-ignore -->` is per block, and `exclude:` also drops
Id stamping and trailer normalisation.

One setting, in the `.markspec.yaml` `format:` section, selects the prose
wrapping of a project:

```yaml
format:
  text-wrap: always # always | maintain | never
```

`always` is the style above. It stays the default and the canonical MarkSpec
style, and a project without the setting is unchanged. `maintain` keeps the
author's line breaks; `never` joins each paragraph and list item onto one line.
The values are dprint-markdown's `textWrap` values, passed as a per-call
override, so one cached formatter serves every project. Only `always` uses the
`.editorconfig` line width. `.markspec.yaml` has no width key: a
`format.line-width` key is refused with a pointer to `.editorconfig`, and any
other key or value is a `MARKSPEC-YAML-003` error. `fmt`, the `check` MSL-F010
gate, the LSP and MarkDesk proposals apply the wrapping of the file's project.
Hard breaks, tables, code, titles and trailers are never re-wrapped, and
idempotency holds for every value (tested). The semantic-equivalence gate
(MSL-F012) already treats soft-wrap positions as equal and is unchanged.

prim has no wrap-mode setting. A project that also runs `prim fmt` must exclude
the files formatted with `maintain` or `never` from prim, in `.primignore`, or
the two formatters re-wrap each other's output. If prim gains a matching setting
(see driftsys/prim#227 for the shared style contract), MarkSpec follows its name
and values.

Rejected: a `.markspec.yaml` `line-width` key (a second width source that
disagrees with prim's `.editorconfig` value); a `project.yaml` key
(`project.yaml` holds project metadata under a closed schema); a per-file
directive (does not scale, as `dprint-ignore`); exposing more dprint options (no
demand, and it would fragment the canonical style beyond wrapping).

Idempotency (`format ∘ format === format`) is a tested hard requirement —
MSL-F010 depends on it.

## Consequences

- One-time reformat churn on existing projects (pre-1.0 no-migration policy);
  `check`'s MSL-F010 now covers prose drift.
- Deliberately-unformatted files use `project.yaml` `exclude:`.
- A future `@dprint/markdown` bump changes the canonical form — version bumps
  are release-notes-worthy events, pins are exact. The pin moved from 0.20.0 to
  0.22.1 to match the version that `prim` pins, so both tools format Markdown
  with the same plugin.
- Semantic line breaks (one sentence per line) do not survive
  `textWrap: always`; they survive `text-wrap: maintain`.

## Alternatives considered

Delegating to an external dprint (violates one-binary expectation);
`remark-stringify` printing (cannot hard-wrap); whole-file dprint with per-file
fallback (fights the entry grammar); prose-only segmentation (leaves bodies
ragged, #649 unfixed).

## References

- Issue #649 — tables silently skipped by `markspec fmt`.
- [ADR-014](./adr-014-canonical-body-ast.md) — canonical body-AST and the
  formatter's string fallback this pass builds on.
- [ADR-015](./adr-015-ast-equivalence-formatting-contract.md) — the
  byte-verbatim `astEquivalent` contract (MSL-F900) this ADR leaves unchanged.
- [ADR-027](./adr-027-cli-smoother-defaults.md) — the composite `check` gate and
  `MSL-F010` this ADR extends to whole-document drift.
- As-built: `packages/markspec/core/formatter/dprint.ts` (WASM loader + fixed
  style), `packages/markspec/core/formatter/md_equiv.ts` (semantic equivalence
  gate), `packages/markspec/core/formatter/prose.ts` and `mod.ts`
  (segmentation + body pass + MSL-F012), `packages/markspec/lsp/server.ts`
  (`onDocumentFormatting`), `tests/e2e/format_test.ts` and
  `tests/e2e/lsp_formatting_test.ts`; `.editorconfig` resolution:
  `packages/markspec/core/config/editorconfig.ts`,
  `tests/e2e/editorconfig_test.ts`; `format.text-wrap`:
  `packages/markspec/core/config/markspec.ts`,
  `tests/e2e/format_text_wrap_test.ts`.
- prim's `.editorconfig` resolution, which this one follows:
  `crates/prim-cli/src/editorconfig.rs` (`style_from`) in driftsys/prim, and
  driftsys/prim#227.
