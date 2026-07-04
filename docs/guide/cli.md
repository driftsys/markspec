# CLI guide

Reference for `project.yaml`, every subcommand, and editor / LSP integration.

MarkSpec follows the [Command Line Interface Guidelines](https://clig.dev/).
Every command supports `--help`. Commands that produce structured output support
`--format json` for machine-readable output to stdout (diagnostics always go to
stderr).

**Exit codes:** `0` success, `1` error, `2` warnings only (`check`, `lint`).

**Global options** (available on every command):

| Flag            | Description               |
| --------------- | ------------------------- |
| `-h, --help`    | Show help                 |
| `-V, --version` | Show version              |
| `-q, --quiet`   | Suppress non-error output |

---

## Project configuration

### project.yaml

Every MarkSpec project requires a `project.yaml` in the project root. MarkSpec
discovers it by walking up from the current directory. `project.yaml` follows
the org project-manifest contract — the closed schema published at
[`https://driftsys.github.io/schemas/project/v1.json`](https://driftsys.github.io/schemas/project/v1.json)
— shared with other DriftSys tooling, not a MarkSpec-only format.

#### Minimal example

```yaml
name: my-project
version: "1.0.0"
```

#### Complete example

```yaml
name: io.acme.braking-system
version: "2.3.0"

dependencies: # projects this project uses (git repositories)
  - url: git@github.com:acme/aeb-icd.git
    name: icd # short id: cache dir, lock rows, badges
    version: "v2.1.0" # frozen baseline (exact tag)

references: # citation sources (published sites)
  - url: https://driftsys.github.io/refhub
    name: refhub
```

#### Fields

| Field          | Type         | Required | Description                                                                                                      |
| -------------- | ------------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `name`         | string       | yes      | Project name. Must match `^[a-z][a-z0-9.-]*$` (lowercase, digits, `.`, `-`). Reverse-DNS convention recommended. |
| `version`      | string       | yes      | Project version. Quote in YAML to avoid number coercion.                                                         |
| `dependencies` | projectRef[] | no       | Defaults to `[]`. Projects this project uses (git repositories). See the projectRef shape below.                 |
| `references`   | projectRef[] | no       | Defaults to `[]`. Registries and external sources this project cites (published sites). See below.               |

`name` and `version` are required — a `project.yaml` missing either is rejected
before any MarkSpec command runs. The schema is **closed**: an unrecognized key
is an error, not a silent no-op. A handful of org-owned fields MarkSpec accepts
but never acts on (`description`, `license`, `keywords`, `labels`, `authors`,
`homepage`, `repository`, `process`, …) are metadata for other org tooling, not
MarkSpec configuration — notably, `labels:` here is inert project metadata and
does not constrain which `Labels:` values entries may carry.

**markspec-specific tool config lives in `.markspec.yaml`, not `project.yaml`.**
`exclude:` and `caption-conventions:` moved there — see below.

#### The projectRef shape

`dependencies:` and `references:` are both lists of the same shape:

| Key       | Type   | Required | Description                                                                                                                                       |
| --------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`     | string | yes      | Git repository URL (`dependencies:`) or published-site base URL (`references:`; `file://` accepted).                                              |
| `version` | string | no       | Version intent: an exact tag freezes a baseline, a branch name tracks its head, absent means auto (latest release tag, else default-branch head). |
| `name`    | string | no       | Upstream id — cache-directory name, lockfile row id, origin badge. Must match `[A-Za-z0-9][A-Za-z0-9._-]*`. Derived from the URL when absent.     |

- **`dependencies:`** — other projects this project builds on (git
  repositories). **Declared but not yet acquired**: `markspec lock` reports each
  one on stderr but does not clone, compile, or pin it. Git dependency
  resolution is planned for a future release.
- **`references:`** — registries or external sources this project cites, such as
  another project's published compile output. `markspec lock` fetches and pins
  these against a cache — see [`lock`](#lock) below. The declared `version:` is
  recorded but not yet consulted when resolving a `references:` entry — `lock`
  currently fetches the site's latest published snapshot regardless of an exact
  tag or branch name; version-selecting resolution is planned for a future
  release.

#### Upstream entries resolve in the graph

Once `markspec lock` has pinned a `references:` entry, its entries join this
project's own traceability graph as read-only, origin-tagged citizens — not just
cached files on disk:

- **Trace links resolve across the repo boundary.** A `Satisfies:` (or any other
  trace attribute) value that names an upstream display ID resolves exactly like
  a same-project reference. `check`, `show`, `context`, `dependents`, and
  `report` all see the upstream entry, tagged with an `Origin:` line / column
  showing `<upstreamId>@<version>` — see [`show`](#show) and [`report`](#report)
  below.
- **`MSL-T014` replaces `MSL-L006`** for a trace value that still doesn't
  resolve once the project declares any `dependencies:`/`references:`: the
  warning names every upstream searched, e.g.
  `not found in project or
  upstreams: producta, icd`. A project with no
  declared upstreams keeps the plain `MSL-L006` behavior.
- **A project entry that reuses an upstream's display ID or `Id:` fails `check`
  with `MSL-R014`**, naming the colliding upstream origin — the same shape as
  the collision that fires when a profile
  [delivers a corpus](profiles.md#delivered-documents) (ADR-030), generalized to
  cover upstream origins too. Fix it by renaming the project entry; upstream
  entries are read-only.
- **`references:` entries are traceability leaves.** `report coverage` never
  reports one as an orphan or unsatisfied gap — a citation isn't something your
  own project is expected to cover. `dependencies:` entries participate in
  coverage like a project entry — but since git dependency acquisition hasn't
  shipped yet (above), no `dependencies:` entry hydrates into the graph today,
  so this only takes effect once that lands.
- **Upstream entries are validation-exempt, not edge-inert.** No structural
  checks or prose lint run against them — that already happened in their own
  repo's `check` — but they remain full resolution targets: a project entry's
  trace link to one still resolves, and so does an edge between two upstream
  entries once both are hydrated into the same graph.

**Root/program project pattern.** A root or program repository that references
every member repo aggregates the whole program's graph for free: each member's
entries hydrate into the root's compile, cross-repo trace edges resolve there,
and `report`, `dependents`, and `context` run against the entire program from
the root — both ends of every cross-repo edge are present. A repo referenced
through more than one path (a diamond — e.g. the root references both a
component and something that itself references that component) is still counted
exactly once: an upstream snapshot's own re-exported entries are skipped in
favor of that entry's authoring repo, so aggregating never double-counts or
collides.

### .markspec.yaml

`.markspec.yaml` carries markspec's own tool configuration: profile binding
(covered in the [Profile guide](profiles.md)) plus two file-discovery /
rendering settings that used to live in `project.yaml`:

| Field                 | Type                      | Default | Description                                                                                                                                                      |
| --------------------- | ------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exclude`             | string[]                  | `[]`    | Gitignore-syntax patterns excluded from project-wide file discovery (bare `check`/`lint`/`fmt`), anchored at the project root. Applied after `.gitignore` rules. |
| `caption-conventions` | map<string, above\|below> | `{}`    | Per-keyword caption-position convention (`Figure`, `Table`, `Listing`, `Feature`, `Equation`, `List`) enforced by `MSL-C072`.                                    |

**`exclude:` example** — skip a directory of example entry blocks that aren't
real requirements, plus a generated-file pattern:

```yaml
# .markspec.yaml
exclude:
  - skills/
  - "*.gen.md"
```

**Built-in skips.** File discovery always skips hidden directories (names
starting with `.`) and the common build-output / dependency directories
`node_modules`, `target`, `dist`, and `build`, on top of `.gitignore` and
`exclude:`. The build-output skip is overridable — re-include one with a negated
entry in `.gitignore` or `exclude:` (e.g. `exclude: ["!target/"]`).

**`caption-conventions:` example** — require every `Table` caption above its
block and every `Figure` caption below:

```yaml
# .markspec.yaml
caption-conventions:
  Table: above
  Figure: below
```

See the [Profile guide](profiles.md) for the profile-binding keys (`profiles:`,
`default-profile:`) this file also carries.

### Directory conventions

MarkSpec does not enforce a directory layout. By convention:

- `docs/` — Markdown files containing requirements and design documentation
- `src/` — source code with doc-comment entries (Rust `///`, Kotlin `/**`)
- `project.yaml` — project root marker

The `compile` and `report` commands accept explicit paths or globs:

```sh
markspec compile "docs/**/*.md"
markspec compile docs/requirements.md src/main.rs
```

Profile configuration (`.markspec.yaml` and profile manifests) is covered in the
[Profile guide](profiles.md).

---

## Commands

### Project setup

#### init

Scaffold a new MarkSpec project — writes `project.yaml`, `.markspec.yaml`, and
(unless opted out) client MCP configs and skills.

```sh
markspec init [target-dir]
```

| Flag            | Type   | Default | Description                                                              |
| --------------- | ------ | ------- | ------------------------------------------------------------------------ |
| `--client`      | string | —       | Force write for the named client (repeatable): `claude-code`, `opencode` |
| `--all-clients` | bool   | false   | Write configs for `claude-code` + `opencode` regardless of detection     |
| `--no-mcp`      | bool   | false   | Skip all MCP scaffolding                                                 |
| `--no-skills`   | bool   | false   | Skip `upskill add`                                                       |
| `--profile`     | string | —       | Profile spec (conflicts with `--no-profile`)                             |
| `--no-profile`  | bool   | false   | Core-only mode (`default-profile: false`)                                |
| `--binary-path` | string | —       | Absolute path to the markspec binary for MCP configs                     |
| `--dry-run`     | bool   | false   | Report decisions, write nothing                                          |
| `--force`       | bool   | false   | Overwrite skip-on-exists files; required for a non-empty dir or non-TTY  |
| `--format`      | string | `text`  | Summary format: `json`, `text`                                           |

**Examples:**

```sh
markspec init                                             # scaffold in cwd
markspec init ./my-project                                # scaffold in a new subdir
markspec init --profile git+https://github.com/org/profile
markspec init --all-clients --binary-path /opt/markspec/bin/markspec
markspec init --dry-run --format json                     # report, write nothing
```

### Authoring

#### fmt

Stamp ULIDs, fix indentation, normalize attributes, and format the whole
Markdown document — entry mechanics and surrounding prose in one pass (ADR-029).

```sh
# the whole project's markdown — what you run before committing
markspec fmt

# one file
markspec fmt docs/requirements.md

# check mode for CI — reports but doesn't modify
markspec fmt --check
```

```sh
markspec fmt [...files]
markspec fmt --check [...files]
```

| Flag      | Type | Default | Description                                              |
| --------- | ---- | ------- | -------------------------------------------------------- |
| `--check` | bool | false   | Report changes without writing. Exit 1 if changes needed |

**Bare invocation = whole-project markdown scope.** With no file arguments,
`fmt` discovers every `.md` file under the project root (gitignore +
`.markspec.yaml` `exclude:` honored) and prints a one-line scope header to
stderr (`formatting N file(s) under <root>`), suppressed by `-q`. Bare
invocation requires a discoverable `project.yaml`; outside a project it errors
rather than silently scanning the cwd. `fmt`'s scope is markdown-only — the
formatter never rewrites source files, unlike `check`/`lint` which also cover
source doc comments.

**Whole-document formatting (ADR-029).** Beyond entry-block mechanics, `fmt`
formats the entire Markdown document — headings, lists, tables, and prose —
through an embedded dprint-markdown plugin, with one fixed, zero-config style:
80-column line width, always-wrap prose, underscore emphasis, asterisk strong,
dash bullet lists, and the file's own line-ending convention preserved.

- **80 columns is a soft target, not a hard cap.** Table rows, links and
  reference definitions, and inline code spans are never split to fit — they may
  exceed 80 columns when they can't be broken.
- **`<!-- dprint-ignore -->` and `<!-- dprint-ignore-start/end -->`** work as a
  per-block opt-out, same as external dprint. An ignore-start/end pair MUST NOT
  span an entry block — entry blocks and surrounding prose format as separate
  segments, so a range that straddles both is not honored across the boundary.
- **Files that must stay unformatted** (long attribute-value lines in showcase
  docs, generated files) use `.markspec.yaml` `exclude:` — the same mechanism
  `check`/`lint` use, not a new flag.
- **Every rewrite is safety-gated.** If reformatting an entry body would change
  its meaning, `fmt` keeps the original text for that entry and reports an
  advisory `MSL-F012` instead of silently doing nothing or corrupting content.

Explicit arguments scope exactly to what's named; a directory argument expands
recursively with `.gitignore` (and the built-in hidden-directory skip) applied —
`.markspec.yaml` `exclude:` patterns are honored only for bare whole-project
invocation, not for explicitly-named directories:

```sh
# a subtree
markspec fmt docs/

# multiple files
markspec fmt docs/*.md
```

**Project-aware trace canonicalisation (requires `project.yaml`):**

When `markspec fmt` runs inside a project, it also canonicalises and heals trace
reference values:

- **Canonicalise** — any ULID written directly in a trace attribute
  (`Satisfies:`, `Derived-from:`, `Verified-by:`, etc.) is rewritten to the
  target entry's current display ID.
- **Heal** — if a target's display ID was renamed, the edge ledger in
  `markspec.lock` records the stable `target-ulid`; `fmt` uses it to rewrite the
  stale display ID to the target's new name.
- **Unresolved references are left as-is** — `markspec check` reports them via
  `MSL-L006`, or `MSL-T014` when the project declares `dependencies:`/
  `references:` (see
  [Upstream entries resolve in the graph](#upstream-entries-resolve-in-the-graph)
  above).

Neither action is performed when no `project.yaml` is discoverable (file-local
invocation). `fmt` reads the edge ledger but never writes `markspec.lock`; the
ledger is owned by `markspec lock`.

#### check

The composite traceability and hygiene gate — structure, traceability, format
drift, lockfile drift, and advisory prose, merged into one diagnostics stream.

```sh
# the whole project — what you wire into CI and the pre-push hook
markspec check

# one file, fast — what editors and per-file hooks run
markspec check docs/requirements.md

# a subtree
markspec check docs/
```

```sh
markspec check [...files]
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--strict` | bool   | false   | Promote warnings to errors    |
| `--format` | string | `text`  | Output format: `json`, `text` |

**Bare invocation = whole-project gate.** With no file arguments, `check`
discovers every relevant file (markdown + source doc comments) under the project
root (gitignore + `.markspec.yaml` `exclude:` honored) and prints a one-line
scope header to stderr (`checking N file(s) under <root>`), suppressed by `-q`
and in `--format json` mode. Bare invocation requires a discoverable
`project.yaml`; outside a project it errors rather than silently scanning the
cwd.

**The composite gate is project-wide only.** Bare `markspec check` runs every
gate below over the whole corpus in one pass, merging findings into a single
diagnostics stream (one text renderer, one `--format json` array, one exit-code
computation):

| Gate                               | Severity                                     | What it checks                                                                                                                                                                                                                                                                       |
| ---------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Parse + structure + attributes     | as today                                     | Malformed entry blocks, missing `Id:`, duplicate display IDs, malformed attributes.                                                                                                                                                                                                  |
| Traceability (incl. `MSL-L006`)    | as today (`MSL-L006` = warning)              | Broken `Satisfies:`/`Derived-from:`/etc. references; `MSL-L006` flags a trace value that doesn't resolve to any entry — or `MSL-T014` when the project declares `dependencies:`/`references:` (see [Upstream entries resolve in the graph](#upstream-entries-resolve-in-the-graph)). |
| Listing documents                  | as today                                     | Listing-file conventions (e.g. `SUMMARY.md` structure).                                                                                                                                                                                                                              |
| Format drift (`MSL-F010`)          | **error**                                    | The file's whitespace/attribute form differs from what `markspec fmt` would produce — i.e. it wasn't formatted before commit.                                                                                                                                                        |
| Reference-canon drift (`MSL-F011`) | **error**                                    | A trace value is a ULID or stale display ID that `markspec fmt` would rewrite to its canonical display ID (ADR-026 canonicalization). Distinct from `MSL-F010` so you know which fmt concern to fix.                                                                                 |
| Lockfile drift (`MSL-L212`)        | **error** (only when `markspec.lock` exists) | Traceability edges have changed since `markspec lock` last ran. Checked offline against the on-disk `markspec.lock` (no network).                                                                                                                                                    |
| Prose lint (`MSL-Q*`)              | **advisory warning**                         | The same rules `markspec lint` runs (modal verbs, EARS, passive voice, INCOSE lexicon, …).                                                                                                                                                                                           |

**`markspec check <file>` (file-local) runs structural validation only.** The
format-drift, lockfile, and prose-lint gates, and the `MSL-L006` trace-existence
warning, are project-wide-only — they need the full corpus (or the whole file's
formatted form) to be meaningful, so they don't fire when you pass explicit file
arguments. This is the fast, editor/per-file-hook path; the canonical agent
write loop is `insert → fmt → check` per file, then a project-wide `check`
before commit/CI catches everything else.

**Exit codes:** `0` clean, `1` any error, `2` warnings only (no errors).
`--strict` promotes every warning (including advisory prose findings) to an
error, so a project-wide `check --strict` is a stricter CI gate than the
default.

**Examples:**

```sh
# Whole project, JSON output for tool integration
markspec check --format json

# Strict mode — warnings become errors (useful for CI)
markspec check --strict

# One file, strict mode
markspec check --strict docs/requirements.md
```

### Querying

#### show

Show details of a single entry by display ID or ULID.

```sh
markspec show <id> <paths...>
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--format` | string | `text`  | Output format: `json`, `text` |

**Examples:**

```sh
markspec show STK_PRJ_0001 "docs/**/*.md"
markspec show --format json STK_PRJ_0001 docs/requirements.md
```

When the active profile [delivers a corpus](profiles.md#delivered-documents)
(ADR-030), or the entry hydrates from a locked `references:` upstream (see
[Upstream entries resolve in the graph](#upstream-entries-resolve-in-the-graph)),
the entry prints an extra `Origin:` line and its `Source:` renders as
`<profile-id-or-upstream-id>@<version>:<path>:<line>:<column>` instead of a raw
filesystem path:

```text
PLT_0001  Platform core service
  Type: platform-component
  Shape: Authored
  Origin: platform-arch@1.2.0
  ...
  Source: platform-arch@1.2.0:reference/platform.md:1:1
```

#### context

Walk the Satisfies chain upward from an entry to see what it ultimately
satisfies.

```sh
markspec context <id> <paths...>
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--depth`  | number | `10`    | Maximum depth to walk         |
| `--format` | string | `text`  | Output format: `json`, `text` |

**Examples:**

```sh
markspec context SRS_PRJ_0001 "docs/**/*.md"
markspec context --depth 3 SRS_PRJ_0001 docs/requirements.md
```

#### dependents

List all entries that depend on (satisfy) a given entry.

```sh
markspec dependents <id> <paths...>
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--format` | string | `text`  | Output format: `json`, `text` |

**Examples:**

```sh
markspec dependents STK_PRJ_0001 "docs/**/*.md"
```

### Building

#### compile

Parse files, build traceability graph, output compiled result.

```sh
markspec compile <paths...>
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--format` | string | `text`  | Output format: `json`, `text` |

**Examples:**

```sh
# Summary output
markspec compile "docs/**/*.md"

# Full JSON output for downstream tools
markspec compile --format json "docs/**/*.md" > compiled.json
```

#### report

Generate a traceability matrix or coverage report.

```sh
markspec report <kind> <paths...>
```

`kind` is one of: `traceability`, `coverage`.

| Flag       | Type   | Default | Description                        |
| ---------- | ------ | ------- | ---------------------------------- |
| `--format` | string | `md`    | Output format: `md`, `json`, `csv` |
| `--scope`  | string | —       | Filter by domain abbreviation      |
| `--label`  | string | —       | Filter by label value              |
| `--output` | string | —       | Write to file instead of stdout    |

**Examples:**

```sh
# Traceability matrix in Markdown
markspec report traceability "docs/**/*.md"

# Coverage report as CSV
markspec report coverage --format csv "docs/**/*.md"

# Write to file
markspec report traceability --output matrix.md "docs/**/*.md"

# Filter by label
markspec report traceability --label ASIL-B "docs/**/*.md"
```

The traceability matrix carries an **Origin** column: `project` for a
project-authored entry, or `<profile-id>@<version>` / `<upstream-id>@<version>`
for an entry injected from a profile's delivered corpus (ADR-030) or a locked
`references:` upstream (see
[Upstream entries resolve in the graph](#upstream-entries-resolve-in-the-graph)).
All three formats (`md`, `json`, `csv`) include it.

The coverage report treats a `references:` upstream entry as a traceability leaf
— it never appears in the orphan/unsatisfied gap lists, since a citation isn't
something your own project is expected to cover.

#### export

Emit the compiled traceability graph in a portable format.

```sh
markspec export <format> <paths...>
```

Supported formats: `json`, `yaml`, `csv`.

**Examples:**

```sh
# JSON export
markspec export json "docs/**/*.md" > compiled.json

# CSV — one row per entry: display ID, title, type, shape, id, file, line, origin
markspec export csv "docs/**/*.md" > entries.csv

# YAML
markspec export yaml "docs/**/*.md"
```

All three formats carry provenance (ADR-030): in `json` and `yaml`, a corpus
entry has an `origin: { kind: "profile", profileId, profileVersion }` field and
a federated-upstream entry (see
[Upstream entries resolve in the graph](#upstream-entries-resolve-in-the-graph))
has `origin: { kind: "upstream", upstreamId, version }` (project-authored
entries omit it); in `csv`, every row has an `origin` column holding
`<profile-id>@<version>` for corpus entries, `<upstream-id>@<version>` for
upstream entries, or `project` for project-authored ones.

#### insert

Append a scaffolded entry block to a file. This is the agent write path — use it
from scripts or AI agents rather than hand-authoring new blocks.

```sh
markspec insert <type> <file>
```

| Flag      | Type | Default | Description                               |
| --------- | ---- | ------- | ----------------------------------------- |
| `--print` | bool | false   | Echo the inserted block to stdout as well |

The command:

1. Finds the highest existing display ID for `<type>` in `<file>`.
2. Computes the next sequential display ID.
3. Generates a fresh ULID.
4. Appends the block with a blank separator.

**Example:**

```sh
markspec insert requirement docs/requirements.md --print
# → appends SRS_PRJ_0003, prints block to stdout
```

Follow with `markspec fmt` to normalize indentation and `markspec check` to
confirm no broken references.

#### create

Print a scaffolded entry block without writing it to any file.

```sh
markspec create <type> <paths...>
```

**Example:**

```sh
markspec create requirement "docs/**/*.md"
```

#### next-id

Print the next available display ID for a profile-declared type without creating
an entry.

```sh
markspec next-id <type> <paths...>
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--format` | string | `text`  | Output format: `json`, `text` |

**Example:**

```sh
markspec next-id requirement "docs/**/*.md"
# → SRS_PRJ_0004

markspec next-id requirement "docs/**/*.md" --format json
# → {"type":"requirement","displayId":"SRS_PRJ_0004"}
```

For a **named (counter-less) type** — one whose `display-id-pattern` has no
`{n}` counter, e.g. `sw-component: "SWC_{name}"` (ADR-025) — there is no number
to mint. `next-id`, `create`, and `insert` instead emit an upper-case `NAME`
placeholder template for you to fill in by hand (slug-valid, so the scaffold
still passes `markspec check`):

```sh
markspec next-id sw-component "docs/**/*.md"
# → SWC_NAME   (with a note on stderr: author the identifier yourself)
```

#### lint

Run prose-quality analysis on entries (INCOSE lexicon, modal keywords,
structural checks). Returns `MSL-Q` and `MSL-M` codes.

```sh
# the whole project — same rules bare `check` runs as an advisory gate
markspec lint

# one file or subtree
markspec lint docs/requirements.md
markspec lint docs/
```

```sh
markspec lint [...paths]
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--format` | string | `text`  | Output format: `json`, `text` |
| `--strict` | bool   | false   | Promote warnings to errors    |

**Bare invocation = whole-project scope**, same discovery rules (gitignore +
`.markspec.yaml` `exclude:`) as `check`/`fmt`, with a scope header on stderr
suppressed by `-q` / `--format json`.

A project-wide `markspec check` already runs these same prose rules as an
advisory (warning-level) gate — `lint` is useful on its own as a focused,
review-time surface with its own score roll-up and band summary, and for running
on an explicit file or subtree without pulling in the other `check` gates.

**Examples:**

```sh
markspec lint --strict
markspec lint --format json
markspec lint docs/requirements.md
```

#### score

Score a single piece of requirement prose against the PA-3 rule catalog. Unlike
`lint`, which walks a file's entries, `score` takes prose directly — useful for
a review-time or editor-integration check of one requirement.

```sh
markspec score --text "The system shall …"
```

| Flag       | Type   | Default | Description                                                            |
| ---------- | ------ | ------- | ---------------------------------------------------------------------- |
| `--text`   | string | —       | Inline prose to score                                                  |
| `--id`     | string | —       | Identifier to echo back in the result                                  |
| `--format` | string | —       | Output format: `json`, `text` (default: `text` on a TTY, `json` piped) |

**Examples:**

```sh
markspec score --text "The controller shall respond within 200 ms."
markspec score --id SRS_BRK_0001 --text "The system shall be fast." --format json
```

### Lockfile and external sync

#### lock

Generate or refresh `markspec.lock`. The lockfile pins upstream profile and
language-pack versions, resolves `references:` projectRefs (see
[project.yaml](#projectyaml) above) against their published compile output, and
records sync mappings discovered under `.markspec/sync/`. See
[ADR-022](../architecture/adr-022-lockfile-and-external-sync.md).

```sh
markspec lock
```

| Flag       | Type   | Default | Description                                                                 |
| ---------- | ------ | ------- | --------------------------------------------------------------------------- |
| `--check`  | bool   | false   | CI mode: read-only, exit `1` on drift.                                      |
| `--update` | string | —       | Force re-resolve every `references:` entry, or one by id (`--update=<id>`). |
| `--format` | string | `text`  | Output format: `json`, `text`.                                              |

**Examples:**

```sh
markspec lock                      # write or refresh markspec.lock
markspec lock --check              # CI gate: fail if lockfile is stale
markspec lock --update             # force re-resolve every reference
markspec lock --update=refhub      # force re-resolve one reference by id
```

**`references:` resolution — three flows.** Only `markspec lock` touches the
network; `check`, `compile`, the LSP, and the MCP server resolve entirely
offline from the pinned cache under `.markspec/cache/upstreams/<id>/`.
`markspec lock` keeps that directory gitignored automatically — it appends
`.markspec/cache/` to `.gitignore` the first time it runs, so nothing has to be
done by hand.

| Flow       | When                                                                                          | Behavior                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| First lock | A `references:` entry has no lockfile row yet.                                                | Fetch the published snapshot, cache it, write a pinned `[[upstream.registry]]` row.                                                           |
| Restore    | A row is already pinned but its cache is missing or broken (fresh clone, CI, a cleaned tree). | Re-fetch the pinned content and verify its hash still matches the lockfile, then repopulate the cache. The pin itself never moves on restore. |
| Update     | `markspec lock --update` (every reference) or `--update=<id>` (one).                          | Re-fetch and move the pin to whatever the source currently serves.                                                                            |

**Diagnostic codes:**

| Code       | When                           | Meaning                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSL-L213` | `markspec lock`                | A declared `references:` entry could not be locked — no derivable id, a fetch failure, a malformed manifest, or a schema-version mismatch.                                                                                                                                                  |
| `MSL-L214` | `markspec lock` (restore flow) | The cache needed restoring, but the re-fetched content's hash no longer matches the pinned snapshot — the published site moved. Run `markspec lock --update=<id>` to move the pin deliberately.                                                                                             |
| `MSL-L212` | `markspec check` (offline)     | Also covers upstream cache drift in this release: fires when a locked reference's cache under `.markspec/cache/upstreams/<id>/` is missing or its hash no longer matches `markspec.lock`, in addition to the existing traceability-edge-drift case. Either way, the fix is `markspec lock`. |

**`dependencies:` are declared, not yet acquired.** For each declared
`dependencies:` entry, `markspec lock` prints
`dependency '<id>' declared — git dependency acquisition lands in a future release; row not written`
to stderr, but does not clone, compile, or write a lockfile row for it — that
lands in a future release.

**CI caching.** `.markspec/cache/upstreams/` is safe to cache between CI runs —
key it on `markspec.lock`'s contents so a job only re-fetches a reference when a
pin actually moved:

```yaml
# .github/workflows/ci.yml (excerpt)
- uses: actions/cache@v4
  with:
    path: .markspec/cache/upstreams/
    key: markspec-upstreams-${{ hashFiles('markspec.lock') }}
```

**Upgrade note.** `markspec lock` now indexes source-file doc-comment entries in
addition to Markdown. A project that pinned its lockfile with an older MarkSpec
and has trace links in source files will see a one-time `MSL-L212` edge-drift
error from bare `markspec check` until you run `markspec lock` once to refresh
the pin — the requirements didn't change, only the set of files the lockfile
indexes did. `markspec doctor` surfaces the same drift as a non-blocking warning
(exit 2), so you can spot and clear it with `markspec lock` before `check`
blocks on it in CI.

#### sync

Read-only commands surfacing bound-entry state from `markspec.lock` and the
per-system NDJSON sync log under `.markspec/sync/<system>/log.ndjson`. `push` /
`pull` / `resolve` / `init` are connector-side and ship in per-tool ADRs.

```sh
markspec sync status [system]
markspec sync log    [system]
markspec sync show   <displayId>
```

**`sync status`** — group bound entries by `remote_state`:

| Flag       | Type   | Default | Description                                                                                                       |
| ---------- | ------ | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `--state`  | string | —       | Filter to one `remote_state` (`ok`, `behind`, `ahead`, `conflict`, `unreachable`, `deleted-upstream`, `unbound`). |
| `--format` | string | `text`  | Output format: `json`, `text`.                                                                                    |

**`sync log`** — tail the per-system sync log (NDJSON):

| Flag       | Type   | Default | Description                                              |
| ---------- | ------ | ------- | -------------------------------------------------------- |
| `--tail`   | number | `20`    | Number of lines from the end.                            |
| `--op`     | string | —       | Filter to one op: `push`, `pull`, `conflict`, `resolve`. |
| `--since`  | string | —       | Filter to entries at or after this RFC 3339 timestamp.   |
| `--format` | string | `text`  | Output format: `json`, `text`.                           |

**`sync show`** — full sync state for one bound entry:

| Flag       | Type   | Default | Description                    |
| ---------- | ------ | ------- | ------------------------------ |
| `--format` | string | `text`  | Output format: `json`, `text`. |

**Examples:**

```sh
markspec sync status                     # all systems, grouped by state
markspec sync status jira                # one system
markspec sync status --state conflict    # only conflicting entries
markspec sync log jira --tail 50 --op conflict
markspec sync show STK_BRK_0001
```

### Documents

#### doc build

Generate a single-document PDF via Typst.

```sh
markspec doc build <file>
```

| Flag           | Type   | Default      | Description      |
| -------------- | ------ | ------------ | ---------------- |
| `-o, --output` | string | `<file>.pdf` | Output file path |

**Examples:**

```sh
markspec doc build docs/spec.md
markspec doc build -o output/spec.pdf docs/spec.md
```

### Books

#### book build

Generate a multi-chapter static HTML site from a SUMMARY.md.

```sh
markspec book build
```

| Flag            | Type   | Default      | Description      |
| --------------- | ------ | ------------ | ---------------- |
| `-o, --output`  | string | `_site`      | Output directory |
| `-s, --summary` | string | `SUMMARY.md` | SUMMARY.md path  |

**Examples:**

```sh
markspec book build
markspec book build -o dist -s docs/SUMMARY.md
```

### Profile and diagnostics

#### profile show

Show the active profile chain and effective configuration.

```sh
markspec profile show
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--format` | string | `text`  | Output format: `json`, `text` |

When the active profile [delivers documents](profiles.md#delivered-documents)
(ADR-030), the text output gains a **Delivered documents** block listing each
file's path, role (`corpus` with an entry count, or `doc` with its description),
and providing tier — plus any missing-file issue
(`PROFILE-DELIVERS-001`/`-002`):

```text
Delivered documents (2):
  - reference/platform.md   corpus   1 entries   [platform-arch]
  - reference/guide.md   doc      Integration guide (read-only reference)   [platform-arch]
```

`--format json` includes the same list under a `delivers` key.

#### profile new

Scaffold a new profile directory with a starter manifest.

```sh
markspec profile new <id>
```

`<id>` must be lowercase alphanumeric with hyphens, optionally scoped
(`@org/name`).

```sh
markspec profile new my-profile
markspec profile new @acme/iso26262
```

Creates `<id>/markspec.yaml` and `<id>/README.md`.

#### profile add

Add a profile to the project's `.markspec.yaml`.

```sh
markspec profile add <spec>
```

`<spec>` is a local path or a scoped package name.

```sh
markspec profile add ./profiles/my-profile
markspec profile add @acme/compliance-profile
```

#### profile publish

Validate a profile manifest for publishability and print any issues.

```sh
markspec profile publish [--dir <dir>] [--format json|text]
```

Checks required fields (`id`, `version`), warns about missing `description` and
`license`, and reports any manifest validation errors. Exits `0` when the
manifest is publish-ready.

#### profile describe

Show full details for a profile element (type, attribute, relation, label, or
convention).

```sh
markspec profile describe <kind> <name>
```

`kind` is one of: `type`, `attribute`, `relation`, `label`, `convention`.

```sh
markspec profile describe type requirement
markspec profile describe attribute ASIL
markspec profile describe relation Satisfies
```

#### doctor

Project health check: verifies `project.yaml`, profile configuration, and
project structure.

```sh
markspec doctor
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--format` | string | `text`  | Output format: `json`, `text` |

When the active profile delivers documents (ADR-030), `doctor` reports the
document count, corpus entry count, and any health issue (declared-but-missing
file, corpus parse failure):

```text
Delivered documents: 2 (1 corpus entries)
```

When a `markspec.lock` is present, `doctor` also reports whether the project's
traceability edges still match the pin, using the same offline comparison
`check`'s `MSL-L212` gate performs. Drift is a **warning** (exit 2) here — the
proactive onramp so a stale lockfile is surfaced before a `markspec check` goes
red on it (`check` keeps the hard `MSL-L212` error, exit 1):

```text
⚠ Lockfile: traceability edges drifted (locked 12, current 15) — run `markspec lock`
```

`--format json` adds a `lockfile` block:

```json
{
  "lockfile": {
    "present": true,
    "edgeDrift": true,
    "lockedEdges": 12,
    "currentEdges": 15
  }
}
```

`present` is `false` when the project has no `markspec.lock`. The
`edgeDrift`/`lockedEdges`/`currentEdges` fields appear only when the lockfile
parses; a present-but-malformed lockfile reports `present: true` with the drift
fields omitted (its validity is `check`'s / `lock`'s concern, not `doctor`'s).
The drift warning uses the non-`MSL` `doctor` code `lockfile-edge-drift`, listed
in the shared `diagnostics` array. See the `lock` [Upgrade note](#lock) for the
one-time post-upgrade drift and how to clear it.

### Maintenance

#### self-upgrade

Download and atomically replace the running `markspec` binary with the latest
release (or a pinned version).

```sh
markspec self-upgrade
```

| Flag        | Type   | Default | Description                                          |
| ----------- | ------ | ------- | ---------------------------------------------------- |
| `--check`   | bool   | false   | Check only; exit `1` if a newer release is available |
| `--version` | string | —       | Pin a specific release (downgrade allowed)           |
| `--format`  | string | `text`  | Output format: `json`, `text`                        |

**Examples:**

```sh
markspec self-upgrade              # upgrade to the latest release
markspec self-upgrade --check      # CI/cron: exit 1 when an update exists
markspec self-upgrade --version 0.10.2
```

### AI agent integration

#### mcp

Start the MarkSpec MCP server. Communicates over stdio JSON-RPC. Exposes the
active project as MCP resources and tools to any MCP-capable AI client (Claude
Code, Claude Desktop, GitHub Copilot in VS Code, OpenCode).

```sh
markspec mcp
```

##### Project discovery

`markspec mcp` resolves the project root from the first of these that contains a
`project.yaml` or `.markspec.yaml` (walking upward from each):

1. `--root <path>` — pass the flag once per candidate root.
2. `MARKSPEC_PROJECT_ROOT` — colon-separated list of candidate roots.
3. `CLAUDE_PROJECT_DIR` — injected automatically by Claude Code (v2.1.139+); no
   configuration needed.
4. The server's launch working directory.

If none resolves, every MarkSpec tool replies with a message that begins "No
MarkSpec project found …" and names the directories it searched. Set `--root` or
`MARKSPEC_PROJECT_ROOT` to point the server at your project — this is the
reliable fix when it is launched from outside the project tree (for example a
user-scoped MCP install, whose working directory is the plugin cache, or a
monorepo opened at a parent directory).

```sh
markspec mcp --root /path/to/your/markspec-project
```

##### Resources

- `markspec://profile` — distilled profile manifest (types, attributes, link
  kinds, labels).
- `markspec://entries` — index of all project entries, grouped by type.
- `markspec://entry/{displayId}` — one entry per resource, with attributes,
  body, outgoing/incoming links.

##### Tools

- `entry_search { query, limit? }` — rank-search entries by display ID and
  title.
- `entry_context { id, depth? }` — walk the `satisfies` chain upward.
- `validate { files? }` — run the validator, return a Markdown diagnostics
  report.
- `markspec_refresh` — force-invalidate the compile cache (call after agent
  edits to guarantee freshness).

##### Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "markspec": {
      "command": "markspec",
      "args": ["mcp"],
      "cwd": "/path/to/your/markspec-project"
    }
  }
}
```

Restart Claude Desktop. The MarkSpec resources and tools appear in the attach
menu.

##### Claude Code

```sh
claude mcp add markspec --command markspec --args mcp --cwd /path/to/project
```

##### VS Code (Copilot)

The `markspec-ide` extension auto-registers the MarkSpec MCP server with VS Code
1.101+ — install the extension and the server appears in Copilot's MCP picker.
See [Editor and LSP integration — VS Code](#vs-code) below.

For users who don't run the extension, the manual recipe still works. Add a
`.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "markspec": {
      "command": "markspec",
      "args": ["mcp"]
    }
  }
}
```

Copilot does not support MCP resource subscriptions today, but the `markspec://`
resources still work — the server runs a fresh staleness check on every read, so
a re-read after an edit returns up-to-date content.

#### mcp install

Print MCP server configuration for a client. The output is the client's native
config snippet — pipe it to the client's settings file or copy-paste it.

```sh
markspec mcp install --client <client>
```

| Flag            | Type   | Default             | Description                                                                                                                |
| --------------- | ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--client`      | string | —                   | Client ID: `claude-desktop`, `claude-code`, `cursor`, `opencode`, `vscode`, `copilot`.                                     |
| `--scope`       | string | client default      | Config scope: `user` or `workspace`. Honoured by `copilot`; other clients are fixed to one scope.                          |
| `--binary-path` | string | invoked binary name | Explicit path to the `markspec` binary. Default writes the invoked name (resolves via `PATH`, surviving package upgrades). |

**Examples:**

```sh
markspec mcp install --client claude-desktop
markspec mcp install --client cursor
markspec mcp install --client vscode
markspec mcp install --client copilot                 # → .github/mcp.json
markspec mcp install --client copilot --scope user     # → ~/.copilot/mcp-config.json
markspec mcp install --client claude-desktop --binary-path /opt/markspec/bin/markspec
```

#### lsp install

Print LSP server configuration for an editor. The output is the editor's native
config snippet (JSON for VS Code, Lua for Neovim, JSON for Zed) — pipe it to the
editor's settings file or copy-paste it.

```sh
markspec lsp install --editor <editor>
```

| Flag            | Type   | Default             | Description                                                                                                                |
| --------------- | ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--editor`      | string | —                   | Editor ID: `vscode`, `neovim`, `zed`.                                                                                      |
| `--binary-path` | string | invoked binary name | Explicit path to the `markspec` binary. Default writes the invoked name (resolves via `PATH`, surviving package upgrades). |

**Examples:**

```sh
markspec lsp install --editor vscode
markspec lsp install --editor neovim
markspec lsp install --editor zed
markspec lsp install --editor vscode --binary-path /opt/markspec/bin/markspec
```

#### Install timeout (never hang)

`mcp install` and `lsp install` read the target config file before writing.
Under extreme host load — many concurrent `markspec` processes, a contended
filesystem, or a locked config file — that read can stall. Rather than hang
silently, both commands run under a watchdog: if the work does not finish within
a deadline, they print a diagnostic to stderr and exit non-zero (`1`).

The deadline defaults to 10 seconds (normal runs finish in well under one).
Override it with the `MARKSPEC_INSTALL_TIMEOUT_MS` environment variable — for
example `MARKSPEC_INSTALL_TIMEOUT_MS=30000` to wait 30 seconds on a slow host. A
missing, blank, or non-positive value keeps the 10-second default.

**Limitation.** The watchdog runs inside the process, so it can only fire once
the runtime has started. If a launch wedges even earlier — in the operating
system's process loader, which can happen under heavy fork/exec pressure — no
in-process timer can catch it. In that case, supervise the command externally
(`timeout 15 markspec mcp install …`) or register the server through your client
directly, e.g. `claude mcp add markspec -- markspec mcp`.

### Not yet implemented

These commands are registered but print an error and exit:

| Command      | Intended purpose               |
| ------------ | ------------------------------ |
| `book dev`   | Live preview with hot reload   |
| `deck build` | Slides → PDF via Touying/Typst |
| `deck dev`   | Live slide preview             |

---

## Editor and LSP integration

MarkSpec ships a built-in Language Server Protocol (LSP) server. Run it with:

```bash
markspec lsp
```

The server communicates over **stdio JSON-RPC** — the standard transport that
every LSP-capable editor supports.

### Features

**Diagnostics** — broken references, missing IDs, duplicate display IDs, and
malformed entries appear as inline errors and warnings as you type. File-local
checks run immediately; cross-file validation runs on save.

**Entry block completion** — type `- [` at the start of a line to get a
pre-filled entry block scaffold with the next available display ID for each type
defined in your profile.

**ID reference completion** — after a trace attribute keyword (`Satisfies:`,
`Derived-from:`, `Verified-by:`, etc.) the server suggests all known display IDs
in the project.

**Source file context guard** — in source files (Rust, Kotlin, Java, C, C++,
TypeScript, TSX, JavaScript, C#), completions only activate near entry markers
or trace keywords. The server won't interfere with your language's native LSP
(rust-analyzer, kotlin-lsp, etc.).

### VS Code

Install the **MarkSpec** extension from the `editors/vscode/` directory in this
repository. The extension requires VS Code **1.101 or newer** (the version that
introduced the stable MCP extension API).

The extension provides two integrations in one install:

- **LSP** — diagnostics, completions, and entry-block scaffolding in the editor.
- **MCP** — registers a `markspec` MCP server with VS Code so Copilot (and any
  other MCP-aware client) can use the project's resources and tools without a
  separate `.vscode/mcp.json`.

Both point at the same `markspec` binary, resolved from `markspec.server.path`.

#### From source

```bash
cd editors/vscode
npm install
npm run compile
```

Then in VS Code: `Extensions → ⋯ → Install from VSIX` or press `Ctrl+Shift+P` →
`Extensions: Install from VSIX…` and select the `.vsix` file, or use the
development host:

```bash
code --extensionDevelopmentPath=editors/vscode
```

#### Configuration

| Setting                 | Default      | Description                                               |
| ----------------------- | ------------ | --------------------------------------------------------- |
| `markspec.server.path`  | `"markspec"` | Path to the `markspec` binary (used by both LSP and MCP). |
| `markspec.server.args`  | `["lsp"]`    | Arguments passed to start the LSP server.                 |
| `markspec.mcp.enabled`  | `true`       | Register the MarkSpec MCP server with VS Code.            |
| `markspec.mcp.args`     | `["mcp"]`    | Arguments passed to start the MCP server.                 |
| `markspec.trace.server` | `"off"`      | Trace level: `off`, `messages`, or `verbose`.             |

If `markspec` is not on your PATH, set the full path:

```json
{
  "markspec.server.path": "/home/you/.local/bin/markspec"
}
```

#### MCP server

Once the extension is installed, the **MarkSpec** MCP server appears in
Copilot's MCP picker — no `.vscode/mcp.json` required. To disable the
registration:

```json
{
  "markspec.mcp.enabled": false
}
```

The manual `.vscode/mcp.json` recipe in
[mcp — VS Code (Copilot)](#vs-code-copilot) remains supported for editors that
don't run the extension.

### Neovim

Neovim's built-in LSP client works out of the box. Add this to your `init.lua`:

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = { "markdown" },
  callback = function()
    vim.lsp.start({
      name = "markspec",
      cmd = { "markspec", "lsp" },
      root_dir = vim.fs.root(0, { "project.yaml", ".git" }),
    })
  end,
})
```

For source files (Rust, Kotlin, etc.) where MarkSpec entry blocks appear in doc
comments, add the relevant file types to the `pattern` list:

```lua
pattern = { "markdown", "rust", "kotlin", "java", "c", "cpp" },
```

The server's context guard ensures it only activates near MarkSpec entry
markers, so it won't conflict with rust-analyzer or other language servers
running on the same buffer.

#### With nvim-lspconfig

If you use [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig), add a
custom server definition:

```lua
local lspconfig = require("lspconfig")
local configs = require("lspconfig.configs")

if not configs.markspec then
  configs.markspec = {
    default_config = {
      cmd = { "markspec", "lsp" },
      filetypes = { "markdown", "rust", "kotlin", "java", "c", "cpp" },
      root_dir = lspconfig.util.root_pattern("project.yaml", ".git"),
    },
  }
end

lspconfig.markspec.setup({})
```

### Other editors

Any editor with LSP support can use `markspec lsp`. The server expects:

- **Transport:** stdio (stdin/stdout JSON-RPC)
- **Trigger characters:** `[` (block scaffold) and `:` (ID reference)
- **Document sync:** full text on each change

Point your editor's LSP client at `markspec lsp` and it should work. If your
editor needs a specific configuration example, please open an issue.
