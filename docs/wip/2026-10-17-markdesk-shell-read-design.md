# MarkDesk: Tauri shell, open a product, read a product (design)

Status: draft for approval · Epic #826 · Journeys DESK-1 (Start) and DESK-6
(Read) from `docs/product/markdesk.md` · Architecture:
`docs/architecture/adr-035-markdesk.md`

## 1. Intent

MarkDesk is the desktop app for people who write requirements but are not
engineers (the "Marie" persona). The backend (`markspec desk --serve`) exists
with two read endpoints. No UI exists yet.

This story ships the first MarkDesk app a person can run: a desktop window that
opens a MarkSpec product from a folder on the computer and lets the author
browse and read it the way the published book shows it. It is read-only. It is
the base that the write journeys (DESK-2 to DESK-4), the propose journey
(DESK-5) and the assistant integration build on.

Why now: the server-side blockers for a UI (#824 CORS/Origin, #823 tree as a
graph) are merged. Nothing in the later journeys can be tried by a real author
until a window exists.

## 2. Goals

1. A Tauri desktop app in `apps/markdesk/` that runs on macOS, Windows and Linux
   in development mode.
2. **Open (DESK-1, local variant).** The author opens a product by choosing a
   folder on the computer. MarkDesk remembers recent products and reopens the
   last one at launch.
3. **Read (DESK-6).** Three-pane window: navigator, document pane, assistant
   column. The navigator shows the traceability tree. Selecting an entry shows
   its whole document rendered like the published book, scrolled to the entry
   and highlighted. Trace links are clickable. A read-only Source drawer shows
   the exact file text.
4. The sidecar server never outlives the app (#825).

## 3. Non-goals (this story)

- Forge sign-in, repository list, clone into a workspace folder. DESK-1 as
  written in the founding document starts with sign-in; this story replaces it
  with "open a local folder". Sign-in and clone ship later together with DESK-5
  (propose), because both need the same GitLab connection.
- Any write path: entry form, Edit mode, `markspec fmt` from the app (DESK-2 to
  DESK-4).
- Findings / validation display (DESK-4).
- Any AI feature, including the DESK-1 "assistant summarizes the product" step
  and DESK-6 questions in the assistant column. See section 9 for the assistant
  story that follows.
- Installers, code signing, auto-updater, release workflow (`markdesk-v*` tags).
  The app only needs to run from the repository in development mode, plus a
  local production build on the developer's machine.
- Images and other assets referenced from documents (see 6.4).
- Search.

## 4. Anti-goals (would make this a failure even if it works)

- MarkDesk writes anything into the product repository (recent list, caches,
  settings, lock files). Principle 6: nothing is lost, no MarkDesk-only files.
- The Spec view looks different from the published book, or the UI contains a
  second Markdown renderer. Principle 5: one model, the file is the truth.
- The first screen of an opened product shows the folder layout instead of the
  traceability tree. Principle 1: the domain is the interface.
- Git, Markdown or MarkSpec syntax vocabulary in primary UI text (rule codes,
  "repository", "commit", bracket syntax). Errors are plain sentences.
- An orphaned `markspec` process left running after the app quits or crashes.
- The Source drawer styled as a dark code editor (ADR-035 SAD_DESK_0008).

## 5. Decided with the product owner

| Topic                  | Decision                                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Way in                 | Open a folder already on the computer. No sign-in, no clone in this story.                                                                                                                                                                              |
| Launch flow            | Option B: a start screen ("Open a product folder…") only when there is no last product. Otherwise MarkDesk reopens the last product directly. A product menu (▾) at the top of the window lists recent products and "Open folder…".                     |
| Not a product          | If the chosen folder is not a MarkSpec project, MarkDesk says so in one plain sentence and stays on the picker / keeps the current product.                                                                                                             |
| Spec view              | Option B: the whole document the entry lives in, rendered like the published book on an A4 sheet, scrolled to the entry, entry highlighted. Entries that live in source-code doc comments fall back to a single-entry sheet (the entry plus its links). |
| Assistant column       | Visible but empty in this story, with one line: "Set up an assistant to ask questions about this product." The line is not interactive yet.                                                                                                             |
| Assistant (next story) | Supported assistants are Claude Code, Codex and GitHub Copilot only. No free or no-account option for now (opencode + local models was considered and dropped). Detection, selection and guided installation are a separate story (section 9).          |
| Order                  | This story first; assistant setup next.                                                                                                                                                                                                                 |

## 6. How it works

### 6.1 Processes

- The Tauri shell (Rust, `apps/markdesk/src-tauri/`) owns: the window, the
  native folder picker, the recent-products store, and the sidecar lifecycle. It
  holds no product logic (SAD_DESK_0003).
- For each opened product, the shell starts one sidecar:
  `markspec desk --serve --port 0 --root <folder> --exit-on-stdin-eof`, reads
  the one-line JSON handshake (`url`, `token`, `apiVersion`) from stdout, and
  passes `url` and `token` to the web UI. In development it also passes
  `--allow-origin http://localhost:5173` (the Vite dev server).
- In development the sidecar is `deno run -A packages/markspec/main.ts …` from
  the repository. In a production build it is the compiled `markspec` binary
  bundled as a Tauri sidecar (`externalBin`).
- Switching product: start the new sidecar first; only when its handshake
  succeeds, stop the old one and swap. If the new one fails, keep the current
  product and show the error.
- If the UI receives an `apiVersion` other than the one it was generated
  against, it shows "This version of MarkDesk does not match the installed
  markspec" and does not continue.

### 6.2 `--exit-on-stdin-eof` (#825)

New flag on `markspec desk --serve`. When set, the server watches stdin and
shuts down cleanly when stdin reaches end-of-file. The shell keeps the child's
stdin as an open pipe; when the shell exits or crashes, the OS closes the pipe
and the server stops. Without the flag, behaviour is unchanged. This closes
#825.

### 6.3 Opening and recent products

- Recent products: a list of absolute folder paths plus display names, stored by
  the shell in the OS application-data directory (Tauri store). Most recent
  first, maximum 10 entries. The product name is `project.name` from the tree
  response, falling back to the folder name.
- At launch: if the most recent product's folder still exists and starts
  successfully, open it. Otherwise show the start screen (with the recent list
  if any).
- A recent product whose folder no longer exists is shown greyed with "folder
  not found" and can be removed from the list. It is not removed silently.
- "Not a MarkSpec product" is detected from the sidecar exiting with code 1
  before the handshake. The UI message is a plain sentence; the sidecar's stderr
  is available behind a "Details" toggle.
- **`--root` becomes strict (server change).** Today the desk command builds its
  candidate list as `[...rootOverrides, cwd]`
  (`packages/markspec/mcp/project.ts:333`), so a non-product `--root` silently
  falls back to the server's working directory (in development: the markspec
  repository itself). When `--root` is given, the desk command must use only
  that candidate and exit 1 when no project is found from it.
