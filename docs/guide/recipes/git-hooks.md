# Git hooks

MarkSpec exposes composable check primitives — `markspec fmt`, `markspec check`,
`markspec lint`, and `markspec lock --check`. Wire them into git hooks via your
hook manager and compose them at the cadence you want. There is no bundled hook
command.

## What each primitive does

| Command                 | Question                   | Blocks? | Cadence      |
| ----------------------- | -------------------------- | ------- | ------------ |
| `markspec fmt`          | Is it in canonical form?   | —       | every commit |
| `markspec check`        | Is it structurally valid?  | yes     | every commit |
| `markspec lint`         | Is the prose well-written? | no      | pre-push     |
| `markspec lock --check` | Has an upstream drifted?   | yes     | pre-push/CI  |

`markspec fmt --check` reports without rewriting (exit 1 if changes are needed);
plain `markspec fmt` rewrites in place.

## With git-std (recommended)

[git-std](https://github.com/driftsys/git-std) manages git hooks via
`.githooks/*.hooks` files. Each line takes a prefix — `~` fix (isolate staged
files, run, re-stage), `!` check (block on failure), `?` advisory (never block)
— and `$@` expands to the matching staged files.

`.githooks/pre-commit.hooks` — fast, every commit:

```text
~markspec fmt   $@ *.md
!markspec check $@ *.md
```

`.githooks/pre-push.hooks` — thorough, before sharing:

```text
!markspec check *.md
?markspec lint  *.md
!markspec lock --check
```

Then run `git std hook install`.

## With the pre-commit framework

For repos using [pre-commit](https://pre-commit.com/), add to
`.pre-commit-config.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: markspec-fmt
        name: markspec fmt --check
        entry: markspec fmt --check
        language: system
        files: \.md$
      - id: markspec-check
        name: markspec check
        entry: markspec check
        language: system
        files: \.md$
```

Then run `pre-commit install`.

## Plain Git hook

Create `.git/hooks/pre-commit`:

```bash
#!/usr/bin/env bash
set -euo pipefail
files=$(git diff --cached --name-only --diff-filter=ACM | grep '\.md$' || true)
[ -z "$files" ] && exit 0
markspec fmt --check $files
markspec check $files
```

```bash
chmod +x .git/hooks/pre-commit
```

## Bypass (emergency)

```bash
git commit --no-verify
```
