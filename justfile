[private]
default:
    @just --list

# Type-check, lint, and test all packages
check: lint test
    deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts

# Run tests
test:
    deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi

# Lint (Deno + dprint)
lint:
    deno lint
    dprint check

# Check then compile the CLI binary
build: check compile

# Format (Deno for TypeScript, dprint for Markdown/JSON/YAML/TOML)
fmt:
    deno fmt
    dprint fmt

# Regenerate theme files from spec tokens
tokens:
    deno run --allow-read --allow-write scripts/gen_theme.ts

# Build spec and guide books (requires mdbook)
book: tokens
    mdbook build docs/spec
    mdbook build docs/guide
    typst compile --font-path packages/markspec-typst/fonts docs/markspec-cheatsheet.typ _site/markspec-cheatsheet.pdf
    cp -r docs/theme _site/theme
    cp docs/index.html _site/index.html

# Serve a book locally with live reload (default: spec)
book-dev book="spec":
    mdbook serve docs/{{book}} --open

# Bump version, update changelog, commit, and tag
bump:
    git std bump

# Build npm package via dnt
build-npm:
    deno run -A scripts/build_npm.ts

# Publish to JSR and npm
publish: build
    deno publish
    just build-npm
    cd npm && npm publish --access public

# Compile the CLI binary for the current platform
compile:
    deno compile --allow-read --allow-write --allow-run --allow-env --allow-ffi \
        --include packages/markspec-typst/ \
        --output dist/markspec \
        packages/markspec/main.ts

# Bump, push tag, and publish (full local release flow)
release: bump
    git push --follow-tags
    just publish

# Remove build artifacts
clean:
    rm -rf node_modules .dprint _site npm markspec
