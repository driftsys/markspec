# Pre-commit hook

`markspec hook` is a pre-commit hook that runs format-check and validation on
the files staged for commit. Commits that contain malformed entries or broken
references are rejected before they reach the repository.

## What the hook checks

1. **Format** — every staged `.md` file is checked against the canonical format
   (`markspec format --check`). If any file needs reformatting the commit is
   rejected with a message: `needs formatting (run 'markspec format')`.
2. **Validation** — cross-file rules run on all staged entries. Missing `Id:`
   attributes, broken `Satisfies:` references, and duplicate display IDs all
   block the commit.

The hook does **not** run `markspec lint` (prose analysis). That is a
review-time quality gate, not a commit blocker.

## Setup

### pre-commit framework (recommended)

Add to `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: markspec
        name: markspec
        entry: markspec hook
        language: system
        types: [markdown]
        pass_filenames: true
```

Install the hook:

```sh
pre-commit install
```

### Plain Git hook

Create `.git/hooks/pre-commit`:

```sh
#!/usr/bin/env sh
set -e

# Get staged .md files
STAGED=$(git diff --cached --name-only --diff-filter=ACM | grep '\.md$' || true)

if [ -z "$STAGED" ]; then
  exit 0
fi

markspec hook $STAGED
```

Make it executable:

```sh
chmod +x .git/hooks/pre-commit
```

### Sharing the hook with the team

Git hooks are not committed to the repository. Use one of these approaches to
share them:

- **pre-commit framework** (recommended) — the `.pre-commit-config.yaml` file is
  committed; developers run `pre-commit install` after cloning.
- **Bootstrap script** — add a `bootstrap` script that installs the hook:

  ```sh
  #!/usr/bin/env sh
  cp scripts/pre-commit .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  ```

## Bypass (emergency)

```sh
git commit --no-verify -m "emergency: skip markspec hook"
```

Use sparingly. Bypassed commits accumulate formatting debt that must be paid
before the next regular commit.
