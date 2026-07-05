# Restore mdBook as Interim Book Renderer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore mdBook (sidebar/TOC nav, full-text search, syntax
highlighting, print stylesheet, light/dark theme toggle) as the renderer for the
4 published books, without touching the native `markspec book build` renderer's
code or tests.

**Architecture:** Re-add the 4 deleted `book.toml` files verbatim, then point
`justfile` and `.github/workflows/pages.yaml` back at
`mdbook build`/`mdbook
serve` instead of `deno run ... book build`. Pure
config/CI revert — no TypeScript changes.

**Tech Stack:** mdBook v0.4.x (installed locally at `/opt/homebrew/bin/mdbook`
v0.4.52; CI installs via `peaceiris/actions-mdbook@v2`), `just`, GitHub Actions,
Deno/dprint formatting.

## Global Constraints

- Do not modify `packages/markspec/book/` (site renderer + summary parser),
  `packages/markspec/cli/commands/book.ts`, or `tests/e2e/book_build_test.ts` —
  the native renderer and its tests must keep working unchanged.
- Do not modify `docs/index.html` — its FontAwesome→inline-SVG fix from PR #762
  is unrelated and must stay.
- Pin `mdbook-version: latest` in CI (matching the config that shipped without
  issue for 3+ months pre-cutover) — do not introduce a new version pin as part
  of this work.
- Every commit message must be Conventional Commits, imperative mood, with a
  scope from this repo's allowed list:
  `auto, repo, ci, spec, core, cli,
  lsp, mcp, render, book, deck, docs, deps, release`
  (enforced by the `git std lint` pre-commit hook). Use scope `book` for these
  commits.
- Run `just fmt` and `git add -u` immediately before every commit — the
  pre-commit hook runs `dprint fmt`/`deno fmt` automatically and can rewrite
  staged files without re-staging them, causing the first commit attempt to fail
  on a stale diff.
- All work happens in the existing worktree at
  `/Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook`
  on branch `story/804-restore-mdbook`. Every `cd` must be repeated per shell
  command — the working directory does not persist between tool calls in this
  environment.
