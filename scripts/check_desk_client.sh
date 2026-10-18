#!/bin/bash
# Verify the generated desk client schema is up to date with
# schemas/desk-api.json. Exits non-zero if stale.

set -euo pipefail

if ! bash apps/markdesk/scripts/gen-client.sh > /dev/null 2>&1; then
  echo "error: desk client generation failed — run 'npm ci' in apps/markdesk"
  exit 1
fi

if ! git diff --quiet apps/markdesk/src/api/schema.d.ts 2>/dev/null; then
  echo "error: generated desk client is stale — run 'npm --prefix apps/markdesk run gen:client' and stage the results"
  git diff --stat apps/markdesk/src/api/schema.d.ts
  exit 1
fi
