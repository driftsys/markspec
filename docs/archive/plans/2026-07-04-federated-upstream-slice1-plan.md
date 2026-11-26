# Federated Upstream Resolution — Slice 1: Origin + Hydration Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the pure-core foundation for cross-repo references: the
`EntryOrigin` discriminated union, entry hydration from compiled-JSON snapshots,
and `loadUpstreamCorpus` with the authoritative-source rule.

**Architecture:** Slice 1 of the federated-upstream-resolution design
(`docs/wip/2026-07-04-federated-upstream-resolution-design.md`, §4.5 + D10).
Everything here is pure core — no network, no git, no Deno APIs beyond an
injected `readFile`. Fetchers and lockfile integration come in slices 2–3;
nothing in this slice is wired into CLI/LSP/MCP yet (that is slice 4).

**Tech Stack:** Deno/TypeScript strict, `@std/assert`, colocated unit tests
(`<module>_test.ts`), Conventional Commits.

## Global Constraints

- Work in a git worktree (repo rule). After `git worktree add`, run
  `./bootstrap` and verify `ls grammars/*.wasm` lists 9 files; if not, run
  `deno task fetch-grammars` or copy from the main checkout.
- Core must stay Node-compatible: no `Deno.*` in `packages/markspec/core/`
  library code — file access only via injected `readFile`.
- Zero warnings from `deno check` / `deno lint` / tests.
- Format before committing: `deno fmt` (TS) — and `dprint fmt` for the two
  `docs/wip/*.md` files.
- Conventional Commits, imperative mood, scope `core` for everything under
  `packages/markspec/core/`.
- Commit messages with backticks: write the message to the scratchpad and use
  `git commit -F <file>` (harness heredoc limitation).
- `deno check` entry points:
  `deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts`

## Task 0: Worktree setup + carry the spec/plan

**Files:**

- Create: worktree at `.claude/worktrees/federated-upstream-slice1` (or
  EnterWorktree tool), branch `feat/federated-upstream-slice1`
- Add: `docs/wip/2026-07-04-federated-upstream-resolution-design.md`,
  `docs/wip/2026-07-04-federated-upstream-slice1-plan.md`

- [ ] **Step 1: Create the worktree and bootstrap**

Run (from the main checkout):

```bash
git worktree add .claude/worktrees/federated-upstream-slice1 -b feat/federated-upstream-slice1
cd .claude/worktrees/federated-upstream-slice1
./bootstrap
ls grammars/*.wasm | wc -l   # expected: 9
```

If the count is not 9:
`cp /Users/sebastientasson/Workspace/driftsys/markspec/grammars/*.wasm grammars/`

- [ ] **Step 2: Copy the two docs/wip files into the worktree and commit**

```bash
mkdir -p docs/wip
cp /Users/sebastientasson/Workspace/driftsys/markspec/docs/wip/2026-07-04-federated-upstream-*.md docs/wip/
git add docs/wip/
git commit -m "docs(core): add federated-upstream design spec and slice-1 plan"
```

(Bash tool note: `cd` into the worktree in the first Bash call of every session;
file tools must use absolute worktree paths.)

## Task 1: `EntryOrigin` discriminated union

**Files:**

- Modify: `packages/markspec/core/model/mod.ts` (the `EntryOrigin` interface at
  ~line 427 and `formatEntryOrigin` at ~line 440)
- Modify: `packages/markspec/core/validator/corpus.ts:90,106` (the two
  `.profileId` comparisons)
- Modify: `packages/markspec/core/mod.ts` (barrel: add `sameOriginSource`)
- Test: `packages/markspec/core/model/entry_origin_test.ts` (exists — extend)

**Interfaces:**

- Consumes: existing `EntryOrigin` interface, `formatEntryOrigin`.
- Produces (later tasks + slices rely on these exact shapes):

  ```ts
  export type EntryOrigin =
    | {
      readonly kind: "profile";
      readonly profileId: string;
      readonly profileVersion: string;
    }
    | {
      readonly kind: "upstream";
      readonly upstreamId: string;
      readonly version: string;
    };
  export function formatEntryOrigin(origin: EntryOrigin): string;
  export function sameOriginSource(a: EntryOrigin, b: EntryOrigin): boolean;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `packages/markspec/core/model/entry_origin_test.ts`:

```ts
Deno.test("formatEntryOrigin: upstream origin renders id@version", () => {
  const origin: EntryOrigin = {
    kind: "upstream",
    upstreamId: "product",
    version: "v2.1.0",
  };
  assertEquals(formatEntryOrigin(origin), "product@v2.1.0");
});

