# ADR-033: Restore mdBook as the Interim Renderer for Published Books

## Status

Accepted (2026-07-05). Closes #804.

## Context

MarkSpec publishes 4 books from `docs/`: the user guide (`docs/guide/`), the
language specification (`docs/spec/language/`), the typography specification
(`docs/spec/typography/`), and the model reference (`docs/spec/model/`). Each
has its own `SUMMARY.md` and builds to a standalone static site under
`_site/<name>/`, deployed via GitHub Pages
([ADR-004](./adr-004-book-structure.md)).

These books originally built with mdBook. Issue #77 replaced mdBook with the
native `markspec book build` renderer ([ADR-004](./adr-004-book-structure.md)'s
`book/site` module) so the toolchain would carry no external build dependency.
The cutover landed via PR #762 (2026-07-04): it deleted the 4 `book.toml` files
and repointed `justfile`'s `book` recipe and `.github/workflows/pages.yaml`'s
build steps at `deno run ... book build` instead of `mdbook build`.

The native renderer never grew mdBook's site chrome. Its output is a bare HTML
shell per chapter styled by a single stylesheet (`theme/markspec.css`) that
targets MarkSpec-specific content — entry blocks, pills, alerts, captions — not
general page chrome. It has no sidebar/TOC navigation, no full-text search, no
syntax-highlighted code fences, no print stylesheet, and no light/dark theme
toggle. Epic #72, which scoped the native-renderer work, had already documented
mdBook as the deliberate "interim renderer" pending native multi-book support —
so PR #762's cutover to the native renderer was premature relative to that
epic's own stated sequencing: it shipped before the replacement reached parity
with what it replaced.

## Decision

Revert the CI/build wiring for the 4 published books to mdBook, while leaving
the native renderer's code and tests in place for future work. This is a
reversion of build orchestration only, not an undoing of issue #77.

Concretely, on `story/804-restore-mdbook`:

