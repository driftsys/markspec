# Profile-Delivered Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A profile package can deliver document files to consuming projects —
per file either a traceable corpus (entries become provenance-marked citizens of
the consumer's graph) or documentation-only (surfaced via MCP resources).

**Architecture:** New `profile.delivers:` manifest section → resolved
`DeliveredDocument[]` on `EffectiveProfile` → one core loader
(`loadDeliveredCorpus`) called at each graph-build moment by three callers
(compiler, LSP `WorkspaceIndex` seeding, MCP project context). Corpus entries
carry a new optional `Entry.origin` field; a validator post-pass emits the
collision error (MSL-R014) and downgrades corpus-located findings to attributed
warnings.

**Tech Stack:** Deno/TypeScript strict, `@std/yaml`, `@std/path`, Cliffy CLI,
vscode-languageserver, MCP TypeScript SDK. Spec:
`docs/wip/2026-07-02-profile-delivered-documents-design.md`.

## Global Constraints

- **Execution environment:** create a git worktree from `main`
  (`git worktree add .worktrees/profile-delivers -b feat/profile-delivers
  main`),
  run `./bootstrap`, then verify `ls grammars/*.wasm` lists **9** files (copy
  from the main checkout if not: `cp <main>/grammars/*.wasm
  grammars/`). All
  paths below are relative to the worktree root. The main working tree has
  unrelated uncommitted changes — never work there.
- **Node-safe core:** no `Deno.*` APIs anywhere under `packages/markspec/core/`
  — file access only via the injected `ReadFile` type from `core/config/mod.ts`
  (`(path) => Promise<string | undefined>`).
- **Diagnostic codes (final, verified free on main):**
  - `PROFILE-DELIVERS-001` error — corpus file declared but missing.
  - `PROFILE-DELIVERS-002` warning — docs-only file declared but missing.
  - `PROFILE-DELIVERS-003` error — `path` escapes the profile directory.
  - `PROFILE-DELIVERS-004` error — `corpus: true` on a non-`.md` file.
  - `MSL-R014` error — project entry collides with a delivered corpus entry
    (language.md §8.2 R-family ends at R013; re-verify with
    `grep -rn "MSL-R014" docs packages` before use — must return nothing).
- **No `CORE_SCHEMA_VERSION` bump.** `Entry.origin` is optional/additive. The
  constant is the profile-schema pin (`parseManifest` rejects any
  `markspec-schema:` ≠ `"1"` with PROFILE-SCHEMA-001); bumping breaks every
  existing profile. Record this in the ADR.
- **Corpus injection order is deterministic:** `effective.delivers` order =
  parent-first tier order, then manifest order. Corpus entries are seeded
  _before_ project entries everywhere (compiler array, LSP index), so
  first-entry-wins resolves identically on every run.
- **Formatting/lint gates before every commit:** `deno fmt && dprint fmt`, and
  `deno lint` clean. Commit scopes allowed: `core`, `cli`, `lsp`, `mcp`, `docs`,
  `spec`, `repo`. No CHANGELOG entries (batched at release).
- **Docs-only corpus stance:** `fmt`, prose lint, and rename never touch
  delivered files. There is no code path that writes into the profile cache.
- Run the full check before the PR: `just build`, plus `deno fmt --check` and
  `dprint check` separately.

---

### Task 1: Manifest — `DeliversDecl` + `parseDeliversSection`

**Files:**

- Modify: `packages/markspec/core/model/profile.ts` (after `DocTypeDef`,
  ~line 168)
- Modify: `packages/markspec/core/profile/manifest.ts`
- Test: `packages/markspec/core/profile/manifest_test.ts` (append)

**Interfaces:**

- Consumes: existing `Diagnostic`, `ProfileManifest` shapes.
- Produces:
  `interface DeliversDecl { path: string; corpus: boolean;
  description?: string }`;
  `ProfileManifest.delivers: readonly
  DeliversDecl[]` (always present, `[]`
  default); manifest parsing of `profile.delivers:` with codes PROFILE-LOAD-003
  / PROFILE-DELIVERS-003 / PROFILE-DELIVERS-004.

- [ ] **Step 1: Write the failing tests** (append to `manifest_test.ts`,
      mirroring its existing `parseManifest` test style):

```ts
Deno.test("parseManifest: delivers section parses path/corpus/description", () => {
  const { manifest, diagnostics } = parseManifest(
    `id: p\nversion: 1.0.0\nmarkspec-schema: "1"\n` +
      `profile:\n  delivers:\n` +
      `    - path: reference/arch.md\n      corpus: true\n      description: Ref arch\n` +
      `    - path: reference/guide.md\n`,
  );
  assertEquals(diagnostics.filter((d) => d.severity === "error"), []);
  assertEquals(manifest?.delivers, [
    { path: "reference/arch.md", corpus: true, description: "Ref arch" },
    { path: "reference/guide.md", corpus: false, description: undefined },
  ]);
});

Deno.test("parseManifest: delivers path escaping profile dir is PROFILE-DELIVERS-003", () => {
  for (const bad of ["../secrets.md", "/etc/passwd", "a/../../b.md"]) {
    const { diagnostics } = parseManifest(
      `id: p\nversion: 1.0.0\nmarkspec-schema: "1"\n` +
        `profile:\n  delivers:\n    - path: "${bad}"\n`,
    );
    assertEquals(
      diagnostics.some((d) => d.code === "PROFILE-DELIVERS-003"),
      true,
      bad,
    );
  }
});

Deno.test("parseManifest: corpus on non-md file is PROFILE-DELIVERS-004", () => {
  const { diagnostics } = parseManifest(
    `id: p\nversion: 1.0.0\nmarkspec-schema: "1"\n` +
      `profile:\n  delivers:\n    - path: data.csv\n      corpus: true\n`,
  );
  assertEquals(
    diagnostics.some((d) => d.code === "PROFILE-DELIVERS-004"),
    true,
  );
});

Deno.test("parseManifest: duplicate delivers path is a load error", () => {
  const { diagnostics } = parseManifest(
    `id: p\nversion: 1.0.0\nmarkspec-schema: "1"\n` +
      `profile:\n  delivers:\n    - path: a.md\n    - path: a.md\n`,
  );
  assertEquals(diagnostics.some((d) => d.code === "PROFILE-LOAD-003"), true);
});

Deno.test("parseManifest: manifest without delivers has empty list", () => {
  const { manifest } = parseManifest(
    `id: p\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
  );
  assertEquals(manifest?.delivers, []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: FAIL
— `delivers` does not exist on `ProfileManifest` (type error).

- [ ] **Step 3: Model addition** — in `core/model/profile.ts` after the
      `DocTypeDef` block:

```ts
// ---------------------------------------------------------------------------
// Delivered documents (ADR-029)
// ---------------------------------------------------------------------------

/**
 * One `profile.delivers:` item as authored in `markspec.yaml`. `path` is
 * relative to the profile directory, `/`-separated, and validated at parse
 * time to stay inside it. `corpus: true` marks a Markdown file whose entries
 * join the consuming project's traceability graph (ADR-029); default `false`
 * means documentation-only.
 */
export interface DeliversDecl {
  readonly path: string;
  readonly corpus: boolean;
  readonly description?: string;
}
```

Add to `ProfileManifest` (after `documents`):

```ts
/** Files this profile delivers to consumers (ADR-029). Empty when the
 * manifest declares no `profile.delivers:`. */
readonly delivers: readonly DeliversDecl[];
```

- [ ] **Step 4: Parser** — in `core/profile/manifest.ts`:
  - Add `"delivers"` to `ALLOWED_PROFILE_KEYS` (line ~50).
  - Add
    `export const ALLOWED_DELIVERS_KEYS = new Set(["path", "corpus",
    "description"]);`
    next to the other key sets.
  - Import `DeliversDecl` from `../model/mod.ts` (add to the existing type
    import list; re-export it from `core/model/mod.ts`'s profile re-export block
    first — find the `export type {` block that re-exports `DocTypeDef` from
    `./profile.ts` and add `DeliversDecl`).
  - Add the section parser next to `parseDocumentsSection` (~line 1292):

```ts
function parseDeliversSection(
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): DeliversDecl[] {
  if (raw === undefined) return [];
  const loc = { file: sourcePath, line: 1, column: 1 };
  if (!Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `profile.delivers: must be a list`,
      location: loc,
    });
    return [];
  }
  const out: DeliversDecl[] = [];
  const seenPaths = new Set<string>();
  for (const item of raw) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `profile.delivers: each item must be a mapping`,
        location: loc,
      });
      continue;
    }
    const r = item as Record<string, unknown>;
    for (const key of Object.keys(r)) {
      if (!ALLOWED_DELIVERS_KEYS.has(key)) {
        diagnostics.push({
          code: "PROFILE-LOAD-003",
          severity: "error",
          message: `profile.delivers: unknown key '${key}'`,
          location: loc,
        });
      }
    }
    const path = r.path;
    if (typeof path !== "string" || path.trim().length === 0) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `profile.delivers: item missing required 'path' (string)`,
        location: loc,
      });
      continue;
    }
    // PROFILE-DELIVERS-003 — the path must stay inside the profile
    // directory: no absolute paths (POSIX or drive-letter), no `..`.
    const normalized = path.replaceAll("\\", "/");
    if (
      normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) ||
      normalized.split("/").includes("..")
    ) {
      diagnostics.push({
        code: "PROFILE-DELIVERS-003",
        severity: "error",
        message: `profile.delivers: path '${path}' escapes the profile ` +
          `directory (absolute paths and '..' segments are not allowed)`,
        location: loc,
      });
      continue;
    }
    if (r.corpus !== undefined && typeof r.corpus !== "boolean") {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `profile.delivers: 'corpus' must be a boolean`,
        location: loc,
      });
      continue;
    }
    const corpus = r.corpus === true;
    if (corpus && !normalized.toLowerCase().endsWith(".md")) {
      diagnostics.push({
        code: "PROFILE-DELIVERS-004",
        severity: "error",
        message: `profile.delivers: 'corpus: true' requires a Markdown ` +
          `(.md) file, got '${path}'`,
        location: loc,
      });
      continue;
    }
    if (seenPaths.has(normalized)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `profile.delivers: duplicate path '${path}'`,
        location: loc,
      });
      continue;
    }
    seenPaths.add(normalized);
    out.push({
      path: normalized,
      corpus,
      description: typeof r.description === "string"
        ? r.description
        : undefined,
    });
  }
  return out;
}
```

- Wire into `parseManifest` after the `documents` parse (~line 1500):

```ts
const delivers = parseDeliversSection(
  profileSection.delivers,
  sourcePath,
  diagnostics,
);
if (diagnostics.some((d) => d.severity === "error")) {
  return { manifest: null, diagnostics };
}
```

- Add `delivers,` to the `manifest` literal (~line 1522).

- [ ] **Step 5: Run tests**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: PASS
(all new + existing).

- [ ] **Step 6: Type-check the workspace** —
      `deno check
      packages/markspec/main.ts packages/markspec/core/mod.ts
      packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts`.
      Expect errors ONLY at other `ProfileManifest` literal constructors, if any
      (e.g. test fixtures); fix each by adding `delivers: []`.

- [ ] **Step 7: Commit**

```bash
git add -A packages/markspec/core
git commit -m "feat(core): parse profile.delivers manifest section (ADR-029)"
```

---

### Task 2: Chain merge — `DeliveredDocument` on `EffectiveProfile`

**Files:**

- Modify: `packages/markspec/core/model/profile.ts`
- Modify: `packages/markspec/core/profile/merge.ts` (`seedFromTier` ~785,
  `foldTier` ~137)
- Modify: `packages/markspec/core/profile/chain.ts` (`buildPlaceholderEffective`
  ~267)
- Test: `packages/markspec/core/profile/merge_test.ts` (append)

**Interfaces:**

- Consumes: `DeliversDecl`, `LoadedProfile` (has `baseDir`, `version`).
- Produces:
  `interface DeliveredDocument { profileId: string;
  profileVersion: string; path: string; absPath: string; corpus: boolean;
  description?: string }`;
  `EffectiveProfile.delivers: readonly
  DeliveredDocument[]` (parent-first,
  then manifest order; deduped by `(profileId, path)`).

- [ ] **Step 1: Write the failing test** (append to `merge_test.ts`; build tiers
      via `parseManifest` — add this local helper at the bottom of the test
      file):

```ts
function tierFromYaml(yaml: string, baseDir: string): LoadedProfile {
  const { manifest } = parseManifest(yaml, `${baseDir}/markspec.yaml`);
  if (!manifest) throw new Error("fixture manifest failed to parse");
  return {
    id: manifest.id,
    version: manifest.version,
    specifier: { kind: "local", path: baseDir },
    manifest,
    sourcePath: `${baseDir}/markspec.yaml`,
    baseDir,
  };
}

Deno.test("mergeChain: delivers resolve absPath per tier, parent-first", () => {
  const parent = tierFromYaml(
    `id: base\nversion: 1.0.0\nmarkspec-schema: "1"\n` +
      `profile:\n  delivers:\n    - path: ref/base.md\n      corpus: true\n`,
    "/profiles/base",
  );
  const child = tierFromYaml(
    `id: leaf\nversion: 2.0.0\nmarkspec-schema: "1"\n` +
      `profile:\n  delivers:\n    - path: ref/leaf.md\n`,
    "/profiles/leaf",
  );
  const { effective } = mergeChain({
    tiers: [parent, child],
    effective: null as unknown as EffectiveProfile, // stub; mergeChain reads .tiers
  });
  assertEquals(effective?.delivers, [
    {
      profileId: "base",
      profileVersion: "1.0.0",
      path: "ref/base.md",
      absPath: "/profiles/base/ref/base.md",
      corpus: true,
      description: undefined,
    },
    {
      profileId: "leaf",
      profileVersion: "2.0.0",
      path: "ref/leaf.md",
      absPath: "/profiles/leaf/ref/leaf.md",
      corpus: false,
      description: undefined,
    },
  ]);
});
```

(Adapt imports and the chain-stub construction to whatever pattern
`merge_test.ts` already uses for `mergeChain` inputs — if it has an existing
tier/chain builder helper, use that instead of `tierFromYaml`.)

- [ ] **Step 2: Run to verify failure**

Run: `deno test packages/markspec/core/profile/merge_test.ts` Expected: FAIL —
`delivers` missing on `EffectiveProfile`.

- [ ] **Step 3: Model** — in `core/model/profile.ts` next to `DeliversDecl`:

```ts
/**
 * A delivered document after chain resolution (ADR-029): the manifest's
 * `DeliversDecl` joined with the delivering tier's identity and on-disk
 * location. `absPath` is `join(tier.baseDir, path)`.
 */
export interface DeliveredDocument {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly path: string;
  readonly absPath: string;
  readonly corpus: boolean;
  readonly description?: string;
}
```

Add to `EffectiveProfile` (after `documents`):

```ts
/**
 * Documents delivered by the chain (ADR-029), parent-first then manifest
 * order — the deterministic corpus injection order. Deduped by
 * `(profileId, path)`.
 */
readonly delivers: readonly DeliveredDocument[];
```

Re-export `DeliveredDocument` from `core/model/mod.ts` alongside `DeliversDecl`.

- [ ] **Step 4: Merge** — in `core/profile/merge.ts`:
  - Add `import { join } from "@std/path";` and `DeliveredDocument` to the model
    type imports.
  - Add near `seedFromTier`:

```ts
/** Resolve a tier's `delivers:` declarations against its baseDir (ADR-029). */
function deliveredFromTier(tier: LoadedProfile): DeliveredDocument[] {
  return tier.manifest.delivers.map((d) => ({
    profileId: tier.id,
    profileVersion: tier.version,
    path: d.path,
    absPath: join(tier.baseDir, d.path),
    corpus: d.corpus,
    description: d.description,
  }));
}
```

- `seedFromTier` return literal: add `delivers: deliveredFromTier(tier),`.
- `foldTier`: before the `result` literal add:

```ts
// Delivered documents — additive union keyed by (profileId, path).
const delivers = [...base.delivers];
for (const d of deliveredFromTier(tier)) {
  if (
    !delivers.some((e) => e.profileId === d.profileId && e.path === d.path)
  ) {
    delivers.push(d);
  }
}
```

    and add `delivers,` to the `result` literal.

- `chain.ts` `buildPlaceholderEffective`: add `delivers: [],`.

- [ ] **Step 5: Run tests + fix remaining `EffectiveProfile` literals**

Run:
`deno test packages/markspec/core/ && deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts`
Expected: the merge test passes; any type errors are other `EffectiveProfile`
literal constructors (test fixtures, e.g. in LSP or validator tests) — fix each
by adding `delivers: []`. Re-run until green.

- [ ] **Step 6: Commit**

```bash
git add -A packages/markspec
git commit -m "feat(core): resolve delivered documents on the effective profile"
```

---

### Task 3: `Entry.origin` + `loadDeliveredCorpus`

**Files:**

- Modify: `packages/markspec/core/model/mod.ts` (Entry interface ~line 433)
- Create: `packages/markspec/core/profile/delivered.ts`
- Test: `packages/markspec/core/profile/delivered_test.ts`
- Modify: `packages/markspec/core/mod.ts` (barrel exports)

**Interfaces:**

- Consumes: `DeliveredDocument`, `parseFile` from `../parser/mod.ts`, `ReadFile`
  from `../config/mod.ts`.
- Produces:
  - `interface EntryOrigin { kind: "profile"; profileId: string;
    profileVersion: string }`
    and `Entry.origin?: EntryOrigin`.
  - `loadDeliveredCorpus(delivers: readonly DeliveredDocument[], readFile:
    ReadFile): Promise<{ entries: readonly Entry[]; diagnostics: readonly
    Diagnostic[] }>`
  - `corpusOriginLabel(doc: DeliveredDocument): string` → `"id@version"`.
  - `buildCorpusIndex(delivers): ReadonlyMap<string, DeliveredDocument>` keyed
    by `absPath`.

- [ ] **Step 1: Write the failing tests** (`delivered_test.ts`):

```ts
import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildCorpusIndex, loadDeliveredCorpus } from "./delivered.ts";
import type { DeliveredDocument } from "../model/mod.ts";

const CORPUS_MD = `- [PLT_0001] Platform core service

  The platform core service shall expose the vehicle state bus.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV
`;

const doc = (over: Partial<DeliveredDocument>): DeliveredDocument => ({
  profileId: "platform-arch",
  profileVersion: "1.2.0",
  path: "ref/arch.md",
  absPath: "/cache/platform-arch/ref/arch.md",
  corpus: true,
  description: undefined,
  ...over,
});

Deno.test("loadDeliveredCorpus: parses corpus entries and stamps origin", async () => {
  const { entries, diagnostics } = await loadDeliveredCorpus(
    [doc({})],
    // deno-lint-ignore require-await
    async (p) => (p === "/cache/platform-arch/ref/arch.md" ? CORPUS_MD : undefined),
  );
  assertEquals(diagnostics.filter((d) => d.severity === "error"), []);
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "PLT_0001");
  assertEquals(entries[0].origin, {
    kind: "profile",
    profileId: "platform-arch",
    profileVersion: "1.2.0",
  });
});

Deno.test("loadDeliveredCorpus: missing corpus file is PROFILE-DELIVERS-001 error", async () => {
  const { entries, diagnostics } = await loadDeliveredCorpus(
    [doc({})],
    // deno-lint-ignore require-await
    async () => undefined,
  );
  assertEquals(entries, []);
  assertEquals(diagnostics[0].code, "PROFILE-DELIVERS-001");
  assertEquals(diagnostics[0].severity, "error");
  assertStringIncludes(diagnostics[0].message, "platform-arch@1.2.0");
});

Deno.test("loadDeliveredCorpus: missing docs-only file is PROFILE-DELIVERS-002 warning", async () => {
  const { diagnostics } = await loadDeliveredCorpus(
    [doc({ corpus: false, path: "ref/guide.md", absPath: "/x/guide.md" })],
    // deno-lint-ignore require-await
    async () => undefined,
  );
  assertEquals(diagnostics[0].code, "PROFILE-DELIVERS-002");
  assertEquals(diagnostics[0].severity, "warning");
});

Deno.test("loadDeliveredCorpus: docs-only file is never parsed", async () => {
  const { entries } = await loadDeliveredCorpus(
    [doc({ corpus: false })],
    // deno-lint-ignore require-await
    async () => CORPUS_MD,
  );
  assertEquals(entries, []);
});

Deno.test("loadDeliveredCorpus: corpus parse diagnostics are attributed", async () => {
  const { diagnostics } = await loadDeliveredCorpus(
    [doc({})],
    // malformed trailer → parser emits a diagnostic for this file
    // deno-lint-ignore require-await
    async () => `- [PLT_0002] Broken\n\n  Body.\n\n      Id: NOT_A_ULID\n`,
  );
  for (const d of diagnostics) {
    assertStringIncludes(d.message, "delivered by platform-arch@1.2.0:");
  }
});

Deno.test("buildCorpusIndex: keyed by absPath", () => {
  const d = doc({});
  assertEquals(buildCorpusIndex([d]).get(d.absPath), d);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test packages/markspec/core/profile/delivered_test.ts` Expected: FAIL
— module `./delivered.ts` not found.

- [ ] **Step 3: Model** — in `core/model/mod.ts` immediately before the `Entry`
      interface:

```ts
/**
 * Provenance of an entry that did not originate in the project's own files
 * (ADR-029). Absent on project-authored entries. `kind` is a discriminant so
 * future origins (e.g. ADR-011 SBOM-generated dependency entries) can reuse
 * the slot.
 */
export interface EntryOrigin {
  readonly kind: "profile";
  readonly profileId: string;
  readonly profileVersion: string;
}
```

Add to `Entry` (after `derivedDiscipline`):

```ts
/**
 * Set on entries injected from a profile-delivered corpus document
 * (ADR-029). Consumers treat such entries as read-only: `fmt` and rename
 * never touch them, and validation findings inside them are downgraded
 * to attributed warnings.
 */
readonly origin?: EntryOrigin;
```

- [ ] **Step 4: Implement `core/profile/delivered.ts`:**

```ts
/**
 * @module core/profile/delivered
 *
 * Loader for profile-delivered documents (ADR-029). Checks every delivered
 * file's existence (PROFILE-DELIVERS-001/002), parses the `corpus: true`
 * files, and stamps each parsed entry with its profile origin. Pure — all
 * I/O via the injected {@linkcode ReadFile}.
 */

import type { ReadFile } from "../config/mod.ts";
import type {
  DeliveredDocument,
  Diagnostic,
  Entry,
  EntryOrigin,
} from "../model/mod.ts";
import { parseFile } from "../parser/mod.ts";

/** Result of {@linkcode loadDeliveredCorpus}. */
export interface LoadDeliveredCorpusResult {
  readonly entries: readonly Entry[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Human-facing label of a delivered document's providing tier. */
export function corpusOriginLabel(doc: DeliveredDocument): string {
  return `${doc.profileId}@${doc.profileVersion}`;
}

/** Index delivered documents by absolute path — used by CLI/LSP callers to
 * recognise corpus locations when rendering diagnostics. */
export function buildCorpusIndex(
  delivers: readonly DeliveredDocument[],
): ReadonlyMap<string, DeliveredDocument> {
  const out = new Map<string, DeliveredDocument>();
  for (const d of delivers) out.set(d.absPath, d);
  return out;
}

/**
 * Load the delivered corpus of an effective profile chain. Iterates
 * `delivers` in order (parent-first + manifest order — the deterministic
 * injection order), so the returned entry order is stable across runs.
 */
export async function loadDeliveredCorpus(
  delivers: readonly DeliveredDocument[],
  readFile: ReadFile,
): Promise<LoadDeliveredCorpusResult> {
  const entries: Entry[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const doc of delivers) {
    const content = await readFile(doc.absPath);
    if (content === undefined) {
      diagnostics.push({
        code: doc.corpus ? "PROFILE-DELIVERS-001" : "PROFILE-DELIVERS-002",
        severity: doc.corpus ? "error" : "warning",
        message: `delivered ${doc.corpus ? "corpus" : "document"} file ` +
          `'${doc.path}' declared by ${corpusOriginLabel(doc)} is missing ` +
          `from the profile package`,
        location: { file: doc.absPath, line: 1, column: 1 },
      });
      continue;
    }
    if (!doc.corpus) continue; // docs-only: existence check only, never parsed
    const parsed = await parseFile(content, { file: doc.absPath });
    for (const d of parsed.diagnostics) {
      diagnostics.push({
        ...d,
        message: `delivered by ${corpusOriginLabel(doc)}: ${d.message}`,
      });
    }
    const origin: EntryOrigin = {
      kind: "profile",
      profileId: doc.profileId,
      profileVersion: doc.profileVersion,
    };
    entries.push(...parsed.entries.map((e) => ({ ...e, origin })));
  }
  return { entries, diagnostics };
}
```

- [ ] **Step 5: Barrel exports** — in `core/mod.ts` add, next to the other
      `./profile/` exports (near `loadProfileForCommand`):

```ts
export {
  buildCorpusIndex,
  corpusOriginLabel,
  loadDeliveredCorpus,
} from "./profile/delivered.ts";
export type { LoadDeliveredCorpusResult } from "./profile/delivered.ts";
```

and add `EntryOrigin` to the model type exports.

- [ ] **Step 6: Run tests**

Run: `deno test packages/markspec/core/profile/delivered_test.ts` Expected:
PASS. (If the attributed-parse-diagnostics test finds the parser emits zero
diagnostics for `Id: NOT_A_ULID` at parse level, swap the fixture for one that
does produce a parse diagnostic — check `core/parser/markdown_test.ts` for an
existing malformed fixture — the assertion loop over an empty list passes
vacuously either way; keep the fixture that actually produces at least one
diagnostic.)

- [ ] **Step 7: Commit**

```bash
git add -A packages/markspec/core
git commit -m "feat(core): loadDeliveredCorpus + Entry.origin provenance"
```

---

### Task 4: Compiler injection + MSL-R014 + diagnostic attribution

**Files:**

- Create: `packages/markspec/core/validator/corpus.ts`
- Test: `packages/markspec/core/validator/corpus_test.ts`
- Modify: `packages/markspec/core/compiler/mod.ts`
- Modify: `packages/markspec/core/mod.ts` (exports)

**Interfaces:**

- Consumes: `Entry.origin` (Task 3).
- Produces:
  - `detectCorpusCollisions(allEntries: readonly Entry[]): {
    diagnostics: readonly Diagnostic[]; collidedTokens: ReadonlySet<string> }`
    — emits `MSL-R014` anchored at the **project** entry.
  - `attributeCorpusDiagnostics(diagnostics, allEntries, collidedTokens):
    Diagnostic[]`
    — suppresses generic duplicate codes for collided tokens, downgrades
    corpus-located errors to attributed warnings.
  - `CompileOptions.corpusEntries?: readonly Entry[]` — pre-loaded,
    origin-stamped entries injected ahead of project entries.

- [ ] **Step 1: Write the failing tests** (`corpus_test.ts`). Build minimal
      `Entry` fixtures the way `core/validator/mod_test.ts` does (copy its
      entry-fixture helper; the essential fields are `displayId`, `id`,
      `location`, `origin`):

```ts
Deno.test("detectCorpusCollisions: project entry reusing corpus display ID → MSL-R014", () => {
  const corpus = makeEntry({
    displayId: "PLT_0001",
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    file: "/cache/p/ref.md",
    origin: { kind: "profile", profileId: "p", profileVersion: "1.0.0" },
  });
  const project = makeEntry({
    displayId: "PLT_0001",
    id: "01ARZ3NDEKTSV4RRFFQ69G5FB0",
    file: "/repo/reqs.md",
  });
  const { diagnostics, collidedTokens } = detectCorpusCollisions([
    corpus,
    project,
  ]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "MSL-R014");
  assertEquals(diagnostics[0].severity, "error");
  assertEquals(diagnostics[0].location?.file, "/repo/reqs.md");
  assertStringIncludes(diagnostics[0].message, "p@1.0.0");
  assertEquals(collidedTokens.has("PLT_0001"), true);
});

Deno.test("detectCorpusCollisions: no corpus entries → no findings", () => {
  const a = makeEntry({ displayId: "STK_0001", file: "/repo/a.md" });
  assertEquals(detectCorpusCollisions([a]).diagnostics, []);
});

Deno.test("attributeCorpusDiagnostics: corpus-located error downgrades to attributed warning", () => {
  const corpus = makeEntry({
    displayId: "PLT_0001",
    file: "/cache/p/ref.md",
    origin: { kind: "profile", profileId: "p", profileVersion: "1.0.0" },
  });
  const out = attributeCorpusDiagnostics(
    [{
      code: "MSL-L006",
      severity: "error",
      message: "link target does not resolve: PLT_9999",
      location: { file: "/cache/p/ref.md", line: 3, column: 1 },
    }],
    [corpus],
    new Set(),
  );
  assertEquals(out[0].severity, "warning");
  assertStringIncludes(out[0].message, "delivered by p@1.0.0:");
});

Deno.test("attributeCorpusDiagnostics: generic duplicate codes suppressed for collided tokens", () => {
  const out = attributeCorpusDiagnostics(
    [{
      code: "MSL-R006",
      severity: "error",
      message: "duplicate display ID 'PLT_0001' (also at /cache/p/ref.md:1)",
      location: { file: "/repo/reqs.md", line: 5, column: 1 },
    }],
    [],
    new Set(["PLT_0001"]),
  );
  assertEquals(out, []);
});

Deno.test("attributeCorpusDiagnostics: project-side diagnostics untouched", () => {
  const input = [{
    code: "MSL-L006" as const,
    severity: "warning" as const,
    message: "link target does not resolve: NOPE_1",
    location: { file: "/repo/reqs.md", line: 2, column: 1 },
  }];
  assertEquals(attributeCorpusDiagnostics(input, [], new Set()), input);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test packages/markspec/core/validator/corpus_test.ts` Expected: FAIL
— module not found.

- [ ] **Step 3: Implement `core/validator/corpus.ts`:**

```ts
/**
 * @module core/validator/corpus
 *
 * Corpus-aware diagnostic post-pass (ADR-029). Two responsibilities:
 *
 * 1. {@linkcode detectCorpusCollisions} — a project entry re-declaring a
 *    display ID (or Id) owned by a delivered corpus entry is MSL-R014, a
 *    distinct code from MSL-R006 because the fix is different: rename the
 *    project entry; the corpus entry is not yours to change.
 * 2. {@linkcode attributeCorpusDiagnostics} — consumer builds must not go
 *    red from upstream bugs they cannot fix: findings located inside a
 *    corpus file are downgraded to warnings and attributed to the
 *    delivering profile; generic duplicate codes are suppressed for
 *    collided tokens (MSL-R014 replaces them).
 */

import type { Diagnostic, Entry } from "../model/mod.ts";

/** Generic duplicate detectors superseded by MSL-R014 for corpus collisions. */
const GENERIC_DUP_CODES: ReadonlySet<string> = new Set([
  "MSL-R005",
  "MSL-R006",
  "MSL-I007",
  "MSL-I008",
]);

/** Result of {@linkcode detectCorpusCollisions}. */
export interface CorpusCollisionResult {
  readonly diagnostics: readonly Diagnostic[];
  /** Display-ID / Id tokens involved in a project↔corpus collision. */
  readonly collidedTokens: ReadonlySet<string>;
}

export function detectCorpusCollisions(
  allEntries: readonly Entry[],
): CorpusCollisionResult {
  const corpusByDisplayId = new Map<string, Entry>();
  const corpusById = new Map<string, Entry>();
  for (const e of allEntries) {
    if (!e.origin) continue;
    if (!corpusByDisplayId.has(e.displayId)) {
      corpusByDisplayId.set(e.displayId, e);
    }
    if (e.id && !corpusById.has(e.id)) corpusById.set(e.id, e);
  }
  if (corpusByDisplayId.size === 0 && corpusById.size === 0) {
    return { diagnostics: [], collidedTokens: new Set() };
  }
  const diagnostics: Diagnostic[] = [];
  const collided = new Set<string>();
  for (const e of allEntries) {
    if (e.origin) continue;
    const displayOwner = corpusByDisplayId.get(e.displayId);
    if (displayOwner) {
      collided.add(e.displayId);
      diagnostics.push({
        code: "MSL-R014",
        severity: "error",
        message: `display ID '${e.displayId}' is already delivered by ` +
          `${displayOwner.origin!.profileId}@` +
          `${displayOwner.origin!.profileVersion}; rename this entry — ` +
          `delivered corpus entries are read-only`,
        location: e.location,
      });
    }
    if (e.id) {
      const idOwner = corpusById.get(e.id);
      if (idOwner) {
        collided.add(e.id);
        diagnostics.push({
          code: "MSL-R014",
          severity: "error",
          message: `Id '${e.id}' is already delivered by ` +
            `${idOwner.origin!.profileId}@` +
            `${idOwner.origin!.profileVersion}; rename this entry — ` +
            `delivered corpus entries are read-only`,
          location: e.location,
        });
      }
    }
  }
  return { diagnostics, collidedTokens: collided };
}

export function attributeCorpusDiagnostics(
  diagnostics: readonly Diagnostic[],
  allEntries: readonly Entry[],
  collidedTokens: ReadonlySet<string>,
): Diagnostic[] {
  const corpusFiles = new Map<string, string>();
  for (const e of allEntries) {
    if (e.origin) {
      corpusFiles.set(
        e.location.file,
        `${e.origin.profileId}@${e.origin.profileVersion}`,
      );
    }
  }
  const out: Diagnostic[] = [];
  for (const d of diagnostics) {
    // Suppress the generic duplicate codes for corpus collisions; the
    // validator embeds the offending token in single quotes, which is what
    // this containment check keys on.
    if (
      GENERIC_DUP_CODES.has(d.code) &&
      [...collidedTokens].some((t) => d.message.includes(`'${t}'`))
    ) {
      continue;
    }
    const label = d.location ? corpusFiles.get(d.location.file) : undefined;
    if (label !== undefined) {
      out.push({
        ...d,
        severity: d.severity === "error" ? "warning" : d.severity,
        message: `delivered by ${label}: ${d.message}`,
      });
      continue;
    }
    out.push(d);
  }
  return out;
}
```

- [ ] **Step 4: Compiler wiring** — in `core/compiler/mod.ts`:
  - `CompileOptions` gains:

```ts
/**
 * Profile-delivered corpus entries (ADR-029), pre-loaded and
 * origin-stamped by `loadDeliveredCorpus`. Injected AHEAD of project
 * entries so first-entry-wins graph slots resolve to the corpus
 * deterministically. Optional — absent means no corpus.
 */
readonly corpusEntries?: readonly Entry[];
```

- Seed them first: change `const allEntries: Entry[] = [];` (line ~199) to
  `const allEntries: Entry[] = [...(options.corpusEntries ?? [])];`.
- After the `diagnostics` array assembly (~line 355), apply the post-pass:

```ts
let diagnostics: Diagnostic[] = [
  ...parseDiagnostics,
  ...validationDiagnostics,
  ...linkTargetDiags,
];
if (options.corpusEntries && options.corpusEntries.length > 0) {
  const { attributeCorpusDiagnostics, detectCorpusCollisions } =
    await import("../validator/corpus.ts");
  const collisions = detectCorpusCollisions(allEntries);
  diagnostics = [
    ...attributeCorpusDiagnostics(
      diagnostics,
      allEntries,
      collisions.collidedTokens,
    ),
    ...collisions.diagnostics,
  ];
}
```

    (Static import is also fine — match the file's existing style, which
    imports validator functions statically at the top; prefer adding
    `attributeCorpusDiagnostics, detectCorpusCollisions` to the existing
    `../validator/mod.ts` import if you re-export them there.)

- Export both functions from `core/validator/mod.ts` and from `core/mod.ts`.

- [ ] **Step 5: Compiler-level test** (append to the compiler's existing test
      file — find it with `ls packages/markspec/core/compiler/*_test.ts`):
      compile one in-memory project file whose `Satisfies:` targets a corpus
      entry passed via `corpusEntries`; assert the corpus entry is in
      `result.entries`, no MSL-L006 for the target, and that a colliding project
      entry yields exactly one MSL-R014 and no MSL-R006.

- [ ] **Step 6: Run tests**

Run: `deno test packages/markspec/core/` Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A packages/markspec/core
git commit -m "feat(core): corpus injection in compile + MSL-R014 collision + attribution"
```

---

### Task 5: CLI wiring — `compileProject`, `check`, location rendering, e2e

**Files:**

- Modify: `packages/markspec/cli/helpers.ts` (`compileProject` ~164, diagnostic
  printing)
- Modify: `packages/markspec/cli/commands/check.ts`
- Test: `tests/e2e/delivered_test.ts` (new)

**Interfaces:**

- Consumes: `loadDeliveredCorpus`, `buildCorpusIndex`, `corpusOriginLabel`,
  `CompileOptions.corpusEntries`, `detectCorpusCollisions`,
  `attributeCorpusDiagnostics`.
- Produces: every graph-consuming CLI command sees corpus entries; human-facing
  corpus locations render as `<profile-id>@<version>:<relative-path>:<line>`.

- [ ] **Step 1: Write the failing e2e test** (`tests/e2e/delivered_test.ts`).
      First run `grep -rn "project.yaml" tests/e2e/*.ts | head -5` and copy the
      exact minimal `project.yaml` fixture other e2e tests use. Skeleton:

```ts
import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROFILE_YAML = `id: platform-arch
version: 1.2.0
markspec-schema: "1"
profile:
  delivers:
    - path: reference/platform.md
      corpus: true
      description: Reference platform architecture
    - path: reference/guide.md
`;

const CORPUS_MD = `- [PLT_0001] Platform core service

  The platform core service shall expose the vehicle state bus.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV
`;

const GUIDE_MD = `# Integration guide\n`;

const PROJECT_MD = `- [STK_0001] Vehicle state access

  The system shall read the vehicle state from the platform core service.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FB0
      Satisfies: PLT_0001
`;

const FIXTURE = {
  "project.yaml": /* copied minimal fixture */ "name: demo\n",
  ".markspec.yaml": `profiles: ["./profile"]\n`,
  "profile/markspec.yaml": PROFILE_YAML,
  "profile/reference/platform.md": CORPUS_MD,
  "profile/reference/guide.md": GUIDE_MD,
  "docs/requirements.md": PROJECT_MD,
};