- **Choosing a subfolder of a product** (for example `myproduct/docs/`):
  discovery walks upward and opens `myproduct/`. MarkDesk accepts that, and the
  recent list stores the discovered product root, not the chosen subfolder. The
  handshake gains a `root` field (absolute path of the discovered root) so the
  shell knows what was opened.

### 6.4 Server additions (DESK_API_VERSION 2 → 3)

All new endpoints follow the existing rules: bearer token, Origin allowlist,
loopback only, `GET` + `OPTIONS` only, error shape `{error:{code,message}}`,
described in `schemas/desk-api.json` first.

1. **Rendered document.** `GET /api/v1/documents?path=<project-relative path>`
   returns the document rendered to HTML by the existing book renderer
   (`renderChapterHtml` in `packages/markspec/book/site/`), plus the list of
   entries in it with the HTML anchor of each. Only Markdown files that project
   discovery would index are allowed; anything else is 404.
2. **Rendered single entry.** For entries in source files: an endpoint (shape
   left to the builder) that renders one entry with the same renderer, so the UI
   never renders Markdown itself.
3. **Source text.** `GET /api/v1/files?path=<project-relative path>` returns the
   exact file text. Same allowlist as (1) plus indexed source files. Absolute
   paths, `..` segments, and symlinks that leave the project root are rejected.
4. **Paths in responses are project-relative.** `EntryView.location.file` (and
   the new endpoints) use paths relative to `--root`. If the current
   implementation returns absolute paths, change it in this version bump.
5. **Entries from outside the product.** The tree includes federated upstream
   entries (another repository) and profile-delivered entries
   (`.markspec/cache/…`). They stay in the navigator, marked with their origin.
   Selecting one shows the single-entry sheet (item 2) with a "from `origin`,
   read-only" line. No document or Source drawer for them. The documents/files
   allowlist never serves upstream paths; `EntryView` must not present an
   upstream `location.file` as if it were project-relative (expose `origin` and
   let the UI branch on it).
6. **Cross-references.** The book renderer currently writes trace-attribute
   values as plain `<code>` (`book/site/mod.ts:409-420`) and no cross-reference
   markup at all. This story adds cross-reference markup to the shared renderer
   (an element carrying `data-display-id`, styled as the dashed-underline
   cross-ref from `typography.md`) for (a) every display ID in a trace attribute
   value and (b) display IDs in body prose that resolve to a known entry. The
   change is additive and also improves `markspec book build` output. The UI
   turns those elements into navigation.
7. **Images:** not served in this story. Relative `<img>` sources in rendered
   documents are replaced by their alt text in a neutral placeholder box.
   (Reason: `<img>` requests cannot carry the bearer token; solving that is a
   separate decision.)

### 6.5 The window