- **Restored `docs/guide/book.toml`, `docs/spec/language/book.toml`,
  `docs/spec/typography/book.toml`, and `docs/spec/model/book.toml`** verbatim
  (recovered from git history predating PR #762). Each declares `src = "."`
  (book content is the directory root, not a `src/` subfolder), a `build-dir`
  into the repo-root `_site/`, `additional-css = [".../theme/markspec.css"]`,
  `git-repository-url`, `edit-url-template`, and `no-section-label = true`.
- **`.github/workflows/pages.yaml`** — re-added the "Install mdBook" step
  (`peaceiris/actions-mdbook@v2`, `mdbook-version: latest` — the same pin that
  shipped without issue for 3+ months pre-cutover) and changed the 4 book-build
  steps from `deno run ... book build --output ...` back to
  `mdbook build <dir>`. Dropped the per-book `markspec.css` copy loop the native
  path needed — mdBook does not copy `additional-css` files anywhere; each
  `book.toml`'s `additional-css = ["../../theme/markspec.css"]` instead makes
  every generated page emit a `<link>` with a depth-adjusted relative `../` path
  that climbs out of the book's own `build-dir` to a single shared
  `_site/theme/markspec.css`. That file is supplied by the pre-existing
  top-level "Copy theme, schemas, and landing page" step
  (`mkdir -p _site/theme && cp theme/markspec.css _site/theme/markspec.css`),
  which this restoration keeps as-is — it is now load-bearing for all 4
  mdBook-built books' stylesheets, not just the Pages landing page, so it must
  not be removed. The checkout/upload-pages-artifact action versions, the
  `schemas/**` trigger path and copy step, the landing-page copy, and the Typst
  cheat-sheet step were left untouched — none are specific to the renderer
  choice.
- **`justfile`** — reverted the `book` recipe's 4 build lines to `mdbook build`,
  dropped the same per-book copy loop (the shared `_site/theme/markspec.css`
  copy that every book's relative-path CSS link resolves to stays, for the same
  reason as above), and restored the
  `book-dev book="spec/language": mdbook serve docs/{{book}} --open` recipe for
  local live-reload preview.
- **Doc-accuracy notes** added to `docs/guide/cli.md`'s `book build` section and
  to the `markspec book build` row of `AGENTS.md`'s CLI reference table, stating
  that the published docs site currently builds via mdBook, not the native
  renderer, and linking issue #804 so a future contributor doesn't rediscover
  this by surprise or assume `markspec book build`'s output is what's actually
  deployed.
- **`docs/index.html`'s FontAwesome→inline-SVG fix from PR #762 was kept** — an
  unrelated improvement to the Pages landing page, not part of the renderer
  choice.
- **Post-review path-depth correction.** The verbatim-restored `additional-css`
  values (2 levels for `docs/guide`, 3 for the 3 `docs/spec/*` books) were
  derived from each book's _source_ directory nesting, not from the deployed
  site's _build-dir_ nesting — which is uniformly 1 level under `_site/` for all
  4 books. That mismatch made every book's stylesheet `<link>` climb one level
  too high once served from GitHub Pages, 404ing outside the `/markspec/` site
  root — confirmed by building the site, copying the output into a directory
  tree simulating the real deployed URL structure, and serving it locally. All 4
  `book.toml` files were corrected to
  `additional-css = ["../theme/markspec.css"]` (a single `../`, uniform across
  all 4 books). mdBook additionally resolves that same string a second time
  against each book's _source_ root, to locate a real file for its own internal
  copy step (separate from, and in addition to, the shared
  `_site/theme/markspec.css` copy step described above) — so the correction also
  required adding a `docs/theme/markspec.css` symlink (for `docs/guide`) and a
  `docs/spec/theme/markspec.css` symlink (shared by the 3 `docs/spec/*` books),
  both pointing at the canonical `theme/markspec.css`. Without one of these
  symlinks present, `mdbook build` fails outright on the corrected value with
  "Unable to copy across static files".

Deliberately **not touched**: `packages/markspec/book/` (the native site
renderer + `SUMMARY.md` parser), `packages/markspec/cli/commands/
book.ts`, and
`tests/e2e/book_build_test.ts`. The native renderer and its test coverage stay
in the tree, fully working, just not wired to the public Pages site right now.

This reversion is safe in the direction it runs: none of the 4 published books
currently contains a live, parsed entry block — every `- [ID] Title`-shaped
example in guide/spec/model content lives inside a fenced `` ```markdown `` code
block (illustrative syntax), not a real entry. The native renderer's one visual
addition over plain mdBook rendering — colored entry-block/pill/alert/caption
HTML — has no current content to apply to, so reverting to mdBook's plain
CommonMark rendering has no visible effect on what's published today.

## Alternatives Rejected

### mdBook + a custom preprocessor bridge

Build a `markspec book preprocess` subcommand implementing mdBook's stdin/stdout
JSON preprocessor protocol, running the native renderer's
entry-block/alert/caption transform on each chapter before mdBook's own
CommonMark renderer sees it. This would preserve entry-block styling under
mdBook for any future live entries in these books.

Rejected for now: no published book has a live entry block today, so this solves
a hypothetical problem. It remains a legitimate follow-up if a book ever needs
real, styled entries under mdBook, but building it ahead of an actual need would
be speculative complexity.

## Consequences

- The published docs site (all 4 books) again has mdBook's sidebar/TOC
  navigation, full-text search, syntax-highlighted code fences, a print
  stylesheet, and a light/dark theme toggle.
- The toolchain reacquires its pre-#77 external build dependency: `mdbook` must
  be installed locally (`just book`) and in CI (`peaceiris/actions-mdbook@v2`).
- `packages/markspec/book/`, `packages/markspec/cli/commands/book.ts`, and
  `markspec book build` remain fully implemented and tested, but are not
  exercised by the published-site build path. A contributor running
  `markspec book build` locally gets a working native render — it just isn't
  what `github.io` serves.
- **Exit criteria for the next native-renderer cutover attempt** (tracked as the
  acceptance checklist on issue #804): `markspec book
  build` must reach chrome
  parity with mdBook — sidebar/TOC navigation, full-text search,
  syntax-highlighted code fences, a print stylesheet, and a light/dark theme
  toggle — before a #77-style cutover is re-attempted. Until then, treat mdBook
  as the renderer of record for the published site.

## References

- Issue [#804](https://github.com/driftsys/markspec/issues/804) — this
  decision's tracking issue.
- Epic #72 — the native multi-book renderer epic that had already scoped mdBook
  as an interim step; issue #77 (PR #762) cut over ahead of that epic's own
  sequencing.
- `docs/archive/specs/2026-07-05-restore-mdbook-design.md` — the design spec
  this ADR is gardened from.
- `docs/archive/plans/2026-07-05-restore-mdbook-plan.md` — the implementation
  plan that executed this decision.
- [ADR-004 — Book Structure](./adr-004-book-structure.md) — the `SUMMARY.md` +
  four-part book structure both the mdBook and native renderers build from.
