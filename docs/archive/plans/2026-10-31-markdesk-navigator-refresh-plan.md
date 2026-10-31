# Plan: MarkDesk navigator refresh (#842)

Spec: `docs/archive/specs/2026-10-31-markdesk-navigator-refresh-design.md`.
Executed inline, test first per step.

1. **Server** (`packages/markspec/desk/api.ts`, `api_test.ts`): tests for an
   ETag on `/tree`, 304 on a matching `If-None-Match`, a new tag after an entry
   is added; then `treeEtag` + the 304 branch. Verify: `deno test` on desk.
2. **Schema + client** (`schemas/desk-api.json`, `npm run gen:client`,
   `client.ts`, `client.test.ts`): `tree(cached?)` returns `CachedTree`, 304
   returns the cached object. Verify: vitest client tests,
   `scripts/check_desk_client.sh`.
3. **UI** (`app/refresh.tsx`, `Navigator.tsx`, `DocumentPane.tsx`, `App.tsx`,
   tests): shared revision; navigator revalidates on revision and keeps state.
   Verify: vitest navigator + document pane tests.
4. **Docs**: ADR-035 SAD entries + "As built"; `markspec fmt`/`check`.
5. `just build`, UI `npm run typecheck && npm test`, garden wip, PR, `/review`.
