#!/bin/bash
# Verify generated theme files are up to date with tokens.yaml.
# Used by the pre-commit hook — exits non-zero if stale.

set -euo pipefail

deno run --allow-read --allow-write scripts/gen_theme.ts > /dev/null 2>&1

if ! git diff --quiet packages/markspec-typst/tokens.typ \
                      packages/markspec-typst/themes/light.typ \
                      packages/markspec-typst/themes/dark.typ \
                      docs/theme/markspec.css 2>/dev/null; then
  echo "error: generated theme files are stale — run 'deno run --allow-read --allow-write scripts/gen_theme.ts' and stage the results"
  git diff --stat packages/markspec-typst/tokens.typ \
                  packages/markspec-typst/themes/light.typ \
                  packages/markspec-typst/themes/dark.typ \
                  docs/theme/markspec.css
  exit 1
fi
