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
One sidecar runs at a time. When another product opens, the shell starts the new
sidecar first and stops the old one only after the new handshake succeeds and
reports the expected API version; on a failure the old sidecar keeps running.
The shell also stops the sidecar when the app exits, and keeps the sidecar's
stdin open, so the sidecar exits if the shell dies.

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
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --skip manual_assistant_
```

### Manual smoke test

Run it against this repository's own product.

1. `npm ci`
2. Create the sidecar placeholder (see above).
3. `npm run tauri dev` — a MarkDesk window opens on the Vite dev server.
4. Choose `Open a product folder…` and pick the repository root. The navigator
   lists the STK and SAD entries; `pgrep -fl "desk --serve"` lists one sidecar.
5. Click an STK entry. Its document renders on the A4 sheet, with the entry
   highlighted and scrolled into view.
6. Click a dashed cross-reference (for example `SAD_DESK_0011` inside
   `SAD_DESK_0002`). The document pane and the navigator move to that entry.
7. Press the Back button, `Alt+Left` or `Cmd+[`. The previous entry returns;
   Forward, `Alt+Right` and `Cmd+]` go forward again.
8. Click an external `https://` link. It opens in the system browser, and the
   MarkDesk window does not navigate. A relative link does nothing.
9. Press `Source`. The drawer shows the file with line numbers, scrolled to the
   entry's line, in Plex Mono on paper.
10. Switch the system appearance to dark. The app follows.
11. With Claude Code ready, select an SAD entry. Type "Shorten this body to one
    sentence." in the prompt box and press Enter. The column shows "Waiting for
    Claude Code…", then the Current and Proposed diff.
12. Press Reject. `git status` shows no change.
13. Ask again and press Accept. The document pane shows the new body, and
    `git diff` changes only that entry's body lines. Run `git checkout` on the
    file to undo the change.
14. Open the product menu and choose `Open folder…` with another product. The
    navigator, document and history reset; `pgrep -fl "desk --serve"` still
    lists one sidecar.
15. Quit the app. `pgrep -fl "desk --serve"` prints nothing.

The manual assistant tests need a signed-in Claude Code and are skipped in CI.
Run them with
`cargo test --manifest-path src-tauri/Cargo.toml -- --ignored manual_assistant_`.

## UI notes

- `App` provides the shell bridge through `BridgeContext` (`useBridge()`), so
  panes never import the Tauri-backed bridge. The selection history
  (`useHistory()`, with `useSelection()` on top) is keyed by the product root.
- `src/main.tsx` imports the repository tokens from `../../theme/markspec.css`
  (`vite.config.ts` allows that folder and drops the remote font import from
  it). The IBM Plex fonts are bundled from `src/fonts/` (SIL Open Font License,
  `src/fonts/OFL.txt`), because the content security policy allows bundled fonts
  only.