Deno.test("sameOriginSource: same profile id, different version → true", () => {
  const a: EntryOrigin = {
    kind: "profile",
    profileId: "@acme/safety",
    profileVersion: "1.0.0",
  };
  const b: EntryOrigin = {
    kind: "profile",
    profileId: "@acme/safety",
    profileVersion: "2.0.0",
  };
  assertEquals(sameOriginSource(a, b), true);
});

Deno.test("sameOriginSource: different upstream ids → false", () => {
  const a: EntryOrigin = {
    kind: "upstream",
    upstreamId: "product",
    version: "v1",
  };
  const b: EntryOrigin = { kind: "upstream", upstreamId: "icd", version: "v1" };
  assertEquals(sameOriginSource(a, b), false);
});

Deno.test("sameOriginSource: profile vs upstream → false", () => {
  const a: EntryOrigin = {
    kind: "profile",
    profileId: "product",
    profileVersion: "1",
  };
  const b: EntryOrigin = { kind: "upstream", upstreamId: "product", version: "1" };
  assertEquals(sameOriginSource(a, b), false);
});
```

Add `sameOriginSource` to the test file's import from `./mod.ts`.

- [ ] **Step 2: Run tests to verify failure**

Run: `deno test packages/markspec/core/model/entry_origin_test.ts` Expected:
FAIL — `sameOriginSource` not exported; upstream literal not assignable to
`EntryOrigin`.

- [ ] **Step 3: Implement the union in `core/model/mod.ts`**

Replace the `EntryOrigin` interface and `formatEntryOrigin` (keep the existing
doc comments, extend them):

```ts
export type EntryOrigin =
  | {
    readonly kind: "profile";
    readonly profileId: string;
    readonly profileVersion: string;
  }
  | {
    readonly kind: "upstream";
    readonly upstreamId: string;
    readonly version: string;
  };

export function formatEntryOrigin(origin: EntryOrigin): string {
  switch (origin.kind) {
    case "profile":
      return `${origin.profileId}@${origin.profileVersion}`;
    case "upstream":
      return `${origin.upstreamId}@${origin.version}`;
  }
}

/**
 * Whether two origins come from the same source (same profile id or same
 * upstream id), ignoring versions. Used by the corpus collision pass to
 * decide "same owner" — version bumps must not split ownership.
 */
export function sameOriginSource(a: EntryOrigin, b: EntryOrigin): boolean {
  if (a.kind === "profile" && b.kind === "profile") {
    return a.profileId === b.profileId;
  }
  if (a.kind === "upstream" && b.kind === "upstream") {
    return a.upstreamId === b.upstreamId;
  }
  return false;
}
```

- [ ] **Step 4: Fix the two narrowing sites in `core/validator/corpus.ts`**

Line ~90: replace `displayOwner.origin!.profileId !== e.origin.profileId` with
`!sameOriginSource(displayOwner.origin!, e.origin)`.

Line ~106: replace `idOwner.origin!.profileId !== e.origin.profileId` with
`!sameOriginSource(idOwner.origin!, e.origin)`.

Add `sameOriginSource` to the file's import from `../model/mod.ts`.

- [ ] **Step 5: Export from the barrel**

In `packages/markspec/core/mod.ts`, add `sameOriginSource` next to the existing
`formatEntryOrigin` export.

- [ ] **Step 6: Type-check the workspace and run the model + validator tests**

Run:

```bash
deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts
deno test packages/markspec/core/model/ packages/markspec/core/validator/ --allow-read --allow-write --allow-env
```

Expected: check clean (every other consumer uses `formatEntryOrigin`, which
still narrows internally); all tests PASS. If `deno check` reports further
`.profileId` accesses on `EntryOrigin`, fix each with `sameOriginSource` or a
`kind === "profile"` narrow — do not cast.

- [ ] **Step 7: Commit**

```bash
deno fmt packages/markspec/core/
git add -A packages/markspec/core/
git commit -m "feat(core): EntryOrigin discriminated union with upstream kind"
```

## Task 2: `deserializeEntry` — inverse of `serializeEntry`

**Files:**

- Create: `packages/markspec/core/compiler/deserialize.ts`
- Test: `packages/markspec/core/compiler/deserialize_test.ts`

**Interfaces:**

- Consumes: `SerializedEntry`, `serializeEntry` from `./schema.ts`; `Entry` from
  `../model/mod.ts`.
- Produces:

  ```ts
  export function deserializeEntry(s: SerializedEntry): Entry;
  ```

  Contract: `deserializeEntry(JSON.parse(JSON.stringify(serializeEntry(e))))`
  deep-equals `e` for entries without `properties.sync` (which serialization
  strips by design). `typedAttributes` is rebuilt as a `Map`; an absent
  serialized field becomes an empty `Map`. `origin` passes through verbatim —
  the authoritative-source skip is the loader's job (Task 4), not the
  deserializer's.

- [ ] **Step 1: Write the failing round-trip test**

Create `packages/markspec/core/compiler/deserialize_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { parseFile } from "../parser/mod.ts";
import { serializeEntry } from "./schema.ts";
import { deserializeEntry } from "./deserialize.ts";