- **Top bar:** product menu (▾ name, path in small grey text), Back / Forward.
- **Navigator (left):** built from `roots`, `nodes`, `edges`. A node's children
  are the nodes whose edge points to it (child → parent), so stakeholder needs
  are at the top. Expanded lazily. A node with several parents appears under
  each parent. Each row shows the display ID, the title, and a colour mark for
  the type (Paul Tol palette via `--ms-*` tokens). Under a parent, refining
  children (`satisfies`, `derived-from`) come first, then verifying children
  (`verifies`) after a thin separator; each group is sorted by display ID in
  natural order. Selecting a row selects the entry.
- **Document pane (middle):** the rendered document on an A4 sheet (`--ms-*`
  tokens, Plex Serif, page metrics from `theme/tokens.yaml` `app.page`). The
  selected entry is scrolled into view and highlighted. Cross-references to
  other entries are clickable and select that entry (and its document). Normal
  web links open in the system browser, never inside the app window.
- **Source drawer:** opens from the bottom of the document pane, shows the exact
  file text (Plex Mono on the same paper, gutter with line numbers, read-only)
  scrolled to the selected entry's line.
- **Assistant column (right):** see section 5.
- **History:** every selection is a history step; Back / Forward move through
  them (also mouse back/forward buttons and the platform shortcuts).
- **Theme:** light and dark follow the OS setting, using the `--md-*` light and
  dark tokens. `theme/markspec.css` switches on `[data-theme="dark"]`, so the UI
  sets that attribute from the OS setting.
- **Fonts:** IBM Plex is bundled with the app (WOFF2, converted from the OTFs in
  `packages/markspec-typst/fonts/`); no network font loading.
- **Visual-parity target:** "rendered like the published book" means the native
  renderer (`renderChapterHtml`) plus `theme/markspec.css`, the output of
  `markspec book build`. The live documentation site is currently built by
  mdBook (ADR-033), which does not render entry blocks, so it is not the
  reference.

## 7. Calls made by the designer (not discussed; change them if wrong)

1. The #825 fix ships in this story (it is the first story that launches the
   server from an app).
2. Package manager for the web UI: **npm** (same as `editors/vscode/`).
3. Typed client: **openapi-typescript** generates types from
   `schemas/desk-api.json`; **openapi-fetch** is the HTTP client. Generated
   files are committed and checked for staleness in CI (same pattern as
   `just tokens` / `scripts/check_tokens.sh`).
4. **Tauri v2**, with the official dialog and store plugins.
5. `apps/markdesk/` is not a Deno workspace member. Root Deno tasks
   (`deno
   check`, `deno lint`, `deno test`) exclude it. The UI is
   type-checked with `tsc --noEmit` and tested with Vitest + Testing Library.
   dprint and `deno fmt` keep formatting it (both handle `.ts`/`.tsx`/`.json`).
6. CI: a path-filtered workflow for `apps/markdesk/**` that runs the UI
   type-check, tests and build, plus `cargo check` / `cargo test` for the shell,
   on Linux only. Multi-OS shell builds come with the release story.
7. No end-to-end test that drives the real Tauri window in this story. Coverage
   is: Deno unit + e2e tests for the new endpoints and the stdin flag; Vitest
   tests for the UI against a mocked client; Rust unit tests for handshake
   parsing and the recent-products logic; a documented manual smoke test in
   `apps/markdesk/README.md`.
8. ADR-035 is edited in place for the new endpoints and the stdin flag (SAD_DESK
   entries), as was done in #828 and #829.
9. `--root` becomes strict for `desk`; a subfolder opens its enclosing product
   and the recent list stores the product root (6.3).
10. Upstream and delivered entries stay in the navigator and open as a read-only
    single-entry sheet (6.4 item 5).
11. Cross-reference markup is added to the shared book renderer, covering trace
    values and resolvable display IDs in prose (6.4 item 6).
12. Navigator groups refining children before verifying children (6.5).
13. The visual-parity reference is `markspec book build` output, not the mdBook
    site (6.5).

## 8. Left to the builder

- Exact React component structure, state management, routing library (or none).
- Exact JSON shapes of the new endpoints, within section 6.4.
- How entry anchors are produced in the rendered HTML (the renderer may need a
  stable `id` per entry block).
- Window size defaults and pane proportions; whether panes are resizable.
- Natural-sort implementation, icon set.

## 9. Follow-up story (recorded here so it is not lost): assistant setup

- On first run (and from a settings entry), MarkDesk detects whether Claude
  Code, Codex and GitHub Copilot are installed **and signed in**. "Installed but
  signed out" shows as "needs sign-in", not "ready".
- One or more found: the author chooses one. None found: MarkDesk offers a
  guided installation of one of the three (download/installer link plus the
  sign-in step). It never installs silently.
- Without an assistant, everything except prompt features works; prompt features
  are disabled with a pointer to setup.
- Every assistant suggestion goes through the normal path: the assistant
  proposes, the author accepts, `markspec fmt` gates the write (principle 7).

Other later stories: forge sign-in + clone + propose (DESK-1 full, DESK-5),
write journeys (DESK-2 to DESK-4), images in documents, release/installers.
