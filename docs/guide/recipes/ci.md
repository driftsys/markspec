# CI traceability gate

Run MarkSpec in CI to enforce traceability and format hygiene across the entire
repository on every push and pull request.

## Recommended pipeline

A minimal CI gate runs three jobs in sequence:

```text
format-check → validate → (optional) lint
```

All three jobs consume no build artifacts — they operate on the committed source
files only.

## GitHub Actions

```yaml
name: MarkSpec

on: [push, pull_request]

jobs:
  format-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install markspec
        run: curl -fsSL https://raw.githubusercontent.com/driftsys/markspec/main/install.sh | sh
      - name: Format check
        run: markspec format --check docs/**/*.md

  validate:
    runs-on: ubuntu-latest
    needs: format-check
    steps:
      - uses: actions/checkout@v4
      - name: Install markspec
        run: curl -fsSL https://raw.githubusercontent.com/driftsys/markspec/main/install.sh | sh
      - name: Validate
        run: markspec validate docs/**/*.md

  lint:
    runs-on: ubuntu-latest
    needs: validate
    steps:
      - uses: actions/checkout@v4
      - name: Install markspec
        run: curl -fsSL https://raw.githubusercontent.com/driftsys/markspec/main/install.sh | sh
      - name: Prose lint
        run: markspec lint docs/**/*.md
```

## GitLab CI

```yaml
stages:
  - quality

markspec-format:
  stage: quality
  script:
    - curl -fsSL https://raw.githubusercontent.com/driftsys/markspec/main/install.sh | sh
    - markspec format --check docs/**/*.md

markspec-validate:
  stage: quality
  script:
    - markspec validate docs/**/*.md
  needs: [markspec-format]

markspec-lint:
  stage: quality
  allow_failure: true   # lint is informational; remove to make it blocking
  script:
    - markspec lint docs/**/*.md
  needs: [markspec-validate]
```

## Exit codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| `0`  | Clean — no errors, no warnings                         |
| `1`  | Errors present — commit should be blocked              |
| `2`  | Warnings only — informational; gate at your discretion |

The `validate` command exits `2` when only warnings are present. Use `--strict`
to promote warnings to errors and make the gate fully binary:

```sh
markspec validate --strict docs/**/*.md
```

## Traceability report as CI artifact

Generate a coverage or traceability matrix and upload it as an artifact:

```yaml
- name: Traceability report
  run: markspec report traceability docs/**/*.md --output traceability.md

- uses: actions/upload-artifact@v4
  with:
    name: traceability
    path: traceability.md
```

## Caching the binary

Cache `~/.local/bin/markspec` between runs to avoid downloading on every job:

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.local/bin/markspec
    key: markspec-${{ runner.os }}-0.6.0
```