const FIXTURE = `# Sample

- [STK_0001] Braking distance

  The system shall stop the vehicle within 40 m from 100 km/h.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Labels: ASIL-B

- [SYS_0001] Threat assessment

  The system shall compute a threat level within 200 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Satisfies: STK_0001
`;

Deno.test("deserializeEntry: JSON wire round-trip preserves the entry", async () => {
  const { entries } = await parseFile(FIXTURE, { file: "/proj/sample.md" });
  for (const entry of entries) {
    const wire = JSON.parse(JSON.stringify(serializeEntry(entry)));
    assertEquals(deserializeEntry(wire), entry);
  }
});

Deno.test("deserializeEntry: origin passes through verbatim", async () => {
  const { entries } = await parseFile(FIXTURE, { file: "/proj/sample.md" });
  const withOrigin = {
    ...entries[0],
    origin: {
      kind: "upstream" as const,
      upstreamId: "product",
      version: "v1.0.0",
    },
  };
  const wire = JSON.parse(JSON.stringify(serializeEntry(withOrigin)));
  assertEquals(deserializeEntry(wire).origin, withOrigin.origin);
});
```

Note: if `parseFile` lives elsewhere or takes different options, mirror the
usage in `packages/markspec/lsp/workspace.ts` (`parseFile(content, { file })`
imported from `core/mod.ts`) — import from the internal module path within core.

- [ ] **Step 2: Run to verify failure**

Run:
`deno test packages/markspec/core/compiler/deserialize_test.ts --allow-read --allow-env`
Expected: FAIL — module `./deserialize.ts` not found.

- [ ] **Step 3: Implement `deserialize.ts`**

```ts
/**
 * @module compiler/deserialize
 *
 * Hydration of compiled-JSON snapshots back into core {@linkcode Entry}
 * values — the inverse of `./schema.ts`. Consumed by the upstream corpus
 * loader (`core/upstream/`): a dependency's or reference's published
 * compile output is deserialized here before joining the consumer's graph.
 *
 * Pure module: no I/O, no Deno APIs.
 */

import type { Entry } from "../model/mod.ts";
import type { SerializedEntry } from "./schema.ts";

/**
 * Rebuild an {@linkcode Entry} from its serialized wire form. Inverse of
 * `serializeEntry`: restores `typedAttributes` from a plain record to a
 * `Map` (absent → empty). All other fields — including `origin` — pass
 * through verbatim.
 */
export function deserializeEntry(s: SerializedEntry): Entry {
  const { typedAttributes, ...rest } = s;
  return {
    ...rest,
    typedAttributes: new Map(Object.entries(typedAttributes ?? {})),
  } as Entry;
}
```

If the round-trip test reveals field-presence mismatches (e.g. the original
entry has an absent optional key that survives as `undefined`), normalize in
`deserializeEntry` by deleting `undefined`-valued keys before returning — match
whatever the test shows; the contract is deep-equality with the
pre-serialization entry.

- [ ] **Step 4: Run to verify pass**

Run:
`deno test packages/markspec/core/compiler/deserialize_test.ts --allow-read --allow-env`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
deno fmt packages/markspec/core/compiler/
git add packages/markspec/core/compiler/deserialize.ts packages/markspec/core/compiler/deserialize_test.ts
git commit -m "feat(core): deserializeEntry inverse of serializeEntry"
```

