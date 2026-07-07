# AGENTS.md

Instructions for AI coding agents working in this repository.

## Project

MarkSpec is a CLI tool and Markdown flavor for traceable industrial
documentation. It parses requirements from Markdown files and source code doc
comments, validates traceability links, stamps ULIDs, and generates output
formats (JSON, CSV, ReqIF, PDF, static site). It targets ISO 26262 and ASPICE
compliance workflows.

Runtime: Deno/TypeScript. Single binary distribution via `deno compile`.

## Repository layout

Deno workspace. Root `deno.json` defines the workspace; each package under
`packages/` has its own `deno.json`.

```text
markspec/
├── deno.json                        ← workspace root (tasks, workspace members)
├── packages/
│   └── markspec/                    ← @driftsys/markspec package
│       ├── deno.json                ← package config (name, version, exports)
│       ├── main.ts                  ← entry point, subcommand dispatch
│       ├── core/
│       │   ├── mod.ts               ← public API barrel (the library boundary)
│       │   ├── mod_test.ts          ← unit test (colocated)
│       │   ├── model/               ← types: Entry, EntryShape (Authored |
│       │   │   └── mod.ts             Reference), DisplayId, Ulid, Attribute,
│       │   │                          SourceLocation, ProjectConfig
│       │   ├── config/              ← project.yaml discovery + loading
│       │   │   └── mod.ts
│       │   ├── profile/             ← profile manifest load, merge, resolver
│       │   │   └── mod.ts             (ADR-008; .markspec.yaml activates chain)
│       │   ├── parser/              ← file → Entry[]. Two sub-modules:
│       │   │   ├── mod.ts
│       │   │   ├── markdown.ts      ←   CommonMark AST walk, entry detection
│       │   │   ├── markdown_test.ts ←   unit test (colocated)
│       │   │   └── source.ts        ←   doc comment extraction, delegates to
│       │   │                            markdown parser
│       │   ├── formatter/           ← write-back: ULID stamping, indentation
│       │   │   └── mod.ts             normalization, trailing backslashes
│       │   ├── validator/           ← file-local + cross-file checks (broken
│       │   │   └── mod.ts             refs, missing Ids, duplicates)
│       │   ├── compiler/            ← glob → parsed entries → resolved graph →
│       │   │   └── mod.ts             compiled JSON
│       │   └── reporter/            ← compiled JSON → output formats (json, csv,
│       │       └── mod.ts             reqif, yaml, coverage, traceability matrix)
│       ├── render/
│       │   ├── mod.ts
│       │   ├── typst/               ← Typst WASM embedding, PDF pipeline
│       │   │   ├── template.ts      ←   Markdown → Typst source. Entry blocks
│       │   │   │                        are spliced as req-block() calls.
│       │   │   └── mod.ts           ←   NodeCompiler wrapper
│       │   ├── styles/              ← Markdown-level entry block transformer
│       │   │   └── mod.ts               (styleRequirementBlocks)
│       │   ├── mustache/            ← {{variable}} preprocessing from
│       │   │                          project.yaml
│       │   └── captions/            ← figure/table numbering
│       ├── book/
│       │   ├── mod.ts
│       │   ├── site/                ← static HTML generation (web book)
│       │   └── summary/             ← SUMMARY.md parsing
│       ├── deck/
│       │   ├── mod.ts
│       │   └── touying/             ← slide layouts, directives
│       ├── cli/
│       │   └── commands/            ← one file per subcommand
│       ├── lsp/
│       │   ├── server.ts            ← LSP server entry point (stdio JSON-RPC).
│       │   │                          Capabilities: diagnostics, completions,
│       │   │                          hover, definition, references, document /
│       │   │                          workspace symbols, rename, folding,
│       │   │                          document highlights, code actions.
│       │   ├── workspace.ts         ← in-memory entry index, incremental updates
│       │   ├── diagnostics.ts       ← core Diagnostic → LSP Diagnostic bridge
│       │   ├── completions.ts       ← block scaffold + ID reference + Type:
│       │   │                          value completion triggers
│       │   ├── hover.ts             ← hover provider: display-ID extraction +
│       │   │                          Markdown-rendered Entry preview
│       │   ├── definition.ts        ← Entry → LSP Location for go-to-definition
│       │   ├── references.ts        ← find-all-references: walks entry
│       │   │                          attributes for whole-token matches
│       │   ├── rename.ts            ← workspace rename + prepareRename:
│       │   │                          whole-token text edits across every file
│       │   ├── symbols.ts           ← document-symbol (outline) + workspace-
│       │   │                          symbol (fuzzy entry search) builders
│       │   ├── folding.ts           ← one foldable region per entry block
│       │   ├── highlights.ts        ← document highlights (read / write) for
│       │   │                          whole-token display-ID matches in file
│       │   ├── code_actions.ts      ← quick-fix code actions for diagnostics
│       │   │                          (MSL-M060 lowercase, MSL-A030 remove,
│       │   │                          MSL-T020 suggest, MSL-A013 dedup,
│       │   │                          MSL-A011 multi-line, MSL-A012 remove)
│       │   ├── context.ts           ← doc comment context guard (source files)
│       │   └── util.ts              ← URI↔path conversion, debounce
│       └── mcp/
│           └── server.ts            ← MCP protocol adapter
├── editors/
│   └── vscode/                      ← markspec-ide VSCode extension
│       ├── package.json
│       ├── src/extension.ts         ← spawns `markspec lsp`, connects to VSCode
│       └── tsconfig.json
├── theme/
│   └── tokens.yaml                  ← canonical design tokens SSOT (run `just tokens`)
├── docs/
│   ├── spec/                        ← language specification (published as book)
│   │   ├── language/language.md     ←   grammar, entry format, attributes
│   │   └── typography/typography.md ←   fonts, layout, palettes, entry rendering
│   ├── guide/                       ← user-facing documentation (published as
│   │                                  book)
│   ├── examples/                    ← showcase documents (excluded from formatters)
│   │   └── entry-rendering.md       ←   all entry types, pills, cross-refs
│   ├── product/                     ← internal engineering (not published)
│   └── architecture/                ← architecture decision records (ADRs)
└── tests/
    ├── e2e/
    │   ├── helpers.ts               ← shared test helper (markspec() function)
    │   ├── validate_test.ts         ← blackbox: runs the CLI binary
    │   ├── format_test.ts
    │   ├── export_test.ts
    │   └── help_test.ts
    └── fixtures/                    ← sample .md and source files for testing
```