Deno.test("check: Satisfies into delivered corpus resolves", async () => {
  const { code, stderr } = await markspec(["check"], FIXTURE);
  assertEquals(code, 0, stderr);
});

Deno.test("check: without delivers the same target is unresolved", async () => {
  const { code, stderr } = await markspec(["check"], {
    ...FIXTURE,
    "profile/markspec.yaml":
      `id: platform-arch\nversion: 1.2.0\nmarkspec-schema: "1"\n`,
  });
  assertEquals(code === 0, false);
  assertStringIncludes(stderr, "MSL-L006");
});

Deno.test("check: project entry colliding with corpus ID is MSL-R014", async () => {
  const { code, stderr } = await markspec(["check"], {
    ...FIXTURE,
    "docs/collide.md": `- [PLT_0001] My own platform entry

  Colliding body.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FC0
`,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-R014");
  assertStringIncludes(stderr, "platform-arch@1.2.0");
});

Deno.test("check: missing corpus file is a PROFILE-DELIVERS-001 error", async () => {
  const files = { ...FIXTURE } as Record<string, string>;
  delete files["profile/reference/platform.md"];
  const { code, stderr } = await markspec(["check"], files);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "PROFILE-DELIVERS-001");
});
```

Adjust the two differential assertions to the actual exit-code contract you
observe from `check` (errors → 1; warnings-only → 2; clean → 0) — assert the
specific codes, not just non-zero, once observed.

- [ ] **Step 2: Run to verify failure**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env tests/e2e/delivered_test.ts`
Expected: FAIL — corpus target unresolved (MSL-L006 fires in the first test), no
MSL-R014 in the third.

- [ ] **Step 3: `helpers.ts`** — add a shared corpus-aware diagnostic printer
      and wire `compileProject`:

```ts
/** Render a diagnostic location, mapping corpus files to the stable
 * `<profile-id>@<version>:<relative-path>` form (ADR-029). */
export function renderDiagnosticLocation(
  diag: { location?: { file: string; line: number } },
  corpusIndex: ReadonlyMap<string, import("../core/mod.ts").DeliveredDocument>,
): string {
  if (!diag.location) return "";
  const doc = corpusIndex.get(diag.location.file);
  if (doc) {
    return `${doc.profileId}@${doc.profileVersion}:${doc.path}:${diag.location.line}`;
  }
  return `${diag.location.file}:${diag.location.line}`;
}
```

In `compileProject` (after `loadActiveProfile`):

```ts
const { compile, loadDeliveredCorpus, buildCorpusIndex } = await import(
  "../core/mod.ts"
);
const corpus = chain
  ? await loadDeliveredCorpus(chain.effective.delivers, readFile)
  : { entries: [], diagnostics: [] };
const corpusIndex = buildCorpusIndex(chain?.effective.delivers ?? []);
let corpusError = false;
for (const diag of corpus.diagnostics) {
  console.error(
    `${diag.severity}[${diag.code}]: ` +
      `${renderDiagnosticLocation(diag, corpusIndex)} ${diag.message}`,
  );
  if (diag.severity === "error") corpusError = true;
}
if (corpusError) Deno.exit(1);
```

then pass `corpusEntries: corpus.entries` into the `compile()` options, and
replace the result-diagnostics print loop's location interpolation with
`renderDiagnosticLocation(diag, corpusIndex)`.

- [ ] **Step 4: `check.ts`** — after the profile chain loads and before the
      parse loop, load the corpus when project-wide:

```ts
const { loadDeliveredCorpus, buildCorpusIndex } = await import(
  "../../core/mod.ts"
);
const corpus = scope.projectWide && chain
  ? await loadDeliveredCorpus(chain.effective.delivers, readFile)
  : { entries: [], diagnostics: [] };
const corpusIndex = buildCorpusIndex(
  scope.projectWide ? chain?.effective.delivers ?? [] : [],
);
```

Seed `allEntries` with the corpus before the file loop
(`allEntries.push(...corpus.entries)` right after its declaration), include
`corpus.diagnostics` in the diagnostic set the command reports, and after
`runPipeline` apply the post-pass:

```ts
const { attributeCorpusDiagnostics, detectCorpusCollisions } =
  await import("../../core/mod.ts");
const collisions = detectCorpusCollisions(allEntries);
const pipelineDiagnostics = [
  ...attributeCorpusDiagnostics(
    result.diagnostics,
    allEntries,
    collisions.collidedTokens,
  ),
  ...collisions.diagnostics,
];
```

(then use `pipelineDiagnostics` wherever `result.diagnostics` fed the
report/exit logic — read the surrounding code and keep its severity → exit
mapping intact). Use `renderDiagnosticLocation` for the human format's location
column.

- [ ] **Step 5: Run the e2e tests**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env tests/e2e/delivered_test.ts`
Expected: PASS (all four).

- [ ] **Step 6: Run the full suite + commit**

Run: `just test` Expected: PASS.

```bash
git add -A packages/markspec/cli tests/e2e
git commit -m "feat(cli): inject delivered corpus into check/compile with attributed locations"
```

---

### Task 6: `show` origin, `profile show` delivers block, `doctor` health

**Files:**

- Modify: `packages/markspec/cli/commands/show.ts` (~line 43)
- Modify: `packages/markspec/cli/commands/profile.ts` (show action, after the
  `groups` loop ~line 62)
- Modify: `packages/markspec/cli/commands/doctor.ts`
- Test: extend `tests/e2e/delivered_test.ts`

**Interfaces:**

- Consumes: `Entry.origin`, `chain.effective.delivers`, `loadDeliveredCorpus`.
- Produces: `show` prints `Origin: <id>@<version>`; `profile show` prints a
  `Delivered documents:` block; `doctor` reports delivered-file health.

- [ ] **Step 1: Failing e2e assertions** (append to `delivered_test.ts`):

```ts
Deno.test("show: corpus entry carries Origin line", async () => {
  const { code, stdout } = await markspec(
    ["show", "PLT_0001", "docs/requirements.md"],
    FIXTURE,
  );
  assertEquals(code, 0);
  assertStringIncludes(stdout, "Origin: platform-arch@1.2.0");
});

Deno.test("profile show: lists delivered documents", async () => {
  const { code, stdout } = await markspec(["profile", "show"], FIXTURE);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "Delivered documents");
  assertStringIncludes(stdout, "reference/platform.md");
  assertStringIncludes(stdout, "corpus");
  assertStringIncludes(stdout, "reference/guide.md");
});
```

Run:
`deno test --allow-read --allow-write --allow-run --allow-env tests/e2e/delivered_test.ts`
Expected: the two new tests FAIL.

- [ ] **Step 2: `show.ts`** — after the `Shape:` line (~line 43):

```ts
if (entry.origin) {
  console.log(
    `  Origin: ${entry.origin.profileId}@${entry.origin.profileVersion}`,
  );
}
```

(JSON format needs no change — `origin` rides the entry spread.)

- [ ] **Step 3: `profile.ts` show action** — after the `groups` loop, still
      inside the `else` (chain present) branch:

```ts
const delivers = chain.effective.delivers;
if (delivers.length > 0) {
  const { loadDeliveredCorpus } = await import("../../core/mod.ts");
  const corpus = await loadDeliveredCorpus(delivers, readFile);
  const countByFile = new Map<string, number>();
  for (const e of corpus.entries) {
    countByFile.set(
      e.location.file,
      (countByFile.get(e.location.file) ?? 0) + 1,
    );
  }
  console.log(`Delivered documents (${delivers.length}):`);
  for (const doc of delivers) {
    const role = doc.corpus
      ? `corpus   ${countByFile.get(doc.absPath) ?? 0} entries`
      : `doc      ${doc.description ?? ""}`.trimEnd();
    console.log(`  - ${doc.path}   ${role}   [${doc.profileId}]`);
  }
  console.log("");
}
```

(Match the import style already used in that action; `readFile` comes from
`../helpers.ts` — add to the existing import if absent. Also add `delivers` to
the JSON branch: extend the `overview` JSON output with a `delivers` field
carrying `chain.effective.delivers`.)

- [ ] **Step 4: `doctor.ts`** — read the file first; in the section that prints
      profile status, add after it:

```ts
if (chain && chain.effective.delivers.length > 0) {
  const { loadDeliveredCorpus } = await import("../../core/mod.ts");
  const corpus = await loadDeliveredCorpus(
    chain.effective.delivers,
    readFile,
  );
  const issues = corpus.diagnostics.filter((d) =>
    d.code.startsWith("PROFILE-DELIVERS")
  );
  console.log(
    `Delivered documents: ${chain.effective.delivers.length} ` +
      `(${corpus.entries.length} corpus entries` +
      `${issues.length > 0 ? `, ${issues.length} issue(s)` : ""})`,
  );
  for (const d of issues) {
    console.log(`  ${d.severity}[${d.code}]: ${d.message}`);
  }
}
```

Adapt variable names to doctor's actual structure (it uses `compileProject()` —
the chain is already in scope as part of its result). Wire the corpus issue
count into doctor's existing exit-code logic the same way its other advisory
sections do (read the code; do not invent a new exit path).

- [ ] **Step 5: Run e2e + full suite**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env tests/e2e/ && just test`
Expected: PASS. If a `profile show` / `doctor` snapshot test drifts, review the
diff — the new block is expected — and update snapshots with
`deno test --allow-run --allow-read -- --update`, then re-review.

