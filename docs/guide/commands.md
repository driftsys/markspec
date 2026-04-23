# Commands

CLI reference for all MarkSpec subcommands, flags, and examples.

MarkSpec follows the [Command Line Interface Guidelines](https://clig.dev/).
Every command supports `--help`. Commands that produce structured output support
`--format json` for machine-readable output to stdout (diagnostics always go to
stderr).

**Exit codes:** `0` success, `1` error, `2` warnings only (validate).

**Global options** (available on every command):

| Flag            | Description               |
| --------------- | ------------------------- |
| `-h, --help`    | Show help                 |
| `-V, --version` | Show version              |
| `-q, --quiet`   | Suppress non-error output |

## Authoring

### format

Stamp ULIDs, fix indentation, normalize attributes.

```sh
markspec format <file...>
markspec format --check <file...>
```

| Flag      | Type | Default | Description                                              |
| --------- | ---- | ------- | -------------------------------------------------------- |
| `--check` | bool | false   | Report changes without writing. Exit 1 if changes needed |

**Examples:**

```sh
# Format a single file (writes changes in place)
markspec format docs/requirements.md

# Format multiple files
markspec format docs/*.md

# Check mode for CI — reports but doesn't modify
markspec format --check docs/*.md
```

### validate

Check broken refs, missing Ids, malformed entries, duplicates.

```sh
markspec validate <file...>
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--strict` | bool   | false   | Promote warnings to errors    |
| `--format` | string | `text`  | Output format: `json`, `text` |

**Examples:**

```sh
# Validate a file
markspec validate docs/requirements.md

# Strict mode — warnings become errors (useful for CI)
markspec validate --strict docs/requirements.md

# JSON output for tool integration
markspec validate --format json docs/*.md
```

## Querying

### show

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

### context

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

### dependents

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

## Building

### compile

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

### report

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

## Documents

### doc build

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

## Books

### book build

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

## Profile and diagnostics

### profile show

Show the active profile chain and effective configuration.

```sh
markspec profile show
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--format` | string | `text`  | Output format: `json`, `text` |

### doctor

Project health check: verifies `project.yaml`, profile configuration, and
project structure.

```sh
markspec doctor
```

| Flag       | Type   | Default | Description                   |
| ---------- | ------ | ------- | ----------------------------- |
| `--format` | string | `text`  | Output format: `json`, `text` |

## Not yet implemented

These commands are registered but print an error and exit:

| Command            | Intended purpose                                         |
| ------------------ | -------------------------------------------------------- |
| `markspec export`  | Compiled JSON → json, csv, reqif, yaml                   |
| `markspec insert`  | Agent write path: insert a requirement block into a file |
| `markspec create`  | Scaffold a new requirement block                         |
| `markspec next-id` | Print the next available display ID for a type           |
| `markspec hook`    | Run format + validate as a pre-commit hook               |
| `book dev`         | Live preview with hot reload                             |
| `deck build`       | Slides → PDF via Touying/Typst                           |
| `deck dev`         | Live slide preview                                       |
| `mcp`              | MCP server for AI agent integration                      |