## Task 3: Snapshot schema guard + compiled/NDJSON entry extraction

**Files:**

- Modify: `packages/markspec/core/compiler/deserialize.ts`
- Test: `packages/markspec/core/compiler/deserialize_test.ts` (extend)

**Interfaces:**

- Consumes: `ManifestJson` shape from `./manifest.ts` (`markspecSchemaVersion`,
  `generator.coreSchema`, `entries` block); `Diagnostic` from `../model/mod.ts`;
  `CORE_SCHEMA_VERSION` (find with
  `grep -rn "CORE_SCHEMA_VERSION" packages/markspec/core/ --include="*.ts" | grep -v test | grep "="`
  and import from its defining module, not the barrel).
- Produces:

  ```ts
  export function checkSnapshotSchema(
    manifest: unknown,
    manifestPath: string,
  ): Diagnostic | undefined;
  export function extractSerializedEntries(
    manifest: unknown,
    readSnapshotFile: (relPath: string) => string | undefined,
    manifestPath: string,
  ): { entries: SerializedEntry[]; diagnostics: Diagnostic[] };
  ```

  `extractSerializedEntries` follows the manifest's `entries` block: `inline` →
  parse `compiled.json` and take `Object.values(json.entries)`; `ndjson` → split
  the file on newlines, `JSON.parse` each non-empty line. Diagnostic codes
  (loader-family, following the `PROFILE-DELIVERS-00x` precedent):
  `UPSTREAM-SNAPSHOT-001` schema skew (error), `UPSTREAM-SNAPSHOT-002`
  missing/unreadable snapshot file (error), `UPSTREAM-SNAPSHOT-003` malformed
  JSON (error).

- [ ] **Step 1: Write the failing tests**

Append to `deserialize_test.ts`:

```ts
import { checkSnapshotSchema, extractSerializedEntries } from "./deserialize.ts";

const GOOD_MANIFEST = {
  markspecSchemaVersion: 1,
  generator: { release: "0.0.0-test", coreSchema: 1 },
  project: { name: "up", root: "/up" },
  counts: { entries: 1, edges: 0, byType: {} },
  entries: { format: "inline", file: "compiled.json" },
  edges: { format: "inline", file: "compiled.json" },
  sqliteMirror: null,
  federation: [],
  reserved: {},
};

Deno.test("checkSnapshotSchema: matching versions → undefined", () => {
  assertEquals(checkSnapshotSchema(GOOD_MANIFEST, "/c/manifest.json"), undefined);
});

Deno.test("checkSnapshotSchema: core-schema skew → UPSTREAM-SNAPSHOT-001", () => {
  const skewed = { ...GOOD_MANIFEST, generator: { release: "9", coreSchema: 99 } };
  const d = checkSnapshotSchema(skewed, "/c/manifest.json");
  assertEquals(d?.code, "UPSTREAM-SNAPSHOT-001");
  assertEquals(d?.severity, "error");
});

Deno.test("extractSerializedEntries: inline compiled.json", async () => {
  const { entries } = await parseFile(FIXTURE, { file: "/up/sample.md" });
  const compiled = JSON.stringify({
    entries: Object.fromEntries(
      entries.map((e) => [e.displayId, serializeEntry(e)]),
    ),
  });
  const result = extractSerializedEntries(
    GOOD_MANIFEST,
    (rel) => (rel === "compiled.json" ? compiled : undefined),
    "/c/manifest.json",
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.entries.length, 2);
});

Deno.test("extractSerializedEntries: ndjson block", async () => {
  const { entries } = await parseFile(FIXTURE, { file: "/up/sample.md" });
  const ndjson = entries.map((e) => JSON.stringify(serializeEntry(e))).join("\n") + "\n";
  const manifest = {
    ...GOOD_MANIFEST,
    entries: { format: "ndjson", file: "entries.ndjson", index: "entries.idx" },
  };
  const result = extractSerializedEntries(
    manifest,
    (rel) => (rel === "entries.ndjson" ? ndjson : undefined),
    "/c/manifest.json",
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.entries.length, 2);
});

Deno.test("extractSerializedEntries: missing snapshot file → UPSTREAM-SNAPSHOT-002", () => {
  const result = extractSerializedEntries(
    GOOD_MANIFEST,
    () => undefined,
    "/c/manifest.json",
  );
  assertEquals(result.entries, []);
  assertEquals(result.diagnostics[0]?.code, "UPSTREAM-SNAPSHOT-002");
});
```