- [ ] **Step 6: Commit**

```bash
git add -A packages/markspec/cli tests/e2e
git commit -m "feat(cli): surface delivered documents in show, profile show, doctor"
```

---

### Task 7: Origin in export + reports

**Files:**

- Modify: `packages/markspec/core/compiler/schema.ts` (`SerializedEntry`)
- Modify: `packages/markspec/core/reporter/mod.ts` (matrix headers ~125, ~139;
  coverage section — locate with `grep -n "coverage" mod.ts`)
- Test: extend the reporter/compiler schema unit tests + one e2e assertion

**Interfaces:**

- Consumes: `Entry.origin`.
- Produces: `SerializedEntry.origin?: EntryOrigin`; matrix CSV header
  `ID,Title,Type,Origin,Satisfies,Satisfied-by`; markdown matrix gains an
  `Origin` column; origin cell is `"<id>@<version>"` or `"project"`.

- [ ] **Step 1: Failing tests.** Read `schema.ts` to see how `SerializedEntry`
      is built; add to its test: serializing an entry with `origin` set includes
      it verbatim, and one without omits the field. Add to `reporter` tests: an
      entry with `origin` renders `p@1.0.0` in the Origin column; one without
      renders `project`. Add one e2e assertion to `delivered_test.ts`:

```ts
Deno.test("export json: corpus entries carry origin", async () => {
  const { code, stdout } = await markspec(
    ["export", "json", "docs/requirements.md"],
    FIXTURE,
  );
  assertEquals(code, 0);
  assertStringIncludes(stdout, `"profileId": "platform-arch"`);
});
```

