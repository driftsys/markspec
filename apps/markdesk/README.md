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