- [ ] **Step 2: Run to verify failure**

Run:
`deno test packages/markspec/core/compiler/deserialize_test.ts --allow-read --allow-env`
Expected: FAIL — `checkSnapshotSchema` / `extractSerializedEntries` not
exported.

- [ ] **Step 3: Implement in `deserialize.ts`**

```ts
/** Result of {@linkcode extractSerializedEntries}. */
export interface ExtractedEntries {
  readonly entries: SerializedEntry[];
  readonly diagnostics: Diagnostic[];
}

/**
 * Reject a snapshot whose schema versions don't match this build — a
 * skewed snapshot must never silently misparse. Returns the diagnostic to
 * publish, or `undefined` when the snapshot is compatible.
 */
export function checkSnapshotSchema(
  manifest: unknown,
  manifestPath: string,
): Diagnostic | undefined {
  const m = manifest as {
    markspecSchemaVersion?: unknown;
    generator?: { coreSchema?: unknown };
  };
  if (
    m?.markspecSchemaVersion === 1 &&
    m?.generator?.coreSchema === CORE_SCHEMA_VERSION
  ) {
    return undefined;
  }
  return {
    code: "UPSTREAM-SNAPSHOT-001",
    severity: "error",
    message:
      `upstream snapshot schema mismatch (manifest v${String(m?.markspecSchemaVersion)}, ` +
      `core-schema ${String(m?.generator?.coreSchema)} vs expected 1/${CORE_SCHEMA_VERSION}); ` +
      `re-run 'markspec lock' with a compatible markspec version`,
    location: { file: manifestPath, line: 1, column: 1 },
  };
}

/**
 * Follow the manifest's `entries` block and return the raw serialized
 * entries. `readSnapshotFile` resolves a path relative to the snapshot
 * directory (injected — this module does no I/O).
 */
export function extractSerializedEntries(
  manifest: unknown,
  readSnapshotFile: (relPath: string) => string | undefined,
  manifestPath: string,
): ExtractedEntries {
  const diagnostics: Diagnostic[] = [];
  const block = (manifest as { entries?: { format?: string; file?: string } })
    ?.entries;
  const file = block?.file;
  if (!file || (block?.format !== "inline" && block?.format !== "ndjson")) {
    diagnostics.push(malformed(manifestPath, "manifest entries block missing or unknown format"));
    return { entries: [], diagnostics };
  }
  const raw = readSnapshotFile(file);
  if (raw === undefined) {
    diagnostics.push({
      code: "UPSTREAM-SNAPSHOT-002",
      severity: "error",
      message:
        `upstream snapshot file '${file}' is missing or unreadable; ` +
        `run 'markspec lock' to restore the cache`,
      location: { file: manifestPath, line: 1, column: 1 },
    });
    return { entries: [], diagnostics };
  }
  try {
    if (block.format === "inline") {
      const json = JSON.parse(raw) as { entries?: Record<string, SerializedEntry> };
      return { entries: Object.values(json.entries ?? {}), diagnostics };
    }
    const entries = raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as SerializedEntry);
    return { entries, diagnostics };
  } catch (err) {
    diagnostics.push(malformed(
      manifestPath,
      `snapshot file '${file}' is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    ));
    return { entries: [], diagnostics };
  }
}

function malformed(file: string, detail: string): Diagnostic {
  return {
    code: "UPSTREAM-SNAPSHOT-003",
    severity: "error",
    message: `malformed upstream snapshot: ${detail}`,
    location: { file, line: 1, column: 1 },
  };
}
```

Add the imports: `Diagnostic` (type) from `../model/mod.ts` and
`CORE_SCHEMA_VERSION` from the module the grep in **Interfaces** located.

- [ ] **Step 4: Run to verify pass**

Run:
`deno test packages/markspec/core/compiler/deserialize_test.ts --allow-read --allow-env`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
deno fmt packages/markspec/core/compiler/
git add packages/markspec/core/compiler/
git commit -m "feat(core): snapshot schema guard and serialized-entry extraction"
```

## Task 4: `loadUpstreamCorpus` with the authoritative-source rule

**Files:**