- [ ] **Step 2: Implement.** `SerializedEntry`: add
      `readonly origin?: EntryOrigin;` and copy it in the serializer
      (`...(entry.origin ? { origin: entry.origin } : {})` — keep output
      deterministic and field-free when absent). Reporter: extend both header
      strings and the row builders:

```ts
const originCell = (e: Entry): string =>
  e.origin ? `${e.origin.profileId}@${e.origin.profileVersion}` : "project";
```

For the coverage report, add the same cell to its per-entry rows (match its
existing row shape — read before editing).

- [ ] **Step 3: Run tests, update snapshots consciously, commit**

Run:
`deno test packages/markspec/core/ && deno test --allow-read --allow-write --allow-run --allow-env tests/e2e/`

```bash
git add -A packages/markspec/core tests/e2e
git commit -m "feat(core): origin column in reports and serialized export"
```

---

### Task 8: MCP — corpus in compile, delivered resources, origin in entry view

**Files:**

- Modify: `packages/markspec/mcp/project.ts` (`runCompile` ~347, `Project`
  interface ~202, return literal ~455)
- Modify: `packages/markspec/mcp/uri.ts`
- Modify: `packages/markspec/mcp/resources/mod.ts`
- Modify: `packages/markspec/mcp/resources/profile.ts` (renderProfile)
- Modify: `packages/markspec/mcp/resources/entry.ts` (renderEntry)
- Tests: `packages/markspec/mcp/uri_test.ts`,
  `packages/markspec/mcp/resources/mod_test.ts` (append, mirroring existing
  fixtures)