**Read these files for current LSP implementation — do not rely on prose
alone:**

@packages/markspec/lsp/server.ts @packages/markspec/lsp/workspace.ts
@packages/markspec/lsp/completions.ts @packages/markspec/lsp/hover.ts
@packages/markspec/lsp/definition.ts @packages/markspec/lsp/references.ts
@packages/markspec/lsp/rename.ts @packages/markspec/lsp/symbols.ts
@packages/markspec/lsp/folding.ts @packages/markspec/lsp/highlights.ts
@packages/markspec/lsp/code_actions.ts @packages/markspec/lsp/context.ts
@packages/markspec/lsp/diagnostics.ts @packages/markspec/lsp/util.ts
@packages/markspec/main.ts

## Key rules

**Single binary, lazy loading.** `main.ts` dispatches subcommands. Each
subcommand dynamically imports only the modules it needs. `markspec check` never
loads Typst WASM. `markspec book build` never loads ReqIF.

**One compile target — one binary:**

```bash
deno compile packages/markspec/main.ts            # → markspec
```

All subcommands — including `lsp` and `mcp` — are dispatched from the single
`markspec` binary. There is no separate `markspec-lsp` or `markspec-mcp` binary.
The `lsp/server.ts` and `mcp/server.ts` modules are dynamically imported by
`main.ts` when the corresponding subcommand is invoked.

**`core/mod.ts` is the library boundary.** Everything outside `core/` imports
from `core/mod.ts`, never from internal paths like `core/parser/markdown.ts`.
This is enforced by convention. When an external consumer needs the library, we
add a `deno.json` to `core/` and publish to JSR — nothing else changes.

**Dependency flow is strictly one-directional:**

```text
model
  ↑
parser
  ↑         ↑
formatter   validator
               ↑
            compiler
               ↑
            reporter
```

No cycles. Each module is independently testable with fixtures.

**WASM migration path.** `parser/` and `formatter/` are the primary candidates
for future Rust/WASM migration. The TypeScript API in `core/mod.ts` stays
unchanged — callers never know the implementation swapped. Don't prematurely
optimize; start with pure TypeScript.

## Build commands

```bash
deno check packages/markspec/main.ts packages/markspec/core/mod.ts \
  packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts  # type-check
deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi  # run all tests
deno lint                                                           # lint
deno fmt && dprint fmt                                              # format (TS + MD/JSON/YAML)
deno fmt --check && dprint check                                    # format check (CI)
```

Or via `just` (preferred):

```bash
just check                      # lint + test + type-check (all three)
just test                       # test only
just lint                       # deno lint + dprint check
just build                      # check (lint+test+typecheck) + compile binary → dist/markspec
just fmt                        # deno fmt (TS) + dprint fmt (MD/JSON/YAML/TOML)
just tokens                     # regenerate Typst + CSS from theme/tokens.yaml
just compile                    # compile CLI binary → dist/markspec
just clean                      # remove build artifacts
```

**`just verify` does not exist.** Use `just build` before opening a PR.

**Two separate format tools:** `deno fmt` handles TypeScript only; `dprint fmt`
handles Markdown, JSON, YAML, TOML. CI runs them as separate jobs — both must
pass. `CHANGELOG.md` and `docs/examples/` are excluded from dprint.

**Design tokens CI gate:** Editing `theme/tokens.yaml` requires running
`just tokens` and committing the generated files
(`packages/markspec-typst/tokens.typ`,
`packages/markspec-typst/themes/light.typ` and `dark.typ`,
`theme/markspec.css`). CI runs `scripts/check_tokens.sh` and fails if stale.

## CLI subcommands

### Implemented

