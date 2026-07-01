# Smoother CLI: project-scope defaults, gitignore-aware discovery, composite `check`

**Date:** 2026-06-12 **Status:** approved (brainstorm), awaiting implementation
plan **Drives:** `markspec check` / `lint` / `fmt` UX rework

## Problem

Three pain points in daily and CI use:

1. `check`, `lint`, and `fmt` all require explicit file arguments, forcing users
   to maintain complex glob patterns covering `.md` plus every source family
   (`.rs`, `.kt`, `.java`, …) in every hook, CI job, and shell alias.
2. The split between the three verbs is hard to map onto a CI/CD or dev-env flow
   — wiring a complete gate means composing three commands with different
   argument and exit-code conventions.
3. File discovery ignores `.gitignore`: vendored, generated, and build output
   gets scanned unless every consumer hand-maintains exclusions. Today the
   codebase has three independent walkers (LSP `walkDirectory`, WIP
   `walkRelevantFiles` in `cli/helpers.ts`, `collectEntries` in
   `cli/commands/lock.ts`), each with its own hardcoded skip list.

## Guiding principle

**Defaults serve the human; explicitness serves the script.** Bare invocations
do the obvious whole-project thing; scripts that want precise scope pass
explicit paths. Semantics are identical whether stdout is a TTY or not — only
output formatting adapts (clig.dev).

## Decisions

| #  | Decision         | Choice                                                                                                                                           |
| -- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1 | No-args default  | All three verbs (`check`, `lint`, `fmt`) operate on the whole project when invoked bare                                                          |
| D2 | Verb structure   | Keep the three focused verbs; `check` becomes the composite gate (no new umbrella command)                                                       |
| D3 | Gitignore        | Pure TypeScript `.gitignore` matcher (no git-binary dependency, works in non-git dirs, Node-compatible)                                          |
| D4 | Blocking policy  | Structure/traceability errors, fmt drift, and lockfile drift exit 1; prose lint is advisory (exit 2 max); `--strict` promotes warnings to errors |
| D5 | Gate composition | In-process: `check` imports core functions and merges one diagnostics stream (Approach A below)                                                  |

## Design

### 1. Unified file discovery (`core/discovery/`)

One walker module in core, replacing all three existing walkers. The LSP adopts
it too.

- Walks from the project root; yields files in the relevant-extension set
  (`.md` + the tree-sitter source families). That extension set becomes a single
  SSOT, currently duplicated in `lsp/context.ts` and the WIP helper.
- Skip precedence: built-ins (`.git`, `.markspec`) → `.gitignore` files (root +
  nested; standard semantics: `!` negation, `/` anchoring, trailing-`/` dir-only
  patterns) → `exclude:` globs from `project.yaml`.
- The `exclude:` escape hatch is required, not speculative: this repo's own
  `skills/` directory contains example entry blocks that are not real
  requirements and is not gitignored (today it is hardcoded in the LSP walker's
  skip list).
- I/O is injected (same convention as `ReadFile`) so the module stays
  Node-compatible; CLI and LSP entry points pass the Deno implementation.
- Directory arguments to commands expand recursively through the same filter
  (`markspec check docs/`).

### 2. Default scope and argument handling

Shared resolution logic for all three verbs:

- **No args** → discover the project root (walk up for `project.yaml` /
  `.markspec.yaml`); run over every file from discovery. No root found → error
  with a hint (`run 'markspec init' or pass explicit files`). Never silently
  scans an arbitrary cwd.
- **Explicit args** → files taken as-is; directories expand through the
  discovery filter. Scope is exactly what was named.
- A one-line scope header on **stderr** (`checking 142 files under <root>`),
  suppressed by `-q` and in `--format json` mode.
- `lint`'s required `<paths...>` becomes optional `[...paths]`.
- The WIP `--all` flag is dropped — bare invocation replaces it.
- AGENTS.md's CLI rule is rewritten: _explicit args = exact scope; bare
  invocation = announced project scope._

