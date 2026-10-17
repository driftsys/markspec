# Desk API CORS and Origin policy (#824) — plan

Issue: driftsys/markspec#824 (epic #826). Branch: `fix/desk-cors-824`.

## Spec

**Goal:** the MarkDesk UI runs in a Tauri webview whose origin is cross-origin
to `http://127.0.0.1:<port>`. Every request carries `Authorization`, so the
browser sends an `OPTIONS` preflight first. Today `createDeskHandler`
(`packages/markspec/desk/api.ts`) answers that preflight with 401 and never sets
CORS headers, so the first UI fetch fails. After this change, a browser on an
allowed origin can call the API, and a browser on any other origin is rejected
with 403.

**Decisions (approved by the user, details ruled by the controller):**

1. Check order in the handler: Host guard (unchanged) → Origin check → `OPTIONS`
   preflight → bearer check → method check → routing.
2. Origin check runs only when the request has an `Origin` header. A request
   with no `Origin` header (CLI tools, curl, Deno `fetch` in tests) continues as
   today; the nonce still protects it.
3. An `Origin` value that is not in the allowlist — including the literal string
   `null` — gets **403** with error code `forbidden-origin` and message
   `Origin is not allowed`. This applies to every method, including `OPTIONS`.
4. `OPTIONS` from an allowed origin returns **204** with an empty body, before
   the bearer check, with exactly these headers:
   - `Access-Control-Allow-Origin: <the request's Origin value, echoed>`
   - `Access-Control-Allow-Methods: GET, OPTIONS`
   - `Access-Control-Allow-Headers: Authorization`
   - `Access-Control-Max-Age: 600`
   - `Vary: Origin`
   - `Cache-Control: no-store`
5. Every non-preflight response to a request from an allowed origin carries
   `Access-Control-Allow-Origin: <echoed origin>` and `Vary: Origin` — the 200
   responses and also the 401, 404, 405 and 400 error responses, so the UI can
   read error bodies.
6. `OPTIONS` with no `Origin` header is not a preflight: it goes through the
   bearer check (401 without a token) and then the method check (405).
7. Built-in allowlist (always allowed), exported as a constant `TAURI_ORIGINS`
   from `desk/api.ts`: `tauri://localhost`, `http://tauri.localhost`,
   `https://tauri.localhost`.
8. Extra origins (for the Vite dev server) are opt-in through a repeatable CLI
   flag `--allow-origin <origin>` on `markspec desk`. No dev origin is allowed
   by default. `DeskHandlerOptions` gets an optional field
   `allowedOrigins?: readonly string[]`, added to `TAURI_ORIGINS`.
9. `--allow-origin` values are validated at startup: the value must parse with
   `new URL(value)`, its scheme must be `http:` or `https:`, and
   `new URL(value).origin` must equal the value with any single trailing `/`
   removed (so no path, query, fragment, or credentials). The stored form is
   `new URL(value).origin`. An invalid value prints
   `error: --allow-origin must be an origin like http://localhost:5173, got <value>`
   to stderr and exits 1, before the server starts.
10. Origin comparison is exact string equality against the stored allowlist
    (`URL.origin` form). No wildcard, no suffix match.

**Alternatives considered:**

- Always allow `http://localhost:5173`: rejected. Any local page on that port
  would pass the origin check; the nonce would still protect the data, but an
  opt-in flag keeps the default policy at Tauri-only.
- Answer every preflight with `*`: rejected. It removes the Origin check as a
  second line of defence next to the Host guard and the nonce.
- Validate `Access-Control-Request-Method` / `-Headers` on preflight: not done.
  The browser enforces the response headers; the server-side check adds code
  without adding protection.

## Global Constraints

- `packages/markspec/desk/api.ts` uses Web APIs only (no `Deno.*`), so it stays
  unit-testable without a socket. `Deno.*` is allowed in `desk/server.ts` and
  `cli/commands/desk_cmd.ts`.
- `deno fmt` for TypeScript; `dprint fmt` for Markdown/JSON. Both must pass.
- Doc comments (`/** */`) on every exported item.
- Never hand-write an `Id:` value. New MarkSpec entries go through
  `markspec insert`, then `markspec fmt <file>`, then `markspec check <file>`.
- Code comments and docs in plain, literal English.
- Commit with Conventional Commits, scope `cli` (e.g. `fix(cli): ...`). One
  commit per task. Do not push.

## Task 1: Origin policy in the desk handler

**Files:** `packages/markspec/desk/api.ts`,
`packages/markspec/desk/api_test.ts`.

Implement decisions 1–7 and 10 in `createDeskHandler`:

- Export `TAURI_ORIGINS: readonly string[]` with the three values from decision
  7, with a doc comment naming which platform uses which.
