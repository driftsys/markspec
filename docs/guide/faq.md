# FAQ

Short answers to the questions a team actually asks when trialing MarkSpec.

---

## What is a display ID?

A display ID is the human-readable identifier in the `[…]` bracket on an entry
title line, for example `STK_PRJ_0001`. It encodes the entry type prefix
(`STK`), an optional domain segment (`PRJ`), and a zero-padded sequence number
(`0001`). Display IDs are mutable — you can rename `STK_PRJ_0001` to
`STK_AEB_0001` — and MarkSpec rewrites all references in the workspace when you
use the LSP rename command.

---

## What is a ULID and why does MarkSpec assign one?

A ULID (Universally Unique Lexicographically Sortable Identifier) is a
26-character string like `01KPVVC9J2B1ZA64QZEMHF02PW`. MarkSpec stamps one onto
each entry during `markspec fmt` and stores it as the `Id:` attribute.

The ULID is **immutable**. Once assigned it never changes, even if the display
ID or title is renamed. Traceability links between projects and external tools
(JIRA, DOORS) reference the ULID, not the display ID, so renaming an entry never
breaks cross-tool links.

---

## How does MarkSpec discover `project.yaml`?

`markspec` walks up the directory tree from the current working directory until
it finds a `project.yaml` file. The directory containing that file becomes the
project root. If no `project.yaml` is found, commands that require project
context (`compile`, `show`, `context`, `dependents`, `report`, `next-id`,
`doc build`, `book build`) exit with an error. `fmt` and `check` work without a
`project.yaml`.

---

## Can I use MarkSpec without a profile?

Yes. `markspec fmt` and `markspec check` work without a profile — they apply
built-in formatting rules and lint checks. Commands that need type vocabulary
(`compile`, `create`, `next-id`) require a profile to know the display-ID
patterns for each type.

To activate a profile, create a `.markspec.yaml` in the project root:

```yaml
profiles:
  - ./profiles/markspec.yaml
```

See the [Profile guide](profiles.md) for the full configuration reference.

---

## What do exit codes 0, 1, and 2 mean?

| Code | Meaning                                              |
| ---- | ---------------------------------------------------- |
| `0`  | Success — no errors, no warnings                     |
| `1`  | Error — validation failed or command error           |
| `2`  | Warnings only — `check` found warnings but no errors |

In CI, treat exit code 2 as a pass or a fail depending on your policy. Pass
`--strict` to `markspec check` to promote warnings to errors (exit code 1).

---

## Where should I put my Markdown files?

Anywhere you like — MarkSpec does not enforce a directory layout. The convention
used in this project is:

- `docs/` — Markdown files containing requirements and architecture descriptions
- `src/` — source code with doc-comment entries (Rust `///`, Kotlin `/**`)

Pass explicit paths or globs to commands that need them:

```sh
markspec check docs/requirements.md
markspec compile "docs/**/*.md" src/main.rs
```

---

## What is the difference between `fmt` and `check`?

| Command          | What it does                                                  | Writes files?  |
| ---------------- | ------------------------------------------------------------- | -------------- |
| `markspec fmt`   | Stamps ULIDs, normalizes indentation and attribute order      | Yes (in place) |
| `markspec check` | Checks broken references, missing IDs, duplicates, lint rules | No             |

Run `fmt` first (see the [git hooks recipe](recipes/git-hooks.md) for pre-commit
setup) to ensure every entry has a ULID before committing. Run `check` in CI to
catch broken traceability links.

---

## How do I set up the LSP in my editor?

- **VS Code** — install the `markspec-ide` extension from `editors/vscode/` in
  the repository. See [CLI guide — VS Code](cli.md#vs-code).
- **Neovim** — add a `vim.lsp.start` autocmd. See
  [CLI guide — Neovim](cli.md#neovim).
- **Other editors** — point your LSP client at `markspec lsp`. Transport: stdio.
  See [CLI guide — Other editors](cli.md#other-editors).

---

## Can I run multiple profiles at once?

The current implementation supports one active profile per project. If multiple
profiles are listed in `.markspec.yaml`, a `PROFILE-LOAD-006` warning is emitted
and only the first is used. Profile stacking (extends chains) is the recommended
way to compose vocabulary. See the [Profile guide](profiles.md).
