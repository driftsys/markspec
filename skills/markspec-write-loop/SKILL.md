---
schema: 1
name: markspec-write-loop
description: |
  Use when writing new entries to a MarkSpec file — teaches the canonical `markspec insert → markspec fmt → markspec check` agent write path and explains what each step produces.
---

## Overview

The canonical agent write path for adding a new entry to a MarkSpec document is
a three-command sequence. Run each step and check its output before proceeding.

```text
markspec insert <type> <file>
markspec fmt <file>
markspec check <file>
```

Never hand-craft a full entry block and paste it. `insert` computes the correct
display ID from the current corpus; pasting a guessed ID risks a collision.

## Step 1 — Insert

```bash
markspec insert <type> <file>
```

Appends a scaffolded entry block to `<file>`. The block contains:

- the next sequential display ID for `<type>` (computed from all entries in the
  project),
- a generated ULID in the `Id:` trailer,
- skeleton `Type:` and `Satisfies:` trailers.

The file is modified in place. Only the new block is appended; existing content
is never touched.

**Then:** fill in the `Title` and `Body` prose in the editor. Do not touch `Id:`
or the display ID — the formatter owns them.

## Step 2 — Format

```bash
markspec fmt <file>
```

- Stamps any missing `Id:` ULIDs.
- Normalises trailer indent to 6 spaces.
- Adds missing trailing backslashes on multi-line attribute values.

Run this before committing. See the
[git hooks recipe](../../../docs/guide/recipes/git-hooks.md) for pre-commit
setup using `markspec fmt` and `markspec check`.

## Step 3 — Check

```bash
markspec check <file>
```

Runs file-local and cross-file checks:

- broken `Satisfies:` / `Verified-by:` references,
- duplicate display IDs or ULIDs,
- missing `Id:` on Authored entries,
- MSL- diagnostic codes (see `markspec-diagnostics`).

Exit 0 = clean. Exit 1 = errors. Exit 2 = warnings only.

Fix any errors and repeat until exit 0.

## Quick reference

| Command                              | Touches file?    | When to run                         |
| ------------------------------------ | ---------------- | ----------------------------------- |
| `markspec insert <type> <file>`      | Yes — appends    | Start of the write loop             |
| `markspec fmt <file>`                | Yes — normalises | After editing, before commit        |
| `markspec check <file>`              | No               | After fmt, check for broken links   |
| `markspec next-id <type> <paths...>` | No               | Read-only ID preview (no insert)    |
| `markspec create <type> <paths...>`  | No               | Print scaffold to stdout (no write) |

## Common mistakes

| Mistake                      | Fix                                                                 |
| ---------------------------- | ------------------------------------------------------------------- |
| Skipping `markspec fmt`      | The pre-commit hook will reject the file; run fmt before committing |
| Running `check` before `fmt` | Format first — some diagnostics are caused by malformed indentation |
| Guessing the next display ID | Use `markspec next-id` or `markspec insert`; never guess            |
| Editing `Id:` by hand        | Leave it alone; `fmt` stamps it                                     |