| Command                               | Module                            | Purpose                                                                                                                                                                                                                      |
| ------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `markspec fmt [...files]`             | `core/formatter`                  | Stamp ULIDs, fix indentation, normalize attributes, and format the whole Markdown document (ADR-029). Bare = whole-project markdown scope.                                                                                   |
| `markspec check [...files]`           | `core/validator` + gates          | Composite gate: structure, traceability, listing docs, fmt drift (MSL-F010 + MSL-F011 reference canon), offline lockfile drift (MSL-L212), advisory prose lint. Bare = whole project; the extra gates run project-wide only. |
| `markspec compile <paths...>`         | `core/compiler`                   | Parse all files, build traceability graph, output compiled JSON.                                                                                                                                                             |
| `markspec show <id> <paths...>`       | `core/compiler`                   | Show details of a single entry by display ID or ULID.                                                                                                                                                                        |
| `markspec context <id> <paths...>`    | `core/compiler`                   | Walk the Satisfies chain upward from an entry.                                                                                                                                                                               |
| `markspec dependents <id> <paths...>` | `core/compiler`                   | List all entries that depend on a given entry.                                                                                                                                                                               |
| `markspec report <kind> <paths...>`   | `core/reporter`                   | Generate traceability matrix or coverage report.                                                                                                                                                                             |
| `markspec profile show`               | `core/profile`                    | Show the active profile chain and effective configuration.                                                                                                                                                                   |
| `markspec doctor`                     | `core/profile` + `core/validator` | Project health check: profile, config, and validation summary.                                                                                                                                                               |
| `markspec next-id <type> <paths...>`  | `core/compiler` + `core/profile`  | Print the next available display ID for a profile-declared type.                                                                                                                                                             |
| `markspec create <type> <paths...>`   | `core/compiler` + `core/profile`  | Scaffold a new entry block for a profile-declared type (stdout).                                                                                                                                                             |
| `markspec insert <type> <file>`       | `core/compiler` + `core/profile`  | Append a scaffolded entry block to the file (agent write path).                                                                                                                                                              |
| `markspec export <format> <paths...>` | `core/compiler`                   | Emit the compiled traceability graph as json, yaml, or csv (reqif pending).                                                                                                                                                  |
| `markspec lint [...paths]`            | `core/lint`                       | Prose-analysis lint (modal verbs, EARS, passive voice, INCOSE, flagship). Bare = whole project.                                                                                                                              |
| `markspec lock`                       | `core/lock`                       | Generate or refresh `markspec.lock` (upstream pins, sync mappings).                                                                                                                                                          |
| `markspec sync {status\|log\|show}`   | `core/sync`                       | Read-only surface over lockfile + per-system sync log (NDJSON).                                                                                                                                                              |
| `markspec doc build <file>`           | `render/typst`                    | Single document → PDF via Typst WASM.                                                                                                                                                                                        |
| `markspec book build`                 | `book/site`                       | Multi-chapter → static HTML site. Not used for the published docs site yet — mdBook is, pending chrome parity (#804).                                                                                                        |
| `markspec lsp`                        | `lsp/server`                      | LSP server for editor integration (stdio JSON-RPC).                                                                                                                                                                          |
| `markspec lsp install`                | `lsp/server`                      | Print LSP server configuration for an editor (vscode, neovim, zed).                                                                                                                                                          |
| `markspec mcp`                        | `mcp/server`                      | MCP server for AI agent integration (stdio JSON-RPC).                                                                                                                                                                        |
| `markspec mcp install`                | `mcp/server`                      | Print MCP server configuration for a client (claude-desktop, cursor, vscode).                                                                                                                                                |

### Not yet implemented

These commands are registered in `main.ts` but print an error and exit. Do not
invoke them.

| Command                 | Intended purpose                |
| ----------------------- | ------------------------------- |
| `markspec export reqif` | ReqIF XML export.               |
| `markspec book dev`     | Live preview with hot reload.   |
| `markspec deck build`   | Slides → PDF via Touying/Typst. |
| `markspec deck dev`     | Live slide preview.             |

**Project context:** `fmt` and `check` work file-locally without a
`project.yaml` when given explicit file arguments. Invoked bare (no args),
`fmt`/`check`/`lint` require a discoverable `project.yaml` — bare invocation in
a project activated only by `.markspec.yaml` (no `project.yaml`) reports "no
project root found" (known limitation). All other commands (`compile`, `show`,
`context`, `dependents`, `report`, `next-id`, `doc build`, `book build`) require
a `project.yaml` found by walking up from the working directory.

## Entry block rendering pipeline

`markspec doc build` renders entry blocks with admonition-style left borders,
type-based coloring, label pills, and dashed-underline cross-references.

**How it works:**

1. `render/mod.ts` calls `parse(markdown)` to extract `Entry[]` before
   rendering.
2. `render/typst/template.ts` (`generateTypstDocument`) splits the document at
   entry block boundaries and emits `#req-block(...)` Typst calls for entries;
   prose segments go through `cmarker`.
3. `packages/markspec-typst/entry.typ` defines `req-block`, `pill`, `cross-ref`,
   and `entry-category`. Imported into `lib.typ`.

**Design tokens:**

Entry type colors live in `theme/tokens.yaml` under `entries:`. Two Paul Tol
palettes are used — bright (print/PDF) and vibrant (screen/HTML). Type buckets
are profile-driven; the table below shows the current prefix mapping used by the
legacy Typst renderer (to be replaced by profile-declared type → color-bucket
mapping under the new entry model — see ADR-011):

| Bucket | Prefixes (legacy)  | Print     | Screen    |
| ------ | ------------------ | --------- | --------- |
| req    | STK, SYS, SWE, SRS | `#4477AA` | `#0077BB` |
| spec   | ARC, SAD, ICD      | `#228833` | `#009988` |
| test   | TST, VAL, SIT, SWT | `#EE6677` | `#EE7733` |

Run `just tokens` after editing `tokens.yaml` to regenerate:

- `packages/markspec-typst/tokens.typ`
- `packages/markspec-typst/themes/light.typ` and `dark.typ`
- `theme/markspec.css`

**`docs/examples/` is excluded from both `deno fmt` and `dprint`.** Example
files contain attribute value lines that exceed 80 chars and must not be
line-wrapped by formatters.

