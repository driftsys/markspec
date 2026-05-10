# Getting started

Install and run MarkSpec for the first time.

## Prerequisites

- [Deno](https://deno.land) v2.0 or later

## Install

Install MarkSpec from JSR:

```sh
deno install -g jsr:@driftsys/markspec
```

Or run directly without installing:

```sh
deno run jsr:@driftsys/markspec --help
```

## Create a project

Create a project directory with a minimal `project.yaml`:

```sh
mkdir my-project && cd my-project
```

```yaml
# project.yaml
name: my-project
version: "1.0.0"
```

## Write your first requirement

Create `requirements.md` with one identified entry:

```markdown
# Requirements

- [STK_PRJ_0001] System availability

  The system shall be available 99.9% of the time.
```

An entry is a list item where the first element is a display ID in brackets,
followed by a title. The indented paragraph underneath is the body.

## Format

Run `markspec format` to stamp a ULID onto the entry:

```sh
markspec format requirements.md
```

```text
info: requirements.md:3 assigned Id: 01KPVVC9J2... to STK_PRJ_0001
1 file(s) formatted, 0 unchanged (1 total)
```

Your file now has an `Id:` attribute:

```markdown
- [STK_PRJ_0001] System availability

  The system shall be available 99.9% of the time.

  Id: 01KPVVC9J2B1ZA64QZEMHF02PW
```

The ULID is a universally unique, immutable identifier. Once assigned, it never
changes — even if the display ID or title is renamed.

## Validate

Run `markspec validate` to check the entry:

```sh
markspec validate requirements.md
```

No output means validation passed (exit code 0).

## Add a second entry with a traceability link

Add a second entry that satisfies the first:

```markdown
- [SRS_PRJ_0001] Health check endpoint

  The service shall expose a /health endpoint returning 200 OK.

      Id: 01KPVVC9J2B1ZA64QZEMHF02PX
      Satisfies: STK_PRJ_0001
```

The `Satisfies:` attribute creates a directed link from SRS_PRJ_0001 to
STK_PRJ_0001 in the traceability graph. Attributes are written as a 4-space
indented code block at the end of the entry.

## Compile

Compile all entries into a traceability graph:

```sh
markspec compile requirements.md
```

```text
2 entries, 1 links from 1 files
```

Add `--format json` for the full structured output:

```sh
markspec compile --format json requirements.md
```

This outputs the complete entry graph as JSON — every entry, its attributes,
links, and source locations.

## Report

Generate a traceability matrix:

```sh
markspec report traceability requirements.md
```

```text
| ID | Title | Type | Satisfies | Satisfied-by |
| -- | ----- | ---- | --------- | ------------ |
| STK_PRJ_0001 | System availability |  | — | SRS_PRJ_0001 |
| SRS_PRJ_0001 | Health check endpoint |  | STK_PRJ_0001 | — |
```

Or a coverage report:

```sh
markspec report coverage requirements.md
```

## Next steps

- [Configuration](configuration.md) — `project.yaml`, `.markspec.yaml`, and
  profile system
- [Commands](commands.md) — full CLI reference with all flags and examples