**Interfaces:**

- Consumes: `loadDeliveredCorpus`, `chain.effective.delivers`, `Entry.origin`.
- Produces:
  - `Project.delivers: readonly DeliveredDocument[]` and
    `Project.readDeliveredDocument(profileId: string, relPath: string):
    Promise<string | undefined>`.
  - URI helpers: `DELIVERED_URI_PREFIX = "markspec://delivered/"`,
    `deliveredUri(profileId, path)`, `parseDeliveredUri(uri)`,
    `isDeliveredUri(uri)`.
  - Delivered docs listed in `resources/list`; readable via `resources/read`;
    `markspec://profile` overview gains a _Delivered documents_ section; entry
    rendering shows origin.

- [ ] **Step 1: Failing unit tests.**
  - `uri_test.ts`:

```ts
Deno.test("deliveredUri round-trips profileId and path", () => {
  const uri = deliveredUri("platform-arch", "reference/platform.md");
  assertEquals(uri, "markspec://delivered/platform-arch/reference%2Fplatform.md");
  assertEquals(parseDeliveredUri(uri), {
    profileId: "platform-arch",
    path: "reference/platform.md",
  });
  assertEquals(isDeliveredUri(uri), true);
  assertEquals(isDeliveredUri("markspec://profile"), false);
});
```

