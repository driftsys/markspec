#!/usr/bin/env bash
# Check that `markspec fmt` and `prim fmt` agree on the committed files
# (#984). Bare `markspec fmt` must leave every committed file unchanged, and
# `prim fmt --check .` must pass on the same tree. Together they show that
# neither formatter would rewrite the other's output. Files that only one of
# the two tools formats are checked by that tool alone. Needs a working tree
# without changes to tracked files; untracked files are ignored.
set -euo pipefail
cd "$(dirname "$0")/.."
PRIM="${PRIM:-prim}"
command -v "$PRIM" >/dev/null || PRIM="$HOME/.local/bin/prim"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "error: tracked files have changes; commit or stash them first" >&2
  exit 1
fi
deno run -A packages/markspec/main.ts fmt
if ! git diff --exit-code; then
  echo "error: markspec fmt changed the committed files above;" \
    "the diff is left in the working tree" >&2
  exit 1
fi
"$PRIM" fmt --check .
echo "markspec fmt and prim fmt agree"
