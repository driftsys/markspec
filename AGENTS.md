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
│       │   ├── model/               ← types: Entry, EntryShape (identified |
│       │   │   └── mod.ts             referenced), DisplayId, Ulid, Attribute,
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
│       │   │                          workspace symbols, rename.
│       │   ├── workspace.ts         ← in-memory entry index, incremental updates
│       │   ├── diagnostics.ts       ← core Diagnostic → LSP Diagnostic bridge
│       │   ├── completions.ts       ← block scaffold + ID reference + Type:
│       │   │                          value completion triggers
│       │   ├── hover.ts             ← hover provider: display-ID extraction +
│       │   │                          Markdown-rendered Entry preview
│       │   ├── definition.ts        ← Entry → LSP Location for go-to-definition
│       │   ├── references.ts        ← find-all-references: walks entry
│       │   │                          attributes for whole-token matches
│       │   ├── rename.ts            ← workspace rename: whole-token text edits
│       │   │                          across every tracked file
│       │   ├── symbols.ts           ← document-symbol (outline) + workspace-
│       │   │                          symbol (fuzzy entry search) builders
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
@packages/markspec/lsp/context.ts @packages/markspec/lsp/diagnostics.ts
@packages/markspec/lsp/util.ts @packages/markspec/main.ts

## Key rules

**Single binary, lazy loading.** `main.ts` dispatches subcommands. Each
subcommand dynamically imports only the modules it needs. `markspec validate`
never loads Typst WASM. `markspec book build` never loads ReqIF.

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

| Command                               | Module                              | Purpose                                                              |
| ------------------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| `markspec format [...files]`          | `core/formatter`                    | Stamp ULIDs, fix indentation, normalize attributes. Pre-commit hook. |
| `markspec validate [...files]`        | `core/validator`                    | Check broken refs, missing Ids, malformed entries, duplicates.       |
| `markspec compile <paths...>`         | `core/compiler`                     | Parse all files, build traceability graph, output compiled JSON.     |
| `markspec show <id> <paths...>`       | `core/compiler`                     | Show details of a single entry by display ID or ULID.                |
| `markspec context <id> <paths...>`    | `core/compiler`                     | Walk the Satisfies chain upward from an entry.                       |
| `markspec dependents <id> <paths...>` | `core/compiler`                     | List all entries that depend on a given entry.                       |
| `markspec report <kind> <paths...>`   | `core/reporter`                     | Generate traceability matrix or coverage report.                     |
| `markspec profile show`               | `core/profile`                      | Show the active profile chain and effective configuration.           |
| `markspec doctor`                     | `core/profile` + `core/validator`   | Project health check: profile, config, and validation summary.       |
| `markspec next-id <type> <paths...>`  | `core/compiler` + `core/profile`    | Print the next available display ID for a profile-declared type.     |
| `markspec hook [...files]`            | `core/formatter` + `core/validator` | Pre-commit hook: run format --check + validate on the given files.   |
| `markspec doc build <file>`           | `render/typst`                      | Single document → PDF via Typst WASM.                                |
| `markspec book build`                 | `book/site`                         | Multi-chapter → static HTML site.                                    |
| `markspec lsp`                        | `lsp/server`                        | LSP server for editor integration (stdio JSON-RPC).                  |
| `markspec mcp`                        | `mcp/server`                        | MCP server for AI agent integration (stdio JSON-RPC).                |

### Not yet implemented

These commands are registered in `main.ts` but print an error and exit. Do not
invoke them.

| Command               | Intended purpose                                          |
| --------------------- | --------------------------------------------------------- |
| `markspec export`     | Compiled JSON → json, csv, reqif, yaml.                   |
| `markspec insert`     | Agent write path: insert a requirement block into a file. |
| `markspec create`     | Scaffold a new requirement block.                         |
| `markspec book dev`   | Live preview with hot reload.                             |
| `markspec deck build` | Slides → PDF via Touying/Typst.                           |
| `markspec deck dev`   | Live slide preview.                                       |

**Project context:** `format` and `validate` work file-locally without a
`project.yaml`. All other commands (`compile`, `show`, `context`, `dependents`,
`report`, `next-id`, `doc build`, `book build`) require a `project.yaml` found
by walking up from the working directory.

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
  Kotlin, C, C++, Java)
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
│   ├── commands.md                  ← CLI reference: all subcommands, flags,
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
- **Suggest corrections on typos.** If the user types `markspec valdate`,
  suggest `markspec validate`.
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
- **File-local vs project-wide.** File-local commands (`format`, `validate` on a
  single file) never silently do project-wide work. Project-wide commands
  (`compile`) require explicit paths/globs.
- **Write-back safety.** Any command that modifies a file (`format`, `insert`)
  is lossless — only the targeted entry block changes, surrounding content
  untouched. The diff shows exactly the intended change.
- **Deterministic output.** Commands producing artifacts (`compile`, `export`)
  are deterministic — same input always produces identical output. No timestamps
  or run metadata unless explicitly requested.
- **Agent-friendly.** The `insert → format → validate` loop is the canonical
  write path for coding agents. Each step produces structured JSON output that
  the next step or the agent can consume.

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
`markspec validate` to discover and classify all requirements and tests by
walking both Markdown files and source doc comments.

## Workflow

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for issue model, PR process,
severity/effort/priority, and review flow.

**Agent-specific rules:**

- **Always work in a worktree.** Create a git worktree for every task. Never
  commit directly to the main working tree unless the user explicitly says to
  work in the tree.
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