- Create: `packages/markspec/core/upstream/mod.ts`
- Test: `packages/markspec/core/upstream/mod_test.ts`

**Interfaces:**

- Consumes: `deserializeEntry`, `checkSnapshotSchema`,
  `extractSerializedEntries` (Tasks 2–3); `Entry`, `Diagnostic` from
  `../model/mod.ts`.
- Produces (slice 2's lock command and slice 4's feed sites consume these):

  ```ts
  /** One locked upstream's cached snapshot (dir written by `markspec lock`). */
  export interface UpstreamSnapshotRef {
    readonly id: string; // projectRef name — cache dir, badges
    readonly version: string; // resolved version label (tag/branch@sha)
    readonly dir: string; // absolute path to .markspec/cache/upstreams/<id>
  }
  export interface LoadUpstreamCorpusResult {
    readonly entries: Entry[];
    readonly diagnostics: Diagnostic[];
  }
  export type ReadFile = (path: string) => Promise<string | undefined>;
  export async function loadUpstreamCorpus(
    upstreams: readonly UpstreamSnapshotRef[],
    readFile: ReadFile,
  ): Promise<LoadUpstreamCorpusResult>;
  ```

  Behavior: per upstream, read `<dir>/manifest.json` (missing → 002, bad JSON →
  003, skew → 001; skip that upstream, keep going); extract entries; **skip any
  serialized entry that already carries an `origin`** (authoritative-source
  rule, design §4.5); stamp the rest with
  `origin = { kind: "upstream", upstreamId: id, version }`.

- [ ] **Step 1: Write the failing tests**

Create `packages/markspec/core/upstream/mod_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { parseFile } from "../parser/mod.ts";
import { serializeEntry } from "../compiler/schema.ts";
import { loadUpstreamCorpus } from "./mod.ts";

const UP_A_MD = `# A

- [SYS_0001] Threat assessment

  The system shall compute a threat level within 200 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`;

async function snapshotFiles(
  dir: string,
  md: string,
  file: string,
  reexport?: { upstreamId: string; version: string },
): Promise<Map<string, string>> {
  const { entries } = await parseFile(md, { file });
  const serialized = entries.map((e) =>
    serializeEntry(
      reexport ? { ...e, origin: { kind: "upstream" as const, ...reexport } } : e,
    )
  );
  const manifest = {
    markspecSchemaVersion: 1,
    generator: { release: "0.0.0-test", coreSchema: 1 },
    project: { name: "up", root: "/up" },
    counts: { entries: serialized.length, edges: 0, byType: {} },
    entries: { format: "inline", file: "compiled.json" },
    edges: { format: "inline", file: "compiled.json" },
    sqliteMirror: null,
    federation: [],
    reserved: {},
  };
  const compiled = {
    entries: Object.fromEntries(serialized.map((s) => [s.displayId, s])),
  };
  return new Map([
    [`${dir}/manifest.json`, JSON.stringify(manifest)],
    [`${dir}/compiled.json`, JSON.stringify(compiled)],
  ]);
}

function readerFor(files: Map<string, string>) {
  return (path: string) => Promise.resolve(files.get(path));
}

Deno.test("loadUpstreamCorpus: hydrates and stamps upstream origin", async () => {
  const files = await snapshotFiles("/c/up/product", UP_A_MD, "/up/a.md");
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: "/c/up/product" }],
    readerFor(files),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.entries.length, 1);
  assertEquals(result.entries[0].displayId, "SYS_0001");
  assertEquals(result.entries[0].origin, {
    kind: "upstream",
    upstreamId: "product",
    version: "v2.1.0",
  });
});

Deno.test("loadUpstreamCorpus: authoritative-source rule skips re-exports", async () => {
  // product's snapshot re-exports an entry it pulled from 'icd' — skip it.
  const files = await snapshotFiles("/c/up/product", UP_A_MD, "/up/a.md", {
    upstreamId: "icd",
    version: "v1.0.0",
  });
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: "/c/up/product" }],
    readerFor(files),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.entries, []);
});

Deno.test("loadUpstreamCorpus: missing manifest → 002, other upstreams still load", async () => {
  const files = await snapshotFiles("/c/up/product", UP_A_MD, "/up/a.md");
  const result = await loadUpstreamCorpus(
    [
      { id: "ghost", version: "v0", dir: "/c/up/ghost" },
      { id: "product", version: "v2.1.0", dir: "/c/up/product" },
    ],
    readerFor(files),
  );
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "UPSTREAM-SNAPSHOT-002");
  assertEquals(result.entries.length, 1);
});

Deno.test("loadUpstreamCorpus: schema skew → 001, upstream skipped", async () => {
  const files = await snapshotFiles("/c/up/product", UP_A_MD, "/up/a.md");
  const manifest = JSON.parse(files.get("/c/up/product/manifest.json")!);
  manifest.generator.coreSchema = 99;
  files.set("/c/up/product/manifest.json", JSON.stringify(manifest));
  const result = await loadUpstreamCorpus(
    [{ id: "product", version: "v2.1.0", dir: "/c/up/product" }],
    readerFor(files),
  );
  assertEquals(result.diagnostics[0].code, "UPSTREAM-SNAPSHOT-001");
  assertEquals(result.entries, []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test packages/markspec/core/upstream/ --allow-read --allow-env`