- Tracking issue: [#804](https://github.com/driftsys/markspec/issues/804).
  Design spec: `docs/wip/2026-07-05-restore-mdbook-design.md`.

---

### Task 1: Restore the 4 mdBook `book.toml` config files

**Files:**

- Create: `docs/guide/book.toml`
- Create: `docs/spec/language/book.toml`
- Create: `docs/spec/typography/book.toml`
- Create: `docs/spec/model/book.toml`

**Interfaces:**

- Consumes: nothing (static TOML config).
- Produces: `book.toml` per directory, read by `mdbook build <dir>` /
  `mdbook serve <dir>` in Task 2. Each declares `src = "."` (book content is the
  directory root, not a `src/` subfolder), `build-dir` (relative path into the
  repo-root `_site/`), and `additional-css` (relative path to
  `theme/markspec.css`).

- [ ] **Step 1: Confirm the current (red) state — mdBook can't find these
      books**

Run:

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && mdbook build docs/guide
```

Expected: exit code 101, with output containing:

```
[ERROR] (mdbook::utils): Error: Couldn't open SUMMARY.md in ".../docs/guide/src" directory
[ERROR] (mdbook::utils): 	Caused By: No such file or directory (os error 2)
```

This confirms mdBook defaults to looking for content under a `src/`
subdirectory, which doesn't exist here — `docs/guide/SUMMARY.md` sits at the
book root. The same failure shape occurs for `docs/spec/language`,
`docs/spec/typography`, and `docs/spec/model` (no need to run all 4; the cause
is identical — no `book.toml` to declare `src = "."`).

- [ ] **Step 2: Create `docs/guide/book.toml`**

```toml
[book]
title = "MarkSpec User Guide"
authors = ["DriftSys"]
language = "en"
src = "."

[build]
build-dir = "../../_site/guide"

[output.html]
no-section-label = true
additional-css = ["../../theme/markspec.css"]
git-repository-url = "https://github.com/driftsys/markspec"
edit-url-template = "https://github.com/driftsys/markspec/edit/main/docs/guide/{path}"
```

- [ ] **Step 3: Create `docs/spec/language/book.toml`**

```toml
[book]
title = "MarkSpec Language Specification"
authors = ["DriftSys"]
language = "en"
src = "."

[build]
build-dir = "../../../_site/spec"

[output.html]
no-section-label = true
additional-css = ["../../../theme/markspec.css"]
git-repository-url = "https://github.com/driftsys/markspec"
edit-url-template = "https://github.com/driftsys/markspec/edit/main/docs/spec/language/{path}"
```

- [ ] **Step 4: Create `docs/spec/typography/book.toml`**

```toml
[book]
title = "MarkSpec Typography"
authors = ["DriftSys"]
language = "en"
src = "."

[build]
build-dir = "../../../_site/typography"

[output.html]
no-section-label = true
additional-css = ["../../../theme/markspec.css"]
git-repository-url = "https://github.com/driftsys/markspec"
edit-url-template = "https://github.com/driftsys/markspec/edit/main/docs/spec/typography/{path}"
```

- [ ] **Step 5: Create `docs/spec/model/book.toml`**

```toml
[book]
title = "MarkSpec Model Reference"
authors = ["DriftSys"]
language = "en"
src = "."

[build]
build-dir = "../../../_site/model"

[output.html]
no-section-label = true
additional-css = ["../../../theme/markspec.css"]
git-repository-url = "https://github.com/driftsys/markspec"
edit-url-template = "https://github.com/driftsys/markspec/edit/main/docs/spec/model/{path}"
```

- [ ] **Step 6: Confirm the green state — all 4 books now build**

Run:

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && for d in docs/guide docs/spec/language docs/spec/typography docs/spec/model; do echo "=== $d ==="; mdbook build "$d"; echo "exit: $?"; done
```

Expected: each of the 4 sections prints `exit: 0`, with mdBook log lines:

```
[INFO] (mdbook::book): Book building has started
[INFO] (mdbook::book): Running the html backend
```

- [ ] **Step 7: Confirm mdBook chrome assets are actually present in the
      output**

Run:

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && grep -o "searchindex\.js\|sidebar\|<nav\|highlight\.js\|print\.html\|theme-list" _site/guide/index.html | sort -u
```

Expected output (order may vary, all 6 lines present):

```
<nav
highlight.js
print.html
searchindex.js
sidebar
theme-list
```

- [ ] **Step 8: Clean up the local build artifact (gitignored, but don't leave
      it around)**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && rm -rf _site
```

- [ ] **Step 9: Commit**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && just fmt && git add docs/guide/book.toml docs/spec/language/book.toml docs/spec/typography/book.toml docs/spec/model/book.toml && git commit -m "book: restore mdBook config for the 4 published books

Refs #804."
```

---

### Task 2: Restore mdBook build orchestration in `justfile` and CI

**Files:**

- Modify: `justfile:40-49`
- Modify: `.github/workflows/pages.yaml:29-67`

**Interfaces:**

- Consumes: the 4 `book.toml` files from Task 1.
- Produces: `just book` and `just book-dev <book>` recipes; a CI `build` job
  that runs `mdbook build` per book. Task 3 exercises both.

- [ ] **Step 1: Replace the `book` recipe and restore `book-dev` in `justfile`**

Current `justfile:40-49`:

```
# Build spec and guide books
book: tokens
    cd docs/spec/language && deno run --allow-read --allow-write ../../../packages/markspec/main.ts book build --output ../../../_site/spec
    cd docs/spec/typography && deno run --allow-read --allow-write ../../../packages/markspec/main.ts book build --output ../../../_site/typography
    cd docs/spec/model && deno run --allow-read --allow-write ../../../packages/markspec/main.ts book build --output ../../../_site/model
    cd docs/guide && deno run --allow-read --allow-write ../../packages/markspec/main.ts book build --output ../../_site/guide
    typst compile --font-path packages/markspec-typst/fonts docs/cheatsheet/markspec-cheatsheet.typ _site/markspec-cheatsheet.pdf
    mkdir -p _site/theme && cp theme/markspec.css _site/theme/markspec.css
    for book in spec typography model guide; do cp theme/markspec.css _site/$book/markspec.css; done
    cp docs/index.html _site/index.html
```

Replace with:

```
# Build spec and guide books (requires mdbook)
book: tokens
    mdbook build docs/spec/language
    mdbook build docs/spec/typography
    mdbook build docs/spec/model
    mdbook build docs/guide
    typst compile --font-path packages/markspec-typst/fonts docs/cheatsheet/markspec-cheatsheet.typ _site/markspec-cheatsheet.pdf
    mkdir -p _site/theme && cp theme/markspec.css _site/theme/markspec.css
    cp docs/index.html _site/index.html

# Serve a book locally with live reload (default: spec/language)
book-dev book="spec/language":
    mdbook serve docs/{{book}} --open
```

Use the Edit tool with the exact "Current" block above as `old_string` and the
exact "Replace with" block as `new_string`.

- [ ] **Step 2: Sanity-check the justfile recipes resolve correctly (no
      execution yet)**

Run:

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && just --list
```

Expected: the output includes both `book` and `book-dev *book="spec/language"*`
lines (exact formatting may vary slightly by `just` version, but both recipe
names must appear).

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && just --show book
```

Expected: prints the exact recipe body from Step 1 (the 4 `mdbook build` lines,
the `typst compile` line, and the 2 `cp`/`mkdir` lines) — confirms `just` parsed
the recipe without syntax errors.

- [ ] **Step 3: Restore the CI workflow's mdBook steps in
      `.github/workflows/pages.yaml`**

Current `.github/workflows/pages.yaml:29-52` (checkout through the 4 build
steps):

```yaml
      - uses: actions/checkout@v6.0.2

      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x

      - name: Regenerate tokens
        run: deno run --allow-read --allow-write scripts/gen_theme.ts

      - name: Build language spec book
        working-directory: docs/spec/language
        run: deno run --allow-read --allow-write ../../../packages/markspec/main.ts book build --output ../../../_site/spec

      - name: Build typography book
        working-directory: docs/spec/typography
        run: deno run --allow-read --allow-write ../../../packages/markspec/main.ts book build --output ../../../_site/typography

      - name: Build model reference book
        working-directory: docs/spec/model
        run: deno run --allow-read --allow-write ../../../packages/markspec/main.ts book build --output ../../../_site/model

      - name: Build guide book
        working-directory: docs/guide
        run: deno run --allow-read --allow-write ../../packages/markspec/main.ts book build --output ../../_site/guide
```

Replace with:

```yaml
      - uses: actions/checkout@v6.0.2

      - name: Install mdBook
        uses: peaceiris/actions-mdbook@v2
        with:
          mdbook-version: latest

      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x

      - name: Regenerate tokens
        run: deno run --allow-read --allow-write scripts/gen_theme.ts

      - name: Build language spec book
        run: mdbook build docs/spec/language

      - name: Build typography book
        run: mdbook build docs/spec/typography

      - name: Build model reference book
        run: mdbook build docs/spec/model

      - name: Build guide book
        run: mdbook build docs/guide
```

Use the Edit tool with the exact "Current" block as `old_string` and the exact
"Replace with" block as `new_string`.

- [ ] **Step 4: Simplify the copy step — mdBook already copies `additional-css`
      per book**

Current `.github/workflows/pages.yaml` (the "Copy theme, schemas, and landing
page" step, immediately after the "Build cheat sheet" step):

```yaml
- name: Copy theme, schemas, and landing page
  run: |
    mkdir -p _site/theme && cp theme/markspec.css _site/theme/markspec.css
    for book in spec typography model guide; do
      cp theme/markspec.css "_site/$book/markspec.css"
    done
    mkdir -p _site/schemas && cp -R schemas/. _site/schemas/
    cp docs/index.html _site/index.html
```

Replace with:

```yaml
- name: Copy theme, schemas, and landing page
  run: |
    mkdir -p _site/theme && cp theme/markspec.css _site/theme/markspec.css
    mkdir -p _site/schemas && cp -R schemas/. _site/schemas/
    cp docs/index.html _site/index.html
```

(Removes the now-redundant `for book in ...` loop — `mdbook build`'s
`additional-css` setting already copies `theme/markspec.css` into each book's
own build-dir root, which Task 1 Step 7 already confirmed by finding
`markspec.css`-driven styling loaded in `_site/guide/index.html`. The top-level
`_site/theme/markspec.css` copy stays — `docs/index.html`, the Pages landing
page, references it directly.)

- [ ] **Step 5: Validate the workflow YAML parses and has the right step shape**

Run:

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && yq '.jobs.build.steps[].name' .github/workflows/pages.yaml
```

Expected output (verified against the pre-edit file; `null` lines are the 2
unnamed `uses:`-only steps — `checkout` and `setup-deno`; every other step,
including "Install Typst" and "Upload artifact", already has a `name:`):

```
null
Install mdBook
null
Regenerate tokens
Build language spec book
Build typography book
Build model reference book
Build guide book
Install Typst
Build cheat sheet
Copy theme, schemas, and landing page
Upload artifact
```

- [ ] **Step 6: Commit**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && just fmt && git add justfile .github/workflows/pages.yaml && git commit -m "ci(book): point pages workflow and justfile back at mdbook build

Refs #804."
```

---

### Task 3: End-to-end local verification

**Files:** none (verification only).

**Interfaces:**

- Consumes: everything from Tasks 1–2.
- Produces: confidence that `just book` and the full `just check` gate both
  still pass before moving on to doc updates.

- [ ] **Step 1: Run the full local book build**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && just book
```

Expected: exit code 0. Output shows `tokens` regenerating theme files, then 4
`mdbook::book` "Book building has started" / "Running the html backend" pairs
(one per book), then the `typst compile` line, then no output from the final
`mkdir`/`cp` lines (silent on success).

- [ ] **Step 2: Confirm all 4 books carry mdBook chrome, not just guide**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && for book in guide spec typography model; do echo "=== $book ==="; grep -Foc "searchindex.js" "_site/$book/index.html"; done
```

Expected: each of the 4 lines prints `=== <book> ===` followed by `1` (the
`<script>` tag loading `searchindex.js` appears exactly once per page).

- [ ] **Step 3: Confirm internal links still resolve (no mdBook build
      warnings)**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && just book 2>&1 | grep -i "warn\|error" || echo "no warnings or errors"
```

Expected: `no warnings or errors`. If mdBook prints a broken-link warning for
any chapter, note which file/link and fix the source Markdown (do not suppress
the warning) before proceeding — this is a real content bug the native
renderer's cross-chapter link rewriting (#776) had been silently compensating
for in a different way.

- [ ] **Step 4: Clean up the build artifact**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && rm -rf _site
```

- [ ] **Step 5: Confirm the unrelated native-renderer test suite is untouched
      and still green**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && deno test --allow-read --allow-write --allow-run tests/e2e/book_build_test.ts packages/markspec/book/
```

Expected: all tests pass (exit code 0) — this plan makes no source changes under
`packages/markspec/book/`, so this is a regression check, not new coverage.

- [ ] **Step 6: Run the full project gate**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && just build
```

Expected: exit code 0 (lint + test + typecheck + compile all pass — none of this
plan's changes touch `packages/markspec/**` source, so this should be
unaffected).

No commit for this task — it's a verification checkpoint, not a change.

---

### Task 4: Add doc-accuracy notes pointing at the tracking issue

**Files:**

- Modify: `docs/guide/cli.md:888-894`
- Modify: `AGENTS.md:242`

**Interfaces:**

- Consumes: issue #804's URL.
- Produces: nothing consumed by later tasks — pure documentation.

- [ ] **Step 1: Add a note to `docs/guide/cli.md`'s `book build` section**

Current `docs/guide/cli.md:888-894`:

````markdown
#### book build

Generate a multi-chapter static HTML site from a SUMMARY.md.

```sh
markspec book build
```
````

Replace with:

````markdown
#### book build

Generate a multi-chapter static HTML site from a SUMMARY.md.

Not currently used to build the published MarkSpec docs site — that still builds
via mdBook until the native renderer reaches chrome parity (sidebar navigation,
search, syntax highlighting, a print stylesheet, and a light/dark theme toggle).
See [#804](https://github.com/driftsys/markspec/issues/804) for the tracking
issue and exit criteria.

```sh
markspec book build
```
````

Use the Edit tool with the exact "Current" block as `old_string` (note: the
old_string spans from the `#### book build` heading through the closing
`` ``` `` of the shell fence) and the "Replace with" block as `new_string`.

- [ ] **Step 2: Update the CLI reference table row in `AGENTS.md`**

Current `AGENTS.md:242`:

```
| `markspec book build` | `book/site` | Multi-chapter → static HTML site. |
```

Replace with:

```
| `markspec book build` | `book/site` | Multi-chapter → static HTML site. Not used for the published docs site yet — mdBook is, pending chrome parity (#804). |
```

(Column padding will be re-aligned automatically by `dprint fmt` in the commit
step below — don't hand-align it.)

- [ ] **Step 3: Verify both edits render sensibly**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && grep -A4 "^#### book build" docs/guide/cli.md && grep "markspec book build" AGENTS.md
```

Expected: the `cli.md` grep shows the new note between the description and the
code fence; the `AGENTS.md` grep shows the updated row mentioning `#804`.

- [ ] **Step 4: Commit**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && just fmt && git add docs/guide/cli.md AGENTS.md && git commit -m "docs(book): note that the public site builds via mdBook for now

Refs #804."
```

---

### Task 5: Garden working memory into an ADR, ready for PR

**Files:**

- Create: `docs/architecture/adr-033-mdbook-interim-restoration.md` (or the next
  unused ADR number if another ADR has landed on `main` since this plan was
  written — check
  `ls docs/architecture/ | grep -E '^adr-[0-9]+' | sort
  | tail -1` before
  numbering).
- Modify: `docs/architecture/overview.md` (ADR reading-order list).
- Modify: `AGENTS.md` (ADR list in the "Docs layout" section).
- Move: `docs/wip/2026-07-05-restore-mdbook-design.md` → `docs/archive/specs/`.
- Move: `docs/wip/2026-07-05-restore-mdbook-plan.md` → `docs/archive/plans/`.

**Interfaces:**

- Consumes: `docs/wip/2026-07-05-restore-mdbook-design.md` (this plan's
  companion spec) and the actual landed diff from Tasks 1–4.
- Produces: a durable ADR recording this decision, per this repo's
  `sdd-working-memory-lifecycle` convention (decisions live in
  `docs/architecture/` as ADRs here, not a generic `docs/decisions/` — this repo
  predates that generic taxonomy and already has its own).

- [ ] **Step 1: Invoke the gardening skill**

This is a skill invocation, not a code change — the executing agent must call:

```
Skill(sdd-gardening)
```

Point it at `docs/wip/2026-07-05-restore-mdbook-design.md` and
`docs/wip/2026-07-05-restore-mdbook-plan.md` as the finished session's working
memory to garden, and at issue #804 as the tracking issue. Follow the existing
ADR template (see `docs/architecture/adr-032-process-profile-boundary.md` for
the `# ADR-NNN: Title` / `## Status` / `## Context` / `## Decision` /
`## Alternatives Considered` / `## Consequences` shape) when authoring the new
ADR's content — status line should read `Accepted (2026-07-05). Closes
#804.`

- [ ] **Step 2: Verify the garden left `docs/wip/` clear of this story's files**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && ls docs/wip/ | grep -i restore-mdbook || echo "clear"
```

Expected: `clear` (the two files should now live under `docs/archive/specs/` and
`docs/archive/plans/` respectively). Do not touch any other files already
present in `docs/wip/` (e.g. unrelated in-progress work) — this step only
concerns this story's own two files.

- [ ] **Step 3: Verify the new ADR is linked from the reading-order docs**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && grep -l "adr-033-mdbook-interim-restoration\|adr-0[0-9][0-9]-mdbook" docs/architecture/overview.md AGENTS.md
```

Expected: both files listed (adjust the grep pattern if the gardener picked a
different ADR number per Step 1's numbering check).

- [ ] **Step 4: Run the full project gate one more time**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && just build
```

Expected: exit code 0.

- [ ] **Step 5: Commit the garden**

```bash
cd /Users/sebastientasson/Workspace/driftsys/markspec-worktrees/804-restore-mdbook && just fmt && git add -A docs/ AGENTS.md && git commit -m "docs(book): record the mdBook interim-restoration decision as an ADR

Closes #804."
```

(Using `Closes #804` here, not `Refs`, since this is the final commit of the
story — matches this repo's convention of closing the tracking issue from the
commit that finishes the work.)

---

## After this plan

This plan does not include pushing the branch or opening the PR — hand off to
the `superpowers:finishing-a-development-branch` skill once all 5 tasks are
checked off, so the user can choose how to integrate (PR, direct merge, etc.)
per that skill's usual flow. Per `AGENTS.md`'s "After PR" convention, run
`/review` on the resulting PR and post findings as a PR comment once it exists.
