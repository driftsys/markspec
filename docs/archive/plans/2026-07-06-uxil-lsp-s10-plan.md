# S10 — uxil LSP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hover, completion, and go-to-declaration LSP support for `ux:`
references, gated on the same `declares: ux-surface` profile designation that
already gates the S9 UXIL-0xx diagnostics family.

**Architecture:** One new pure-function module (`lsp/uxil.ts`, mirroring
`lsp/typl.ts`), one new gated registry-builder method on `WorkspaceIndex`
(`getUxRegistry`), a small extraction on `lsp/definition.ts`
(`sourceLocationToLspLocation`), and three new branches inside `server.ts`'s
existing `onHover`/`onCompletion`/`onDefinition` handlers.

**Tech Stack:** Deno/TypeScript, `@std/assert` for unit tests, the
`vscode-languageserver` LSP types already used throughout `lsp/`.

## Global Constraints

- Design spec: `docs/wip/2026-07-06-uxil-lsp-s10-design.md` (approved) — every
  task below implements a piece of it.
- `just build` (lint + test + typecheck + compile) must pass clean before this
  branch is ready for PR. Zero warnings from `deno check`, `deno lint`,
  `deno test`.
- Every commit uses Conventional Commits with scope `lsp` (the repo's `git-std`
  commit-msg hook only allows scopes:
  `auto, repo, ci, spec, core,
  cli, lsp, mcp, render, book, deck, docs, deps, release`
  — `uxil` is not a valid scope).
- TDD: write the failing test, verify it fails, implement, verify it passes,
  then commit. One commit per task.