Expected: FAIL — module `./mod.ts` not found.

- [ ] **Step 3: Implement `core/upstream/mod.ts`**

```ts
/**
 * @module upstream
 *
 * Upstream corpus loader — hydrates the cached compiled-JSON snapshots
 * that `markspec lock` writes under `.markspec/cache/upstreams/<id>/`
 * into read-only graph citizens carrying an `upstream` origin.
 *
 * Design: docs/wip/2026-07-04-federated-upstream-resolution-design.md §4.5.
 * Sibling of `core/profile/delivered.ts` (`loadDeliveredCorpus`), same
 * purity rules: no I/O of its own — file access via the injected
 * {@linkcode ReadFile}.
 */

import type { Diagnostic, Entry } from "../model/mod.ts";
import {
  checkSnapshotSchema,
  deserializeEntry,
  extractSerializedEntries,
} from "../compiler/deserialize.ts";

/** One locked upstream's cached snapshot (dir written by `markspec lock`). */
export interface UpstreamSnapshotRef {
  /** projectRef `name` — cache directory, lockfile rows, origin badges. */
  readonly id: string;
  /** Resolved version label recorded by the lockfile (e.g. `v2.1.0`). */
  readonly version: string;
  /** Absolute path to `.markspec/cache/upstreams/<id>`. */
  readonly dir: string;
}

/** Result of {@linkcode loadUpstreamCorpus}. */
export interface LoadUpstreamCorpusResult {
  readonly entries: Entry[];
  readonly diagnostics: Diagnostic[];
}

/** File reader injected by the caller (CLI/LSP own the I/O). */
export type ReadFile = (path: string) => Promise<string | undefined>;

/**
 * Hydrate every locked upstream's cached snapshot into `Entry[]`.
 *
 * Per upstream: read `<dir>/manifest.json`, reject schema skew
 * (UPSTREAM-SNAPSHOT-001), extract the serialized entries, and stamp each
 * with `origin = { kind: "upstream", upstreamId, version }`.
 *
 * Authoritative-source rule (design §4.5): a snapshot entry that already
 * carries an `origin` is a re-export of some other source's entry (the
 * upstream's own corpus or its upstreams) and is skipped — every entry
 * joins an aggregate only from its authoring project. A failing upstream
 * contributes diagnostics but never aborts the others.
 */
export async function loadUpstreamCorpus(
  upstreams: readonly UpstreamSnapshotRef[],
  readFile: ReadFile,
): Promise<LoadUpstreamCorpusResult> {
  const entries: Entry[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const up of upstreams) {
    const manifestPath = `${up.dir}/manifest.json`;
    const manifestRaw = await readFile(manifestPath);
    if (manifestRaw === undefined) {
      diagnostics.push({
        code: "UPSTREAM-SNAPSHOT-002",
        severity: "error",
        message:
          `upstream '${up.id}' snapshot manifest is missing or unreadable; ` +
          `run 'markspec lock' to restore the cache`,
        location: { file: manifestPath, line: 1, column: 1 },
      });
      continue;
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch (err) {
      diagnostics.push({
        code: "UPSTREAM-SNAPSHOT-003",
        severity: "error",
        message: `malformed upstream snapshot: manifest is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
        location: { file: manifestPath, line: 1, column: 1 },
      });
      continue;
    }
    const skew = checkSnapshotSchema(manifest, manifestPath);
    if (skew) {
      diagnostics.push(skew);
      continue;
    }
    // Snapshot files are read relative to the upstream's cache dir. The
    // extractor is sync; pre-read the single file the manifest points at.
    const block = (manifest as { entries?: { file?: string } }).entries;
    const relFile = block?.file;
    const snapshotContent = relFile !== undefined
      ? await readFile(`${up.dir}/${relFile}`)
      : undefined;
    const extracted = extractSerializedEntries(
      manifest,
      (rel) => (rel === relFile ? snapshotContent : undefined),
      manifestPath,
    );
    diagnostics.push(...extracted.diagnostics);
    for (const s of extracted.entries) {
      if (s.origin !== undefined) continue; // authoritative-source rule
      const entry = deserializeEntry(s);
      entries.push({
        ...entry,
        origin: { kind: "upstream", upstreamId: up.id, version: up.version },
      });
    }
  }
  return { entries, diagnostics };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `deno test packages/markspec/core/upstream/ --allow-read --allow-env`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
