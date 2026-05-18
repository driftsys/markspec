#!/bin/bash
# Verify the committed AST fidelity matrix catalogue is up to date.
# Exits non-zero if stale. SP3 — the success oracle; this gate enforces
# only catalogue freshness, never the OK/UNOWNED/RESIDUAL counts.

set -euo pipefail

deno run --allow-read --allow-write \
  scripts/gen_ast_fidelity_matrix.ts > /dev/null 2>&1

if ! git diff --quiet docs/product/ast-fidelity-matrix.md 2>/dev/null; then
  echo "error: docs/product/ast-fidelity-matrix.md is stale — run 'just ast-fidelity-matrix' and stage the result"
  git diff --stat docs/product/ast-fidelity-matrix.md
  exit 1
fi