- `resources/mod_test.ts`: with a project fixture whose profile delivers two
  files, `listResourceDescriptors` includes both delivered URIs with the
  manifest description; `readResource` on a delivered URI returns the file text;
  unknown delivered path throws.

- [ ] **Step 2: `uri.ts`:**

```ts
/** Prefix for delivered-document resource URIs (ADR-029). */
export const DELIVERED_URI_PREFIX = "markspec://delivered/";

/** Build a delivered-document URI: profileId segment + encoded relative path. */
export function deliveredUri(profileId: string, path: string): string {
  return `${DELIVERED_URI_PREFIX}${encodeURIComponent(profileId)}/` +
    encodeURIComponent(path);
}

/** Parse a delivered-document URI. Returns `{profileId, path}` or undefined. */
export function parseDeliveredUri(
  uri: string,
): { profileId: string; path: string } | undefined {
  if (!uri.startsWith(DELIVERED_URI_PREFIX)) return undefined;
  const rest = uri.slice(DELIVERED_URI_PREFIX.length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx <= 0 || slashIdx === rest.length - 1) return undefined;
  try {
    return {
      profileId: decodeURIComponent(rest.slice(0, slashIdx)),
      path: decodeURIComponent(rest.slice(slashIdx + 1)),
    };
  } catch {
    return undefined;
  }
}

/** Check whether a URI is a delivered-document URI. */
export function isDeliveredUri(uri: string): boolean {
  return parseDeliveredUri(uri) !== undefined;
}
```

