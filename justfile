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

# Build spec and guide books (requires mdbook)
book:
    mdbook build docs/spec
    mdbook build docs/guide
    cp docs/index.html _site/index.html

# Serve a book locally with live reload (default: spec)
book-dev book="spec":
    mdbook serve docs/{{book}} --open

# Bump version, update changelog, commit, and tag
bump:
    git std bump

# Publish to JSR
publish: build
    deno publish

# Compile the CLI binary for the current platform
compile:
    deno compile --allow-read --allow-write --allow-run --allow-env \
        --output markspec \
        packages/markspec/main.ts

# Bump, push tag, and publish (full local release flow)
release: bump
    git push --follow-tags
    just publish

# Remove build artifacts
clean:
    rm -rf node_modules .dprint _site markspec