### 3. `check` as the composite gate

Bare `markspec check` runs, in one process over one parsed corpus:

| Gate                                                                   | Source                        | Severity                                           |
| ---------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------- |
| Parse + structure + attributes                                         | existing pipeline             | as today                                           |
| Traceability incl. MSL-L006                                            | existing, `projectWide: true` | as today                                           |
| Listing documents                                                      | existing                      | as today                                           |
| fmt drift (`format(x) !== x`)                                          | `core/formatter` check mode   | **error** — new code MSL-F010 "file not formatted" |
| Lockfile (parse + edge-ledger drift; only when `markspec.lock` exists) | `core/lock`                   | error                                              |
| Prose lint (MSL-Q rules)                                               | `core/lint`                   | **warning** (advisory)                             |

- All findings merge into the single diagnostics stream: one text renderer, one
  `--format json` array, one exit-code computation. Exit 1 = any error; exit 2 =
  warnings only; 0 = clean. `--strict` promotes warnings to errors (existing
  flag, unchanged semantics).
- `markspec check <files>` runs the same gates **scoped to those files**;
  cross-file-only gates (MSL-L006, lockfile drift) auto-suppress, exactly as
  file-local mode behaves today.
- `lint` and `fmt` remain focused verbs (`lint` = prose only; `fmt` = writes,
  `fmt --check` = drift only). `check` never writes.
- Known behavior change: existing `check <files>` hook users start seeing
  advisory prose-lint warnings. Pre-1.0, no compat promise; findings are
  non-blocking (exit 2 at most).

### 4. Testing

- **Unit** (colocated): `core/discovery/` matcher — gitignore semantics
  (negation, anchoring, dir-only, nested files), exclude-glob precedence,
  extension filter.
- **E2E** (blackbox, `tests/e2e/`): bare `check`/`lint`/`fmt` in a temp project
  with a `.gitignore` (an ignored file containing a broken ref must NOT be
  reported); directory-arg expansion; no-root error message; composite gates
  (unformatted file → exit 1 + MSL-F010; prose-only finding → exit 2);
  `check <file>` still suppresses MSL-L006.
- The WIP `check_all_test.ts` is reworked: `--all` cases become bare-`check`
  cases.

## Disposition of current working-tree WIP

- **Keep as-is:** `core/validator/listing.ts` markdown-only basename fix;
  `main.ts` bare-invocation-shows-help fix.
- **Superseded:** `walkRelevantFiles` in `cli/helpers.ts` and the `check --all`
  flag/plumbing in `cli/commands/check.ts` — replaced by `core/discovery/` and
  the no-args default.
- All of it lands on one feature branch (worktree, per repo rules).

## Alternatives considered

- **New umbrella command (`markspec ci` / `verify`)** — rejected: `check` is
  already the natural gate name for hooks and CI; a fourth verb adds the very
  surface-area confusion this work removes.
- **Approach B, `check` orchestrates subcommands** (spawn or call each command's
  action) — rejected: three interleaved output formats, no unified JSON,
  exit-code juggling; equivalent to a `just` recipe.
- **`git ls-files` for discovery** — rejected: requires the git binary, diverges
  outside git repos, needs a fallback walker anyway (two code paths). Pure TS
  matcher is one deterministic path.
- **Hardcoded skip list, user-extensible** — rejected: the exact half-measure
  being complained about.
- **Fold `lint` into `check` entirely** — rejected: `lint` stays useful as a
  focused advisory verb; `check` includes it but doesn't replace it.
- **TTY-dependent scope semantics** — rejected: scope must be deterministic;
  only formatting adapts to TTY.

## Non-features

- No `.markspecignore` file (gitignore + `project.yaml` `exclude:` covers it).
- No gate-selection flags on `check` (`--only`, `--no-lint`) — use the focused
  verb instead.
- `compile` / `export` keep requiring explicit paths (artifact production is a
  different use case). Revisit later if needed.
