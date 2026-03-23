# Type-check all packages
check:
    deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts

# Run tests
test:
    deno test --allow-read

# Lint (Deno + dprint)
lint:
    deno lint
    dprint check

# Run all checks (check + test + lint)
build: check test lint

# Validate commits on branch and build — run before PR
verify:
    git std check --range main..HEAD
    just build

# Format (Deno for TypeScript, dprint for Markdown/JSON/YAML/TOML)
fmt:
    deno fmt
    dprint fmt

# Remove build artifacts
clean:
    rm -rf node_modules .dprint
