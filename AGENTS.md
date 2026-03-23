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
│       │   ├── model/               ← types: Entry, DisplayId, Ulid, Attribute,
│       │   │   └── mod.ts             EntryType, SourceLocation, ProjectConfig
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
│       │   └── server.ts            ← LSP protocol adapter
│       └── mcp/
│           └── server.ts            ← MCP protocol adapter
├── docs/
│   ├── spec/                        ← language specification (published as book)
│   ├── guide/                       ← user-facing documentation (published as
│   │                                  book)
│   ├── product/                     ← internal engineering (not published)
│   └── records/                     ← architecture decision records
└── tests/
    ├── e2e/
    │   ├── helpers.ts               ← shared test helper (markspec() function)
    │   ├── validate_test.ts         ← blackbox: runs the CLI binary
    │   ├── format_test.ts
    │   ├── export_test.ts
    │   └── help_test.ts
    └── fixtures/                    ← sample .md and source files for testing
```

## Key rules

**Single binary, lazy loading.** `main.ts` dispatches subcommands. Each
subcommand dynamically imports only the modules it needs. `markspec validate`
never loads Typst WASM. `markspec book build` never loads ReqIF.

**Three compile targets from the same source:**

```bash
deno compile packages/markspec/main.ts            # → markspec
deno compile packages/markspec/lsp/server.ts      # → markspec-lsp
deno compile packages/markspec/mcp/server.ts      # → markspec-mcp
```

**`core/mod.ts` is the library boundary.** Everything outside `core/` imports
from `core/mod.ts`, never from internal paths like `core/parser/markdown.ts`.
This is enforced by convention. When an external consumer needs the library, we
add a `deno.json` to `core/` and publish to JSR — nothing else changes.

**`markspec-ide` is the only external extension.** It lives in a separate repo
and dispatches via PATH lookup (`markspec ide` → finds `markspec-ide` binary).
PDF, book, and deck are subcommands of the main binary, not extensions.

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
deno test --allow-read                                              # run all tests
deno lint                                                           # lint
deno fmt                                                            # format
deno fmt --check                                                    # format check (CI)
```

Or via `just` (preferred):

```bash
just check                      # type-check
just test                       # test
just lint                       # lint (Deno + dprint)
just build                      # check + test + lint
just verify                     # validate commits + build
just fmt                        # format (Deno + dprint)
just clean                      # remove build artifacts
```

## CLI subcommands

| Command                    | Module                       | Purpose                                                              |
| -------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `markspec format`          | `core/formatter`             | Stamp ULIDs, fix indentation, normalize attributes. Pre-commit hook. |
| `markspec validate`        | `core/validator`             | Check broken refs, missing Ids, malformed entries, duplicates.       |
| `markspec compile <paths>` | `core/compiler`              | Parse all files, build traceability graph, output compiled JSON.     |
| `markspec export`          | `core/reporter`              | Compiled JSON → json, csv, reqif, yaml.                              |
| `markspec insert`          | `core/formatter`             | Agent write path: insert a requirement block into a file.            |
| `markspec doc build`       | `render/typst`               | Single document → PDF via Typst WASM.                                |
| `markspec book build`      | `book/site`                  | Multi-chapter → static HTML site.                                    |
| `markspec book dev`        | `book/site`                  | Live preview with hot reload.                                        |
| `markspec deck build`      | `deck/touying`               | Slides → PDF via Touying/Typst.                                      |
| `markspec deck dev`        | `deck/touying`               | Live slide preview.                                                  |
| `markspec lsp`             | dispatches to `markspec-lsp` | LSP server for editor integration.                                   |
| `markspec mcp`             | dispatches to `markspec-mcp` | MCP server for AI agent integration.                                 |

## Entry types used in this project

| Prefix | Name                              | Where                                      |
| ------ | --------------------------------- | ------------------------------------------ |
| STK    | Stakeholder Requirement           | `docs/product/stakeholder-requirements.md` |
| SAD    | Software Architecture Description | `docs/product/software-architecture.md`    |

The full MarkSpec spec defines eight builtin types (STK, SYS, SRS, SAD, ICD,
VAL, SIT, SWT). This project only uses two because it is a CLI tool, not a
safety-critical embedded system.

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
│   ├── language.md                  ← MarkSpec grammar: CommonMark + GFM/GLFM
│   │                                  subset, entry format, attributes
│   └── typography.md                ← fonts, page layout, diagram sizing,
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
└── records/                         ← decision trail (not published)
    ├── adr-001-markdown-format.md
    ├── adr-002-requirement-authoring.md
    ├── adr-003-diagram-authoring.md
    ├── adr-004-book-structure.md
    └── adr-005-cli-architecture.md
```

**Conventions:**

- This project uses **STK and SAD only**. No SYS, SRS, or ICD entries. The guide
  serves as interface documentation.
- `product/` is flat — requirements and architecture entries live side by side
  as peer work products.
- `records/` is a peer of `product/`, `guide/`, and `spec/` — it groups ADRs
  separately because they have a different lifecycle (immutable once accepted,
  accumulate over time).
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
import { parseRequirementBlock } from "./parser.ts";
import { assertEquals } from "@std/assert";

Deno.test("parseRequirementBlock: extracts display ID", () => {
  const block = `- [SRS_BRK_0001] Sensor debouncing

  The sensor driver shall debounce raw inputs.

  Id: SRS_01HGW2Q8MNP3 \\
  Labels: ASIL-B`;

  const req = parseRequirementBlock(block);
  assertEquals(req.displayId, "SRS_BRK_0001");
  assertEquals(req.title, "Sensor debouncing");
  assertEquals(req.id, "SRS_01HGW2Q8MNP3");
  assertEquals(req.labels, ["ASIL-B"]);
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

  Id: SRS_01HGW2Q8MNP3 \\
  Satisfies: SYS_NONEXISTENT \\
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
deno test --allow-run --allow-read

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
- run: deno test --allow-run --allow-read
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
/// Id: SRS_01HGW3C4DEF6 \
/// Satisfies: SYS_AEB_0012 \
/// Labels: ASIL-B
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
/// Id: SYS_01HGW3A2BCD5 \
/// Satisfies: STK_AEB_0001 \
/// Labels: ASIL-B
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

- **Start from the issue.** Read the acceptance criteria and
  `docs/spec/language.md`, propose an approach, and wait for approval before
  implementing.
- **ATDD + TDD.** Write acceptance tests first from the story's acceptance
  criteria, then TDD the unit tests and implementation.
- **Single PR = code + tests + docs.** Every pull request ships implementation,
  tests, and updated documentation together.
- **Commits.** Use Conventional Commits — `feat`, `fix`, `refactor`, `docs`,
  `test`, `chore`. Imperative mood. One commit per PR.
- **Before PR.** Run `just build` — all checks must pass.

## Conventions

- **Zero warnings.** No warnings from `deno check`, `deno lint`, or `deno test`.
  Fix warnings as they appear.
- **Code style:** `deno fmt` for formatting. Always format before committing.
- **Naming.** Names must reveal intent. Avoid `temp`, `data`, `flag`, `info`.
  Use `camelCase` for variables and functions, `PascalCase` for types and
  interfaces.
- **Error handling.** Use typed errors with descriptive messages. Prefer
  `Result`-style patterns over thrown exceptions where possible.
- **Comments:** doc comments (`/** */`) on all public API items. Brief inline
  comments on tricky internals only.
