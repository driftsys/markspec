# ADR-027: CLI Smoother Defaults — Project-Scope Discovery and the Composite `check` Gate

## Status

Accepted (2026-06-12). Shipped on branch `feat/cli-smoother-defaults`.

## Context

Three pain points in daily and CI use of `markspec check` / `lint` / `fmt`:

1. All three verbs required explicit file arguments, forcing users to maintain
   complex glob patterns covering `.md` plus every source family (`.rs`, `.kt`,
   `.java`, …) in every hook, CI job, and shell alias.
2. The split between the three verbs was hard to map onto a CI/CD or dev-env
   flow — wiring a complete gate meant composing three commands with different
   argument and exit-code conventions.
3. File discovery ignored `.gitignore`: vendored, generated, and build output
   got scanned unless every consumer hand-maintained exclusions. The codebase
   had three independent walkers (LSP `walkDirectory`, `cli/commands/lock.ts`
   `collectEntries`/`walkMarkdown`, and an uncommitted WIP `walkRelevantFiles`
   in `cli/helpers.ts`), each with its own hardcoded skip list.

Guiding principle: **defaults serve the human; explicitness serves the script.**
Bare invocations do the obvious whole-project thing; scripts that want precise
scope pass explicit paths. Semantics are identical whether stdout is a TTY or
not — only output formatting adapts (clig.dev).

User-facing behavior (flags, exit codes, examples) is documented in
[`docs/guide/cli.md`](../guide/cli.md) and the CLI subcommands table in
[`AGENTS.md`](../../AGENTS.md); this ADR does not restate that reference.

## Decision

### Unified file discovery (`core/discovery/`)

A new `core/discovery/` module (`gitignore.ts` + `mod.ts`) is the single file-
discovery SSOT, replacing the three prior walkers. It is a pure-TypeScript
`.gitignore` matcher — no git-binary dependency, works in non-git directories,
Node-compatible by construction (`deno-lint` allows no `Deno.*` in `core/`).

I/O is injected via a `DiscoveryIO` interface (`readDir` + `readFile`), the same
convention as `ReadFile` elsewhere in `core/`; CLI and LSP entry points supply
the Deno implementation (`denoDiscoveryIO()` in `cli/helpers.ts`).

Skip precedence, in order:

1. **Built-in** — any directory whose name starts with `.` (covers `.git`,
   `.markspec`, `.worktrees`, `.claude` without enumerating every dotdir a
   consumer's environment might create). `.gitignore` _files_ are still read;
   hidden _files_ like `.hidden.md` are still yielded.
2. **`.gitignore` files** (root + nested; standard semantics: `!` negation, `/`
   anchoring, trailing-`/` dir-only patterns, `**` cross-directory globs,
   last-match-wins).
3. **`exclude:` globs from `project.yaml`** — a new
   `ProjectConfig.exclude:
   readonly string[]` field (gitignore syntax,
   root-anchored). This escape hatch is required, not speculative: this repo's
   own `skills/` directory contains example entry blocks that are not real
   requirements and is not gitignored — previously hardcoded in the LSP walker's
   skip list, now `exclude: ["skills/"]` in the repo's own `project.yaml`.

Three extension-set SSOTs live in `core/discovery/mod.ts`: `SOURCE_EXTENSIONS`
(tree-sitter-parseable source families), `MARKDOWN_EXTENSIONS` (`.md` only — the
`fmt` scope, since the formatter never rewrites source), and
`RELEVANT_EXTENSIONS` (their union — the `check`/`lint` scope). `lsp/context.ts`
imports `SOURCE_EXTENSIONS` from `core/mod.ts` rather than duplicating it.

### Default scope and argument handling

A shared `resolveScope(args, opts)` helper in `cli/helpers.ts` gives `check`,
`lint`, and `fmt` identical scope semantics:

- **No args** → discover the project root by walking up for `project.yaml`; run
  over every file `core/discovery` yields under it. No root found → error with a
  hint (`run 'markspec init' or pass explicit files`) — bare invocation never
  silently scans an arbitrary cwd.
- **Explicit args** → files taken as-is; directories expand recursively through
  `core/discovery`'s `.gitignore` and hidden-directory skip, but **not**
  `project.yaml` `exclude:` — `exclude:` governs only the whole- project default
  scope, not explicitly-named directories. Scope is exactly what was named.
- A one-line scope header on **stderr** (`checking N file(s) under <root>`),
  suppressed by `-q` and in `--format json` mode.
- `lint`'s previously-required `<paths...>` became optional `[...paths]`; the
  WIP `--all` flag on `check` was dropped in favor of bare invocation.

### `check` as the composite gate

Bare `markspec check` runs, over one parsed corpus, in one process:

| Gate                                 | Source            | Severity                   | Scope             |
| ------------------------------------ | ----------------- | -------------------------- | ----------------- |
| Parse + structure + attributes       | existing pipeline | as today                   | always            |
| Traceability incl. MSL-L006          | existing          | warning                    | project-wide only |
| Listing documents                    | existing          | as today                   | always            |
| fmt drift (formatter)                | `core/formatter`  | **error** — new `MSL-F010` | project-wide only |
| fmt drift (reference canon)          | `core/refs`       | **error** — new `MSL-F011` | project-wide only |
| Lockfile (parse + edge-ledger drift) | `core/lock`       | **error** — `MSL-L212`     | project-wide only |
| Prose lint (MSL-Q rules)             | `core/lint`       | **warning** (advisory)     | project-wide only |

All findings merge into one diagnostics stream: one text renderer, one
`--format json` array, one exit-code computation (0 clean / 1 any error / 2
warnings-only; `--strict` promotes warnings to errors, unchanged semantics).

**Refinement made during implementation — the extra gates are project-wide only,
not "the same gates scoped to files."** `markspec check <files>` (file-local)
runs structural/attribute/listing validation only — identical to pre-branch
behavior. The fmt-drift gates (`MSL-F010` formatter drift and `MSL-F011`
reference-canonicalization drift), the lockfile gate (`MSL-L212`), the
prose-lint gate (`MSL-Q`), and the `MSL-L006` unresolved- trace-target warning
do not fire when explicit file arguments are given. This is gated on
`scope.projectWide` in `cli/commands/check.ts`, not suppressed per-gate ad hoc.

`MSL-F011` closes a gap in the original gate: `MSL-F010` compared only
`format().changed`, but `markspec fmt` additionally runs the `core/refs`
canonicalization/heal pass, so a file with a non-canonical-but-formatter-clean
reference (a ULID or stale display ID) passed `check` while `fmt --check` would
still rewrite it. The gate now runs the full
`format() → parse →
canonicalizeRefs` sequence — from the same exclude-aware
corpus `fmt` builds — so bare `check` and `fmt --check` never disagree.
Consciously accepted: bare `check` now hard-fails on reference-canon drift too;
the canonical `insert → fmt → check` loop runs `fmt` first, so the agent path is
unaffected.

The refinement exists because `core/formatter`'s `format()` lowercases modal
verbs and applies other normalisations. Running the fmt-drift check (error
severity) file-local against a single file's current-vs-formatted diff would
hard-fail on content that file-local `check` today treats as warning-level or
doesn't touch at all — turning the fast editor/per-file-hook path into a
surprise failure, and breaking the canonical `insert → fmt → check` agent write
loop where `fmt` hasn't necessarily run yet on a file mid-edit. Bare,
project-wide `check` is the CI/pre-push gate where the full corpus and the "must
already be formatted" bar both make sense; file-local `check` stays the fast
structural check the agent loop relies on. This is also consistent with
`MSL-L006` and the lockfile gate, which were already project-wide-only for the
same reason (a file-local subset cannot distinguish a typo from a valid
cross-file target).

`lint` and `fmt` remain focused verbs (`lint` = prose only; `fmt` = writes,
`fmt --check` = drift only). `check` never writes.

### Lock ↔ check edge-hash parity

`markspec lock`'s entry collection (`cli/commands/lock.ts` `collectEntries`) and
`check`'s `MSL-L212` gate both walk the file set via `core/discovery` with the
same `RELEVANT_EXTENSIONS` + the same `exclude:` patterns. This is load-bearing:
the lockfile gate recomputes the canonical edge hash from the
currently-discovered corpus and compares it to the locked hash — if `lock` and
`check` walked different file sets, the hash would drift spuriously on every
run. Unifying both on `core/discovery` (rather than `lock.ts` keeping its own
markdown-only `walkMarkdown`) is what makes the parity hold; it also widened
`lock`'s collection to include source-file entries (a lockfile generated before
this change needs one `markspec lock` refresh).