- [ ] **Step 3: `project.ts`:**
  - Import `loadDeliveredCorpus` and `DeliveredDocument` from `../core/mod.ts`.
  - In `runCompile`, before `compile(...)`:

```ts
const corpus = profileChain
  ? await loadDeliveredCorpus(
    profileChain.effective.delivers,
    env.readFile,
  )
  : { entries: [], diagnostics: [] };
```

    and pass `corpusEntries: corpus.entries` into `compile`.

- `Project` interface + return literal:

```ts
/** Documents delivered by the active profile chain (ADR-029). */
readonly delivers: readonly DeliveredDocument[];
/** Read a delivered document's raw text from the profile cache. */
readDeliveredDocument(
  profileId: string,
  relPath: string,
): Promise<string | undefined>;
```

```ts
delivers: profileChain?.effective.delivers ?? [],
async readDeliveredDocument(profileId, relPath) {
  const doc = (profileChain?.effective.delivers ?? []).find(
    (d) => d.profileId === profileId && d.path === relPath,
  );
  if (!doc) return undefined;
  return await env.readFile(doc.absPath);
},
```

- [ ] **Step 4: `resources/mod.ts`:**
  - In `listResourceDescriptors`, after the profile-detail loop:

```ts
for (const doc of project.delivers) {
  out.push({
    uri: deliveredUri(doc.profileId, doc.path),
    name: `delivered: ${doc.path}`,
    description: doc.description ??
      (doc.corpus
        ? `Corpus document delivered by ${doc.profileId} — its entries are in the graph`
        : `Reference document delivered by ${doc.profileId}`),
    mimeType: "text/markdown",
  });
}
```

- In `readResource`, before the final `throw`:

```ts
if (isDeliveredUri(uri)) {
  const parsed = parseDeliveredUri(uri)!;
  const text = await project.readDeliveredDocument(
    parsed.profileId,
    parsed.path,
  );
  if (text === undefined) {
    throw new Error(
      `delivered document not found: ${parsed.profileId}/${parsed.path}`,
    );
  }
  return { uri, mimeType: "text/markdown", text };
}
```

- [ ] **Step 5: `resources/profile.ts` + `resources/entry.ts`.** Read both
      files. In `renderProfile`, append a section when
      `project.delivers`-equivalent data is reachable from the chain the view is
      built from (the builder receives `project.profileChain` — use
      `chain?.effective.delivers`):

```ts
## Delivered documents

- [reference/platform.md](markspec://delivered/platform-arch/reference%2Fplatform.md) — corpus (entries in graph) — Reference platform architecture
- [reference/guide.md](markspec://delivered/platform-arch/reference%2Fguide.md) — documentation
```

(emit via the file's existing string-building style, one bullet per delivered
doc, using `deliveredUri`). In `renderEntry`, when `entry.origin` is set, add
near the metadata head:
`Origin: delivered by ${origin.profileId}@${origin.profileVersion} (read-only)`.

- [ ] **Step 6: Run tests + commit**

Run: `deno test packages/markspec/mcp/` Expected: PASS.

```bash
git add -A packages/markspec/mcp
git commit -m "feat(mcp): delivered-document resources + corpus in compiled context"
```

---

### Task 9: LSP — corpus seeding, rename guard, completion badge

**Files:**

- Modify: `packages/markspec/lsp/server.ts`
- Modify: `packages/markspec/lsp/workspace.ts` (`DisplayIdEntry`,
  `getAllDisplayIds`)
- Modify: `packages/markspec/lsp/completions.ts` (`buildIdReferenceItems`)
- Tests: `packages/markspec/lsp/workspace_test.ts` (or colocated test file —
  check naming with `ls packages/markspec/lsp/*_test.ts`), `completions_test.ts`
  (append)

**Interfaces:**

- Consumes: `profile.delivers` (already on the module-scoped
  `EffectiveProfile`), `loadDeliveredCorpus`, `Entry.origin`.
- Produces: corpus entries in the `WorkspaceIndex` before the project walk; no
  diagnostics published for corpus files; rename returns `null` on corpus-origin
  IDs; `DisplayIdEntry.origin?: string` badge in completion detail.

- [ ] **Step 1: Failing unit tests.**
  - Workspace determinism (append to the workspace test file):

```ts
Deno.test("WorkspaceIndex: corpus seeded first owns colliding display IDs", async () => {
  const index = new WorkspaceIndex();
  await index.parseAndUpdateFile("/cache/p/ref.md", CORPUS_MD); // corpus fixture
  // Simulate origin stamping the server applies on seed:
  index.updateFile(
    "/cache/p/ref.md",
    index.getEntriesForFile("/cache/p/ref.md").map((e) => ({
      ...e,
      origin: { kind: "profile", profileId: "p", profileVersion: "1.0.0" },
    })),
  );
  await index.parseAndUpdateFile("/repo/a.md", PROJECT_MD_WITH_SAME_ID);
  const owner = index.getEntryByDisplayId(makeDisplayId("PLT_0001"));
  assertEquals(owner?.origin?.profileId, "p");
});
```

- Completions badge (append to `completions_test.ts`):