The `render/styles/mod.ts` module (`styleRequirementBlocks`) is an earlier
Markdown-level transformer — it produces styled Markdown rather than Typst calls
and is not yet wired into the pipeline. The Typst splicing approach in
`template.ts` is the active rendering path.

## Entry types used in this project

| Prefix | Name                              | Where                                      |
| ------ | --------------------------------- | ------------------------------------------ |
| STK    | Stakeholder Requirement           | `docs/product/stakeholder-requirements.md` |
| SAD    | Software Architecture Description | `docs/product/software-architecture.md`    |

MarkSpec's core defines no type vocabulary — all types come from profiles. See
[ADR-009 — Core / Profile Boundary](docs/architecture/adr-009-core-profile-boundary.md)
and [ADR-010 — Default Profile](docs/architecture/adr-010-default-profile.md).
This project uses STK (stakeholder requirement) and SAD (software architecture
description) entry types under a lightweight project profile. A full compliance
profile (ASPICE, ISO 26262) would declare additional types
(software-requirement, unit-test, integration-test, …).

## Technology stack

- **Runtime:** Deno (latest stable)
- **Language:** TypeScript (strict mode)
- **Markdown parsing:** unified / remark / mdast ecosystem
- **Source file parsing:** tree-sitter (for doc comment extraction from Rust,
  Kotlin, Java, C, C++, TypeScript, TSX, JavaScript, C#)
- **PDF rendering:** Typst via typst.ts WASM embedding
- **Book rendering:** custom static site generator (`book/` module)
- **Presentations:** Touying (Typst presentation framework)
- **LSP:** vscode-languageserver-node (reference implementation)
- **MCP:** Anthropic MCP SDK (TypeScript)
- **Templating:** Mustache (logic-less, key-value only)
- **IDs:** ULID for universal uniqueness, display IDs for human readability
- **Fonts:** IBM Plex family (Serif for body, Sans for headings, Mono for IDs
  and code)
- **Formatting:** dprint (non-configurable)

## Docs layout

Three folders, three purposes. Two are published as books (GitLab/GitHub Pages),
one is internal.

```text
docs/
├── spec/                            ← public language specification
│   ├── SUMMARY.md                     (published as separate book)
│   ├── language/language.md         ← MarkSpec grammar: CommonMark + GFM/GLFM
│   │                                  subset, entry format, attributes
│   └── typography/typography.md     ← fonts, page layout, diagram sizing,
│                                      color palettes
├── guide/                           ← user-facing documentation
│   ├── SUMMARY.md                     (published as separate book)
│   ├── getting-started.md
│   ├── configuration.md
│   ├── cli.md                       ← CLI reference: all subcommands, flags,
│   │                                  examples
│   └── recipes/                     ← how-to guides, common workflows
├── product/                         ← internal engineering (not published,
│   │                                  readable raw on GitHub/GitLab)
│   ├── stakeholder-requirements.md  ← STK entries
│   └── software-architecture.md     ← SAD entries
```

**Architecture decision records** live in `docs/architecture/`:

- `adr-001-markdown-format.md` — CommonMark + GFM/GLFM subset
- `adr-002-entry-model.md` — identified and referenced entry shapes
- `adr-003-diagram-authoring.md` — SVG authoring conventions
- `adr-004-book-structure.md` — SUMMARY.md + four-part book structure
- `adr-005-cli-architecture.md` — subcommand dispatch, single binary
- `adr-006-property-model.md` — observed facts (file, git, sync, build, source)
- `adr-007-document-structure.md` — YAML front matter, document-id
- `adr-008-profile-system.md` — profile manifest, distribution, extends chain
- `adr-009-core-profile-boundary.md` — the anchoring core/profile split
- `adr-010-default-profile.md` — bundled RFC 2119 baseline profile
- `adr-011-language-pack-and-dependency-ingestion.md` — languages + SBOM
- `adr-012-diagnostic-code-scheme.md` — phased adoption of the nextgen
  diagnostic-code catalogue (current `language.md` §8 scheme stays authoritative
  for `main` until a sequenced migration phase)
- `adr-013-document-directive-not-a-resolution-step.md` — the family-hint
  document directive is a `markspec fmt` concern, not a validator
  type-resolution step (type-chain "step 7" deferred by design)
- `adr-014-canonical-body-ast.md` — canonical body-AST is the load-bearing body
  model; formatter uses a safe string fallback where the build/render inverse
  isn't total; B044/C072 shipped (bounded ADR-012 exception), M050/M051
  deferred-by-dependency (entity-resolution spec not on `main`)
- `adr-015-ast-equivalence-formatting-contract.md` — SP3 AST-equivalence
  formatting contract: `build(format(x)) ≈ normalizeBodyAst(build(x))`; ratifies
  `astEquivalent` into production; retires ADR-014 Decision-2's
  non-total-inverse caveat; RESIDUAL=0/58
- `adr-016-body-token-ast.md` — flat `Entry.bodyTokens` stream as the single
  extraction layer for modal verbs, EARS triggers, Gherkin keywords,
  `$Identifier` entity refs and inline code; supersedes ADR-014's
  `InlineContent.markers`; `LineMap` carries file-relative positions through
  source-file doc-comment parsing
- `adr-017-discipline-classification.md` — derive SW/HW discipline from the
  Allocated-to graph; introduces `Entry.derivedDiscipline?`; ships in slices
  (registry + channels + default + mixed + `discipline_mode`)
- `adr-018-core-discipline-ssot.md` — single source of truth for SW/HW
  discipline lives in core (R3 / Path A++); profile extends, never overrides
- `adr-019-typl-type-dsl.md` — typl Type Specification DSL for inline
  constraint/type declarations on entry attributes; parser + four surfaces
  (inline, bullet, fenced, table) + validation + corpus type registry
- `adr-020-sqlite-indexing-eval.md` — evaluation scope for on-demand SQLite
  indexing as Phase 1 of the background-indexing epic (no FS watcher, surgical
  invalidation, lockfile-pinned federated cache)
- `adr-021-prose-analysis-flagship-build.md` — Stage-2 prose-analysis design: 16
  active MSL-Q rules + flagship `xref-glossary-undefined` + band-count score
  roll-up; deliberate non-feature: no trend artifacts in core
- `adr-022-lockfile-and-external-sync.md` — `markspec.lock` format for upstream
  version pinning + sync state tracking (`markspec lock`,
  `markspec sync status|log|show`)
- `adr-023-mcp-trigger-language.md` — MCP server's agent-facing trigger language
  (TRIGGER / PREFER over / SKIP grammar) + project-detection soft gate so tools
  self-describe "no MarkSpec project found" outside MarkSpec workspaces
- `adr-024-interface-as-contract.md` — re-parent `SoftwareInterface` /
  `HardwareInterface` from `Component` to `Contract` (an interface is a
  specification, not a building block); `Provides`/`Requires` provider/consumer
  links; supersedes the type tree shown in ADR-017
- `adr-025-counter-less-display-id-pattern.md` — counter-less ("named")
  `display-id-pattern` so types whose IDs are named, not numbered (components
  `SWC_LIGHT_CTRL`, `HWC_PIU`) classify by prefix without an explicit `Type:`;
  refines ADR-009 §5; classification-only (not mintable)
- `adr-026-display-id-trace-resolution.md` — display IDs are the canonical
  authored form for trace-relation values; permissive slug-shape gate +
  `MSL-L006` existence warning; lockfile `[[edge]]` ULID ledger; `core/refs/`
  purity boundary; `fmt` canonicalise + rename-heal; MSL-L006 vs deferred
  ADR-012 §8.3 T-family; additive `[[edge]]` on ADR-022 lockfile
- `adr-027-cli-smoother-defaults.md` — bare `check`/`lint`/`fmt` default to
  whole-project scope via gitignore-aware `core/discovery/`; `project.yaml`
  `exclude:`; `check` becomes the composite gate (structure + traceability + fmt
  drift `MSL-F010` + lockfile drift `MSL-L212` + advisory prose lint); extra
  gates are project-wide only, file-local `check <file>` stays fast structural;
  lock↔check discovery parity; known limitation: `.markspec.yaml`-only projects
  don't satisfy bare-invocation root discovery
- `adr-028-mcp-project-discovery.md` — `markspec mcp` resolves its project root
  from an ordered candidate list (`--root` > `MARKSPEC_PROJECT_ROOT` >
  `CLAUDE_PROJECT_DIR` > `cwd`), resolved once at startup; MCP roots
  deliberately dropped (unimplemented on Claude Code); soft gate names the
  searched dirs
- `adr-029-whole-document-markdown-formatting.md` — `markspec fmt` formats the
  entire Markdown document by default via an embedded, exact-pinned
  dprint-markdown WASM plugin; fixed zero-config style (80-column soft limit,
  `textWrap: always`); dprint rewrites are gated by a CommonMark-semantic
  equivalence comparator with an MSL-F012 fallback; `check`'s MSL-F010 now
  covers prose drift
- `adr-030-profile-delivered-documents.md` — `profile.delivers:` lets a profile
  ship document files to consumers, per file flagged as a traceable corpus
  (joins the graph, provenance via `Entry.origin`) or docs-only; one core loader
  (`loadDeliveredCorpus`) feeds the CLI compiler, LSP, and MCP server;
  collisions are `MSL-R014`; no `CORE_SCHEMA_VERSION` bump
- `adr-031-federated-upstream-resolution.md` — cross-repo trace references via
  org `project.yaml` `dependencies:`/`references:` resolved offline from
  lock-pinned snapshots (only `markspec lock` touches the network); upstream
  entries join the graph as read-only citizens (`Entry.origin` upstream kind,
  reuses ADR-030); flat ID space with `MSL-R014` collisions; `MSL-T014`
  unresolved-after-federation, `MSL-L213`/`L214` lock failures, `MSL-L215`
  unreleased-pin advisory (promoted under `check --strict`); manifest gains
  optional `project.version`
- `adr-032-process-profile-boundary.md` — the org `process:` field and
  `.markspec.yaml` profile activation are orthogonal; no `check` coupling
  between them (would breach ADR-009/010)
- `adr-033-mdbook-interim-restoration.md` — reverts the #77/PR #762 native-
  renderer cutover for the 4 published books back to mdBook (book.toml,
  `justfile`, `pages.yaml`); native `markspec book build` code/tests kept but
  unwired from the public site pending chrome parity (nav, search, syntax
  highlighting, print, theme toggle)
- `adr-034-uxil-interaction-dsl.md` — uxil UX Interaction DSL: `ux:` reference
  grammar, closed kind/verb vocabularies, base resolution via `core/decl`,
  corpus registry + machine projection, `declares: ux-surface` profile gate;
  sibling of ADR-019
- `overview.md` — narrative architecture tour

See [docs/architecture/overview.md](docs/architecture/overview.md) for a reading
order.

**Conventions:**

- This project uses **STK and SAD only**. No SYS, SRS, or ICD entries. The guide
  serves as interface documentation.
- `product/` is flat — requirements and architecture entries live side by side
  as peer work products.
- `architecture/` is a peer of `product/`, `guide/`, and `spec/` — it groups
  ADRs separately because they have a different lifecycle (immutable once
  accepted, accumulate over time).
- `spec/` and `guide/` each have their own `SUMMARY.md` and build as independent
  books.
- `product/` is not bundled into a book — it is just files in the repo, readable
  natively on GitHub/GitLab.

## CLI framework and conventions

### CLI standard: clig.dev

All MarkSpec CLI behavior must comply with the **Command Line Interface
Guidelines** at <https://clig.dev/>. This is the same standard followed by
`git-std` and all DriftSys CLI tools.

Key rules from clig.dev that apply directly to MarkSpec:

- **stdout for data, stderr for messaging.** Primary output (JSON, Markdown,
  requirement listings) goes to stdout. Log messages, progress, errors,
  diagnostics go to stderr. Never mix them.
- **Exit code 0 on success, non-zero on failure.** Map non-zero codes to failure
  modes: 1 for errors, 2 for warnings only.
- **`-h` and `--help` on every command and subcommand.** Show concise help by
  default (description, examples, common flags), full help with `--help`.
  `markspec help subcommand` should also work.
- **Lead with examples in help text.** Users read examples first. Show the
  common invocations before the flag reference.
- **Suggest corrections on typos.** If the user types `markspec chekc`, suggest
  `markspec check`.
- **`NO_COLOR` environment variable support.** When `NO_COLOR` is set, suppress
  all color output. Also support `--color` / `--no-color` flags.
- **No interactive prompts when stdin is not a TTY.** In CI/piped contexts,
  missing required input is an error, not a prompt.
- **TTY detection for output formatting.** Human-readable output (colors,
  formatting) when writing to a terminal. Plain/machine-readable output when
  piped. `--format json` forces structured output regardless.
- **If the command hangs, tell the user what's happening.** Progress indicators
  for operations that take more than a second.

### Framework choice

Use **Cliffy** (`jsr:@c4spar/cliffy`) for subcommand dispatch, argument parsing,
auto-generated help, and shell completions. It is the most capable TypeScript
CLI framework available for Deno — command trees, type-safe flags, built-in
validation. Covers most of the clig.dev requirements out of the box.

Use **`@std/fmt/colors`** (Deno standard library) for ANSI color output.
Composable functions (`red()`, `bold()`, `dim()`), supports `NO_COLOR` natively.

### Diagnostic output

Write a thin diagnostic formatter module (`cli/diagnostic.ts`) that formats
errors with file path, line number, column, severity, message, and optional
source snippet with underline annotation. All validators produce structured
diagnostic objects; the CLI renders them. Target the quality of Rust's `miette`
— file location, colored annotations, context — without pulling in a large
dependency.

Example output:

```text
error[E001]: broken reference
  --> docs/product/software-requirements/braking.md:42:3
   |
42 |   Satisfies: SYS_BRK_9999
   |              ^^^^^^^^^^^^ SYS_BRK_9999 not found in compiled entries
   |
```

### MarkSpec-specific CLI rules

- **Dual output mode.** Every command supports `--format json` for
  machine-readable output. JSON to stdout, diagnostics to stderr.
- **Explicit args = exact scope; bare invocation = announced project scope.**
  `check`, `lint`, and `fmt` with explicit file/directory arguments operate on
  exactly those paths (directories expand through gitignore-aware discovery).
  Invoked bare, they operate on every relevant file under the project root
  (gitignore + project.yaml `exclude:` honored) and announce the scope on
  stderr. Bare invocation outside a project is an error, never a silent cwd
  scan. Artifact-producing commands (`compile`, `export`) still require explicit
  paths/globs.
- **Write-back safety.** Any command that modifies a file (`fmt`, `insert`) is
  lossless — only the targeted entry block changes, surrounding content
  untouched. The diff shows exactly the intended change.
- **Deterministic output.** Commands producing artifacts (`compile`, `export`)
  are deterministic — same input always produces identical output. No timestamps
  or run metadata unless explicitly requested.
- **Agent-friendly.** The `insert → fmt → check` loop is the canonical write
  path for coding agents. Each step produces structured JSON output that the
  next step or the agent can consume.

## Test conventions

### Structure

```text
packages/markspec/core/
  parser/
    markdown.ts
    markdown_test.ts             ← unit: colocated with source
  validator/
    mod.ts
    mod_test.ts                  ← unit: colocated with source

tests/
  e2e/
    helpers.ts                   ← shared test helper (markspec() function)
    validate_test.ts             ← blackbox: runs the CLI binary
    format_test.ts
    export_test.ts
    help_test.ts
  fixtures/                      ← sample .md and source files
```

### Unit tests

Colocated with source, following Deno convention (`@std` pattern). File naming:
`<module>_test.ts` next to `<module>.ts`.

Unit tests import directly from the module under test:

```typescript
import { parseEntryBlock } from "./parser.ts";
import { assertEquals } from "@std/assert";

Deno.test("parseEntryBlock: extracts display ID", () => {
  const block = `- [SRS_BRK_0001] Sensor debouncing

  The sensor driver shall debounce raw inputs.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Labels: ASIL-B`;

  const entry = parseEntryBlock(block);
  assertEquals(entry.shape, "identified");
  assertEquals(entry.displayId, "SRS_BRK_0001");
  assertEquals(entry.title, "Sensor debouncing");
  assertEquals(entry.id, "01HGW2Q8MNP3RSTVWXYZABCDEF");
  assertEquals(entry.labels, ["ASIL-B"]);
});
```

### E2E tests

Blackbox only. Files in `tests/e2e/` import **nothing** from source modules.
They interact with the CLI exclusively through `Deno.Command`. This is the
integration boundary.

**Helper:**

```typescript
// tests/e2e/helpers.ts

const CLI_ENTRY = new URL(
  "../../packages/markspec/main.ts",
  import.meta.url,
).pathname;

export async function markspec(
  args: string[],
  files: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = await Deno.makeTempDir();
  try {
    for (const [name, content] of Object.entries(files)) {
      const path = `${dir}/${name}`;
      await Deno.mkdir(
        `${dir}/${name.split("/").slice(0, -1).join("/")}`,
        { recursive: true },
      ).catch(() => {});
      await Deno.writeTextFile(path, content);
    }
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        CLI_ENTRY,
        ...args,
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    });
    const result = await cmd.output();
    return {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
```

**Behavioral assertions** — use `assertEquals` and `assertStringIncludes` for
logic (exit codes, error IDs, pass/fail):

```typescript
import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

Deno.test("validate: broken upstream link fails", async () => {
  const input = `
- [SRS_BRK_0001] Sensor debouncing

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Satisfies: SYS_NONEXISTENT
      Labels: ASIL-B
`;

  const { code, stderr } = await markspec(["validate"], {
    "requirements.md": input,
  });

  assertEquals(code, 1);
  assertStringIncludes(stderr, "unresolved reference: SYS_NONEXISTENT");
});
```

**Snapshot assertions** — use `assertSnapshot` for prose formatting (help text,
validation reports, error messages). Snapshots catch unintended wording changes:

```typescript
import { assertSnapshot } from "@std/testing/snapshot";
import { markspec } from "./helpers.ts";

Deno.test("help text", async (t) => {
  const { stdout } = await markspec(["--help"]);
  await assertSnapshot(t, stdout);
});
```

First run: `deno test --allow-run --allow-read -- --update` writes `.snap`
files. Review the snapshot content, then commit. From then on, any change
requires a conscious update.

### When to use which

| Pattern                                 | When                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `assertEquals` / `assertStringIncludes` | Behavioral correctness — exit codes, error IDs, pass/fail, structural checks  |
| `assertSnapshot`                        | Prose formatting — help text, full report layout, error message wording       |
| Unit test (colocated)                   | Testing a single function or module in isolation                              |
| E2E test (blackbox)                     | Testing the CLI as a user would — input files in, stdout/stderr/exit code out |

### Running

```bash
# unit tests only
deno test packages/markspec/

# e2e tests only
deno test --allow-run --allow-read tests/e2e/

# everything
deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi

# update snapshots
deno test --allow-run --allow-read -- --update
```

### Package exclusion

In `deno.json` when publishing to JSR:

```json
{
  "exclude": ["**/*_test.ts"]
}
```

JSR also only follows the export graph from the entry point — test files are
never reachable from `mod.ts` and will not be included in published packages.

### CI

```yaml
- run: deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi
```

Snapshot files (`.snap`) are committed to the repository. CI verifies them — if
a snapshot drifts, the test fails.

### V-model test convention (Rust demo projects)

The conventions above apply to the MarkSpec toolchain itself (Deno/TypeScript).
The following applies to Rust projects that **use** MarkSpec — such as the
`demo-aeb-*` repos.

**V-model to file system mapping:**

| Level   | Requirement lives in                       | Test lives in                 |
| ------- | ------------------------------------------ | ----------------------------- |
| **STK** | `docs/product/stakeholder-requirements.md` | `tests/val_*.rs`              |
| **SYS** | `tests/sit_*.rs` (doc comment)             | `tests/sit_*.rs` (function)   |
| **SRS** | `src/**/*_test.rs` (doc comment)           | `src/**/*_test.rs` (function) |

STK is the only level where requirement and test are in different places — the
requirement is authored by product people in Markdown, the VAL test is written
by QA in Rust. Every other level is colocated: the spec and its proof in the
same file.

**SRS + SWT (unit level, colocated):**

The doc comment IS the software requirement. The function below it IS the
verification. They live together.

```rust
// src/decision/threat_test.rs

/// [SRS_AEB_0030] Time-to-collision calculation
///
/// The decision module shall compute time-to-collision as
/// the ratio of range to closing velocity for each tracked
/// object.
///
///     Id: 01HGW3C4DEF6ABCDEFGHJKMNPQ
///     Satisfies: SYS_AEB_0012
///     Labels: ASIL-B
#[test]
fn swt_aeb_0030_ttc_calculation() {
    let ttc = compute_ttc(50.0, 15.0);
    assert!((ttc - 3.33).abs() < 0.01);
}
```

**SYS + SIT (integration level, colocated):**

System requirements and their integration tests live together in `tests/`. They
test across module boundaries using only the crate's public API.

```rust
// tests/sit_perception_decision.rs

/// [SYS_AEB_0012] Object threat assessment from radar tracks
///
/// The system shall compute a threat level for each tracked
/// object based on time-to-collision, relative velocity, and
/// object classification.
///
///     Id: 01HGW3A2BCD5ABCDEFGHJKMNPQ
///     Satisfies: STK_AEB_0001
///     Labels: ASIL-B
#[test]
fn sit_aeb_0012_threat_from_radar_track() {
    let frame = mock_radar_frame(50.0, 15.0, ObjectClass::Vehicle);
    let track = perception::process_radar_frame(&frame);
    let threat = decision::assess_threat(&track);
    assert_eq!(threat.level, ThreatLevel::High);
}
```

**STK + VAL (acceptance level, separated):**

STK requirements are authored in Markdown by product people. VAL tests are
written separately in Rust, referencing the STK ID via `/// Verifies:`.

```rust
// tests/val_emergency_braking.rs

/// Verifies: STK_AEB_0001
#[test]
fn val_aeb_0001_vehicle_stops_before_collision() {
    let scenario = Scenario::new()
        .ego_speed(60.0)         // km/h
        .target_stationary(40.0) // meters ahead
        .driver_no_response();

    let result = simulate(scenario);

    assert!(result.collision_avoided);
    assert!(result.final_speed < 5.0);
}
```

**Running by V-model level:**

```bash
cargo test --lib              # SWT only (unit tests in src/)
cargo test --test '*'         # SIT + VAL (integration tests in tests/)
cargo test                    # everything
```

**Traceability.** The three-letter prefix in function names (`swt_`, `sit_`,
`val_`) and the `[TYPE_...]` / `/// Verifies:` annotations allow
`markspec check` to discover and classify all requirements and tests by walking
both Markdown files and source doc comments.

## Workflow

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for issue model, PR process,
severity/effort/priority, and review flow.

**Agent-specific rules:**

- **Always work in a worktree.** Create a git worktree for every task. Never
  commit directly to the main working tree unless the user explicitly says to
  work in the tree. After `git worktree add`, run `./bootstrap` **and verify the
  tree-sitter grammars were fetched**: `ls grammars/*.wasm` must list 9 files. A
  fresh worktree starts with none, and `bootstrap` runs under
  `set -euo
  pipefail`, so it can exit before its grammar-fetch step if an
  earlier step fails — leaving the worktree grammar-less. Without the grammars
  the pre-push hook's `just check` fails on the source-file parsing e2e tests
  (`source_body_tokens_test.ts`, `source_jsfamily_test.ts`). Fetch them with
  `deno task fetch-grammars`, or copy from the main checkout:
  `cp <main-checkout>/grammars/*.wasm grammars/`.
- **Working memory is worktree-first.** Create the story worktree _before_
  writing any `docs/wip/` file (Superpowers specs and plans). Specs and plans
  are born, committed, and gardened on the story branch; the main checkout's
  `docs/wip/` stays empty. If a wip file was accidentally created in the main
  checkout, move it into the worktree at kickoff (copy, commit there, delete the
  untracked original) — never commit it to the main working tree, and do not
  garden unlanded work.
- **Start from the issue.** Read the acceptance criteria and
  `docs/spec/language/language.md`, propose an approach, and wait for approval
  before implementing.
- **ATDD + TDD.** Write acceptance tests first from the story's acceptance
  criteria, then TDD the unit tests and implementation.
- **Single PR = code + tests + docs.** Every pull request ships implementation,
  tests, and updated documentation together.
- **Commits.** Use Conventional Commits — `feat`, `fix`, `refactor`, `docs`,
  `test`, `chore`. Imperative mood. One commit per PR.
- **Before PR.** Run `just build` — all checks must pass.
- **After PR.** Run `/review` on the pull request and post findings as a PR
  comment.

## Conventions

- **Zero warnings.** No warnings from `deno check`, `deno lint`, or `deno test`.
  Fix warnings as they appear.
- **Code style:** `deno fmt` for TypeScript, `dprint fmt` for
  Markdown/JSON/YAML/TOML. Always run `just fmt` before committing. Both
  `deno fmt --check` and `dprint check` are separate CI gates — both must pass.
- **Naming.** Names must reveal intent. Avoid `temp`, `data`, `flag`, `info`.
  Use `camelCase` for variables and functions, `PascalCase` for types and
  interfaces.
- **Node.js compatibility.** Production code must run on Node.js, not only Deno.
  Use `jsr:` imports (resolved by both runtimes), avoid `Deno.*` APIs in library
  code — use `@std/*` or Web APIs instead. `Deno.*` is allowed in CLI entry
  points, tests, and scripts.
- **Error handling.** Use typed errors with descriptive messages. Prefer
  `Result`-style patterns over thrown exceptions where possible.
- **Comments:** doc comments (`/** */`) on all public API items. Brief inline
  comments on tricky internals only.

<!-- git-std:bootstrap -->

## Post-clone setup

Run `./bootstrap` after `git clone` or `git worktree add`.

`./bootstrap` installs `git-std` and fetches tree-sitter grammars only — it does
not install [`mdbook`](https://rust-lang.github.io/mdBook/) (or Typst). To run
`just book`/`just book-dev` for local docs preview, install `mdbook` separately
(e.g. `cargo install mdbook --version <pinned>`, or a platform package manager
such as `brew install mdbook`). CI installs a **pinned** version via
`peaceiris/actions-mdbook@v2` (`mdbook-version:` in
`.github/workflows/pages.yaml`) rather than `latest` — match that exact version
locally. A stale local mdbook renders a book successfully but can silently
diverge from what CI actually deploys (0.4 → 0.5 renamed the menu bar's DOM id
and replaced icon-font glyphs with inline SVG; a local build against 0.4 gave no
warning that a custom `additional-js` script had broken on the live 0.5 site).
Verify with `mdbook --version` before trusting a local build/preview of any
book-chrome change (theme, `additional-css`/`additional-js`, book.toml).