### Known limitation

Bare invocation (`check`/`lint`/`fmt` with no file arguments) discovers the
project root via `discoverProjectRoot`, which walks up for `project.yaml` only
([`core/config/mod.ts`](../../packages/markspec/core/config/mod.ts)). A project
activated solely by `.markspec.yaml` with no `project.yaml` present (see
[ADR-008](./adr-008-profile-system.md)) is not recognized as a project root for
the no-args path, and bare invocation reports "no project root found" in that
case, even though the error message text says "project.yaml or .markspec.yaml".
This mismatch is pre-existing across the whole CLI (`requireProjectConfig` has
the same gap) and is not fixed by this work — explicit file arguments are
unaffected. Revisiting it (making no-args root discovery also honor a
`.markspec.yaml`-only project, or correcting the message) is a product call
affecting every command, not scoped to this change.

## Consequences

- `markspec check`, `markspec lint`, and `markspec fmt` invoked bare now operate
  on the whole project (gitignore + `exclude:` aware) instead of erroring on
  missing arguments.
- `markspec check` is now the composite CI/pre-push gate: existing
  `check <files>` hook users start seeing advisory prose-lint warnings when they
  move to bare invocation (exit 2 at most, non-blocking). Pre-1.0, no compat
  promise.
- `core/discovery` is a new Node-compatible core module and a new export surface
  off `core/mod.ts` (`discoverFiles`, `isIgnored`, `parseGitignore`,
  `MARKDOWN_EXTENSIONS`, `RELEVANT_EXTENSIONS`, `SOURCE_EXTENSIONS`, plus
  `DiscoverOptions` / `DiscoveryDirEntry` / `DiscoveryIO` / `GitignoreRule`
  types).
- `ProjectConfig` gained a required `exclude: readonly string[]` field (default
  `[]`); loading code and every literal `ProjectConfig` in test fixtures needed
  updating for the new required field.
- The LSP's file-indexing walker (`lsp/server.ts` `onInitialized`) and the
  lockfile's entry collector (`cli/commands/lock.ts`) both moved onto
  `core/discovery`, retiring their own skip lists and honoring the project's
  `exclude:` (and `.gitignore`) for the first time.