```ts
Deno.test("buildIdReferenceItems: corpus entries carry origin badge", () => {
  const items = buildIdReferenceItems([
    { displayId: makeDisplayId("PLT_0001"), title: "Core", origin: "p@1.0.0" },
    { displayId: makeDisplayId("STK_0001"), title: "Local" },
  ]);
  assertEquals(items[0].detail, "Core — from p@1.0.0");
  assertEquals(items[1].detail, "Local");
});
```

- [ ] **Step 2: `workspace.ts`** — extend `DisplayIdEntry`:

```ts
export interface DisplayIdEntry {
  readonly displayId: DisplayId;
  readonly title: string;
  /** `"<profileId>@<version>"` when the entry is delivered corpus (ADR-029). */
  readonly origin?: string;
}
```

`getAllDisplayIds` sets it:

```ts
result.push({
  displayId,
  title: entry.title,
  origin: entry.origin
    ? `${entry.origin.profileId}@${entry.origin.profileVersion}`
    : undefined,
});
```

- [ ] **Step 3: `completions.ts`** — `buildIdReferenceItems` detail:

```ts
detail: entry.origin ? `${entry.title} — from ${entry.origin}` : entry.title,
```

Also update the server's trace-target-filtered branch (server.ts `onCompletion`
Trigger 3) which maps entries to `{ displayId, title }` — include the same
origin projection there.

- [ ] **Step 4: `server.ts` seeding.** Add near the server-state block:

```ts
/** Absolute paths of delivered corpus files currently seeded into the
 * index (ADR-029). Diagnostics for these files are never published and
 * the files are re-seeded, not watched. */
const corpusFilePaths = new Set<string>();

async function seedDeliveredCorpus(): Promise<void> {
  for (const path of corpusFilePaths) index.removeFile(path);
  corpusFilePaths.clear();
  const delivers = profile?.delivers ?? [];
  if (delivers.length === 0) return;
  const corpus = await loadDeliveredCorpus(delivers, readFile);
  for (const d of corpus.diagnostics) {
    connection.console.warn(`${d.code}: ${d.message}`);
  }
  const byFile = new Map<string, Entry[]>();
  for (const e of corpus.entries) {
    const list = byFile.get(e.location.file) ?? [];
    list.push(e);
    byFile.set(e.location.file, list);
  }
  for (const [file, entries] of byFile) {
    index.updateFile(file, entries);
    corpusFilePaths.add(file);
  }
}
```

(add `loadDeliveredCorpus` and `Entry` to the existing static imports from
`../core/mod.ts`). Call `await seedDeliveredCorpus();` in `onInitialized`
immediately before the file walk, and in `reloadProfile()` right after `profile`
is reassigned (before `publishAllDiagnostics()`).

- [ ] **Step 5: `server.ts` diagnostic + rename guards.**
  - `publishAllDiagnostics`: in the send loop add
    `if (corpusFilePaths.has(file)) continue;` and the same guard in the clear
    loop.
  - `onPrepareRename` and `onRenameRequest`: after the display-ID token is
    resolved (`oldId` in rename; add a `displayIdAtPosition` lookup in
    prepareRename), insert:

```ts
const targetEntry = index.getEntryByDisplayId(makeDisplayId(oldId));
if (targetEntry?.origin) return null; // delivered corpus is read-only (ADR-029)
```

- [ ] **Step 6: Run tests + full check**

Run: `deno test packages/markspec/lsp/ && just check` Expected: PASS, zero
warnings.

- [ ] **Step 7: Commit**

```bash
git add -A packages/markspec/lsp
git commit -m "feat(lsp): seed delivered corpus at first index; guard rename; badge completions"
```

---

### Task 10: Documentation — ADR, language.md §8, JSON schema, guide

**Files:**

- Create: `docs/architecture/adr-029-profile-delivered-documents.md` (verify 029
  is still the next free number: `ls docs/architecture/ | tail`)
- Modify: `docs/spec/language/language.md` (§8.2 table, after MSL-R013)
- Modify: `schemas/profile/v1.json`
- Modify: `docs/guide/configuration.md`, `docs/guide/commands.md`
- Create: `docs/guide/recipes/shipping-a-reference-architecture.md`
- Modify: `AGENTS.md` (ADR list)

**Interfaces:** none (documentation).

- [ ] **Step 1: ADR.** Distil the spec
      (`docs/wip/2026-07-02-profile-delivered-documents-design.md`) into the
      house ADR format (mirror `adr-026-*.md` for structure: Context / Decision
      / Consequences / Alternatives considered). Must include: the `delivers:`
      manifest shape and merge rule; `DeliveredDocument` + `Entry.origin`; the
      one-core-loader/three-callers injection design; collision (MSL-R014) +
      attribution/downgrade policy; read-only-by- construction; the
      **no-CORE_SCHEMA_VERSION-bump correction** and why; the five explicit
      non-features; the rejected alternatives (vendoring, ADR-022 upstream
      reuse, shallow cut).
- [ ] **Step 2: language.md.** Append to the §8.2 R-family table:

```markdown
| `MSL-R014` | error | Display ID / Id collides with an entry delivered by the
active profile's corpus (ADR-029). Rename the project entry. |
```

Check whether PROFILE-LOAD codes are documented in language.md
(`grep -n "PROFILE-LOAD" docs/spec/language/language.md`); if yes, add the four
PROFILE-DELIVERS codes beside them; if no, the ADR is their home.

- [ ] **Step 3: JSON schema.** In `schemas/profile/v1.json`, add to the
      `profile` object's `properties`:

```json
"delivers": {
  "type": "array",
  "description": "Documents this profile delivers to consumers (ADR-029).",
  "items": {
    "type": "object",
    "additionalProperties": false,
    "required": ["path"],
    "properties": {
      "path": {
        "type": "string",
        "description": "Path relative to the profile directory. No '..' or absolute paths."
      },
      "corpus": {
        "type": "boolean",
        "default": false,
        "description": "true → the file's entries join the consuming project's traceability graph (Markdown only)."
      },
      "description": { "type": "string" }
    }
  }
}
```

- [ ] **Step 4: Guide.** `configuration.md`: document `profile.delivers:` with
      the two-file example from the spec §1. `commands.md`: update
      `profile show` / `doctor` / `show` sections with the new output blocks.
      New recipe `shipping-a-reference-architecture.md`: walk through authoring
      a profile that delivers a corpus file, consuming it (`.markspec.yaml`),
      and verifying (`check` resolves, `profile show` lists, collision error
      demo). `AGENTS.md`: append the ADR-029 line to the ADR list.
- [ ] **Step 5: Format + commit**

Run: `just fmt && dprint check && deno fmt --check`

```bash
git add docs schemas AGENTS.md
git commit -m "docs(docs): ADR-029 profile-delivered documents + guide + schema"
```

---

### Task 11: Final verification gate

- [ ] `just build` — lint + full test suite + type-check + binary compile must
      pass with zero warnings.
- [ ] `deno fmt --check && dprint check` (separate CI gates — run both).
- [ ] Manual smoke: in a scratch dir under the worktree, recreate the e2e
      fixture on disk and run `dist/markspec check`,
      `dist/markspec profile
      show`,
      `dist/markspec show PLT_0001 docs/requirements.md` — eyeball the corpus
      location rendering (`platform-arch@1.2.0:reference/platform.md:N`).
- [ ] Confirm `docs/wip/` still contains the spec + this plan (they garden into
      archive when the branch finishes, per sdd-working-memory rule — run the
      `sdd-gardening` skill before the PR merges).
- [ ] Open the PR (single PR: code + tests + docs). Body first line:
      `Closes #<issue>` if a tracking issue exists — search
      `gh issue list --search "profile deliver"` first. Then run `/review` on it
      and post findings as a PR comment.

---

## Self-review notes (already applied)

- Spec §4 "three callers" ↔ Tasks 4/5 (compiler+CLI), 8 (MCP), 9 (LSP). ✓
- Spec §5 collision + attribution ↔ Task 4; §6 CLI surfaces ↔ Tasks 5–7; §7 MCP
  resources ↔ Task 8; §8 LSP scope ↔ Task 9; §9 codes ↔ Tasks 1/3/4; §10 testing
  ↔ per-task TDD + Task 5 e2e; §11 docs ↔ Task 10. ✓
- Spec §3 CORE_SCHEMA_VERSION bump — **deliberately not implemented** (would
  break the `markspec-schema: "1"` pin contract); spec updated, ADR records the
  correction.
- Cold-cache degradation (spec §4): no new code needed — `loadChain` already
  fails soft in the LSP (`try/catch` around profile load leaves `profile`
  undefined → `seedDeliveredCorpus` no-ops), and re-seeding rides the existing
  profile-reload watcher. Covered by Task 9 wiring.
