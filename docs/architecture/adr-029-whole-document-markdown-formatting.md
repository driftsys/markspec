# ADR-029 — Whole-Document Markdown Formatting

## Status

Accepted (2026-07-02). Closes #649.

## Context

`markspec fmt` formatted only entry-block mechanics — ULID stamping, trailer
indentation, trailing backslashes, modal-keyword case. Surrounding Markdown
(overview chapters, context prose, headings, tables, lists) passed through
verbatim, and tables were silently skipped (#649). Authors expect `markspec fmt`
to be _the_ formatter for MarkSpec documents; today a second tool (dprint) is
required for the prose.

## Decision

`markspec fmt` formats the entire Markdown document by default, Markdown files
only, with a fixed zero-config style, via the embedded dprint-markdown WASM
plugin (`@dprint/formatter` host, exact-pinned `@dprint/markdown@0.20.0`),
lazily loaded on the fmt code path.

Style: `lineWidth` 80 (soft target — table rows, links/references, and inline
code may exceed it and are never split), `textWrap` always, emphasis
underscores, strong asterisks, dashes for lists; line endings follow the file's
detected convention. dprint's `<!-- dprint-ignore -->` directives work as a
per-block opt-out, but an ignore-start/end pair MUST NOT span an entry block
(segments format independently).

Entry-block coexistence (approach B): prose segments outside entry blocks and
each entry's AST-canonical body go through dprint; title lines and trailers
never do. Every dprint rewrite is gated by a CommonMark-semantic equivalence
comparator (`markdownSemanticallyEquivalent`, mdast-based: positions elided,
whitespace runs in text values collapsed) — soft-wrap positions and delimiter
styles compare equal, content changes do not. A rejected rewrite is kept as-was
and reported as MSL-F012 (info). ADR-015's byte-verbatim `astEquivalent` is
unchanged and still guards §5.2 body emission (MSL-F900).

Because a body is formatted dedented and re-indented afterward, the body pass
budgets its `lineWidth` at `80 − indent` (floor 20, via a per-call
`ProseFormatOptions.lineWidth` override) so a wrap point landing near column 80
dedented does not exceed 80 once re-indented — keeping the result in agreement
with a whole-file dprint view of the same content (e.g. the external dprint CLI
on this repo's own tree).

Idempotency (`format ∘ format === format`) is a tested hard requirement —
MSL-F010 depends on it.

## Consequences

- One-time reformat churn on existing projects (pre-1.0 no-migration policy);
  `check`'s MSL-F010 now covers prose drift.
- Deliberately-unformatted files use `project.yaml` `exclude:`.
- A future `@dprint/markdown` bump changes the canonical form — version bumps
  are release-notes-worthy events, pins are exact.
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
  (segmentation + body pass + MSL-F012), `packages/markspec/lsp/server.ts`
  (`onDocumentFormatting`), `tests/e2e/format_test.ts` and
  `tests/e2e/lsp_formatting_test.ts`.
