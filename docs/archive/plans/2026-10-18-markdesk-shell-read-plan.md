# MarkDesk Shell and Read Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first runnable MarkDesk app: a Tauri window that opens a
MarkSpec product from a local folder and lets the author browse the traceability
tree and read documents rendered like the book.

**Architecture:** The `markspec desk --serve` sidecar gains a strict `--root`, a
`root` handshake field, `--exit-on-stdin-eof`, and three read endpoints
(rendered document, rendered entry, source text) at `DESK_API_VERSION = 3`. The
shared book renderer gains entry anchors and cross-reference markup. A new
`apps/markdesk/` holds a React + Vite UI (typed client generated from
`schemas/desk-api.json`) and a thin Tauri v2 Rust shell that owns the window,
folder picker, recent-products store and sidecar lifecycle.

**Tech Stack:** Deno/TypeScript (server), React + Vite + TypeScript, Vitest +
Testing Library, openapi-typescript + openapi-fetch, Tauri v2 (Rust) with
`tauri-plugin-dialog`, `tauri-plugin-store`, `tauri-plugin-shell`/`opener`.

**Spec:** `docs/wip/2026-10-17-markdesk-shell-read-design.md` (read it before
any task).

## Global Constraints

- MarkDesk never writes any file inside the product folder (recents live in the
  OS app-data directory via the Tauri store).
- The UI never renders Markdown itself; all HTML comes from the server's book
  renderer.
- Desk API: loopback only, bearer token on every non-preflight request, Origin
  allowlist, `GET` + `OPTIONS` only, errors `{error:{code,message}}`, schema in
  `schemas/desk-api.json` updated in the same task as the code.
- `DESK_API_VERSION` becomes `3` (Task 3) and the UI refuses any other value.
- Project-relative paths in every API payload use `/` separators on all OSes.
- Primary UI copy has no rule codes and no Git/Markdown vocabulary. Exact
  strings (use verbatim):
  - Start screen: title `MarkDesk`, subtitle
    `Open a product to start reading and writing requirements.`, button
    `Open a product folder…`, list heading `Recent`.
  - Product menu item: `Open folder…`.
  - Not a product: `This folder doesn't contain a MarkSpec product.`
  - Generic open failure: `MarkDesk could not open this product.`
  - Disclosure for sidecar stderr: `Details`.
  - Missing recent folder: `folder not found`, action `Remove from list`.
  - Version mismatch:
    `This version of MarkDesk does not match the installed markspec.`
  - Lost connection: `MarkDesk lost the connection to this product.`, action
    `Reopen`.
  - Assistant column: `Set up an assistant to ask questions about this product.`
  - Read-only external entry: `From {origin}, read-only.`
- Tauri v2; npm with committed `package-lock.json`; exact dependency versions.
- Source drawer is light paper + Plex Mono, never a dark editor theme.
- Commits: Conventional Commits, git-std scopes only (`cli`, `book`, `repo`,
  `ci`, `docs`); end every message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not skip hooks.

## Review Focus

