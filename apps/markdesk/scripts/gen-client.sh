#!/bin/bash
# Regenerate the typed desk API schema from schemas/desk-api.json.
set -euo pipefail
cd "$(dirname "$0")/.."
npx openapi-typescript ../../schemas/desk-api.json -o src/api/schema.d.ts
deno fmt src/api/schema.d.ts
