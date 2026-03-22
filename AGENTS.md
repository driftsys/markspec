# AGENTS.md

Instructions for AI coding agents working in this repository.

## Project

MarkSpec is a Markdown flavor for traceable industrial documentation, and a CLI
toolchain that processes it. It is a Deno/TypeScript monorepo containing the
language specification, CLI, LSP server, and MCP server.

MarkSpec is built on CommonMark with the GFM/GLFM shared subset. It adds
requirement authoring with typed IDs (STK, SYS, SRS, SAD, ICD, VAL, SIT, SWT),
ULID-based traceability, git-trailers-style attributes, and Mustache variable
substitution — while keeping source files pure Markdown that renders correctly
on GitHub and GitLab without tooling.

## Build commands

```bash
deno check packages/*/mod.ts   # Type-check all packages
deno test --allow-read          # Run all tests
deno lint                       # Lint
deno fmt                        # Format
deno fmt --check                # Format check (CI)
```

Or via `just` (preferred):

```bash
just check                      # Type-check
just test                       # Test
just lint                       # Lint (Deno + dprint)
just build                      # check + test + lint
just verify                     # Validate commits + build
just fmt                        # Format (Deno + dprint)
just clean                      # Remove build artifacts
```

## Architecture

The language specification lives in `docs/specification.md`. Architecture
decisions are in `docs/architecture/`.

**Workspace structure — four packages:**

| Package                   | Role                                                      |
| ------------------------- | --------------------------------------------------------- |
| `@driftsys/markspec-core` | Parser, validator, ID graph, traceability, output formats |
| `@driftsys/markspec-cli`  | CLI binary — subcommands: doc, book, deck                 |
| `@driftsys/markspec-lsp`  | LSP server                                                |
| `@driftsys/markspec-mcp`  | MCP server for AI coding agents                           |

**CLI subcommands:**

| Subcommand              | Purpose                            |
| ----------------------- | ---------------------------------- |
| `markspec doc build`    | Generate document PDF              |
| `markspec doc export`   | JSON export                        |
| `markspec doc validate` | Check ID graph, gaps, broken links |
| `markspec doc format`   | Format Markdown, assign ULIDs      |
| `markspec doc insert`   | Scaffold a new requirement block   |
| `markspec book build`   | Generate PDF + HTML book           |
| `markspec book dev`     | Live preview                       |
| `markspec deck build`   | Generate presentation PDF          |
| `markspec deck dev`     | Live preview                       |
| `markspec lsp`          | Start LSP server                   |
| `markspec mcp`          | Start MCP server                   |

**Key design decisions:**

- Source files are pure Markdown. Tooling does the heavy lifting.
- One binary. Three rendering targets (document, book, deck).
- Packages are scoped under `@driftsys/` on JSR.

## Workflow

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for issue model, PR process,
severity/effort/priority, and review flow.

**Agent-specific rules:**

- **Start from the issue.** Read the acceptance criteria and
  `docs/specification.md`, propose an approach, and wait for approval before
  implementing.
- **ATDD + TDD.** Write acceptance tests first from the story's acceptance
  criteria, then TDD the unit tests and implementation.
- **Single PR = code + tests + docs.** Every pull request ships implementation,
  tests, and updated documentation together.
- **Commits.** Use Conventional Commits — `feat`, `fix`, `refactor`, `docs`,
  `test`, `chore`. Imperative mood. One commit per PR.
- **Before PR.** Run `deno task check`, `deno task test`, `deno task lint`, and
  `deno fmt --check` — all must pass.

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