- `markspec.lock` byte output can change for projects with source-file entries
  after the first `markspec lock` run post-upgrade (widened collection scope,
  described above). **Upgrade note (#663):** a project with trace attributes in
  source doc comments (e.g. the `demo-aeb-*` V-model repos) that runs bare
  `markspec check` in CI before re-running `markspec lock` gets a one-time
  `MSL-L212` error, because the pinned edge hash was computed from the narrower
  markdown-only corpus. This is expected; run `markspec lock` once to refresh
  the pin. Per the standing "no migration tooling until 1.0" decision, no
  migration is provided — the `MSL-L212` message names the source-file widening
  as a possible cause so the failure is self-explanatory.

## Alternatives considered

- **New umbrella command (`markspec ci` / `verify`)** — rejected: `check` is
  already the natural gate name for hooks and CI; a fourth verb adds the very
  surface-area confusion this work removes.
- **`check` orchestrates the other subcommands** (spawn or call each command's
  action and merge output) — rejected: three interleaved output formats, no
  unified JSON, exit-code juggling; equivalent to a `just` recipe, not an
  in-process gate.
- **`git ls-files` for discovery** — rejected: requires the git binary, diverges
  outside git repos, needs a fallback walker anyway (two code paths). A pure-TS
  matcher is one deterministic path independent of git being installed or the
  directory being a git repo.
- **Hardcoded skip list, user-extensible** — rejected: the exact half-measure
  this work replaces (three walkers, three hardcoded lists).
- **Fold `lint` into `check` entirely (remove the standalone verb)** — rejected:
  `lint` stays useful as a focused advisory verb; `check` includes its findings
  but does not replace the command.
- **TTY-dependent scope semantics** — rejected: scope must be deterministic
  regardless of stdout being a TTY; only output formatting adapts (clig.dev).
- **No `.markspecignore` file** — rejected as a non-feature: `.gitignore` +
  `project.yaml` `exclude:` already cover the need.
- **Gate-selection flags on `check`** (`--only`, `--no-lint`) — rejected as a
  non-feature: use the focused verb (`lint`, `fmt --check`) instead of adding
  flag surface area to the composite gate.

## Follow-ups (accepted, non-blocking)

- **Done (#660).** `MSL-F010`, the new `MSL-F011` (reference-canonicalization
  drift), and the in-`check` `MSL-L212` are documented in the governed
  diagnostic-code catalogue (`docs/spec/language/language.md` §8.9 / §8.10), and
  the `MSL-F` family is recorded in
  [ADR-012](./adr-012-diagnostic-code-scheme.md) via its ADR-027 amendment, per
  the phased-adoption process.
- `mcp/project.ts` still has its own, fourth, unrelated file-walker
  (`SKIP_DIRS`) not yet unified on `core/discovery` — out of scope here because
  the MCP read-surface doesn't feed the `MSL-L212` hash, so there is no parity
  requirement, but it is a consistency debt.
- `markspec init` writes a lockfile with an empty edge ledger; a bare
  `markspec check` run before the first `markspec lock` could false-positive
  `MSL-L212`. The canonical `init → author → lock → check` flow avoids this;
  tightening `init`'s initial lockfile is a candidate follow-up.

## References

- Working memory (spec + plan) archived at
  `docs/archive/specs/2026-06-12-cli-smoother-defaults-design.md` and
  `docs/archive/plans/2026-06-12-cli-smoother-defaults.md`.
- [ADR-008](./adr-008-profile-system.md) — profile manifest / `.markspec.yaml`
  activation; the known-limitation section above concerns its interaction with
  no-args project-root discovery.
- [ADR-012](./adr-012-diagnostic-code-scheme.md) — diagnostic-code catalogue
  governance; `MSL-F010` / `MSL-L212` catalogue entries are a follow-up under
  this ADR's phased-adoption process.
- [ADR-022](./adr-022-lockfile-and-external-sync.md) — lockfile format;
  `MSL-L212` is the existing edge-hash drift category this gate reuses offline
  (no upstream/network resolution, which stays in `markspec lock --check`).
- As-built: `packages/markspec/core/discovery/gitignore.ts`,
  `packages/markspec/core/discovery/mod.ts`, `packages/markspec/core/mod.ts`
  (re-exports), `packages/markspec/core/model/mod.ts` (`ProjectConfig.exclude`),
  `packages/markspec/core/config/mod.ts` (`exclude:` parsing), `cli/helpers.ts`
  (`resolveScope`, `denoDiscoveryIO`), `cli/commands/check.ts` (composite
  gates), `cli/commands/fmt.ts`, `cli/commands/lint.ts`, `cli/commands/lock.ts`
  (`collectEntries`), `lsp/server.ts` (`onInitialized` discovery),
  `lsp/context.ts` (`SOURCE_EXTENSIONS` import).
