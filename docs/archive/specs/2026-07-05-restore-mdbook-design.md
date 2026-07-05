# Design: restore mdBook as the interim book renderer

Issue: #804 (epic #72)

## Context

MarkSpec publishes 4 books from `docs/`: the user guide, the language
specification, the typography specification, and the model reference. Each has
its own `SUMMARY.md` and builds to a standalone static site under
`_site/<name>/`, deployed via GitHub Pages.

Originally these books built with mdBook. Issue #77 replaced mdBook with a
native `markspec book build` renderer so the toolchain has no external
dependency. The cutover landed via PR #762 (2026-07-04) and deleted the 4
`book.toml` files, switching CI and `justfile` to call `markspec book build`
directly.

The native renderer never grew mdBook's site chrome: sidebar/TOC navigation,
full-text search, syntax-highlighted code fences, a print stylesheet, and a
light/dark theme toggle. Its output is a bare HTML shell per chapter with a
single stylesheet (`theme/markspec.css`) that only styles MarkSpec-specific
content (entry blocks, pills, alerts, captions) — no general page chrome. Epic
#72 itself already documents mdBook as "the interim renderer" pending native
multi-book support, so #77's cutover was premature relative to the epic's own
stated sequencing.

## Goal

Recover mdBook's site chrome for all 4 published books, while keeping the native
renderer and its tests in the codebase for future work — this is a reversion of
the CI/build wiring only, not a deletion of #77's work.

## Approach

Restore the 4 `book.toml` files verbatim (recovered from git history — they were
deleted, not rewritten, by PR #762) and point CI + `justfile` back at
`mdbook build`/`mdbook serve`. No new runtime code.

### File changes

- **`docs/guide/book.toml`, `docs/spec/language/book.toml`,
  `docs/spec/typography/book.toml`, `docs/spec/model/book.toml`** — restore
  verbatim from before PR #762 (each declares title,
  `additional-css =
  [".../theme/markspec.css"]`, `git-repository-url`,
  `edit-url-template`, `no-section-label = true`).
- **`.github/workflows/pages.yaml`** — re-add the "Install mdBook" step
  (`peaceiris/actions-mdbook@v2`, `mdbook-version: latest`, matching what
  shipped without issue for 3+ months pre-cutover); change the 4 book-build
  steps from `deno run ... book build` back to `mdbook build <dir>`; drop the
  per-book `markspec.css` copy loop the native path needed (mdBook copies
  `additional-css` into each book's own build-dir itself). Leave the
  checkout/upload-pages-artifact action versions, the `schemas/**` trigger path
  and copy step, the landing-page copy, and the Typst cheat-sheet step untouched
  — those are unrelated to the renderer choice.
- **`justfile`** — revert the `book` recipe's 4 build lines to `mdbook
  build`,
  drop the copy loop, restore the
  `book-dev book="spec/language":
  mdbook serve docs/{{book}} --open` recipe.
- **Not touched:** `packages/markspec/book/` (site renderer + summary parser),
  `packages/markspec/cli/commands/book.ts`, and `tests/e2e/book_build_test.ts` —
  the native renderer and its tests keep working; they're just not wired to the
  public Pages site right now.
- **Not touched:** `docs/index.html` — its FontAwesome→inline-SVG fix from PR
  #762 is an unrelated improvement and stays.
- Small doc-accuracy notes: one line in `docs/guide/cli.md`'s `book build`
  section and in `AGENTS.md`'s CLI reference, stating the public site currently
  builds via mdBook and linking #804, so a future contributor (or agent) doesn't
  rediscover this by surprise and doesn't assume `markspec
  book build` output
  is what's actually deployed.

### Why nothing regresses in the reverse direction

The native renderer's one visual addition over plain mdBook — colored
entry-block/pill/alert/caption HTML — is not exercised by any of the 4 published
books today. Every `- [ID] Title` pattern in guide/spec/model content lives
inside fenced `` ```markdown `` code examples (illustrative syntax), not as
live, parsed entries. Reverting to mdBook's plain CommonMark rendering therefore
has no visible effect on current published content.

## Alternatives considered

**mdBook + a custom preprocessor bridge.** Build a `markspec book
preprocess`
subcommand implementing mdBook's stdin/stdout JSON preprocessor protocol,
running the native renderer's entry-block/alert/caption transform on each
chapter before mdBook's own CommonMark renderer sees it — preserving entry-block
styling under mdBook for any _future_ live entries in these books.

Rejected for now: no published book has a live entry block today, so this solves
a hypothetical problem. It's a legitimate follow-up if a book ever needs real,
styled entries under mdBook, but building it now would be speculative complexity
ahead of an actual need.

## Exit criteria

Tracked as the acceptance checklist on #804. `markspec book build` needs all of:
sidebar/TOC navigation, full-text search, syntax-highlighted code fences, a
print stylesheet, and a light/dark theme toggle, before a #77-style native
cutover is re-attempted.

## Validation plan

- `just book` locally; eyeball all 4 rendered books for nav, search, syntax
  highlighting, print view, and the theme toggle; confirm internal links resolve
  and `markspec.css` entry-block styling still applies where used
  (docs/examples-style illustrations, if any are ever added).
- `just build` / `just check` are unaffected — book building isn't part of that
  gate, and no core/CLI source changes are made.
- No test suite changes: `tests/e2e/book_build_test.ts` and the `book/` module's
  unit tests keep passing unchanged, since the native renderer itself isn't
  touched.
