# Plan: bare `check`/`lint`/`fmt` treat nested projects as separate projects (#856)

## Intent

Since #844 (LSP) and #854 (MCP), a folder below a project root that holds its
own `project.yaml` is a separate project: its entries form their own graph and
are validated against its own profile (ADR-028 §7). Bare `markspec check`,
`lint`, and `fmt` still walk the whole tree as one graph, so MCP `validate` and
`check` report different results for the same tree. This change makes the CLI
follow the same rule as the LSP and the MCP server.

## Decision

Chosen: the CLI treats nested projects as separate projects.

Alternatives considered:

- Keep one graph and document the difference in the CLI guide. Rejected: three
  surfaces with two rules for one tree. An author who sees a clean `validate` in
  the editor or agent then gets a red `check` in CI, or the reverse.
- Skip nested subtrees in bare `check` without checking them. Rejected: a CI job
  that runs `markspec check` at the repository root would stop covering the
  nested projects without any warning.

## Behaviour

- **Ownership.** A file belongs to its nearest project root. The roots are the
  bare-scope root (nearest `project.yaml` above the working directory, as today)
  plus every root that `findNestedProjectRoots` returns below it (same
  gitignore, hidden-directory and `exclude:` rules as the LSP and MCP). Under a
  `project.yaml` root, a nested root is a directory with its own `project.yaml`.
  A `.markspec.yaml` below a `project.yaml` is not a root (`resolveConfigRoot`).
- **Bare `check`.** The root project and then each nested project (sorted) are
  checked separately, each with its own `.markspec.yaml` profile and tool
  config, `markspec.lock`, delivered corpus, upstreams, and composite gates. The
  scope header is printed once per project (`checking N file(s) under <root>`).
  Text diagnostics are printed per project in the same order. `--format json`
  stays a flat array of `Diagnostic` (each carries its file path). `--strict`
  applies to every project. The exit code is the worst of all projects (1 > 2 >
  0).
- **Bare `lint`.** Same loop: each project is linted with its own profile and
  corpus. JSON stays `{ diagnostics, score }` with concatenated diagnostics; the
  score is computed over the entries of all projects together, if the roll-up is
  additive over band counts (otherwise stop and report). The text output prints
  one score summary per project.
- **Bare `fmt` and `fmt --check`.** Each project is formatted with its own
  profile and its own reference index (its own `collectProjectEntries` plus its
  own lockfile edge ledger). One summary line per project. Exit code is the
  worst.
- **`collectProjectEntries` (used by `lock`, `compile`, `fmt`, `doctor`).**
  Skips files that belong to a nested project. This keeps the lock ↔ check
  parity of ADR-027: `lock` pins exactly the files that `check`'s MSL-L212 gate
  compares against for the same project. `lock` does not recurse; each nested
  project has its own `markspec.lock` (run `markspec lock` in it).
- **Unchanged.** Explicit file or directory arguments keep the exact scope and
  the current single-graph behaviour. Bare invocation from inside a nested
  project already uses that project as its root.

## Tasks

Each task is TDD (failing test first), runs `just check` green in the worktree,
and is reviewed before the next task starts.

### Task 1 — core: owned-file discovery

- Add to `packages/markspec/core/discovery/projects.ts` a function that walks
  `root` with `discoverFiles` (same `extensions` / `exclude` options) and yields
  only files whose nearest root among `[root, ...nestedRoots]` is `root`. Return
  the nested roots too, so callers can loop over them without a second walk.
  Export it from `core/mod.ts`. Unit tests colocated.
- Make `collectProjectEntries` (`core/collect/mod.ts`) use it.
- e2e test (`tests/e2e/`): parent `project.yaml` + `sub/project.yaml`; bare
  `markspec lock` at the parent does not pin entries from `sub/`; bare `check`
  at the parent reports no MSL-L212 after that lock.

### Task 2 — `check` per project

- `resolveScope` (`cli/helpers.ts`) bare mode returns one scope per project:
  root project first, then nested roots, each with its owned files. Explicit
  args unchanged.
- Extract the body of `check`'s action (`cli/commands/check.ts` lines 41-304)
  into a per-project function taking the root and files explicitly (no
  `Deno.cwd()` lookups inside), then loop.
- e2e tests (acceptance criteria from #856):
  - the same display ID in the parent and in `sub/` → no MSL-R006 / MSL-I008;
  - a parent entry `Satisfies:` a `sub/` entry → MSL-L006 (unresolved) on the
    parent entry;
  - an error inside `sub/` is still reported by bare `check` at the parent, and
    the exit code reflects it;
  - `sub/` is validated with `sub/.markspec.yaml`'s profile, not the parent's;
  - the scope header appears once per project;
  - `--format json` is one flat array.

### Task 3 — `lint` and `fmt` per project

- `lint`: per-project loop. `compileProject` (`cli/helpers.ts`) must accept the
  project root explicitly instead of `requireProjectConfig()` from the working
  directory.
- `fmt`: per-project loop; each project's profile and reference index come from
  that project.
- e2e tests: a nested-project tree for each command (per-project profile used,
  summary per project, exit code worst-of).

### Task 4 — docs

- `docs/guide/cli.md`: bare-scope paragraphs of `fmt`, `check`, `lint`; `lock`
  section notes it pins only its own project.
- `docs/architecture/adr-027-cli-smoother-defaults.md`: parity section notes the
  nested-project rule applies to both sides.
- `docs/architecture/adr-028-mcp-project-discovery.md` §7: replace the paragraph
  that says the CLI differs.
- `AGENTS.md` CLI rule "Explicit args = exact scope; bare invocation = announced
  project scope": mention nested projects.
