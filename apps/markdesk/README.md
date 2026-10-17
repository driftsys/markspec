# MarkDesk

Desktop authoring app for MarkSpec. This directory holds the web UI (React and
Vite). It talks to the `markspec desk --serve` loopback API described in
`schemas/desk-api.json`.

## Prerequisites

- Node 22 or newer
- Rust stable (for the Tauri shell)
- Deno (for `markspec` and for formatting the generated client)

## Develop

```bash
npm ci
npm run dev
```

## Scripts

- `npm test` runs the Vitest suite.
- `npm run typecheck` runs `tsc --noEmit`.
- `npm run build` builds the web UI into `dist/`.
- `npm run gen:client` regenerates `src/api/schema.d.ts` from
  `schemas/desk-api.json`. Commit the result.
- `npm run tauri dev` starts the desktop shell against the Vite dev server.
- `npm run build:sidecar` compiles the `markspec` CLI into
  `src-tauri/binaries/markspec-<target triple>`, the sidecar that release
  bundles ship.

## Desktop shell

`src-tauri/` holds the Tauri shell. To open a product it starts
`markspec desk --serve --port 0 --root <folder> --exit-on-stdin-eof` and reads
the one-line handshake from its stdout. Debug builds run the repository's
`packages/markspec/main.ts` with Deno and pass
`--allow-origin http://localhost:5173`; release builds run the bundled binary.
One sidecar runs at a time. The shell kills it when another product opens and
when the app exits; it also keeps the sidecar's stdin open, so the sidecar exits
if the shell dies.

Recently opened products are stored in `recents.json` in the app-data directory.

`tauri-build` requires the sidecar file to exist even for `cargo test`. Either
run `npm run build:sidecar` or create an empty placeholder:

```bash
mkdir -p src-tauri/binaries
touch "src-tauri/binaries/markspec-$(rustc -vV | sed -n 's/^host: //p')"
```

Rust checks:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
# Also start the real sidecar with Deno:
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored
```

### Manual smoke test

1. `npm ci`
2. Create the sidecar placeholder (see above).
3. `npm run tauri dev` — a MarkDesk window opens on the Vite dev server.
4. In the window's developer tools console, run the command below. It returns
   `{ url, token, apiVersion: 3, root }`, and `pgrep -fl "desk --serve"` lists
   one sidecar.

   ```js
   await window.__TAURI_INTERNALS__.invoke("open_product", {
     path: "/path/to/markspec",
   });
   ```
5. Close the window — the app exits and `pgrep -fl "desk --serve"` prints
   nothing.