deno fmt packages/markspec/core/upstream/
git add packages/markspec/core/upstream/
git commit -m "feat(core): loadUpstreamCorpus with authoritative-source rule"
```

## Task 5: Barrel exports + full gate

**Files:**

- Modify: `packages/markspec/core/mod.ts`

**Interfaces:**

- Produces (the public API slices 2/4 import from `core/mod.ts`):
  `loadUpstreamCorpus`, `UpstreamSnapshotRef` (type), `LoadUpstreamCorpusResult`
  (type), `deserializeEntry`, `checkSnapshotSchema`, `extractSerializedEntries`,
  `sameOriginSource` (already exported in Task 1).

- [ ] **Step 1: Add the exports**

In `packages/markspec/core/mod.ts`, following the existing grouping style (value
exports and `export type` blocks), add:

```ts
export {
  checkSnapshotSchema,
  deserializeEntry,
  extractSerializedEntries,
} from "./compiler/deserialize.ts";
export { loadUpstreamCorpus } from "./upstream/mod.ts";
export type {
  LoadUpstreamCorpusResult,
  UpstreamSnapshotRef,
} from "./upstream/mod.ts";
```

(Match the barrel's actual conventions — if it re-exports via grouped
`export { … } from` lists per module, extend those lists instead.)

- [ ] **Step 2: Run the full gate**

Run:

```bash
just fmt
just check
```

Expected: lint clean, type-check clean, all tests pass. Fix anything red before
proceeding (zero-warnings rule).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(core): export upstream corpus loader from the core barrel"
```

## Task 6: PR

- [ ] **Step 1: Push and open the PR**

Write the PR body to the scratchpad first (backtick-safe), then:

```bash
git push -u origin feat/federated-upstream-slice1   # ≥300s timeout: pre-push hook runs full just check
gh pr create --title "feat(core): federated upstream slice 1 — origin union + snapshot hydration" --body-file <scratchpad>/pr-body.md
```

PR body must state: slice 1 of the federated-upstream design
(`docs/wip/2026-07-04-federated-upstream-resolution-design.md`), pure core, no
behavior wired into CLI/LSP/MCP yet; list the new public API. There is no
tracking issue yet — no `Closes #N` line (or file the epic/story issues first if
the user wants issue tracking, and reference the story).

- [ ] **Step 2: Run `/review` on the PR and post findings as a PR comment**
      (repo rule).

## Self-review notes (against the design spec)

- Spec §4.5 EntryOrigin union → Task 1. `formatEntryOrigin` switch → Task 1.
- Spec §4.5 `deserializeCompileResult` is delivered as `deserializeEntry` +
  `extractSerializedEntries` (entries are the only consumed payload —
  links/forward/reverse are rebuilt by the consumer's compile; YAGNI on
  hydrating them). Slice 4 revisits if the root graph needs upstream links
  directly.
- Spec §4.5 skew guard → Task 3 (UPSTREAM-SNAPSHOT-001).
- Spec §4.5 authoritative-source rule → Task 4 (skip + dedicated test, including
  the diamond re-export case).
- Spec D10 purity → no Deno APIs anywhere in the new modules; injected
  `ReadFile`.
- NOT in this slice (per spec slicing): project.yaml parsing, lockfile rows,
  fetchers, feed sites, validator changes, LSP/MCP — slices 2–5.
