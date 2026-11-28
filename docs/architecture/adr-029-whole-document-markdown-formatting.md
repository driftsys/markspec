# ADR-029 — Whole-Document Markdown Formatting

## Status

Accepted (2026-07-02). Closes #649. Amended by #984: the line width and the line
ending come from `.editorconfig`, and entry titles wrap at the line width.
Amended by #1010: an entry-body rewrite must also keep the body block kinds.
Amended 2026-11-26 by #1003: the profile convention `modal-keywords.casing`
changes modal keyword casing (see
[Amendment 2026-11-26](#amendment-2026-11-26--modal-keyword-casing-from-the-profile)).

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
underscores, strong asterisks, dashes for lists. The line width and the line
ending are the only two values a project can change, and only through
`.editorconfig` (see below); every other value is fixed (amended 2026-11-26, see
Amendment: a profile can also choose the modal keyword casing). dprint's
`<!-- dprint-ignore -->` directives work as a per-block opt-out, but an
ignore-start/end pair MUST NOT span an entry block (segments format
independently).

Entry-block coexistence (approach B): prose segments outside entry blocks and
each entry's AST-canonical body go through dprint; trailers never do. An entry
title longer than the line width goes through dprint alone, as a one-item list,
to wrap it as `prim fmt` does (amended by #984); the wrap is kept only when it
is equivalent under the comparator below and every continuation line is indented
at the list item's content column, else the title stays on one line (MSL-F012).
A title inside a `dprint-ignore` region is not wrapped. Every dprint rewrite is
gated by a CommonMark-semantic equivalence comparator
(`markdownSemanticallyEquivalent`, mdast-based: positions elided, whitespace
runs in text values collapsed) — soft-wrap positions and delimiter styles
compare equal, content changes do not. A rejected rewrite is kept as-was and
reported as MSL-F012 (info). Entry bodies have a second gate, described in the
#1010 amendment below. ADR-015's byte-verbatim `astEquivalent` is unchanged and
still guards §5.2 body emission (MSL-F900).

A prose segment can hold a plain list item next to an entry. When formatting
that item alone changes the list depth of any entry (an entry moves into or out
of a list item), the prose pass runs again with every list that holds an entry
kept out of it, so the entry keeps its nesting and `fmt` stays idempotent
(#904).

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

### Body block kinds gate (amendment, #1010)

CommonMark has no definition lists: `Term` followed by a `: definition` line and
the same text joined into one line parse to the same paragraph, so the mdast
comparator alone accepted a dprint rewrite that joined them. An entry-body
rewrite must now also build to MarkSpec body blocks of the same kinds, in the
same order, at every level (blocks inside list items included). Otherwise `fmt`
keeps the AST-canonical body and reports MSL-F012. Prose segments outside entry
blocks have no such gate.

Consequences:

- An entry body that holds a definition list is not wrapped by dprint at all:
  the rejection keeps the whole canonical body, so a long paragraph next to the
  list is not wrapped either, and each `fmt` run reports MSL-F012 for that
  entry.
- `prim fmt` still joins the list into one paragraph, so `prim fmt --check`
  fails on a file that `markspec fmt` formatted with a definition list in an
  entry body. Until prim keeps definition lists (driftsys/prim#229), such a file
  needs a prim exclude.

Idempotency (`format ∘ format === format`) is a tested hard requirement —
MSL-F010 depends on it.

## Amendment 2026-11-26 — modal keyword casing from the profile

The statement above that the line width and the line ending are the only values
a project can change no longer holds. The profile convention
`modal-keywords.casing` also changes the output of `markspec fmt`: the default
(and `rfc2119`, `iso`) lowercases `SHALL`, `SHOULD`, `MAY` and `MUST` and the
mid-sentence EARS keywords `When`, `While`, `Where` and `Unless`, `preserve`
keeps them as written, and `rfc8174` uppercases `shall` and `must`. The `check`
fmt-drift gate (MSL-F010), LSP formatting and MarkDesk proposals apply the
convention of the profile of their own project. The decision text above is
otherwise unchanged. See `docs/spec/language/language.md` §9.1.

## Consequences

- One-time reformat churn on existing projects (pre-1.0 no-migration policy);
  `check`'s MSL-F010 now covers prose drift.
- Deliberately-unformatted files use `project.yaml` `exclude:`.
- A future `@dprint/markdown` bump changes the canonical form — version bumps
  are release-notes-worthy events, pins are exact. The pin moved from 0.20.0 to
  0.22.1 to match the version that `prim` pins, so both tools format Markdown
  with the same plugin.
- Semantic line breaks (one sentence per line) do not survive
  `textWrap: always`.

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
  (segmentation + body pass + MSL-F012),
  `packages/markspec/core/formatter/title_wrap.ts` (entry-title wrap, #984;
  tests `title_wrap_test.ts`, `tests/e2e/fmt_title_wrap_test.ts`,
  `scripts/check_fmt_parity.sh` for the CI parity job),
  `packages/markspec/lsp/server.ts` (`onDocumentFormatting`),
  `tests/e2e/format_test.ts` and `tests/e2e/lsp_formatting_test.ts`;
  `.editorconfig` resolution: `packages/markspec/core/config/editorconfig.ts`,
  `tests/e2e/editorconfig_test.ts`.
- prim's `.editorconfig` resolution, which this one follows:
  `crates/prim-cli/src/editorconfig.rs` (`style_from`) in driftsys/prim, and
  driftsys/prim#227.
