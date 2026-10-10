#!/bin/bash
# Warm the caches a cloud session needs. Runs after the checkout, so it can see
# the repo — unlike the environment's setup script. Backgrounded: a cold JSR
# cache must not delay the session.
set -uo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
(
  deno cache packages/markspec/main.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts
  [ -d apps/markdesk ] && ( cd apps/markdesk && npm ci --no-audit --no-fund )
  [ -f apps/markdesk/src-tauri/Cargo.toml ] && cargo fetch --manifest-path apps/markdesk/src-tauri/Cargo.toml
) >/tmp/markdesk-warm.log 2>&1 &
exit 0