- Add `allowedOrigins?: readonly string[]` to `DeskHandlerOptions` with a doc
  comment ("extra origins allowed in addition to `TAURI_ORIGINS`, e.g. the Vite
  dev server; values are in `URL.origin` form").
- Build the allowlist once per handler (a `Set`).
- Add a `forbidden-origin` 403 path, the 204 preflight path, and attach
  `Access-Control-Allow-Origin` + `Vary: Origin` to every non-preflight response
  for an allowed origin (decision 5). Keep the change small: e.g. compute the
  CORS headers once and merge them into the response the existing routing
  produces.
- Update the module doc comment to describe the Origin policy.

Tests (TDD — write them first) in `api_test.ts`, following the file's existing
helpers and style:

1. Preflight from `tauri://localhost` (no `Authorization`) → 204, all six
   headers of decision 4 with exact values, empty body.
2. Preflight from `http://evil.example` → 403, body error code
   `forbidden-origin`.
3. `GET /api/v1/tree` with valid token from `http://evil.example` → 403
   `forbidden-origin`.
4. `GET /api/v1/tree` with valid token from `http://tauri.localhost` → 200 with
   `Access-Control-Allow-Origin: http://tauri.localhost` and `Vary: Origin`.
5. `GET /api/v1/tree` without token from `tauri://localhost` → 401 with
   `Access-Control-Allow-Origin: tauri://localhost`.
6. `Origin: null` → 403 `forbidden-origin`.
7. `allowedOrigins: ["http://localhost:5173"]` → preflight from
   `http://localhost:5173` is 204; the same handler without that option returns
   403 for that origin.
8. `GET` with valid token and no `Origin` header → 200 and no
   `Access-Control-Allow-Origin` header (existing behaviour preserved).
9. `OPTIONS` with no `Origin` and no token → 401.

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/desk/`
and `deno check packages/markspec/desk/server.ts`, `deno lint`,
`deno fmt --check`.

## Task 2: `--allow-origin` flag, contract, and ADR

**Files:** `packages/markspec/cli/commands/desk_cmd.ts`,
`packages/markspec/desk/server.ts`, `tests/e2e/desk_test.ts`,
`schemas/desk-api.json`, `docs/architecture/adr-035-markdesk.md`.

Depends on Task 1: `DeskHandlerOptions.allowedOrigins` and `TAURI_ORIGINS` exist
in `desk/api.ts`.

- `desk_cmd.ts`: add a repeatable option `--allow-origin <origin:string>`
  (Cliffy `collect: true`), description
  `Extra browser origin allowed to call the API (repeatable), e.g. the Vite dev server`.
  Validate each value per decision 9 before importing the server; on failure
  print the exact decision-9 error and exit 1. Add a help example:
  `markspec desk --serve --port 0 --allow-origin http://localhost:5173`.
- `server.ts`: add `allowedOrigins?: readonly string[]` to `DeskServerOptions`
  and pass it to `createDeskHandler`.
- `tests/e2e/desk_test.ts` (blackbox, CLI only, follow the file's existing spawn
  pattern):
  - spawn with `--allow-origin http://localhost:5173`, send
    `OPTIONS
    /api/v1/tree` with `Origin: http://localhost:5173` → 204 and
    `Access-Control-Allow-Origin: http://localhost:5173`;
  - `--allow-origin http://localhost:5173/path` → exit code 1 and stderr
    contains `--allow-origin must be an origin`.
- `schemas/desk-api.json`:
  - add an `options` operation to both paths (`/api/v1/tree` and
    `/api/v1/entries/{id}`): responses `204` (CORS preflight accepted,
    documenting the four `Access-Control-*` headers) and `403`
    (`ForbiddenOrigin`); `security: []` because preflight carries no token;
  - add a `ForbiddenOrigin` response in `components/responses` beside
    `ForbiddenHost`, and reference it as a `403` alternative on the existing
    `get` operations (OpenAPI allows one response per status code, so describe
    the `403` as "Host is not loopback, or Origin is not allowed" if a second
    `403` entry cannot be added);
  - extend the top-level `info.description` with one sentence: browser clients
    must send an allowed `Origin` (`tauri://localhost`,
    `http://tauri.localhost`, `https://tauri.localhost`, plus any
    `--allow-origin` values).
- `docs/architecture/adr-035-markdesk.md`: add one new SAD entry after
  `SAD_DESK_0002` stating the Origin policy (built-in Tauri allowlist, opt-in
  `--allow-origin`, 403 for other origins, preflight answered before the token
  check). Use `markspec next-id` / `markspec insert` for the ID and `Id:`, then
  move the block into place, then `markspec fmt` and `markspec check` on the
  file. One requirement per entry, active voice, measurable. Do not edit the
  existing entries' `Id:` lines.

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/desk_test.ts packages/markspec/desk/`,
`deno check packages/markspec/main.ts packages/markspec/desk/server.ts`,
`deno lint`, `deno fmt --check`, `dprint check`.
