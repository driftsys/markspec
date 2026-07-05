# CI traceability gate

Run MarkSpec in CI to enforce traceability and format hygiene across the entire
repository on every push and pull request.

## Recommended pipeline

A minimal CI gate runs three jobs in sequence:

```text
fmt-check → check → (optional) lint
```

All three jobs consume no build artifacts — they operate on the committed source
files only.

## GitHub Actions

```yaml
name: MarkSpec

on: [push, pull_request]

jobs:
  fmt-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install markspec
        run: curl -fsSL https://raw.githubusercontent.com/driftsys/markspec/main/install.sh | sh
      - name: Format check
        run: markspec fmt --check docs/**/*.md

  check:
    runs-on: ubuntu-latest
    needs: fmt-check
    steps:
      - uses: actions/checkout@v4
      - name: Install markspec
        run: curl -fsSL https://raw.githubusercontent.com/driftsys/markspec/main/install.sh | sh
      - name: Check
        run: markspec check docs/**/*.md

  lint:
    runs-on: ubuntu-latest
    needs: check
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

markspec-fmt:
  stage: quality
  script:
    - curl -fsSL https://raw.githubusercontent.com/driftsys/markspec/main/install.sh | sh
    - markspec fmt --check docs/**/*.md

markspec-check:
  stage: quality
  script:
    - markspec check docs/**/*.md
  needs: [markspec-fmt]

markspec-lint:
  stage: quality
  allow_failure: true   # lint is informational; remove to make it blocking
  script:
    - markspec lint docs/**/*.md
  needs: [markspec-check]
```

## Exit codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| `0`  | Clean — no errors, no warnings                         |
| `1`  | Errors present — commit should be blocked              |
| `2`  | Warnings only — informational; gate at your discretion |

The `check` command exits `2` when only warnings are present. Use `--strict` to
promote warnings to errors and make the gate fully binary:

```sh
markspec check --strict docs/**/*.md
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

Cache `~/.local/bin/markspec` between runs to avoid downloading on every job.
Bump the version in the cache key whenever you bump `MARKSPEC_VERSION` (or the
"latest" you're tracking), so the cache invalidates instead of serving a stale
binary:

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.local/bin/markspec
    key: markspec-${{ runner.os }}-0.10.3
```

## Caching upstream snapshots

`markspec lock` is the only step that touches the network for `references:` and
`dependencies:` upstreams — `check` and `compile` read the pinned snapshots
under `.markspec/cache/upstreams/` entirely offline. Cache that directory
between CI runs, keyed on the lockfile's contents, so `lock` only re-acquires an
upstream when its pin has actually moved:

```yaml
- uses: actions/cache@v4
  with:
    path: .markspec/cache/upstreams
    key: markspec-upstreams-${{ hashFiles('markspec.lock') }}
```

With a warm cache, `markspec lock` is idempotent — it verifies each pinned
snapshot's hash and skips re-acquiring an upstream whose pin hasn't moved.