- No e2e/blackbox test in this story (LSP-only; matches the typl LSP precedent)
  and no `docs/guide/` changes (the epic explicitly defers the user-facing uxil
  guide chapter to S12 — see PR #808's description).
- Branch: `story/728-uxil-lsp`, working tree:
  `/Users/sebastientasson/Workspace/driftsys/markspec/.worktrees/728-uxil-lsp`.
  All commands below assume that directory as the working directory.

---

### Task 1: Extract `sourceLocationToLspLocation` from `lsp/definition.ts`

**Files:**

- Modify: `packages/markspec/lsp/definition.ts`
- Test: `packages/markspec/lsp/definition_test.ts`

**Interfaces:**

- Consumes: `SourceLocation` (`file: string; line: number; column: number`) from
  `core/model/mod.ts`; `LspLocation` (already defined in `definition.ts`);
  `pathToUri` from `./util.ts` (already imported).
- Produces: `sourceLocationToLspLocation(loc: SourceLocation): LspLocation` —
  Task 4 (server.ts wiring) calls this directly on a `SurfaceRecord.location`
  for uxil go-to-declaration.

- [ ] **Step 1: Write the failing tests**

Open `packages/markspec/lsp/definition_test.ts`. Add `SourceLocation` to the
existing type import and `sourceLocationToLspLocation` to the existing named
import from `./definition.ts`:

```ts
import { assertEquals } from "@std/assert";
import type { Entry, SourceLocation } from "../core/model/mod.ts";
import { makeDisplayId } from "../core/model/mod.ts";
import {
  entryToLspLocation,
  hasNavigableLocation,
  resolveNavigableLocation,
  sourceLocationToLspLocation,
} from "./definition.ts";
```

Add these three tests directly after the existing
`"entryToLspLocation: line 1 column 1 → 0,0 range"` test (before the
`makeUpstreamEntry` helper):

```ts
Deno.test("sourceLocationToLspLocation: converts file path to file:// URI", () => {
  const loc: SourceLocation = { file: "/abs/path/req.md", line: 5, column: 1 };
  assertEquals(
    sourceLocationToLspLocation(loc).uri,
    "file:///abs/path/req.md",
  );
});

Deno.test("sourceLocationToLspLocation: line and column are 0-based (LSP convention)", () => {
  const loc: SourceLocation = { file: "/x/req.md", line: 5, column: 3 };
  const result = sourceLocationToLspLocation(loc);
  assertEquals(result.range.start.line, 4);
  assertEquals(result.range.start.character, 2);
  assertEquals(result.range.end.line, 4);
  assertEquals(result.range.end.character, 2);
});

Deno.test("entryToLspLocation: matches sourceLocationToLspLocation(entry.location)", () => {
  const entry = makeEntry("/abs/path/req.md", 5, 1);
  assertEquals(
    entryToLspLocation(entry),
    sourceLocationToLspLocation(entry.location),
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-read packages/markspec/lsp/definition_test.ts` Expected:
FAIL — `sourceLocationToLspLocation` is not exported from `./definition.ts`.

- [ ] **Step 3: Extract the helper in `lsp/definition.ts`**

Change the type import at the top of `packages/markspec/lsp/definition.ts` from:

```ts
import type { Entry } from "../core/model/mod.ts";
```

to:

```ts
import type { Entry, SourceLocation } from "../core/model/mod.ts";
```

Replace the existing `entryToLspLocation` function:

```ts
export function entryToLspLocation(entry: Entry): LspLocation {
  const line = Math.max(0, entry.location.line - 1);
  const character = Math.max(0, entry.location.column - 1);
  return {
    uri: pathToUri(entry.location.file),
    range: {
      start: { line, character },
      end: { line, character },
    },
  };
}
```

with:

```ts
/**
 * Convert a raw `SourceLocation` (1-based line/column) to an LSP
 * `Location` (URI + zero-based, zero-width range). Shared by
 * `entryToLspLocation` (below) and the uxil go-to-declaration path
 * (`SurfaceRecord.location`, S10 #728), which has no `Entry` to hang
 * off of.
 */
export function sourceLocationToLspLocation(loc: SourceLocation): LspLocation {
  const line = Math.max(0, loc.line - 1);
  const character = Math.max(0, loc.column - 1);
  return {
    uri: pathToUri(loc.file),
    range: {
      start: { line, character },
      end: { line, character },
    },
  };
}

/**
 * Convert an Entry's source location to an LSP `Location` pointing at
 * the entry's start (zero-width range). 1-based core line/column are
 * shifted to 0-based per the LSP spec.
 */
export function entryToLspLocation(entry: Entry): LspLocation {
  return sourceLocationToLspLocation(entry.location);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-read packages/markspec/lsp/definition_test.ts` Expected:
PASS — all tests, including the pre-existing `entryToLspLocation` and
`resolveNavigableLocation` tests.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/lsp/definition.ts packages/markspec/lsp/definition_test.ts
git commit -m "$(printf 'refactor(lsp): extract sourceLocationToLspLocation from entryToLspLocation\n\nShared helper for uxil go-to-declaration (S10 #728), which resolves a\nSurfaceRecord.location rather than an Entry.'; echo)"
```

(If the printf/heredoc form is awkward in your shell, write the message to a
temp file and use `git commit -F <file>` instead — avoid inline heredocs with
backticks in the message body.)

---

### Task 2: `lsp/uxil.ts` — token detection, hover, completion (new file)

**Files:**

- Create: `packages/markspec/lsp/uxil.ts`
- Test: `packages/markspec/lsp/uxil_test.ts`

**Interfaces:**

- Consumes: `SurfaceRecord`, `UxRef`, `UxRegistry` types from `core/uxil/mod.ts`
  (already merged to `main` via #808 — `SurfaceRecord` has
  `path: string; kind: string; states: readonly string[];
  owningEntryDisplayId: string; owningEntryFile: string; elements: readonly
  UxElement[]; location: SourceLocation`;
  `UxElement` has
  `name: string;
  verbs: readonly string[]; keyTemplate?: UxKey; navTarget?: string; states:
  readonly string[]; eventDictionary: string; location: SourceLocation`;
  `UxRef` has
  `hasScheme: boolean; surface: readonly string[]; state?:
  string; element?: string; key?: UxKey; verb?: string; position: Position`;
  `UxRegistry` has `surfaces: ReadonlyMap<string, readonly SurfaceRecord[]>`).
- Produces: `uxRefTokenAtPosition(line, column): string | undefined`,
  `isUxRefTrigger(textBefore): boolean`,
  `extractUxRefPartial(textBefore): string`,
  `resolveUxRef(ref: UxRef, registry: UxRegistry): SurfaceRecord | undefined`,
  `formatUxHoverContent(ref: UxRef, registry: UxRegistry): string |
  undefined`,
  `buildUxCompletionItems(registry: UxRegistry, partial: string):
  readonly UxCompletionItem[]`
  (with `UxCompletionItem = { label: string;
  detail: string }`) — all consumed
  by Task 4 (server.ts wiring) and directly unit-tested here against hand-built
  fixtures.

- [ ] **Step 1: Write the failing tests for `uxRefTokenAtPosition`**

Create `packages/markspec/lsp/uxil_test.ts`:

```ts
import { assertEquals, assertStringIncludes } from "@std/assert";
import { uxRefTokenAtPosition } from "./uxil.ts";

// ---------------------------------------------------------------------------
// uxRefTokenAtPosition
// ---------------------------------------------------------------------------

Deno.test("uxRefTokenAtPosition: detects ux: ref with cursor in middle", () => {
  const l = "See `ux:media.home` here";
  const want = "ux:media.home";
  assertEquals(uxRefTokenAtPosition(l, l.indexOf("ux:")), want); // on 'u'
  assertEquals(uxRefTokenAtPosition(l, l.indexOf("media")), want); // mid segment
  assertEquals(uxRefTokenAtPosition(l, l.indexOf("home") + 2), want); // near end
});

Deno.test("uxRefTokenAtPosition: returns undefined on whitespace", () => {
  const l = "See `ux:media.home` here";
  assertEquals(uxRefTokenAtPosition(l, l.indexOf(" here")), undefined);
});

Deno.test("uxRefTokenAtPosition: returns undefined off a non-ux: token", () => {
  assertEquals(uxRefTokenAtPosition("Satisfies: STK_001", 12), undefined);
});

Deno.test("uxRefTokenAtPosition: spans an element/verb ref", () => {
  const l = "`ux:media.home/play!activate`";
  const want = "ux:media.home/play!activate";
  assertEquals(uxRefTokenAtPosition(l, l.indexOf("play")), want);
  assertEquals(uxRefTokenAtPosition(l, l.indexOf("activate") + 3), want);
});

Deno.test("uxRefTokenAtPosition: trims a trailing sentence period", () => {
  const l = "cite ux:media.home.";
  assertEquals(uxRefTokenAtPosition(l, l.indexOf("home")), "ux:media.home");
});

Deno.test("uxRefTokenAtPosition: unrelated text fused to ux: is rejected", () => {
  const l = "seeux:media.home";
  // Cursor on the unrelated "see" prefix must not resolve to a ref.
  assertEquals(uxRefTokenAtPosition(l, 0), undefined);
  // Cursor on the actual ref portion still resolves.
  assertEquals(uxRefTokenAtPosition(l, l.indexOf("media")), "ux:media.home");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-read packages/markspec/lsp/uxil_test.ts` Expected: FAIL
— `packages/markspec/lsp/uxil.ts` does not exist yet.

- [ ] **Step 3: Implement `uxRefTokenAtPosition`**

Create `packages/markspec/lsp/uxil.ts`:

```ts
/**
 * @module lsp/uxil
 *
 * LSP-side uxil helpers — pure functions that compute hover content,
 * completion items, and go-to-declaration targets for `ux:` references.
 * Consume the corpus UxRegistry from core/uxil/registry.ts. Mirrors
 * lsp/typl.ts's shape and lsp/hover.ts's token-scanning pattern.
 *
 * Profile-free by design: WorkspaceIndex.getUxRegistry(profile) applies
 * the uxilDeclaringTypes gate (S9 #727's Tier-1 opacity guarantee)
 * before a registry ever reaches these functions — an `undefined`
 * registry from the caller just means "nothing resolves," never
 * "check the profile" (S10 #728).
 */

/** Character set for a `ux:` reference token: identifier chars plus
 * the uxil DSL's structural characters (core/uxil/lexer.ts's token
 * set, minus comma and the `->` arrow — neither appears in a bare
 * citation or declaration head). */
const UX_REF_CHAR_RE = /[A-Za-z0-9_.:/!@{}]/;

/**
 * Return the `ux:` reference token at the given column on `line`, or
 * `undefined` when the column lies on whitespace/an unrelated
 * character, past the line end, or the contiguous run under the
 * cursor doesn't contain a `ux:` scheme at or before the cursor.
 *
 * Scans the full contiguous run of ref-charset characters around the
 * cursor first (so the cursor can sit anywhere inside the token, not
 * just at its start), then anchors on the literal `ux:` prefix within
 * that run — a real reference is always bounded by a backtick or
 * whitespace, so `run` and `"ux:" + rest` coincide in practice; the
 * anchor search keeps unrelated text fused to a ref with no separator
 * from being mistaken for part of it. A trailing sentence period (a
 * bare, non-code-span citation followed by prose) is trimmed,
 * mirroring `dollarNameAtPosition` (lsp/typl.ts).
 */
export function uxRefTokenAtPosition(
  line: string,
  column: number,
): string | undefined {
  if (column < 0 || column >= line.length) return undefined;
  if (!UX_REF_CHAR_RE.test(line[column])) return undefined;

  let start = column;
  while (start > 0 && UX_REF_CHAR_RE.test(line[start - 1])) start--;
  let end = column;
  while (end < line.length && UX_REF_CHAR_RE.test(line[end])) end++;

  const run = line.slice(start, end);
  const uxIndex = run.indexOf("ux:");
  if (uxIndex < 0) return undefined;
  if (column < start + uxIndex) return undefined;

  return run.slice(uxIndex).replace(/\.+$/, "");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-read packages/markspec/lsp/uxil_test.ts` Expected: PASS
(all 6 tests).

- [ ] **Step 5: Write the failing tests for `isUxRefTrigger` and
      `extractUxRefPartial`**

Append to `packages/markspec/lsp/uxil_test.ts` (add
`isUxRefTrigger,
extractUxRefPartial` to the import from `./uxil.ts`):

```ts
// ---------------------------------------------------------------------------
// isUxRefTrigger / extractUxRefPartial
// ---------------------------------------------------------------------------

Deno.test("isUxRefTrigger: triggers on ux: and a partial surface path", () => {
  assertEquals(isUxRefTrigger("See `ux:"), true);
  assertEquals(isUxRefTrigger("See `ux:media"), true);
  assertEquals(isUxRefTrigger("See `ux:media.h"), true);
});

Deno.test("isUxRefTrigger: does not trigger mid-identifier or on unrelated colons", () => {
  assertEquals(isUxRefTrigger("Satisfies:"), false);
  assertEquals(isUxRefTrigger("fluxux:media"), false);
});

Deno.test("isUxRefTrigger: stops matching past the surface-path segment", () => {
  // Element/state/verb completion is out of scope for this story — once a
  // `/`, `@`, or `!` has been typed, the trigger no longer fires.
  assertEquals(isUxRefTrigger("`ux:media.home/"), false);
});

Deno.test("extractUxRefPartial: extracts text typed after ux:", () => {
  assertEquals(extractUxRefPartial("See `ux:"), "");
  assertEquals(extractUxRefPartial("See `ux:media.h"), "media.h");
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `deno test --allow-read packages/markspec/lsp/uxil_test.ts` Expected: FAIL
— `isUxRefTrigger`/`extractUxRefPartial` not exported.

- [ ] **Step 7: Implement `isUxRefTrigger` and `extractUxRefPartial`**

Append to `packages/markspec/lsp/uxil.ts`:

```ts
/**
 * Return true when the text before the cursor triggers `ux:`
 * completion — a `ux:` scheme followed by an optional partial surface
 * path (letters, digits, underscore, dot). Anchored so it can't fire
 * mid-identifier (`fluxux:`) or against an unrelated colon context.
 * Stops matching once the partial reaches `/`, `@`, `!`, or `{` — this
 * story's completion is surface-path-only (no element/state/verb
 * segment completion).
 */
export function isUxRefTrigger(textBefore: string): boolean {
  return /(?:^|[^A-Za-z0-9_])ux:[A-Za-z0-9_.]*$/.test(textBefore);
}

/**
 * Extract the partial surface-path text typed after `ux:`, for
 * server-side prefix filtering. Empty when nothing has been typed yet.
 */
export function extractUxRefPartial(textBefore: string): string {
  return /ux:([A-Za-z0-9_.]*)$/.exec(textBefore)?.[1] ?? "";
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `deno test --allow-read packages/markspec/lsp/uxil_test.ts` Expected: PASS
(all 10 tests so far).

- [ ] **Step 9: Write the failing tests for `resolveUxRef` and
      `formatUxHoverContent`**

Append to `packages/markspec/lsp/uxil_test.ts`. Add the fixture helpers and
tests (add `resolveUxRef, formatUxHoverContent` to the `./uxil.ts` import, and
add a new import for the core types):

```ts
import type {
  SurfaceRecord,
  UxElement,
  UxRef,
  UxRegistry,
} from "../core/uxil/mod.ts";
```

```ts
// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function element(
  name: string,
  opts: {
    verbs?: string[];
    states?: string[];
    eventDictionary?: string;
    navTarget?: string;
  } = {},
): UxElement {
  return {
    name,
    verbs: opts.verbs ?? ["activate"],
    states: opts.states ?? [],
    eventDictionary: opts.eventDictionary ?? "logs a tap event",
    ...(opts.navTarget !== undefined ? { navTarget: opts.navTarget } : {}),
    location: { file: "docs/product/sad.md", line: 4, column: 3 },
  };
}

function surfaceRecord(
  path: string,
  opts: {
    kind?: string;
    states?: string[];
    owningEntryDisplayId?: string;
    owningEntryFile?: string;
    elements?: UxElement[];
  } = {},
): SurfaceRecord {
  const file = opts.owningEntryFile ?? "docs/product/sad.md";
  return {
    path,
    kind: opts.kind ?? "screen",
    states: opts.states ?? [],
    owningEntryDisplayId: opts.owningEntryDisplayId ?? "SAD_MEDIA_0001",
    owningEntryFile: file,
    elements: opts.elements ?? [],
    location: { file, line: 3, column: 1 },
  };
}

function registry(records: SurfaceRecord[]): UxRegistry {
  const surfaces = new Map<string, SurfaceRecord[]>();
  for (const r of records) {
    const list = surfaces.get(r.path);
    if (list) list.push(r);
    else surfaces.set(r.path, [r]);
  }
  return { surfaces };
}

function ref(
  surface: string,
  opts: { element?: string; state?: string; verb?: string } = {},
): UxRef {
  return {
    hasScheme: true,
    surface: surface.split("."),
    ...(opts.element !== undefined ? { element: opts.element } : {}),
    ...(opts.state !== undefined ? { state: opts.state } : {}),
    ...(opts.verb !== undefined ? { verb: opts.verb } : {}),
    position: { line: 1, column: 1 },
  };
}

// ---------------------------------------------------------------------------
// resolveUxRef
// ---------------------------------------------------------------------------

Deno.test("resolveUxRef: finds the declaration by path", () => {
  const r = registry([surfaceRecord("media.home")]);
  assertEquals(resolveUxRef(ref("media.home"), r)?.path, "media.home");
});

Deno.test("resolveUxRef: returns undefined for an unknown surface", () => {
  const r = registry([surfaceRecord("media.home")]);
  assertEquals(resolveUxRef(ref("media.other"), r), undefined);
});

Deno.test("resolveUxRef: first-declaration-wins on a duplicate path", () => {
  const first = surfaceRecord("media.home", {
    owningEntryDisplayId: "SAD_0001",
  });
  const dup = surfaceRecord("media.home", { owningEntryDisplayId: "SAD_0002" });
  const r = registry([first, dup]);
  assertEquals(
    resolveUxRef(ref("media.home"), r)?.owningEntryDisplayId,
    "SAD_0001",
  );
});

// ---------------------------------------------------------------------------
// formatUxHoverContent
// ---------------------------------------------------------------------------

Deno.test("formatUxHoverContent: surface-only ref shows kind, states, owning entry", () => {
  const r = registry([
    surfaceRecord("media.home", {
      states: ["idle", "playing"],
      owningEntryDisplayId: "SAD_MEDIA_0007",
    }),
  ]);
  const content = formatUxHoverContent(ref("media.home"), r);
  assertStringIncludes(content!, "ux:media.home");
  assertStringIncludes(content!, "**Kind:** screen");
  assertStringIncludes(content!, "idle, playing");
  assertStringIncludes(content!, "SAD_MEDIA_0007");
});

Deno.test("formatUxHoverContent: element ref shows verbs and description", () => {
  const r = registry([
    surfaceRecord("media.home", {
      elements: [element("play", {
        verbs: ["activate"],
        eventDictionary: "logs media_play_tapped",
      })],
    }),
  ]);
  const content = formatUxHoverContent(
    ref("media.home", { element: "play" }),
    r,
  );
  assertStringIncludes(content!, "ux:media.home/play");
  assertStringIncludes(content!, "**Verbs:** activate");
  assertStringIncludes(content!, "logs media_play_tapped");
});

Deno.test("formatUxHoverContent: unknown surface returns undefined", () => {
  assertEquals(formatUxHoverContent(ref("media.home"), registry([])), undefined);
});

Deno.test("formatUxHoverContent: unknown element on a known surface returns undefined", () => {
  const r = registry([surfaceRecord("media.home")]);
  assertEquals(
    formatUxHoverContent(ref("media.home", { element: "missing" }), r),
    undefined,
  );
});

Deno.test("formatUxHoverContent: unknown state on a known surface returns undefined", () => {
  const r = registry([surfaceRecord("media.home", { states: ["idle"] })]);
  assertEquals(
    formatUxHoverContent(ref("media.home", { state: "playing" }), r),
    undefined,
  );
});

Deno.test("formatUxHoverContent: unknown state on a known element returns undefined", () => {
  const r = registry([
    surfaceRecord("media.home", {
      elements: [element("play", { states: ["idle"] })],
    }),
  ]);
  assertEquals(
    formatUxHoverContent(
      ref("media.home", { element: "play", state: "playing" }),
      r,
    ),
    undefined,
  );
});
```

- [ ] **Step 10: Run the tests to verify they fail**

Run: `deno test --allow-read packages/markspec/lsp/uxil_test.ts` Expected: FAIL
— `resolveUxRef`/`formatUxHoverContent` not exported.

- [ ] **Step 11: Implement `resolveUxRef` and `formatUxHoverContent`**

Append to `packages/markspec/lsp/uxil.ts` (add the type import at the top of the
file first):

```ts
import type { SurfaceRecord, UxRegistry, UxRef } from "../core/uxil/mod.ts";
```

```ts
/**
 * Resolve a parsed `ux:` reference to its declaring surface record.
 * First-declaration-wins on a duplicate path, matching the validator's
 * (UXIL-015) and the navigate-resolution check's convention.
 */
export function resolveUxRef(
  ref: UxRef,
  registry: UxRegistry,
): SurfaceRecord | undefined {
  return registry.surfaces.get(ref.surface.join("."))?.[0];
}

/**
 * Format the hover content for a `ux:` reference. With `ref.element`
 * set, the card leads with that element's verb set and description
 * (`eventDictionary`); otherwise it shows the surface's kind and
 * states. Always includes the owning entry. Returns `undefined` — no
 * hover, not a wrong one — when the surface, or a named element/state,
 * isn't found.
 */
export function formatUxHoverContent(
  ref: UxRef,
  registry: UxRegistry,
): string | undefined {
  const surface = resolveUxRef(ref, registry);
  if (!surface) return undefined;

  if (ref.element !== undefined) {
    const el = surface.elements.find((e) => e.name === ref.element);
    if (!el) return undefined;
    if (ref.state !== undefined && !el.states.includes(ref.state)) {
      return undefined;
    }
    const lines: string[] = [`### ux:${surface.path}/${el.name}`, ""];
    const meta = [`**Verbs:** ${el.verbs.join(", ")}`];
    if (el.states.length > 0) {
      meta.push(`**States:** ${el.states.join(", ")}`);
    }
    lines.push(meta.join(" · "));
    lines.push(`**Description:** ${el.eventDictionary}`);
    lines.push(
      `**Surface:** ${surface.kind} · **Owning entry:** ${surface.owningEntryDisplayId} (${surface.owningEntryFile})`,
    );
    return lines.join("\n");
  }

  if (ref.state !== undefined && !surface.states.includes(ref.state)) {
    return undefined;
  }

  const lines: string[] = [`### ux:${surface.path}`, ""];
  const meta = [`**Kind:** ${surface.kind}`];
  if (surface.states.length > 0) {
    meta.push(`**States:** ${surface.states.join(", ")}`);
  }
  lines.push(meta.join(" · "));
  lines.push(
    `**Owning entry:** ${surface.owningEntryDisplayId} (${surface.owningEntryFile})`,
  );
  return lines.join("\n");
}
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `deno test --allow-read packages/markspec/lsp/uxil_test.ts` Expected: PASS
(all tests so far).

- [ ] **Step 13: Write the failing tests for `buildUxCompletionItems`**

Append to `packages/markspec/lsp/uxil_test.ts` (add `buildUxCompletionItems` to
the `./uxil.ts` import):

```ts
// ---------------------------------------------------------------------------
// buildUxCompletionItems
// ---------------------------------------------------------------------------

Deno.test("buildUxCompletionItems: one item per known surface path", () => {
  const r = registry([
    surfaceRecord("media.home", { kind: "screen", owningEntryDisplayId: "SAD_0001" }),
    surfaceRecord("media.queue", { kind: "panel", owningEntryDisplayId: "SAD_0002" }),
  ]);
  const items = buildUxCompletionItems(r, "");
  assertEquals(items.map((i) => i.label).sort(), ["media.home", "media.queue"]);
  const home = items.find((i) => i.label === "media.home");
  assertEquals(home?.detail, "screen · SAD_0001");
});

Deno.test("buildUxCompletionItems: filters by prefix (case-insensitive)", () => {
  const r = registry([
    surfaceRecord("media.home"),
    surfaceRecord("controls.hvac"),
  ]);
  const items = buildUxCompletionItems(r, "Media");
  assertEquals(items.map((i) => i.label), ["media.home"]);
});

Deno.test("buildUxCompletionItems: empty registry yields no items", () => {
  assertEquals(buildUxCompletionItems(registry([]), "").length, 0);
});
```

- [ ] **Step 14: Run the tests to verify they fail**

Run: `deno test --allow-read packages/markspec/lsp/uxil_test.ts` Expected: FAIL
— `buildUxCompletionItems` not exported.

- [ ] **Step 15: Implement `buildUxCompletionItems`**

Append to `packages/markspec/lsp/uxil.ts`:

```ts
/** One `ux:` completion item — protocol-independent for testability. */
export interface UxCompletionItem {
  readonly label: string;
  readonly detail: string;
}

/**
 * Build completion items for the `ux:` trigger: one item per known
 * surface path in the registry, server-side prefix-filtered against
 * `partial` (case-insensitive). `detail` shows the surface's kind and
 * owning entry.
 */
export function buildUxCompletionItems(
  registry: UxRegistry,
  partial: string,
): readonly UxCompletionItem[] {
  const needle = partial.toLowerCase();
  const items: UxCompletionItem[] = [];
  for (const [path, records] of registry.surfaces) {
    if (needle.length > 0 && !path.toLowerCase().startsWith(needle)) continue;
    const first = records[0];
    items.push({
      label: path,
      detail: `${first.kind} · ${first.owningEntryDisplayId}`,
    });
  }
  return items;
}
```

- [ ] **Step 16: Run the full test file to verify everything passes**

Run: `deno test --allow-read packages/markspec/lsp/uxil_test.ts` Expected: PASS
— all tests (token detection, triggers, resolution, hover, completion).

- [ ] **Step 17: Type-check and lint the new file**

Run:
`deno check packages/markspec/lsp/uxil.ts packages/markspec/lsp/uxil_test.ts`
Expected: no errors.

Run:
`deno lint packages/markspec/lsp/uxil.ts packages/markspec/lsp/uxil_test.ts`
Expected: no warnings.

- [ ] **Step 18: Commit**

```bash
git add packages/markspec/lsp/uxil.ts packages/markspec/lsp/uxil_test.ts
git commit -m "$(printf 'feat(lsp): add uxil hover/completion/definition helpers\n\nPure functions for ux: ref token detection, hover card formatting, and\nsurface-path completion, mirroring lsp/typl.ts. Part of S10 (#728).'; echo)"
```

---

### Task 3: `WorkspaceIndex.getUxRegistry` (lsp/workspace.ts)

**Files:**

- Modify: `packages/markspec/lsp/workspace.ts`
- Test: `packages/markspec/lsp/workspace_test.ts`

**Interfaces:**

- Consumes: `uxilDeclaringTypes`, `classifyEntry`, `emittableEntries` (all
  already exported flatly from `core/mod.ts`); `buildUxRegistry`,
  `type
  UxRegistry` from `core/uxil/mod.ts`; `EffectiveProfile` (already
  imported in this file).
- Produces:
  `WorkspaceIndex.getUxRegistry(profile: EffectiveProfile | null):
  UxRegistry | undefined`
  — Task 4 (server.ts) calls this at each of the three new handler branches.

- [ ] **Step 1: Write the failing tests**

Append to `packages/markspec/lsp/workspace_test.ts`, after the final existing
test
(`"WorkspaceIndex: validateAll runs the uxil family when
designated (#727)"`).
This reuses the same `EffectiveProfile` / `ux-contract` fixture shape as that
existing test:

```ts
Deno.test("getUxRegistry: returns undefined with no declaring type designated", async () => {
  const md = `- [UXI_0001] Contract

  \`ux:media.home : screen\`

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const parsed = await parseFile(md, { file: "t.md" });
  const index = new WorkspaceIndex();
  index.updateFile("t.md", parsed.entries);

  assertEquals(index.getUxRegistry(null), undefined);
});

Deno.test("getUxRegistry: builds the registry when a declaring type is designated", async () => {
  const md = `- [UXI_0001] Contract

  \`ux:media.home : screen\`

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const parsed = await parseFile(md, { file: "t.md" });
  const index = new WorkspaceIndex();
  index.updateFile("t.md", parsed.entries);

  const origin = "@test/p";
  const uxContract: ProvenancedMapEntry<EffectiveTypeDef> = {
    value: {
      name: "ux-contract",
      extends: "Requirement",
      displayIdPattern: { value: "UXI_{n:4d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
      color: { value: undefined, origin },
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map(),
      description: { value: undefined, origin },
      attrDescriptions: new Map(),
      relationDescriptions: new Map(),
      discipline: { value: undefined, origin },
      declares: { value: "ux-surface", origin },
    },
    origin,
  };
  const profile: EffectiveProfile = {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map([["ux-contract", uxContract]]),
    documents: { types: new Map(), frontMatter: new Map() },
    delivers: [],
    kinds: new Map(),
    prose: {
      lexicons: {
        "capitalized-allow": { value: [], origin: "" },
        "sentence-abbrev": { value: [], origin: "" },
      },
    },
    disciplineMode: { value: "none", origin: "inferred" },
  };

  const registry = index.getUxRegistry(profile);
  assertEquals(registry?.surfaces.has("media.home"), true);
});

Deno.test("getUxRegistry: excludes upstream entries", () => {
  const index = new WorkspaceIndex();
  index.updateFile("docs/product/stk.md", [
    upstreamEntry("PRODUCT_UXI_0001"),
  ]);

  const origin = "@test/p";
  const uxContract: ProvenancedMapEntry<EffectiveTypeDef> = {
    value: {
      name: "ux-contract",
      extends: "Requirement",
      displayIdPattern: { value: "PRODUCT_UXI_{n:4d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
      color: { value: undefined, origin },
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map(),
      description: { value: undefined, origin },
      attrDescriptions: new Map(),
      relationDescriptions: new Map(),
      discipline: { value: undefined, origin },
      declares: { value: "ux-surface", origin },
    },
    origin,
  };
  const profile: EffectiveProfile = {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map([["ux-contract", uxContract]]),
    documents: { types: new Map(), frontMatter: new Map() },
    delivers: [],
    kinds: new Map(),
    prose: {
      lexicons: {
        "capitalized-allow": { value: [], origin: "" },
        "sentence-abbrev": { value: [], origin: "" },
      },
    },
    disciplineMode: { value: "none", origin: "inferred" },
  };

  // The upstream entry has no uxil content, but this test's point is that
  // getUxRegistry never even considers it — proven indirectly by confirming
  // the call doesn't throw and returns an empty (not populated) registry.
  const registry = index.getUxRegistry(profile);
  assertEquals(registry?.surfaces.size, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
`deno test --allow-read --allow-write --allow-env packages/markspec/lsp/workspace_test.ts`
Expected: FAIL — `getUxRegistry` is not a method on `WorkspaceIndex`.

- [ ] **Step 3: Implement `getUxRegistry`**

At the top of `packages/markspec/lsp/workspace.ts`, change the existing import
block:

```ts
import {
  attributeCorpusDiagnostics,
  detectCorpusCollisions,
  formatEntryOrigin,
  parseFile,
  suppressDeclaredAttrR010,
  validate,
  validateUxilFamily,
} from "../core/mod.ts";
import { buildTypeRegistry, type TypeRegistry } from "../core/typl/mod.ts";
```

to:

```ts
import {
  attributeCorpusDiagnostics,
  classifyEntry,
  detectCorpusCollisions,
  emittableEntries,
  formatEntryOrigin,
  parseFile,
  suppressDeclaredAttrR010,
  uxilDeclaringTypes,
  validate,
  validateUxilFamily,
} from "../core/mod.ts";
import { buildTypeRegistry, type TypeRegistry } from "../core/typl/mod.ts";
import { buildUxRegistry, type UxRegistry } from "../core/uxil/mod.ts";
```

Add this method to the `WorkspaceIndex` class immediately after
`getTypeRegistry()`:

```ts
/**
 * Build the uxil corpus registry (S8 #726), gated on
 * `uxilDeclaringTypes(profile)` — returns `undefined` when no profile
 * type designates `declares: ux-surface`, preserving the diagnostics
 * family's Tier-1 opacity guarantee for hover/completion/go-to-
 * declaration (S10 #728). Mirrors `uxil_family.ts`'s own gating:
 * upstream entries excluded via `emittableEntries`, then filtered to
 * declaring-type entries via `entry.type ?? classifyEntry(...).type`
 * (the LSP path never runs pipeline Stage 2, so entries typically
 * arrive unclassified). Rebuilt on every call — no caching, matching
 * `getTypeRegistry()`'s precedent.
 */
getUxRegistry(profile: EffectiveProfile | null): UxRegistry | undefined {
  const declaring = uxilDeclaringTypes(profile);
  if (declaring.size === 0) return undefined;
  const local = emittableEntries(this.getAllEntries());
  const declaringEntries = local.filter((e) => {
    const type = e.type ?? classifyEntry(e, profile!).type;
    return type !== undefined && declaring.has(type);
  });
  return buildUxRegistry(declaringEntries);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
`deno test --allow-read --allow-write --allow-env packages/markspec/lsp/workspace_test.ts`
Expected: PASS — all tests, including the pre-existing ones.

- [ ] **Step 5: Type-check and lint**

Run: `deno check packages/markspec/lsp/workspace.ts` Expected: no errors.

Run: `deno lint packages/markspec/lsp/workspace.ts` Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/lsp/workspace.ts packages/markspec/lsp/workspace_test.ts
git commit -m "$(printf 'feat(lsp): add WorkspaceIndex.getUxRegistry\n\nGated on uxilDeclaringTypes(profile), mirroring uxil_family.ts'"'"'s\npartition (emittableEntries + classifyEntry fallback). Part of S10\n(#728).'; echo)"
```

---

### Task 4: Wire hover/completion/definition in `lsp/server.ts`

**Files:**

- Modify: `packages/markspec/lsp/server.ts`

**Interfaces:**

- Consumes: `uxRefTokenAtPosition`, `isUxRefTrigger`, `extractUxRefPartial`,
  `resolveUxRef`, `formatUxHoverContent`, `buildUxCompletionItems` from
  `./uxil.ts` (Task 2); `sourceLocationToLspLocation` from `./definition.ts`
  (Task 1); `index.getUxRegistry(profile)` from `WorkspaceIndex` (Task 3);
  `parseUxRef` from `../core/uxil/mod.ts` (already exists on `main`).
- Produces: no new exports — this task only wires existing handlers. There is no
  `server_test.ts` in this codebase (confirmed: every other LSP handler's wiring
  is verified by its pure-function unit tests plus `deno
  check`/`just test`,
  not a direct server-level test) — this task's verification is the full test
  suite plus manual read-through, not a new test file.

- [ ] **Step 1: Add the new imports**

In `packages/markspec/lsp/server.ts`, change:

```ts
import { resolveNavigableLocation } from "./definition.ts";
```

to:

```ts
import {
  resolveNavigableLocation,
  sourceLocationToLspLocation,
} from "./definition.ts";
```

Change:

```ts
import {
  buildDollarNameCompletions,
  dollarNameAtPosition,
  formatTyplHoverContent,
  isDollarNameTrigger,
  isRelativeDollarTrigger,
} from "./typl.ts";
```

to (add the new import block directly after it):

```ts
import {
  buildDollarNameCompletions,
  dollarNameAtPosition,
  formatTyplHoverContent,
  isDollarNameTrigger,
  isRelativeDollarTrigger,
} from "./typl.ts";
import {
  buildUxCompletionItems,
  extractUxRefPartial,
  formatUxHoverContent,
  isUxRefTrigger,
  resolveUxRef,
  uxRefTokenAtPosition,
} from "./uxil.ts";
```

`parseUxRef` lives in `core/uxil/mod.ts`, not `core/mod.ts`, so it needs its own
standalone import rather than joining the existing `"../core/mod.ts"` block.
Change:

```ts
import { extendsTransitively } from "../core/profile/discipline_mode.ts";
```

to:

```ts
import { extendsTransitively } from "../core/profile/discipline_mode.ts";
import { parseUxRef } from "../core/uxil/mod.ts";
```

- [ ] **Step 2: Add the hover branch**

In `connection.onHover(...)`, the existing body reads (in part):

```ts
  // Try typl $Name token first — it takes priority over display-ID lookup.
  const dollarName = dollarNameAtPosition(line, params.position.character);
  if (dollarName) {
    const registry = index.getTypeRegistry();
    // Published tier (#750): give hover the enclosing entry so it can
    // resolve a relative `$.x` against the entry root namespace and mark a
    // published symbol as declared "in this entry" vs. cited from another.
    const enclosing = findEnclosingEntry(
      index.getEntriesForFile(filePath),
      params.position.line + 1, // LSP is 0-based; Entry is 1-based.
    );
    const hoverContent = formatTyplHoverContent(dollarName, registry, {
      entryDisplayId: enclosing?.displayId,
      rootNamespace: enclosing?.types?.rootNamespace,
    });
    if (hoverContent) {
      return { contents: { kind: "markdown", value: hoverContent } };
    }
  }

  const id = displayIdAtPosition(line, params.position.character);
```

Insert a new branch between the closing `}` of the `dollarName` block and
`const id = ...`:

```ts
  // Try typl $Name token first — it takes priority over display-ID lookup.
  const dollarName = dollarNameAtPosition(line, params.position.character);
  if (dollarName) {
    const registry = index.getTypeRegistry();
    // Published tier (#750): give hover the enclosing entry so it can
    // resolve a relative `$.x` against the entry root namespace and mark a
    // published symbol as declared "in this entry" vs. cited from another.
    const enclosing = findEnclosingEntry(
      index.getEntriesForFile(filePath),
      params.position.line + 1, // LSP is 0-based; Entry is 1-based.
    );
    const hoverContent = formatTyplHoverContent(dollarName, registry, {
      entryDisplayId: enclosing?.displayId,
      rootNamespace: enclosing?.types?.rootNamespace,
    });
    if (hoverContent) {
      return { contents: { kind: "markdown", value: hoverContent } };
    }
  }

  // Try a ux: ref next (S10 #728) — inert (no registry) unless the
  // profile designates a declaring type (uxilDeclaringTypes).
  const uxToken = uxRefTokenAtPosition(line, params.position.character);
  if (uxToken) {
    const uxRegistry = index.getUxRegistry(profile ?? null);
    if (uxRegistry) {
      const { ref } = parseUxRef(uxToken);
      if (ref) {
        const hoverContent = formatUxHoverContent(ref, uxRegistry);
        if (hoverContent) {
          return { contents: { kind: "markdown", value: hoverContent } };
        }
      }
    }
  }

  const id = displayIdAtPosition(line, params.position.character);
```

- [ ] **Step 3: Add the completion trigger**

In `connection.onCompletion(...)`, the existing body ends with:

```ts
  // Trigger 5: $Name identifier — typl binding names from the corpus registry.
  if (isDollarNameTrigger(line)) {
    return time("onCompletion/dollarName", () => {
      const registry = index.getTypeRegistry();
      // Published tier (#750): scope relative `$.x` shorthands to the
      // enclosing entry's root namespace, and switch to relative-only
      // suggestions when the partial is `$.`-led.
      const enclosing = findEnclosingEntry(
        index.getEntriesForFile(filePath),
        params.position.line + 1, // LSP is 0-based; Entry is 1-based.
      );
      const items = buildDollarNameCompletions(registry, {
        rootNamespace: enclosing?.types?.rootNamespace,
        relative: isRelativeDollarTrigger(line),
      });
      return items.map((item) => ({
        label: item.label,
        detail: item.detail,
        documentation: item.documentation,
        kind: CompletionItemKind.Variable,
      }));
    });
  }

  return [];
});
```

Insert Trigger 6 between the end of Trigger 5's `if` block and `return [];`:

```ts
  // Trigger 6: ux: reference — known surface paths from the uxil registry
  // (S10 #728). Empty when no profile type designates ux-surface.
  if (isUxRefTrigger(line)) {
    return time("onCompletion/uxRef", () => {
      const uxRegistry = index.getUxRegistry(profile ?? null);
      if (!uxRegistry) return [];
      const partial = extractUxRefPartial(line);
      const items = buildUxCompletionItems(uxRegistry, partial);
      return {
        isIncomplete: partial.length > 0,
        items: items.map((item) => ({
          label: item.label,
          detail: item.detail,
          kind: CompletionItemKind.Reference,
        })),
      };
    });
  }

  return [];
});
```

- [ ] **Step 4: Add the go-to-declaration branch**

The existing `connection.onDefinition(...)` handler reads (in part):

```ts
  const line = document.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line, character: Number.MAX_SAFE_INTEGER },
  });

  const id = displayIdAtPosition(line, params.position.character);
  if (!id) return null;
  const entry = index.getEntryByDisplayId(makeDisplayId(id));
  if (!entry) return null;

  return resolveNavigableLocation(entry);
});
```

Insert a new branch between the `line` assignment and `const id = ...`:

```ts
  const line = document.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line, character: Number.MAX_SAFE_INTEGER },
  });

  // Try a ux: ref first (S10 #728) — its token grammar (colon-bearing)
  // never overlaps a display-ID token's.
  const uxToken = uxRefTokenAtPosition(line, params.position.character);
  if (uxToken) {
    const uxRegistry = index.getUxRegistry(profile ?? null);
    if (uxRegistry) {
      const { ref } = parseUxRef(uxToken);
      const surface = ref ? resolveUxRef(ref, uxRegistry) : undefined;
      if (surface) {
        return sourceLocationToLspLocation(surface.location);
      }
    }
  }

  const id = displayIdAtPosition(line, params.position.character);
  if (!id) return null;
  const entry = index.getEntryByDisplayId(makeDisplayId(id));
  if (!entry) return null;

  return resolveNavigableLocation(entry);
});
```

- [ ] **Step 5: Type-check the server**

Run:

```bash
deno check packages/markspec/main.ts packages/markspec/core/mod.ts \
  packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts
```

Expected: no errors.

- [ ] **Step 6: Lint**

Run: `deno lint packages/markspec/lsp/server.ts` Expected: no warnings.

- [ ] **Step 7: Run the full unit test suite**

Run: `deno test packages/markspec/` Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add packages/markspec/lsp/server.ts
git commit -m "$(printf 'feat(lsp): wire ux: hover, completion, and go-to-declaration\n\nThree new branches in the existing onHover/onCompletion/onDefinition\nhandlers, gated through WorkspaceIndex.getUxRegistry. Closes #728.'; echo)"
```

---

### Task 5: Full build gate

**Files:** none (verification only).

**Interfaces:** none — this task runs the repo's standard pre-PR gate.

- [ ] **Step 1: Run the full gate**

Run: `just build`

Expected: `deno lint` clean, full test suite green (unit + e2e), `deno check`
clean on the four entry points, binary compiles to `dist/markspec`.

- [ ] **Step 2: Run format checks (not covered by `just build`)**

Run: `deno fmt --check` Expected: no diff.

Run: `dprint check` Expected: no diff.

- [ ] **Step 3: Review the full diff**

Run: `git diff main --stat`

Confirm the changed-file list matches exactly: `lsp/definition.ts`,
`lsp/definition_test.ts`, `lsp/uxil.ts` (new), `lsp/uxil_test.ts` (new),
`lsp/workspace.ts`, `lsp/workspace_test.ts`, `lsp/server.ts`. No unrelated
files.

At this point the branch is ready for PR — hand off to the
`requesting-code-review` / `finishing-a-development-branch` skills for the
PR-opening, review, and merge steps (outside this plan's scope).
