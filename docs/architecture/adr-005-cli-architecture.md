# ADR-005: CLI architecture

Status: Accepted\
Date: 2026-03-23\
Scope: MarkSpec CLI

## Context

MarkSpec needs a CLI tool that handles multiple subcommands (format, validate,
compile, export, insert, doc, book, deck, lsp, mcp) while remaining fast and
composable. The CLI must work well for both human operators and AI coding
agents.

## Decision

### Single binary, lazy loading

`main.ts` dispatches subcommands. Each subcommand dynamically imports only the
modules it needs. `markspec validate` never loads Typst WASM.
`markspec book build` never loads ReqIF.

Three compile targets from the same source:

```bash
deno compile main.ts            # → markspec
deno compile lsp/server.ts      # → markspec-lsp
deno compile mcp/server.ts      # → markspec-mcp
```

`markspec-ide` is the only external extension. It lives in a separate repo and
dispatches via PATH lookup. PDF, book, and deck are subcommands of the main
binary, not extensions.

### CLI standard: clig.dev

All CLI behavior complies with the Command Line Interface Guidelines at
<https://clig.dev/>. Key rules:

- **stdout for data, stderr for messaging.** Primary output goes to stdout.
  Diagnostics go to stderr. Never mix them.
- **Exit code 0 on success, non-zero on failure.** 1 for errors, 2 for warnings
  only.
- **`-h` and `--help` on every command and subcommand.**
- **Lead with examples in help text.**
- **Suggest corrections on typos.**
- **`NO_COLOR` environment variable support.**
- **No interactive prompts when stdin is not a TTY.**
- **TTY detection for output formatting.** `--format json` forces structured
  output regardless.
- **Progress indicators for operations that take more than a second.**

### Framework

**Cliffy** (`jsr:@c4spar/cliffy`) for subcommand dispatch, argument parsing,
auto-generated help, and shell completions. Command trees, type-safe flags,
built-in validation. Covers most clig.dev requirements out of the box.

**`@std/fmt/colors`** (Deno standard library) for ANSI color output. Supports
`NO_COLOR` natively.

### Diagnostic output

A thin diagnostic formatter module (`cli/diagnostic.ts`) formats errors with
file path, line number, column, severity, message, and optional source snippet
with underline annotation. All validators produce structured diagnostic objects;
the CLI renders them.

```text
error[E001]: broken reference
  --> docs/product/software-requirements/braking.md:42:3
   |
42 |   Satisfies: SYS_BRK_9999
   |              ^^^^^^^^^^^^ SYS_BRK_9999 not found in compiled entries
   |
```

### MarkSpec-specific rules

- **Dual output mode.** Every command supports `--format json` for
  machine-readable output. JSON to stdout, diagnostics to stderr.
- **File-local vs project-wide.** File-local commands never silently do
  project-wide work. Project-wide commands require explicit paths/globs.
- **Write-back safety.** Any command that modifies a file is lossless — only the
  targeted entry block changes, surrounding content untouched.
- **Deterministic output.** Commands producing artifacts are deterministic —
  same input always produces identical output.
- **Agent-friendly.** The `insert → format → validate` loop is the canonical
  write path for coding agents. Each step produces structured JSON output.

## Consequences

- Single binary distribution via `deno compile`.
- Lazy loading keeps startup fast — subcommands only load what they need.
- clig.dev compliance ensures predictable, composable CLI behavior.
- Cliffy provides the framework for command trees without custom parsing.
- Diagnostic output targets Rust `miette` quality without the dependency.
- Structured JSON output on every command enables agent integration.
