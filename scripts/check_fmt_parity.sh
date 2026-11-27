#!/usr/bin/env bash
# Check that `markspec fmt` and `prim fmt` give the same Markdown output
# (#984). Runs both formatters on the whole project, then fails when either
# one changed a committed file. Needs a clean working tree.
set -euo pipefail
cd "$(dirname "$0")/.."
PRIM="${PRIM:-prim}"
command -v "$PRIM" >/dev/null || PRIM="$HOME/.local/bin/prim"
if [ -n "$(git status --porcelain)" ]; then
  echo "error: the working tree is not clean; commit or stash first" >&2
  exit 1
fi
deno run -A packages/markspec/main.ts fmt
"$PRIM" fmt .
if ! git diff --exit-code; then
  echo "error: markspec fmt and prim fmt disagree on the files above" >&2
  git checkout -- .
  exit 1
fi
echo "markspec fmt and prim fmt agree"