1. **Windows separators** — `relative()` yields `\` on Windows; API paths and
   the allowlist must use `/`. Test owner: Task 3 (`toApiPath` unit test).
2. **Path abuse on `/files` and `/documents`** — `../project.yaml`, absolute
   paths, percent-encoded `%2e%2e`, a real `.md` that holds no project entry, an
   upstream entry's file → all 404 `not-found`, never file contents. Owner:
   Task 3.
3. **Sidecar dies after the handshake** — fetch fails mid-session → the
   lost-connection message with `Reopen`, not a blank pane. Owner: Task 6.
4. **Display IDs containing `/` or `.`** — entry URLs use `encodeURIComponent`,
   anchors are looked up by `data-display-id` attribute (not CSS selectors built
   from raw IDs). Owners: Task 7 (navigator/selection) and Task 8
   (scroll-to-entry).
5. **Cycles and multi-parent nodes** — navigator must not recurse eagerly and
   must show a multi-parent node under each parent. Owner: Task 7.

---

## File Structure

Server (Deno):

- `packages/markspec/desk/server.ts` — strict root, handshake `root`, stdin-EOF
  shutdown.
- `packages/markspec/cli/commands/desk_cmd.ts` — `--exit-on-stdin-eof` flag.
- `packages/markspec/desk/api.ts` — v3 routes, `DeskSource.readFile`, allowlist,
  `toApiPath`.
- `packages/markspec/desk/render.ts` (new) — `renderDocumentView`,
  `renderEntryHtmlView` (keeps `api.ts` routing-only).
- `packages/markspec/book/site/mod.ts` — anchors, cross-refs, `renderEntryHtml`
  export.
- `schemas/desk-api.json`, `docs/architecture/adr-035-markdesk.md`, `AGENTS.md`
  (desk row).

App (`apps/markdesk/`):

- `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`,
  `index.html`, `README.md`.
- `scripts/gen-client.sh` + root `scripts/check_desk_client.sh`.
- `src/api/schema.d.ts` (generated), `src/api/client.ts`.
- `src/shell/bridge.ts` — `ShellBridge` interface + Tauri implementation.
- `src/app/App.tsx`, `src/app/StartScreen.tsx`, `src/app/ProductMenu.tsx`,
  `src/app/useProduct.ts`.
- `src/navigator/model.ts`, `src/navigator/Navigator.tsx`.
- `src/document/DocumentPane.tsx`, `src/document/useHistory.ts`,
  `src/document/SourceDrawer.tsx`, `src/assistant/AssistantColumn.tsx`.
- `src/styles/app.css`, `src/fonts/*.woff2`.
- `src-tauri/` — `Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`,
  `src/main.rs`, `src/lib.rs`, `src/handshake.rs`, `src/recents.rs`,
  `src/sidecar.rs`.
- `.github/workflows/markdesk.yaml`.

---

### Task 1: Sidecar startup contract (strict root, `root` in handshake, stdin EOF)

**Files:**

- Modify: `packages/markspec/desk/server.ts`
- Modify: `packages/markspec/cli/commands/desk_cmd.ts`
- Test: `tests/e2e/desk_test.ts`
- Docs: `docs/architecture/adr-035-markdesk.md` (SAD_DESK_0002 / 0003 text:
  strict root, handshake fields, stdin flag; closes #825)

**Interfaces:**

- Produces:
  `DeskServerOptions { port; root?; allowedOrigins?;
  exitOnStdinEof?: boolean }`;
  `DeskHandshake { url; token; apiVersion;
  root: string }` (absolute
  discovered product root). CLI flag `--exit-on-stdin-eof`.

- [ ] **Step 1: Write failing e2e tests** in `tests/e2e/desk_test.ts` (reuse its
      local spawn pattern, `ignore: !hasNet`):
  - `"desk --serve --root: a folder outside any product exits 1 without a handshake"`
    — `--root` = fresh `Deno.makeTempDir()`, spawn with `cwd` = repository root
    (itself a product). Assert exit code `1`, stdout `""`, stderr includes
    `no MarkSpec project` (match the existing soft-gate wording).
  - `"desk --serve --root: a subfolder opens the enclosing product"` —
    `--root FIXTURE_ROOT/docs`; handshake `root` equals
    `await Deno.realPath(FIXTURE_ROOT)`.
  - `"desk --serve --exit-on-stdin-eof: closing stdin stops the server"` — spawn
    with `stdin: "piped"`, read handshake, close stdin writer, assert the
    process exits with code `0` within 5000 ms.
- [ ] **Step 2: Run** `deno test --allow-all tests/e2e/desk_test.ts` → the three
      new tests FAIL.
- [ ] **Step 3: Implement.** In `startDeskServer`: when `root` is given, build
      the env with `rootOverrides: () => [resolve(root)]` **and**
      `cwd: () => resolve(root)` so no fallback to the process cwd exists; add
      `root: project.projectRoot` to the handshake. When `exitOnStdinEof`, start
      a background loop reading `Deno.stdin.readable` to completion, then
      `server.shutdown()` and return (exit code 0). Add the CLI option (boolean,
      description `Exit when stdin closes (for app-managed
      sidecars)`) and
      pass it through.
- [ ] **Step 4: Run** `deno test --allow-all tests/e2e/desk_test.ts` → all PASS;
      `deno test --allow-all packages/markspec/desk/` still PASS.
- [ ] **Step 5: Commit**
      `fix(cli): make desk --root strict and stop on stdin EOF` (body:
      `Closes #825.`).

---

### Task 2: Book renderer — entry anchors, cross-refs, single-entry export

**Files:**

- Modify: `packages/markspec/book/site/mod.ts`, `packages/markspec/book/mod.ts`
  (re-export)
- Test: `packages/markspec/book/site/mod_test.ts`

**Interfaces:**

- Produces:
  - `RenderChapterOptions.knownDisplayIds?: ReadonlySet<string>`
  - every `req-block` div carries `id="entry-<displayId>"` and
    `data-display-id="<displayId>"` (both HTML-escaped)
  - cross-ref element: `<span class="cross-ref" data-display-id="X">X</span>`
  - `export function renderEntryHtml(entry: Entry, options: { profile?:
    EffectiveProfile; knownDisplayIds?: ReadonlySet<string> }): string`

- [ ] **Step 1: Write failing tests:**
  - `"renderChapterHtml: entry block carries id and data-display-id"` — HTML
    contains `id="entry-SRS_BRK_0001"` and `data-display-id="SRS_BRK_0001"`.
  - `"renderChapterHtml: trace value in knownDisplayIds becomes a cross-ref"` —
    `Satisfies: SYS_BRK_0003` with set `{SYS_BRK_0003}` → contains
    `<span class="cross-ref" data-display-id="SYS_BRK_0003">SYS_BRK_0003</span>`.
  - `"renderChapterHtml: unknown trace value stays plain"` — same input, empty
    set → no `cross-ref`.
  - `"renderChapterHtml: known ID in prose becomes a cross-ref, not inside code"`
    — prose `See SYS_BRK_0003 and \`SYS_BRK_0003\`.`→ exactly one`cross-ref`
    span.
  - `"renderChapterHtml: no knownDisplayIds leaves output byte-identical"` —
    compare against the output for the same fixture computed with the option
    omitted before the change (snapshot via `assertSnapshot`).
  - `"renderEntryHtml: renders one entry like the chapter renderer"` — equals
    the `req-block` substring of `renderChapterHtml` for a one-entry document.
- [ ] **Step 2: Run** `deno test --allow-all packages/markspec/book/site/` → new
      tests FAIL.
- [ ] **Step 3: Implement.** Attribute values: split on `[\s,]+`, wrap tokens in
      the set. Prose and entry bodies: a rehype transform in the prose processor
      that splits text nodes on whole-token matches of the set, skipping
      descendants of `code`, `pre`, `a`. Promote `_entryToHtml` into the
      exported `renderEntryHtml`. The snapshot test pins that the `id` /
      `data-display-id` attributes are the only change when the set is absent
      (update the snapshot once, review it).
- [ ] **Step 4: Run** the book tests and `deno test --allow-all tests/e2e/` book
      tests → PASS.
- [ ] **Step 5: Commit**
      `feat(book): add entry anchors and cross-reference
      markup to the chapter renderer`.

---

### Task 3: Desk API v3 — documents, rendered entry, source text

**Files:**

- Create: `packages/markspec/desk/render.ts`
- Modify: `packages/markspec/desk/api.ts`, `packages/markspec/desk/server.ts`
  (provide `readFile`), `schemas/desk-api.json`
- Test: `packages/markspec/desk/api_test.ts`, `tests/e2e/desk_test.ts`
- Docs: ADR-035 (new SAD_DESK entry for the three read endpoints, via
  `markspec insert` → `markspec fmt` → `markspec check`, never a hand-written
  `Id:`), `AGENTS.md` desk row.

**Interfaces:**

- Consumes: `renderChapterHtml(..., { file, profile, knownDisplayIds })`,
  `renderEntryHtml` (Task 2).
- Produces (also as schema components `DocumentView`, `EntryHtmlView`,
  `SourceText`):
  - `DESK_API_VERSION = 3`
  - `DeskSource.readFile(absolutePath: string): Promise<string | undefined>`
  - `export function toApiPath(projectRoot: string, file: string): string`
    (project-relative, `/` separators)
  - `GET /api/v1/documents?path=P` →
    `DocumentView { apiVersion; path; html;
    entries: { displayId: string; anchor: string }[] }`
    (anchor = `entry-<displayId>`)
  - `GET /api/v1/entries/{id}/html` →
    `EntryHtmlView { apiVersion; displayId;
    html; origin? }`
  - `GET /api/v1/files?path=P` → `SourceText { apiVersion; path; text }`
  - `ProductNode.origin` and `EntryView.origin` set for **every** non-project
    entry (delivered and upstream).
  - Allowlist = set of `toApiPath(root, e.location.file)` for compiled entries
    with no `origin`. `/documents` additionally requires a `.md` path. Anything
    else → 404 `not-found`; missing `path` → 400 `bad-request`.

- [ ] **Step 1: Write failing tests** in `api_test.ts` (style `"desk api: …"`,
      existing `handler()`/`get()`/`assertMatchesSchema`):
  - documents: 200 for `docs/<fixture>.md`; `html` contains `data-display-id`;
    `entries` lists the file's display IDs with anchors; matches `DocumentView`.
  - documents: cross-refs present for a known trace target.
  - entries/{id}/html: 200 for a fixture entry, matches `EntryHtmlView`;
    `encodeURIComponent` of an ID with `/` resolves (add such an entry to a
    `compileDocs` fixture).
  - files: 200 returns exact bytes of the fixture file; matches `SourceText`.
  - Review Focus 2 — each → 404 `not-found`: `../project.yaml`, absolute path,
    `%2e%2e%2fproject.yaml`, `project.yaml`, a `.md` with no entries, an
    upstream entry's file. `/documents` without `path` → 400.
  - Review Focus 1 — `"toApiPath: converts Windows separators"`:
    `toApiPath("C:\\p", "C:\\p\\docs\\a.md")` → `"docs/a.md"` (inject
    `@std/path/windows` via a parameter or test the separator normalisation on a
    backslash input).
  - tree/entry: `origin` set for an upstream fixture entry.
  - e2e `desk_test.ts`: handshake `apiVersion` is `3`; `/api/v1/files` over
    loopback returns 200 with the token, 401 without.
- [ ] **Step 2: Run**
      `deno test --allow-all packages/markspec/desk/
      tests/e2e/desk_test.ts`
      → FAIL.
- [ ] **Step 3: Implement** routes as new branches in `route()`, rendering in
      `render.ts`; build the allowlist from the cached compile per request
      (cheap set build). Update the schema paths and components first, then
      code.
- [ ] **Step 4: Run** the same tests → PASS; `just check` → PASS.
- [ ] **Step 5: Commit**
      `feat(cli): add desk document, entry html and source
      endpoints (api v3)`.

---

### Task 4: `apps/markdesk` scaffold and generated typed client

**Files:**

- Create:
  `apps/markdesk/{package.json,package-lock.json,vite.config.ts,
  tsconfig.json,index.html,README.md,.gitignore}`,
  `apps/markdesk/scripts/gen-client.sh`, `apps/markdesk/src/main.tsx`,
  `apps/markdesk/src/api/schema.d.ts` (generated),
  `apps/markdesk/src/api/client.ts`, `apps/markdesk/src/api/client.test.ts`,
  `scripts/check_desk_client.sh`, `.github/workflows/markdesk.yaml`
- Modify: root `deno.json` (`lint.exclude`, `test.exclude`, `fmt.exclude` add
  `apps/markdesk/node_modules/`, `apps/markdesk/dist/`,
  `apps/markdesk/src-tauri/target/`; `test`/`lint` exclude `apps/markdesk/`),
  `dprint.json` (exclude `apps/markdesk/package-lock.json`)

**Interfaces:**

- Produces:
  - npm scripts: `dev`, `build`, `test` (vitest run), `typecheck`
    (`tsc --noEmit`), `gen:client`.
  - `export const EXPECTED_API_VERSION = 3`
  - `export function createDeskClient(baseUrl: string, token: string):
    DeskClient`
    where `DeskClient` has `tree(): Promise<ProductTree>`,
    `entry(id: string): Promise<EntryView>`,
    `entryHtml(id: string): Promise<EntryHtmlView>`,
    `document(path: string): Promise<DocumentView>`,
    `file(path: string): Promise<SourceText>`; every method rejects with
    `DeskError { status: number; code: string; message: string }` on a non-2xx
    or network failure (`status: 0`, `code: "network"`).
  - Types re-exported from `schema.d.ts` components.

- [ ] **Step 1: Write failing Vitest tests** `client.test.ts` with a stubbed
      `fetch`: sends `Authorization: Bearer <token>`; `entry("A/B")` requests
      `/api/v1/entries/A%2FB`; `document("docs/a b.md")` encodes the query; 404
      body → `DeskError{status:404, code:"not-found"}`; fetch throwing →
      `DeskError{status:0, code:"network"}`.
- [ ] **Step 2: Run** `npm --prefix apps/markdesk test` → FAIL.
- [ ] **Step 3: Implement.** `gen-client.sh` runs
      `npx openapi-typescript ../../schemas/desk-api.json -o src/api/schema.d.ts`
      then `deno fmt` on the output. `check_desk_client.sh` mirrors
      `scripts/check_tokens.sh` (regenerate, `git diff --quiet`, error message
      `generated desk client is stale — run 'npm --prefix
      apps/markdesk run gen:client' and stage the results`).
      Workflow `markdesk.yaml`: `pull_request` path filter `apps/markdesk/**`,
      `schemas/desk-api.json`, the workflow file; job on `ubuntu-latest`: Node
      22, `npm ci`, `typecheck`, `test`, `build`,
      `bash scripts/check_desk_client.sh`. README: prerequisites (Node 22, Rust
      stable, Deno), `npm ci`, `npm run dev`.
- [ ] **Step 4: Run**
      `npm --prefix apps/markdesk run typecheck && npm --prefix
      apps/markdesk test && bash scripts/check_desk_client.sh && just check`
      → PASS.
- [ ] **Step 5: Commit**
      `feat(repo): scaffold MarkDesk app with generated desk
      client`.

---

### Task 5: Tauri shell — handshake, recents store, sidecar lifecycle

**Files:**

- Create:
  `apps/markdesk/src-tauri/{Cargo.toml,build.rs,tauri.conf.json,
  capabilities/default.json}`,
  `src/main.rs`, `src/lib.rs`, `src/handshake.rs`, `src/recents.rs`,
  `src/sidecar.rs`, `apps/markdesk/scripts/build-sidecar.sh`
- Modify: `apps/markdesk/package.json` (`tauri` scripts, `@tauri-apps/cli`,
  `@tauri-apps/api`, plugin JS packages), `apps/markdesk/.gitignore`
  (`src-tauri/binaries/`, `src-tauri/target/`),
  `.github/workflows/markdesk.yaml` (Rust job), README (manual smoke test)

**Interfaces:**

- Consumes: Task 1 handshake JSON `{url, token, apiVersion, root}` and flags.
- Produces (Tauri commands, camelCase over IPC):
  - `open_product(path: String) -> Result<OpenedProduct, OpenError>` where
    `OpenedProduct { url: String, token: String, api_version: u32, root:
    String }`
    and
    `OpenError { kind: "not-a-product" | "spawn-failed",
    details: String }`.
    Starts the new sidecar; on success stops the previous one and records `root`
    in recents (most recent first).
  - `list_recents() -> Vec<RecentProduct>` with
    `RecentProduct { root:
    String, name: Option<String>, exists: bool }`.
  - `set_product_name(root: String, name: String)`.
  - `remove_recent(root: String)`.
  - Rust pure functions with unit tests:
    `handshake::parse(line: &str) ->
    Result<Handshake, String>`;
    `recents::touch(list: Vec<Recent>, root: &str)
    -> Vec<Recent>` (dedupe,
    front, cap 10); `recents::remove`.
  - Sidecar command: debug builds run
    `deno run --allow-read --allow-write
    --allow-env --allow-net=127.0.0.1 <repo>/packages/markspec/main.ts desk
    --serve --port 0 --root <path> --exit-on-stdin-eof --allow-origin
    http://localhost:5173`
    (repo path from `env!("CARGO_MANIFEST_DIR")` `/../../..`); release builds
    run the bundled `externalBin` `binaries/markspec` with the same args minus
    `--allow-origin`. Child stdin stays piped and open for the child's lifetime;
    on app exit and on product switch the child is killed explicitly too.
  - "not-a-product" = child exits with code 1 before printing a handshake;
    `details` = captured stderr. Handshake timeout 30 s → "spawn-failed".

- [ ] **Step 1: Write failing Rust unit tests:** `parse` accepts the Task 1 line
      and rejects missing `token`/`root`; `touch` moves an existing root to the
      front without duplicating; caps at 10 dropping the oldest; `remove`
      deletes by root.
- [ ] **Step 2: Run**
      `cargo test --manifest-path
      apps/markdesk/src-tauri/Cargo.toml` →
      FAIL.
- [ ] **Step 3: Implement** the modules and commands; register
      `tauri-plugin-dialog`, `tauri-plugin-store` (file `recents.json` in
      app-data), and `tauri-plugin-opener`. `build-sidecar.sh` runs
      `deno
      compile` into
      `src-tauri/binaries/markspec-<rustc host triple>`. CI Rust job (ubuntu,
      install the Tauri Linux system packages, create an empty placeholder
      sidecar binary so `tauri-build` accepts `externalBin`), runs `cargo test`
      and `cargo clippy -- -D warnings`.
- [ ] **Step 4: Run** `cargo test`, `cargo clippy -- -D warnings` → PASS;
      manual: `npm --prefix apps/markdesk run tauri dev` opens a window (blank
      UI is fine at this point).
- [ ] **Step 5: Commit**
      `feat(repo): add MarkDesk Tauri shell with sidecar
      lifecycle and recents`.

---

### Task 6: Open flow — start screen, product menu, errors

**Files:**

- Create: `apps/markdesk/src/shell/bridge.ts`, `src/app/App.tsx`,
  `src/app/StartScreen.tsx`, `src/app/ProductMenu.tsx`, `src/app/useProduct.ts`,
  tests `src/app/*.test.tsx`
- Modify: `src/main.tsx`

**Interfaces:**

- Consumes: Task 4 `createDeskClient`, `EXPECTED_API_VERSION`, `DeskError`; Task
  5 commands.
- Produces:
  - `interface ShellBridge { openProduct(path): Promise<OpenedProduct>;
    listRecents(): Promise<RecentProduct[]>; setProductName(root, name):
    Promise<void>; removeRecent(root): Promise<void>; pickFolder():
    Promise<string | null>; openExternal(url: string): Promise<void> }` +
    `tauriBridge` implementation (`openExternal` via `tauri-plugin-opener`).
  - `useProduct(bridge)` state:
    `{ status: "start" | "opening" | "open" |
    "error"; product?: { root; name; client: DeskClient }; error?: {
    message; details? } }`,
    actions `open(path)`, `reopen()`.
  - App layout slots: `navigator`, `document`, `assistant` (filled by Tasks 7–8;
    placeholders here).

- [ ] **Step 1: Write failing tests** (fake `ShellBridge`, fake client):
  - no recents → start screen with the exact start-screen strings.
  - recents with an existing first item → opens it at launch, no start screen;
    tree `project.name` is passed to `setProductName`.
  - first recent folder missing → start screen, that item shows
    `folder not found` and `Remove from list`.
  - `openProduct` rejects `{kind:"not-a-product"}` → message
    `This folder doesn't contain a MarkSpec product.` and a `Details` disclosure
    with the stderr; current product (if any) stays open.
  - handshake `api_version` 2 → version-mismatch message, client not used.
  - Review Focus 3: client rejects `DeskError{code:"network"}` after open →
    `MarkDesk lost the connection to this product.` + `Reopen`, which calls
    `openProduct(root)` again.
  - product menu lists recents and `Open folder…` (calls `pickFolder`).
- [ ] **Step 2: Run** `npm --prefix apps/markdesk test` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(repo): add MarkDesk open flow and product menu`.

---

### Task 7: Navigator

**Files:**

- Create: `apps/markdesk/src/navigator/model.ts`, `Navigator.tsx`, tests.

**Interfaces:**

- Consumes: `ProductTree` (Task 4).
- Produces:
  - `buildNavigatorModel(tree: ProductTree): NavigatorModel` with
    `roots: string[]`, `node(id): ProductNode`,
    `children(id):
    { refining: string[]; verifying: string[] }` (child →
    parent edges; `satisfies`/`derived-from` → refining, `verifies` → verifying;
    each sorted with `compareDisplayIds` natural order).
  - `export function compareDisplayIds(a: string, b: string): number`
  - `<Navigator model selected onSelect(displayId) />` — lazy expansion; row =
    type colour mark + display ID + title; origin badge when `node.origin`.

- [ ] **Step 1: Write failing tests:** natural sort (`SRS_2` before `SRS_10`);
      grouping refining before verifying; multi-parent node listed under both
      parents; cycle fixture (A→B→A plus extra root) renders without recursion
      and expands one level per click (Review Focus 5); selecting a row calls
      `onSelect` with the raw display ID including `/` (Review Focus 4).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(repo): add MarkDesk navigator`.

---

### Task 8: Document pane, history, source drawer, assistant column, theme

**Files:**

- Create:
  `apps/markdesk/src/document/{DocumentPane.tsx,useHistory.ts,
  SourceDrawer.tsx}`,
  `src/assistant/AssistantColumn.tsx`, `src/styles/app.css`, `src/fonts/` (IBM
  Plex Serif/Sans/Mono WOFF2 converted from `packages/markspec-typst/fonts/`,
  with the OFL licence file), tests.
- Modify: `src/app/App.tsx` (wire slots), README (smoke-test checklist).

**Interfaces:**

- Consumes: `DeskClient` (Task 4), `NavigatorModel` (Task 7), cross-ref and
  anchor markup (Task 2), `DocumentView`/`EntryHtmlView`/`SourceText` (Task 3).
- Produces: `useHistory()` →
  `{ current?: string; select(id); back();
  forward(); canBack; canForward }`;
  selection flow: `client.entry(id)` → if `origin` → `client.entryHtml(id)` +
  read-only line; else if `location.file` ends with `.md` →
  `client.document(path)` (cached per path) then scroll to the element whose
  `data-display-id === id` and add the highlight class; else (source file) →
  `client.entryHtml(id)`.

- [ ] **Step 1: Write failing tests:**
  - selecting a Markdown entry renders the document HTML and highlights the
    block with matching `data-display-id` (ID containing `/` and `.`: lookup by
    attribute comparison, not a CSS selector string — Review Focus 4).
  - selecting a source-file entry uses `entryHtml`.
  - an `origin` entry shows `From {origin}, read-only.` and hides the Source
    drawer toggle.
  - clicking a `.cross-ref` selects its `data-display-id`; Back/Forward walk the
    selections; `Alt+Left`/`Alt+Right` (and `Cmd+[`/`Cmd+]` on macOS) do the
    same.
  - clicking an `http(s)` link calls the bridge's external-open, never navigates
    the webview.
  - Source drawer shows `client.file(path).text` with line numbers and scrolls
    to `location.line`.
  - assistant column shows exactly
    `Set up an assistant to ask questions about this product.`
  - relative `<img>` in document HTML is replaced by its alt text placeholder.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** CSS: import `theme/markspec.css` (via Vite alias to
      the repo `theme/`) for `--ms-*` / `--md-*`; set `data-theme` on `<html>`
      from `matchMedia("(prefers-color-scheme: dark)")` and follow changes; A4
      sheet width/margins from `--md-page-*` tokens; `.cross-ref` dashed
      underline; Source drawer = paper background, Plex Mono 12/19, recessed
      gutter only.
- [ ] **Step 4: Run** tests + typecheck + build → PASS; run the README manual
      smoke test with `tauri dev` on this repository (open folder, pick an STK
      entry, follow a link, Back, open Source, switch product via menu, quit and
      confirm no `markspec` process remains).
- [ ] **Step 5: Commit**
      `feat(repo): add MarkDesk document pane, history and
      source drawer`.

---

## After the last task

- Whole-branch review (`/review`), then the `sdd-gardening` skill so `docs/wip/`
  is empty before the PR; squash to one commit per AGENTS.md; `just build` +
  `deno fmt --check` before push; PR body `Part of #826.` and `Closes #825.`
