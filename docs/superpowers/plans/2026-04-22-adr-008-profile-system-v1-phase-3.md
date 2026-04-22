# ADR-008 Profile System v1 — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `extends:` chain resolution + merge semantics so a leaf profile
can extend a parent profile and the combined rules resolve into one
`EffectiveProfile` with per-rule provenance.

**Architecture:** `loadChain` grows to walk `extends:` (cycle-detecting,
depth-limited) and produce a multi-tier `ProfileChain`. A new
`core/profile/merge.ts` module then folds the chain (root → leaf) into an
`EffectiveProfile`, applying three rule families: **additive** (union lists),
**tightening** (child may narrow, never relax), **subset** (traceability targets
must be ⊆ parent's). Violations surface as `PROFILE-MERGE-001` /
`PROFILE-MERGE-002`; cycle/depth failures as `PROFILE-LOAD-004` /
`PROFILE-LOAD-005`. Merge happens once at load.

**Tech Stack:** Deno + TypeScript, `@std/assert`. Builds on Phase 1's
`parseManifest` and Phase 2's `loadChain` + `resolveLocalSpecifier`.

**Spec:**
[docs/superpowers/specs/2026-04-21-adr-008-profile-system-v1-design.md](../specs/2026-04-21-adr-008-profile-system-v1-design.md)
§3 (profile chain + merge semantics).

**Branch:** `feat/profile-system-phase-3`, stacked on
`feat/profile-system-phase-1` (which carries merged Phase 2 content via PR #228,
bridging to main via #229).

---

## Scope

### In Phase 3

- **`EffectiveProfile` type** with `ProvenancedValue<T>` / `ProvenancedMap<V>`
  wrappers preserving per-rule origin.
- **Chain walking**: `loadChain` follows `extends:` pointers, detects cycles,
  enforces depth limit 20. Local specifiers only (git still stubbed — Phase 4).
- **`core/profile/merge.ts`** module implementing the three merge families
  (additive / tightening / subset).
- **`ProfileChain.effective`** field populated by merge. Multi-tier chains work
  end-to-end.
- **Diagnostics**: `PROFILE-LOAD-004` (cycle), `PROFILE-LOAD-005` (too deep),
  `PROFILE-MERGE-001` (relaxation), `PROFILE-MERGE-002` (target not subset).

### Deferred (not Phase 3)

- Git specifier resolution + cache — Phase 4.
- Validator pipeline stages consuming the `EffectiveProfile` — Phases 5–7.
- Generated inverses — Phase 8.
- CLI `profile add` / `doctor` — Phase 9.

### Diagnostic codes introduced in Phase 3

| Code                | Severity | Meaning                                                   |
| ------------------- | -------- | --------------------------------------------------------- |
| `PROFILE-LOAD-004`  | error    | `extends:` cycle detected in chain                        |
| `PROFILE-LOAD-005`  | error    | `extends:` chain exceeds maximum depth (20)               |
| `PROFILE-MERGE-001` | error    | Child tier relaxes a constraint set by a parent tier      |
| `PROFILE-MERGE-002` | error    | Child tier's traceability target not a subset of parent's |

---

## Files this PR creates or modifies

### New files

- `packages/markspec/core/profile/merge.ts` — merge implementation
  (additive/tightening/subset), returns `{ effective, diagnostics }`.
- `packages/markspec/core/profile/merge_test.ts` — unit tests.
- `tests/fixtures/profiles/phase3/base/markspec.yaml` — parent fixture for e2e
  tests.
- `tests/fixtures/profiles/phase3/child-valid/markspec.yaml` — valid child that
  tightens.
- `tests/fixtures/profiles/phase3/child-relaxation/markspec.yaml` — invalid
  child (relaxation).
- `tests/e2e/profile_merge_test.ts` — end-to-end tests through
  `markspec validate`.

### Modified files

- `packages/markspec/core/model/profile.ts` — add `EffectiveProfile`,
  `ProvenancedValue`, `ProvenancedMap`, `ProvenancedMapEntry`,
  `EffectiveShapeScope`, `EffectiveTypeDef`; add `effective: EffectiveProfile`
  to `ProfileChain`.
- `packages/markspec/core/model/mod.ts` — re-export the new types.
- `packages/markspec/core/profile/chain.ts` — walk `extends:`, detect cycle +
  depth, wire merge into result.
- `packages/markspec/core/profile/chain_test.ts` — add extends-walking tests.
- `packages/markspec/core/profile/mod.ts` — export `mergeChain` and
  `MergeResult`.
- `packages/markspec/core/mod.ts` — re-export the new merge API.

No changes to: `core/validator/**`, `core/compiler/**`, `core/parser/**`,
`main.ts` (CLI already wired; Phase 3 just produces a richer chain for it to
hold).

---

## Task overview

| #   | Task                                               | Files touched                                                                   |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| 3.1 | Effective profile + provenance types               | `model/profile.ts`, `model/mod.ts`                                              |
| 3.2 | Chain walks `extends:` (cycle + depth)             | `profile/chain.ts`, `profile/chain_test.ts`                                     |
| 3.3 | Merge scaffold — single-tier identity merge        | `profile/merge.ts`, `profile/merge_test.ts`                                     |
| 3.4 | Additive merge rules                               | `profile/merge.ts`, `profile/merge_test.ts`                                     |
| 3.5 | Attribute tightening (cardinality, enum, required) | `profile/merge.ts`, `profile/merge_test.ts`                                     |
| 3.6 | Type-level tightening (pattern, enforcement)       | `profile/merge.ts`, `profile/merge_test.ts`                                     |
| 3.7 | Traceability target subset rule                    | `profile/merge.ts`, `profile/merge_test.ts`                                     |
| 3.8 | Wire merge into loadChain + e2e tests              | `profile/chain.ts`, barrel exports, fixtures, `tests/e2e/profile_merge_test.ts` |

Each task is one commit. Every task follows TDD.

---

## Task 3.1 — Effective profile + provenance types

Add the types the merge module will populate. Pure declarations, no logic.

**Files:**

- Modify: `packages/markspec/core/model/profile.ts`
- Modify: `packages/markspec/core/model/mod.ts`

- [ ] **Step 1: Append the provenance + effective types to `model/profile.ts`**

Append to `packages/markspec/core/model/profile.ts` (after the existing
`ProfileChain` interface):

```typescript
// ---------------------------------------------------------------------------
// Runtime: effective profile (merged chain) + provenance wrappers
// ---------------------------------------------------------------------------

/** Identifier of the profile (tier) that contributed a value — `manifest.id`. */
export type ProfileId = string;

/** A single value annotated with the profile it originated from. */
export interface ProvenancedValue<T> {
  readonly value: T;
  readonly origin: ProfileId;
}

/**
 * A map-valued entry: the current effective value, the tier that set it, and
 * the ordered list of parent tiers whose values this entry narrowed or
 * replaced. Used for fields where children can override parents (attributes,
 * traceability rules, type definitions).
 */
export interface ProvenancedMapEntry<V> {
  readonly value: V;
  readonly origin: ProfileId;
  readonly overrides?: readonly ProfileId[];
}

/** Map with per-entry provenance. Keys are always strings (attr/type/link names). */
export type ProvenancedMap<V> = ReadonlyMap<string, ProvenancedMapEntry<V>>;

/** Shape-scope rules after merging (identified or referenced). */
export interface EffectiveShapeScope {
  readonly required: ProvenancedValue<readonly string[]>;
  readonly attributes: ProvenancedMap<AttrDecl>;
  /** Referenced scope's traceability is always empty (referenced entries don't originate links). */
  readonly traceability: ProvenancedMap<TraceRule>;
}

/** Type-scope rules after merging. */
export interface EffectiveTypeDef {
  readonly name: string;
  /** Shape is frozen at the type's declaration — never changes across the chain. */
  readonly shape: EntryShape;
  readonly displayIdPattern: ProvenancedValue<string | undefined>;
  readonly displayIdPatternEnforcement: ProvenancedValue<EnforcementMode>;
  readonly required: ProvenancedValue<readonly string[]>;
  readonly attributes: ProvenancedMap<AttrDecl>;
  readonly traceability: ProvenancedMap<TraceRule>;
}

/**
 * The merged, validator-ready view of a profile chain. Every field carries
 * per-rule provenance so a diagnostic can blame the right tier.
 */
export interface EffectiveProfile {
  readonly required: ProvenancedValue<readonly string[]>;
  readonly attributes: ProvenancedMap<AttrDecl>;
  readonly labels: ProvenancedValue<readonly string[]>;
  readonly identified: EffectiveShapeScope;
  readonly referenced: EffectiveShapeScope;
  readonly types: ProvenancedMap<EffectiveTypeDef>;
  readonly documents: {
    readonly types: ProvenancedMap<DocTypeDef>;
    readonly frontMatter: ProvenancedMap<AttrDecl>;
  };
}
```

- [ ] **Step 2: Add `effective` to `ProfileChain`**

Find the existing `ProfileChain` interface in the same file (added in Phase 2
Task 2.1) and add the `effective` field:

```typescript
export interface ProfileChain {
  readonly tiers: readonly LoadedProfile[];
  readonly effective: EffectiveProfile;
}
```

- [ ] **Step 3: Re-export from model barrel**

Modify `packages/markspec/core/model/mod.ts`. Find the
`export type { ... } from "./profile.ts"` block from Phase 2 and add the new
names (alphabetized):

```typescript
export type {
  AttrDecl,
  Cardinality,
  DocTypeDef,
  EffectiveProfile,
  EffectiveShapeScope,
  EffectiveTypeDef,
  EnforcementMode,
  InverseDecl,
  LoadedProfile,
  ProfileChain,
  ProfileId,
  ProfileManifest,
  ProfileSpecifier,
  ProvenancedMap,
  ProvenancedMapEntry,
  ProvenancedValue,
  TargetMatcher,
  TraceRule,
  TypeDef,
  ValueType,
} from "./profile.ts";
```

- [ ] **Step 4: Type-check**

Run:
`deno check packages/markspec/core/model/profile.ts packages/markspec/core/model/mod.ts`
Expected: FAIL — because `ProfileChain.effective` is required but `chain.ts`
currently returns a chain without it. Confirm the error mentions `effective`
missing. This is expected; Task 3.8 fixes the caller.

- [ ] **Step 5: Defensive placeholder in chain.ts (will be replaced in Task
      3.8)**

To keep the workspace compiling until Task 3.8, temporarily add a placeholder to
`packages/markspec/core/profile/chain.ts`. Find where the happy-path return
builds `{ chain: { tiers: [tier] }, diagnostics }`. Replace with:

```typescript
const placeholderEffective: EffectiveProfile = {
  required: { value: [], origin: tier.id },
  attributes: new Map(),
  labels: { value: [], origin: tier.id },
  identified: {
    required: { value: [], origin: tier.id },
    attributes: new Map(),
    traceability: new Map(),
  },
  referenced: {
    required: { value: [], origin: tier.id },
    attributes: new Map(),
    traceability: new Map(),
  },
  types: new Map(),
  documents: { types: new Map(), frontMatter: new Map() },
};
return {
  chain: { tiers: [tier], effective: placeholderEffective },
  diagnostics,
};
```

Add `EffectiveProfile` to the existing type imports at the top of `chain.ts`.
This placeholder is removed in Task 3.8 when real merge is wired.

- [ ] **Step 6: Run the full workspace test suite**

Run: `deno task test` Expected: all 354 tests pass. The placeholder doesn't
change observable behavior for existing tests — they don't inspect
`chain.effective`.

- [ ] **Step 7: Commit**

```bash
git add packages/markspec/core/model/profile.ts packages/markspec/core/model/mod.ts packages/markspec/core/profile/chain.ts
git commit -m "feat(core): EffectiveProfile + provenance types"
```

---

## Task 3.2 — Chain walks `extends:` (cycle + depth)

Teach `loadChain` to follow `manifest.extends` pointers, producing a multi-tier
chain ordered root → leaf. Detect cycles (`PROFILE-LOAD-004`), cap depth at 20
(`PROFILE-LOAD-005`). Local specifiers only; git still emits the Phase-4 stub
error.

**Files:**

- Modify: `packages/markspec/core/profile/chain.ts`
- Modify: `packages/markspec/core/profile/chain_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/markspec/core/profile/chain_test.ts`:

```typescript
Deno.test("loadChain: two-tier chain loads in root→leaf order", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/child" },
    "/project",
    mockReadFile({
      "/project/profiles/child/markspec.yaml":
        `id: "@acme/child"\nversion: 1.0.0\nextends: "../base"\n`,
      "/project/profiles/base/markspec.yaml":
        `id: "@acme/base"\nversion: 1.0.0\n`,
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 2);
  // tiers[0] = root parent, tiers[last] = leaf
  assertEquals(result.chain?.tiers[0].id, "@acme/base");
  assertEquals(result.chain?.tiers[1].id, "@acme/child");
});

Deno.test("loadChain: three-tier chain loads in order", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/leaf" },
    "/project",
    mockReadFile({
      "/project/profiles/leaf/markspec.yaml":
        `id: "@acme/leaf"\nversion: 1.0.0\nextends: "../mid"\n`,
      "/project/profiles/mid/markspec.yaml":
        `id: "@acme/mid"\nversion: 1.0.0\nextends: "../base"\n`,
      "/project/profiles/base/markspec.yaml":
        `id: "@acme/base"\nversion: 1.0.0\n`,
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.map((t) => t.id), [
    "@acme/base",
    "@acme/mid",
    "@acme/leaf",
  ]);
});

Deno.test("loadChain: direct cycle emits PROFILE-LOAD-004", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/a" },
    "/project",
    mockReadFile({
      "/project/profiles/a/markspec.yaml":
        `id: "@acme/a"\nversion: 1.0.0\nextends: "../b"\n`,
      "/project/profiles/b/markspec.yaml":
        `id: "@acme/b"\nversion: 1.0.0\nextends: "../a"\n`,
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-004");
});

Deno.test("loadChain: self-cycle emits PROFILE-LOAD-004", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/me" },
    "/project",
    mockReadFile({
      "/project/profiles/me/markspec.yaml":
        `id: "@acme/me"\nversion: 1.0.0\nextends: "."\n`,
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-004");
});

Deno.test("loadChain: depth beyond 20 emits PROFILE-LOAD-005", async () => {
  const files: Record<string, string> = {};
  // Build a 22-tier chain (leaf + 21 ancestors)
  for (let i = 0; i < 22; i++) {
    const id = `@acme/t${i}`;
    const extendsLine = i < 21 ? `\nextends: "../t${i + 1}"` : "";
    files[`/project/profiles/t${i}/markspec.yaml`] =
      `id: "${id}"\nversion: 1.0.0${extendsLine}\n`;
  }
  const result = await loadChain(
    { kind: "local", path: "./profiles/t0" },
    "/project",
    mockReadFile(files),
  );
  assertEquals(result.chain, null);
  assertEquals(
    result.diagnostics.find((d) => d.code === "PROFILE-LOAD-005") !==
      undefined,
    true,
  );
});

Deno.test("loadChain: extends of unresolvable parent propagates PROFILE-LOAD-001", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/leaf" },
    "/project",
    mockReadFile({
      "/project/profiles/leaf/markspec.yaml":
        `id: "@acme/leaf"\nversion: 1.0.0\nextends: "../missing"\n`,
      // no file at /project/profiles/missing/markspec.yaml
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-001");
});
```

Also update the Phase 2 extends test (currently asserts that extends is
preserved but not walked). Find the test "loadChain: manifest with extends: is
loaded but extends is ignored" and **delete** it — Phase 3 walks extends, so
this behavior changes.

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/chain_test.ts` Expected: the 6
new tests FAIL (current chain loader doesn't walk extends). The extended-parent
path tests specifically fail because the returned chain has `tiers.length === 1`
(Phase 2 behavior).

- [ ] **Step 3: Implement extends walking**

Replace the body of `loadChain` in `packages/markspec/core/profile/chain.ts`
with the walking version. Imports stay the same. Add a constant near the top:

```typescript
const MAX_CHAIN_DEPTH = 20;
```

Replace the `loadChain` function body:

```typescript
export async function loadChain(
  specifier: ProfileSpecifier,
  contextDir: string,
  readFile: ReadFile,
): Promise<LoadChainResult> {
  const diagnostics: Diagnostic[] = [];

  if (specifier.kind === "git") {
    diagnostics.push({
      code: "PROFILE-LOAD-001",
      severity: "error",
      message: "git profile specifiers are not supported in v1 Phase 2 " +
        "(landing in Phase 4); use a local './path' specifier for now",
      location: { file: "<specifier>", line: 1, column: 1 },
    });
    return { chain: null, diagnostics };
  }

  // Walk extends: chain. Accumulate tiers leaf-first, reverse at the end.
  const tiersLeafFirst: LoadedProfile[] = [];
  const visited = new Set<string>(); // specifier key (kind + resolved path)
  let cursorSpec: ProfileSpecifier | undefined = specifier;
  let cursorDir = contextDir;

  while (cursorSpec !== undefined) {
    // Only local specifiers are followed in Phase 3.
    if (cursorSpec.kind === "git") {
      diagnostics.push({
        code: "PROFILE-LOAD-001",
        severity: "error",
        message:
          "git profile specifiers in extends: chain are not supported yet " +
          "(landing in Phase 4)",
        location: { file: "<specifier>", line: 1, column: 1 },
      });
      return { chain: null, diagnostics };
    }

    const key = specifierKey(cursorSpec, cursorDir);
    if (visited.has(key)) {
      diagnostics.push({
        code: "PROFILE-LOAD-004",
        severity: "error",
        message: `profile extends: cycle detected at ${cursorSpec.path} ` +
          `(already visited in this chain)`,
        location: { file: "<specifier>", line: 1, column: 1 },
      });
      return { chain: null, diagnostics };
    }
    visited.add(key);

    if (tiersLeafFirst.length >= MAX_CHAIN_DEPTH) {
      diagnostics.push({
        code: "PROFILE-LOAD-005",
        severity: "error",
        message:
          `profile extends: chain exceeds maximum depth (${MAX_CHAIN_DEPTH})`,
        location: { file: "<specifier>", line: 1, column: 1 },
      });
      return { chain: null, diagnostics };
    }

    const resolved = await resolveLocalSpecifier(
      cursorSpec,
      cursorDir,
      readFile,
      diagnostics,
    );
    if (!resolved) {
      return { chain: null, diagnostics };
    }

    const parsed = parseManifest(resolved.rawYaml, resolved.sourcePath);
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.manifest) {
      return { chain: null, diagnostics };
    }

    const tier: LoadedProfile = {
      id: parsed.manifest.id,
      version: parsed.manifest.version,
      specifier: cursorSpec,
      manifest: parsed.manifest,
      sourcePath: resolved.sourcePath,
      baseDir: resolved.baseDir,
    };
    tiersLeafFirst.push(tier);

    // Advance cursor to the parent, if any.
    if (parsed.manifest.extends !== undefined) {
      cursorSpec = parsed.manifest.extends;
      cursorDir = resolved.baseDir;
    } else {
      cursorSpec = undefined;
    }
  }

  // Reverse so tiers[0] = root parent, tiers[last] = leaf child.
  const tiers = tiersLeafFirst.reverse();

  // Effective profile is still a placeholder — Task 3.8 wires real merge.
  const placeholderEffective = buildPlaceholderEffective(tiers);

  return {
    chain: { tiers, effective: placeholderEffective },
    diagnostics,
  };
}

/**
 * Canonical cycle-detection key for a resolved specifier. Two specifiers
 * are "the same" when they resolve to the same directory on disk.
 */
function specifierKey(
  spec: Extract<ProfileSpecifier, { kind: "local" }>,
  contextDir: string,
): string {
  const { resolve } = globalThis as unknown as {
    resolve: (...paths: string[]) => string;
  };
  // Prefer std-path's resolve; imported at module level. Falling back to string concat is incorrect.
  // See import section: import { resolve } from "@std/path";
  return `local:${resolveStdPath(contextDir, spec.path)}`;
}
```

Wait — the function `specifierKey` above uses a nonexistent `resolveStdPath`.
Fix the implementation: add `resolve` to the existing `@std/path` import in
`chain.ts`, then use it directly. Rewrite `specifierKey`:

```typescript
import { resolve as resolvePath } from "@std/path";

function specifierKey(
  spec: Extract<ProfileSpecifier, { kind: "local" }>,
  contextDir: string,
): string {
  return `local:${resolvePath(contextDir, spec.path)}`;
}
```

And add a helper for the placeholder effective (moved out of the happy path for
clarity; will be replaced in Task 3.8):

```typescript
function buildPlaceholderEffective(
  tiers: readonly LoadedProfile[],
): EffectiveProfile {
  const leafOrigin = tiers[tiers.length - 1]?.id ?? "<unknown>";
  return {
    required: { value: [], origin: leafOrigin },
    attributes: new Map(),
    labels: { value: [], origin: leafOrigin },
    identified: {
      required: { value: [], origin: leafOrigin },
      attributes: new Map(),
      traceability: new Map(),
    },
    referenced: {
      required: { value: [], origin: leafOrigin },
      attributes: new Map(),
      traceability: new Map(),
    },
    types: new Map(),
    documents: { types: new Map(), frontMatter: new Map() },
  };
}
```

Delete the per-tier placeholder that Task 3.1 added — this new helper replaces
it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/chain_test.ts` Expected: all
tests pass (Phase 2's tests + 6 new). The deleted "extends ignored" test is
gone.

- [ ] **Step 5: Run full suite**

Run: `deno task test` Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/profile/chain.ts packages/markspec/core/profile/chain_test.ts
git commit -m "feat(core): walk extends: chain with cycle + depth detection"
```

---

## Task 3.3 — Merge scaffold: single-tier identity merge

Create `core/profile/merge.ts` with the public `mergeChain(chain)` function. For
a one-tier chain it's trivial — every field comes from the single tier with that
tier's id as origin. Sets up the function signature and return shape that
subsequent tasks extend.

**Files:**

- Create: `packages/markspec/core/profile/merge.ts`
- Create: `packages/markspec/core/profile/merge_test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/markspec/core/profile/merge_test.ts`:

```typescript
/**
 * @module core/profile/merge_test
 *
 * Unit tests for profile chain merging.
 */

import { assertEquals } from "@std/assert";
import { mergeChain } from "./merge.ts";
import { parseManifest } from "./manifest.ts";
import type { LoadedProfile, ProfileChain } from "../model/mod.ts";

/**
 * Build a one-tier chain from inline YAML for tests. Parsing must succeed.
 */
function singleTierChain(yaml: string): ProfileChain {
  const parsed = parseManifest(yaml);
  if (!parsed.manifest) {
    throw new Error(
      "parseManifest failed in test fixture: " +
        parsed.diagnostics.map((d) => d.message).join("; "),
    );
  }
  const tier: LoadedProfile = {
    id: parsed.manifest.id,
    version: parsed.manifest.version,
    specifier: { kind: "local", path: "./fixture" },
    manifest: parsed.manifest,
    sourcePath: "/fixture/markspec.yaml",
    baseDir: "/fixture",
  };
  // Placeholder effective — mergeChain rebuilds it.
  return {
    tiers: [tier],
    effective: {
      required: { value: [], origin: tier.id },
      attributes: new Map(),
      labels: { value: [], origin: tier.id },
      identified: {
        required: { value: [], origin: tier.id },
        attributes: new Map(),
        traceability: new Map(),
      },
      referenced: {
        required: { value: [], origin: tier.id },
        attributes: new Map(),
        traceability: new Map(),
      },
      types: new Map(),
      documents: { types: new Map(), frontMatter: new Map() },
    },
  };
}

Deno.test("mergeChain: single-tier empty profile produces empty effective profile", () => {
  const chain = singleTierChain(
    `id: "@acme/single"\nversion: 1.0.0\n`,
  );
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const eff = result.effective!;
  assertEquals(eff.required.value, []);
  assertEquals(eff.required.origin, "@acme/single");
  assertEquals(eff.labels.value, []);
  assertEquals(eff.attributes.size, 0);
  assertEquals(eff.types.size, 0);
  assertEquals(eff.identified.attributes.size, 0);
  assertEquals(eff.identified.traceability.size, 0);
  assertEquals(eff.referenced.attributes.size, 0);
  assertEquals(eff.documents.types.size, 0);
  assertEquals(eff.documents.frontMatter.size, 0);
});

Deno.test("mergeChain: single-tier with universal attribute", () => {
  const chain = singleTierChain(`
id: "@acme/single"
version: 1.0.0
profile:
  required: [Status]
  attributes:
    - name: Status
      type: enum
      values: [draft, approved]
`);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const eff = result.effective!;
  assertEquals(eff.required.value, ["Status"]);
  assertEquals(eff.required.origin, "@acme/single");
  assertEquals(eff.attributes.size, 1);
  const statusEntry = eff.attributes.get("Status")!;
  assertEquals(statusEntry.origin, "@acme/single");
  assertEquals(statusEntry.value.name, "Status");
  assertEquals(statusEntry.value.type, "enum");
});

Deno.test("mergeChain: single-tier with a type definition", () => {
  const chain = singleTierChain(`
id: "@acme/single"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: warn
      required: [Rationale]
      attributes:
        - name: Rationale
          type: text
`);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const req = result.effective!.types.get("requirement")!;
  assertEquals(req.origin, "@acme/single");
  assertEquals(req.value.shape, "identified");
  assertEquals(req.value.displayIdPattern.value, "REQ-{n:04d}");
  assertEquals(req.value.displayIdPattern.origin, "@acme/single");
  assertEquals(req.value.displayIdPatternEnforcement.value, "warn");
  assertEquals(req.value.required.value, ["Rationale"]);
  assertEquals(req.value.attributes.size, 1);
  assertEquals(req.value.attributes.get("Rationale")?.origin, "@acme/single");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/merge_test.ts` Expected: FAIL
with `Cannot find module './merge.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/markspec/core/profile/merge.ts`:

```typescript
/**
 * @module core/profile/merge
 *
 * Fold a {@linkcode ProfileChain} into a single {@linkcode EffectiveProfile},
 * applying additive, tightening, and subset merge rules across tiers
 * (root → leaf). Violations surface as `PROFILE-MERGE-*` diagnostics.
 *
 * Merge happens once at load. Callers should not call `mergeChain` lazily.
 */

import type {
  AttrDecl,
  Diagnostic,
  DocTypeDef,
  EffectiveProfile,
  EffectiveShapeScope,
  EffectiveTypeDef,
  LoadedProfile,
  ProfileChain,
  ProfileId,
  ProfileManifest,
  ProvenancedMap,
  ProvenancedMapEntry,
  ProvenancedValue,
  TraceRule,
} from "../model/mod.ts";

/** Result of merging a {@linkcode ProfileChain}. */
export interface MergeResult {
  /** The merged profile, or `null` when any merge constraint was violated. */
  readonly effective: EffectiveProfile | null;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Merge all tiers of a chain into one EffectiveProfile. Tiers are processed
 * in root → leaf order; later tiers can add to or tighten earlier tiers'
 * rules. Returns `{ effective: null }` if any tier relaxes an ancestor.
 */
export function mergeChain(chain: ProfileChain): MergeResult {
  const diagnostics: Diagnostic[] = [];
  const tiers = chain.tiers;
  if (tiers.length === 0) {
    return {
      effective: null,
      diagnostics: [
        {
          code: "PROFILE-MERGE-001",
          severity: "error",
          message: "cannot merge an empty profile chain",
          location: { file: "<chain>", line: 1, column: 1 },
        },
      ],
    };
  }

  // Start with the root tier's universal + shape + types, annotated with that
  // tier's id as origin.
  const seed = tiers[0];
  let effective = seedFromTier(seed);

  // (Subsequent tasks extend this: additive, tightening, subset merges.)
  // Phase 3 scaffold: ignore tiers beyond the first for now. This code path
  // is exercised only by single-tier chains in Task 3.3's tests.
  if (tiers.length > 1) {
    // Placeholder — Tasks 3.4–3.7 implement multi-tier merge.
    effective = effective;
  }

  return { effective, diagnostics };
}

// ---------------------------------------------------------------------------
// Helpers: construct an EffectiveProfile from a single tier's manifest.
// ---------------------------------------------------------------------------

function seedFromTier(tier: LoadedProfile): EffectiveProfile {
  const origin: ProfileId = tier.id;
  const m = tier.manifest;

  return {
    required: { value: m.universalRequired, origin },
    attributes: mapFromAttrList(m.universalAttributes, origin),
    labels: { value: m.labels, origin },
    identified: buildShapeScope(m.identified, origin),
    referenced: {
      required: { value: m.referenced.required, origin },
      attributes: mapFromAttrList(m.referenced.attributes, origin),
      traceability: new Map(),
    },
    types: mapFromTypes(m.types, origin),
    documents: {
      types: mapFromDocTypes(m.documents.types, origin),
      frontMatter: mapFromAttrList(m.documents.frontMatter, origin),
    },
  };
}

function buildShapeScope(
  raw: ProfileManifest["identified"],
  origin: ProfileId,
): EffectiveShapeScope {
  return {
    required: { value: raw.required, origin },
    attributes: mapFromAttrList(raw.attributes, origin),
    traceability: mapFromTrace(raw.traceability, origin),
  };
}

function mapFromAttrList(
  attrs: readonly AttrDecl[],
  origin: ProfileId,
): ProvenancedMap<AttrDecl> {
  const out = new Map<string, ProvenancedMapEntry<AttrDecl>>();
  for (const a of attrs) {
    out.set(a.name, { value: a, origin });
  }
  return out;
}

function mapFromTrace(
  trace: ReadonlyMap<string, TraceRule>,
  origin: ProfileId,
): ProvenancedMap<TraceRule> {
  const out = new Map<string, ProvenancedMapEntry<TraceRule>>();
  for (const [name, rule] of trace) {
    out.set(name, { value: rule, origin });
  }
  return out;
}

function mapFromTypes(
  types: ProfileManifest["types"],
  origin: ProfileId,
): ProvenancedMap<EffectiveTypeDef> {
  const out = new Map<string, ProvenancedMapEntry<EffectiveTypeDef>>();
  for (const [name, td] of types) {
    const eff: EffectiveTypeDef = {
      name,
      shape: td.shape,
      displayIdPattern: { value: td.displayIdPattern, origin },
      displayIdPatternEnforcement: {
        value: td.displayIdPatternEnforcement,
        origin,
      },
      required: { value: td.required, origin },
      attributes: mapFromAttrList(td.attributes, origin),
      traceability: mapFromTrace(td.traceability, origin),
    };
    out.set(name, { value: eff, origin });
  }
  return out;
}

function mapFromDocTypes(
  docTypes: readonly DocTypeDef[],
  origin: ProfileId,
): ProvenancedMap<DocTypeDef> {
  const out = new Map<string, ProvenancedMapEntry<DocTypeDef>>();
  for (const dt of docTypes) {
    out.set(dt.id, { value: dt, origin });
  }
  return out;
}

// Suppress unused-locals warnings for ProvenancedValue (used in types only).
// deno-lint-ignore no-explicit-any
const _provRef: ProvenancedValue<any> | undefined = undefined;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/merge_test.ts` Expected: all 3
tests PASS.

- [ ] **Step 5: Clean up the unused `_provRef` marker**

Remove the `_provRef` line at the bottom of `merge.ts` — it was only there to
keep `ProvenancedValue` "used" while nothing references it. Now that multiple
helpers use `ProvenancedMap<V>` (which is defined in terms of
`ProvenancedMapEntry`), the `ProvenancedValue` type import is still needed but
not via that hack. Drop `ProvenancedValue` from the imports if the type-checker
flags it as unused — but it will be used in subsequent tasks, so leaving the
import + the placeholder line in is acceptable if needed.

Run: `deno check packages/markspec/core/profile/merge.ts` Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/profile/merge.ts packages/markspec/core/profile/merge_test.ts
git commit -m "feat(core): mergeChain scaffold — single-tier identity merge"
```

---

## Task 3.4 — Additive merge rules

Implement the union-across-tiers rules: `profile.required`,
`profile.attributes`, `profile.labels`, `profile.types` keys, per-type
`attributes`, per-type `traceability` keys. Children **add** entries parents
didn't have. When a child adds an attribute name already present in the parent,
Task 3.5 handles tightening — for now, additive-only tests exercise
non-overlapping additions.

**Files:**

- Modify: `packages/markspec/core/profile/merge.ts`
- Modify: `packages/markspec/core/profile/merge_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/markspec/core/profile/merge_test.ts`:

```typescript
/**
 * Build a multi-tier chain from an ordered list of YAMLs (root → leaf).
 */
function multiTierChain(yamls: readonly string[]): ProfileChain {
  const tiers: LoadedProfile[] = yamls.map((yaml, i) => {
    const parsed = parseManifest(yaml);
    if (!parsed.manifest) {
      throw new Error(
        `tier ${i} parse failed: ${
          parsed.diagnostics.map((d) => d.message).join("; ")
        }`,
      );
    }
    return {
      id: parsed.manifest.id,
      version: parsed.manifest.version,
      specifier: { kind: "local", path: `./t${i}` },
      manifest: parsed.manifest,
      sourcePath: `/fixture/t${i}/markspec.yaml`,
      baseDir: `/fixture/t${i}`,
    };
  });
  // Stub effective — mergeChain rebuilds it.
  return {
    tiers,
    effective: {
      required: { value: [], origin: tiers[0].id },
      attributes: new Map(),
      labels: { value: [], origin: tiers[0].id },
      identified: {
        required: { value: [], origin: tiers[0].id },
        attributes: new Map(),
        traceability: new Map(),
      },
      referenced: {
        required: { value: [], origin: tiers[0].id },
        attributes: new Map(),
        traceability: new Map(),
      },
      types: new Map(),
      documents: { types: new Map(), frontMatter: new Map() },
    },
  };
}

Deno.test("mergeChain: additive — child adds universal attribute parent didn't have", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Owner
      type: text
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const eff = result.effective!;
  assertEquals(eff.attributes.size, 2);
  assertEquals(eff.attributes.get("Status")?.origin, "@acme/parent");
  assertEquals(eff.attributes.get("Owner")?.origin, "@acme/child");
});

Deno.test("mergeChain: additive — required is union", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  required: [Status]
  attributes:
    - name: Status
      type: enum
      values: [draft, approved]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  required: [Owner]
  attributes:
    - name: Owner
      type: text
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const eff = result.effective!;
  // Order: parent entries come first, child's additions appended.
  assertEquals(eff.required.value, ["Status", "Owner"]);
  // required.origin points at the leaf child since it last modified the list.
  assertEquals(eff.required.origin, "@acme/child");
});

Deno.test("mergeChain: additive — labels are union, deduplicated", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  labels: [DRAFT, INTERNAL]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  labels: [INTERNAL, PUBLIC]
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  // Union without duplicates, parent entries first.
  assertEquals(result.effective!.labels.value, ["DRAFT", "INTERNAL", "PUBLIC"]);
});

Deno.test("mergeChain: additive — child adds a new type", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    test:
      shape: identified
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const types = result.effective!.types;
  assertEquals(types.size, 2);
  assertEquals(types.get("requirement")?.origin, "@acme/parent");
  assertEquals(types.get("test")?.origin, "@acme/child");
});

Deno.test("mergeChain: additive — child adds attribute to an existing type", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
      attributes:
        - name: Rationale
          type: text
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      shape: identified
      attributes:
        - name: Owner
          type: text
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const req = result.effective!.types.get("requirement")!.value;
  assertEquals(req.attributes.size, 2);
  assertEquals(req.attributes.get("Rationale")?.origin, "@acme/parent");
  assertEquals(req.attributes.get("Owner")?.origin, "@acme/child");
});

Deno.test("mergeChain: additive — child adds traceability rule to existing type", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
      traceability:
        Derived-from:
          target: [{shape: identified}]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      shape: identified
      traceability:
        Allocates-to:
          target: [{shape: identified}]
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const req = result.effective!.types.get("requirement")!.value;
  assertEquals(req.traceability.size, 2);
  assertEquals(req.traceability.get("Derived-from")?.origin, "@acme/parent");
  assertEquals(req.traceability.get("Allocates-to")?.origin, "@acme/child");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/merge_test.ts` Expected: new
tests fail because `mergeChain` currently returns the root-tier seed only.

- [ ] **Step 3: Implement additive merge**

Replace the `mergeChain` body in `packages/markspec/core/profile/merge.ts` (keep
the helpers, replace only the main function):

```typescript
export function mergeChain(chain: ProfileChain): MergeResult {
  const diagnostics: Diagnostic[] = [];
  const tiers = chain.tiers;
  if (tiers.length === 0) {
    return {
      effective: null,
      diagnostics: [
        {
          code: "PROFILE-MERGE-001",
          severity: "error",
          message: "cannot merge an empty profile chain",
          location: { file: "<chain>", line: 1, column: 1 },
        },
      ],
    };
  }

  // Start from root, fold each subsequent tier.
  let effective = seedFromTier(tiers[0]);
  for (let i = 1; i < tiers.length; i++) {
    effective = foldTier(effective, tiers[i], diagnostics);
  }

  // If any merge error was recorded, drop the effective profile.
  const hasError = diagnostics.some((d) => d.severity === "error");
  return hasError
    ? { effective: null, diagnostics }
    : { effective, diagnostics };
}

/**
 * Apply a child tier's additions and tightenings on top of the current
 * accumulated EffectiveProfile. Task 3.4 implements additive only;
 * Tasks 3.5–3.7 extend this with tightening and subset checks.
 */
function foldTier(
  base: EffectiveProfile,
  tier: LoadedProfile,
  diagnostics: Diagnostic[],
): EffectiveProfile {
  const origin: ProfileId = tier.id;
  const m = tier.manifest;

  // Universal additive.
  const required = unionList(base.required, m.universalRequired, origin);
  const labels = unionList(base.labels, m.labels, origin);
  const attributes = unionAttrMap(
    base.attributes,
    m.universalAttributes,
    origin,
    diagnostics,
  );

  // Shape scopes — same additive pattern.
  const identified: EffectiveShapeScope = {
    required: unionList(
      base.identified.required,
      m.identified.required,
      origin,
    ),
    attributes: unionAttrMap(
      base.identified.attributes,
      m.identified.attributes,
      origin,
      diagnostics,
    ),
    traceability: unionTraceMap(
      base.identified.traceability,
      m.identified.traceability,
      origin,
      diagnostics,
    ),
  };
  const referenced: EffectiveShapeScope = {
    required: unionList(
      base.referenced.required,
      m.referenced.required,
      origin,
    ),
    attributes: unionAttrMap(
      base.referenced.attributes,
      m.referenced.attributes,
      origin,
      diagnostics,
    ),
    traceability: base.referenced.traceability, // always empty
  };

  // Types — add new types, fold existing ones.
  const types = new Map(base.types);
  for (const [name, td] of m.types) {
    const existing = types.get(name);
    if (!existing) {
      // Fresh type contributed by this tier.
      const eff: EffectiveTypeDef = {
        name,
        shape: td.shape,
        displayIdPattern: { value: td.displayIdPattern, origin },
        displayIdPatternEnforcement: {
          value: td.displayIdPatternEnforcement,
          origin,
        },
        required: { value: td.required, origin },
        attributes: mapFromAttrList(td.attributes, origin),
        traceability: mapFromTrace(td.traceability, origin),
      };
      types.set(name, { value: eff, origin });
    } else {
      // Fold child's additions into existing type. Tightening in Tasks 3.5–3.7.
      const merged: EffectiveTypeDef = {
        name,
        shape: existing.value.shape, // shape never changes
        displayIdPattern: existing.value.displayIdPattern,
        displayIdPatternEnforcement: existing.value.displayIdPatternEnforcement,
        required: unionList(existing.value.required, td.required, origin),
        attributes: unionAttrMap(
          existing.value.attributes,
          td.attributes,
          origin,
          diagnostics,
        ),
        traceability: unionTraceMap(
          existing.value.traceability,
          td.traceability,
          origin,
          diagnostics,
        ),
      };
      const overrides = [
        ...(existing.overrides ?? []),
        existing.origin,
      ];
      types.set(name, { value: merged, origin, overrides });
    }
  }

  // Documents — add new doc types + frontMatter.
  const docTypes = new Map(base.documents.types);
  for (const dt of m.documents.types) {
    if (!docTypes.has(dt.id)) {
      docTypes.set(dt.id, { value: dt, origin });
    }
    // Overlap handling deferred.
  }
  const frontMatter = unionAttrMap(
    base.documents.frontMatter,
    m.documents.frontMatter,
    origin,
    diagnostics,
  );

  return {
    required,
    attributes,
    labels,
    identified,
    referenced,
    types,
    documents: {
      types: docTypes,
      frontMatter,
    },
  };
}

// ---------------------------------------------------------------------------
// Additive merge primitives
// ---------------------------------------------------------------------------

/**
 * Union of two string lists; parent entries first, child entries appended,
 * duplicates dropped. Origin = leaf tier that last appended anything (or the
 * parent origin if the child contributes nothing).
 */
function unionList(
  parent: ProvenancedValue<readonly string[]>,
  childList: readonly string[],
  childOrigin: ProfileId,
): ProvenancedValue<readonly string[]> {
  if (childList.length === 0) {
    return parent;
  }
  const seen = new Set(parent.value);
  const merged = [...parent.value];
  let anyAdded = false;
  for (const s of childList) {
    if (!seen.has(s)) {
      merged.push(s);
      seen.add(s);
      anyAdded = true;
    }
  }
  return anyAdded ? { value: merged, origin: childOrigin } : parent;
}

/**
 * Union of attribute maps. Task 3.4 handles non-overlap only — if the child
 * declares an attribute with the same name as the parent, we keep the parent's
 * entry and record the child tier as an override (Task 3.5 turns this into a
 * tightening check).
 */
function unionAttrMap(
  parent: ProvenancedMap<AttrDecl>,
  childAttrs: readonly AttrDecl[],
  childOrigin: ProfileId,
  _diagnostics: Diagnostic[],
): ProvenancedMap<AttrDecl> {
  const out = new Map(parent);
  for (const a of childAttrs) {
    const existing = out.get(a.name);
    if (!existing) {
      out.set(a.name, { value: a, origin: childOrigin });
    } else {
      // Overlap — parent's value is kept (no tightening yet).
      // Task 3.5 replaces this with a tightening check.
      const overrides = [
        ...(existing.overrides ?? []),
        childOrigin,
      ];
      out.set(a.name, { ...existing, overrides });
    }
  }
  return out;
}

/**
 * Union of traceability rule maps, same pattern as attributes.
 */
function unionTraceMap(
  parent: ProvenancedMap<TraceRule>,
  childTrace: ReadonlyMap<string, TraceRule>,
  childOrigin: ProfileId,
  _diagnostics: Diagnostic[],
): ProvenancedMap<TraceRule> {
  const out = new Map(parent);
  for (const [name, rule] of childTrace) {
    const existing = out.get(name);
    if (!existing) {
      out.set(name, { value: rule, origin: childOrigin });
    } else {
      const overrides = [
        ...(existing.overrides ?? []),
        childOrigin,
      ];
      out.set(name, { ...existing, overrides });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/merge_test.ts` Expected: all
tests pass (the 3 from Task 3.3 + 6 new).

- [ ] **Step 5: Run full suite**

Run: `deno task test` Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/profile/merge.ts packages/markspec/core/profile/merge_test.ts
git commit -m "feat(core): additive merge rules (union lists, types, attributes)"
```

---

## Task 3.5 — Attribute tightening (cardinality, enum, required flag)

When a child tier redeclares an attribute the parent already declared, the
child's declaration must not relax the parent's constraint. Handle three
tightening rules for `AttrDecl`: `cardinality`, `enum values`, and `required`
flag.

**Files:**

- Modify: `packages/markspec/core/profile/merge.ts`
- Modify: `packages/markspec/core/profile/merge_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/markspec/core/profile/merge_test.ts`:

```typescript
Deno.test("mergeChain: tighten — child narrows cardinality 0..N → 1..N", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Tags
      type: tag-list
      cardinality: 0..N
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Tags
      type: tag-list
      cardinality: 1..N
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const tags = result.effective!.attributes.get("Tags")!;
  assertEquals(tags.value.cardinality, { lower: 1, upper: Infinity });
  assertEquals(tags.origin, "@acme/child");
});

Deno.test("mergeChain: relax — child widens cardinality emits PROFILE-MERGE-001", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Tags
      type: tag-list
      cardinality: 1..N
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Tags
      type: tag-list
      cardinality: 0..N
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-001");
  const msg = result.diagnostics[0].message;
  if (!msg.includes("Tags") || !msg.includes("cardinality")) {
    throw new Error(`diagnostic message missing context: ${msg}`);
  }
});

Deno.test("mergeChain: tighten — child narrows enum values", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved, deprecated, withdrawn]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved]
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const status = result.effective!.attributes.get("Status")!;
  assertEquals(status.value.values, ["draft", "approved"]);
});

Deno.test("mergeChain: relax — child adds enum value not in parent emits PROFILE-MERGE-001", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved, new-value]
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-001");
});

Deno.test("mergeChain: tighten — child sets required:true", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Rationale
      type: text
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Rationale
      type: text
      required: true
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const rationale = result.effective!.attributes.get("Rationale")!;
  assertEquals(rationale.value.required, true);
});

Deno.test("mergeChain: relax — child sets required:false when parent had true", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Rationale
      type: text
      required: true
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Rationale
      type: text
      required: false
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-001");
});

Deno.test("mergeChain: type mismatch — child changes attr type emits PROFILE-MERGE-001", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Count
      type: integer
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Count
      type: text
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-001");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/merge_test.ts` Expected: the 7
new tests FAIL — `unionAttrMap` currently keeps the parent's value instead of
tightening.

- [ ] **Step 3: Implement attribute tightening**

Replace the body of `unionAttrMap` in `packages/markspec/core/profile/merge.ts`:

```typescript
function unionAttrMap(
  parent: ProvenancedMap<AttrDecl>,
  childAttrs: readonly AttrDecl[],
  childOrigin: ProfileId,
  diagnostics: Diagnostic[],
): ProvenancedMap<AttrDecl> {
  const out = new Map(parent);
  for (const a of childAttrs) {
    const existing = out.get(a.name);
    if (!existing) {
      out.set(a.name, { value: a, origin: childOrigin });
      continue;
    }
    const tightened = tightenAttr(
      existing,
      a,
      childOrigin,
      diagnostics,
    );
    if (tightened) {
      out.set(a.name, tightened);
    }
    // If tightening failed (returned undefined), diagnostics were recorded;
    // keep the parent entry so downstream code still sees a valid attribute.
  }
  return out;
}

/**
 * Tighten a parent attribute declaration with a child's redeclaration.
 * Returns the new effective entry on success, or `undefined` if the child
 * relaxes (caller records PROFILE-MERGE-001).
 */
function tightenAttr(
  existing: ProvenancedMapEntry<AttrDecl>,
  child: AttrDecl,
  childOrigin: ProfileId,
  diagnostics: Diagnostic[],
): ProvenancedMapEntry<AttrDecl> | undefined {
  const parent = existing.value;

  // Value-type must match exactly (widening a type is a relaxation).
  if (parent.type !== child.type) {
    diagnostics.push(mergeRelaxation(
      `attribute '${parent.name}'`,
      "type",
      `${parent.type} (${existing.origin})`,
      `${child.type} (${childOrigin})`,
    ));
    return undefined;
  }

  // Cardinality: child lower ≥ parent lower AND child upper ≤ parent upper.
  if (child.cardinality.lower < parent.cardinality.lower) {
    diagnostics.push(mergeRelaxation(
      `attribute '${parent.name}'`,
      "cardinality.lower",
      `${parent.cardinality.lower} (${existing.origin})`,
      `${child.cardinality.lower} (${childOrigin})`,
    ));
    return undefined;
  }
  if (child.cardinality.upper > parent.cardinality.upper) {
    diagnostics.push(mergeRelaxation(
      `attribute '${parent.name}'`,
      "cardinality.upper",
      `${formatUpper(parent.cardinality.upper)} (${existing.origin})`,
      `${formatUpper(child.cardinality.upper)} (${childOrigin})`,
    ));
    return undefined;
  }

  // Required flag: once required, cannot be un-required.
  if (parent.required === true && child.required === false) {
    diagnostics.push(mergeRelaxation(
      `attribute '${parent.name}'`,
      "required",
      `true (${existing.origin})`,
      `false (${childOrigin})`,
    ));
    return undefined;
  }

  // Enum: child.values must be a subset of parent.values.
  if (parent.type === "enum") {
    const parentSet = new Set(parent.values ?? []);
    const childValues = child.values ?? [];
    for (const v of childValues) {
      if (!parentSet.has(v)) {
        diagnostics.push(mergeRelaxation(
          `attribute '${parent.name}'`,
          "enum values",
          `[${[...parentSet].join(",")}] (${existing.origin})`,
          `added '${v}' (${childOrigin})`,
        ));
        return undefined;
      }
    }
  }

  // Build the tightened value (field-by-field, child wins on narrower bounds).
  const merged: AttrDecl = {
    name: parent.name,
    type: parent.type,
    required: parent.required || child.required,
    cardinality: child.cardinality,
    values: parent.type === "enum" ? child.values : parent.values,
    inverse: child.inverse ?? parent.inverse,
  };
  const overrides = [
    ...(existing.overrides ?? []),
    existing.origin,
  ];
  return { value: merged, origin: childOrigin, overrides };
}

function mergeRelaxation(
  subject: string,
  field: string,
  parentView: string,
  childView: string,
): Diagnostic {
  return {
    code: "PROFILE-MERGE-001",
    severity: "error",
    message:
      `${subject}: field '${field}' relaxed by child (parent: ${parentView}, child: ${childView})`,
    location: { file: "<merge>", line: 1, column: 1 },
  };
}

function formatUpper(u: number): string {
  return u === Infinity ? "N" : String(u);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/merge_test.ts` Expected: all
tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/merge.ts packages/markspec/core/profile/merge_test.ts
git commit -m "feat(core): attribute tightening (cardinality, enum, required)"
```

---

## Task 3.6 — Type-level tightening (display-id-pattern, enforcement)

When a child redeclares an existing type, two type-level fields also follow
tightening rules:

- `display-id-pattern` — must be identical across tiers (no change allowed).
- `display-id-pattern-enforcement` — child may move `off → warn → error`, never
  loosen.

Also: shape must match (a child cannot change a type's shape).

**Files:**

- Modify: `packages/markspec/core/profile/merge.ts`
- Modify: `packages/markspec/core/profile/merge_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/markspec/core/profile/merge_test.ts`:

```typescript
Deno.test("mergeChain: type shape mismatch across tiers emits PROFILE-MERGE-001", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    thing:
      shape: identified
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    thing:
      shape: referenced
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-001");
  const msg = result.diagnostics[0].message;
  if (!msg.includes("shape")) {
    throw new Error(`expected 'shape' in message, got: ${msg}`);
  }
});

Deno.test("mergeChain: display-id-pattern differs between tiers emits PROFILE-MERGE-001", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:06d}"
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-001");
  const msg = result.diagnostics[0].message;
  if (!msg.includes("display-id-pattern")) {
    throw new Error(`expected 'display-id-pattern' in message, got: ${msg}`);
  }
});

Deno.test("mergeChain: child may set display-id-pattern when parent had none", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const req = result.effective!.types.get("requirement")!.value;
  assertEquals(req.displayIdPattern.value, "REQ-{n:04d}");
  assertEquals(req.displayIdPattern.origin, "@acme/child");
});

Deno.test("mergeChain: enforcement tightens off → warn → error", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: warn
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: error
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const req = result.effective!.types.get("requirement")!.value;
  assertEquals(req.displayIdPatternEnforcement.value, "error");
});

Deno.test("mergeChain: enforcement loosening error → warn emits PROFILE-MERGE-001", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: error
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: warn
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-001");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/merge_test.ts` Expected: 5 new
tests FAIL.

- [ ] **Step 3: Implement type-level tightening**

In `packages/markspec/core/profile/merge.ts`, find the section of `foldTier`
where an existing type is merged (the `else` branch of `if (!existing)`).
Replace its body with a tightening check:

```typescript
} else {
  const tightened = tightenType(
    existing,
    td,
    origin,
    diagnostics,
  );
  if (tightened) {
    types.set(name, tightened);
  }
  // If tightening failed, parent entry is kept (diagnostics already pushed).
}
```

Add the `tightenType` helper near the bottom of `merge.ts`:

```typescript
const ENFORCEMENT_ORDER: Record<string, number> = { off: 0, warn: 1, error: 2 };

function tightenType(
  existing: ProvenancedMapEntry<EffectiveTypeDef>,
  child: import("../model/mod.ts").TypeDef,
  childOrigin: ProfileId,
  diagnostics: Diagnostic[],
): ProvenancedMapEntry<EffectiveTypeDef> | undefined {
  const name = child.name;
  const effExisting = existing.value;

  // Shape must match.
  if (effExisting.shape !== child.shape) {
    diagnostics.push(mergeRelaxation(
      `type '${name}'`,
      "shape",
      `${effExisting.shape} (${existing.origin})`,
      `${child.shape} (${childOrigin})`,
    ));
    return undefined;
  }

  // Display-ID pattern: if parent set one, child cannot change it.
  let displayIdPattern = effExisting.displayIdPattern;
  if (child.displayIdPattern !== undefined) {
    if (
      effExisting.displayIdPattern.value !== undefined &&
      effExisting.displayIdPattern.value !== child.displayIdPattern
    ) {
      diagnostics.push(mergeRelaxation(
        `type '${name}'`,
        "display-id-pattern",
        `'${effExisting.displayIdPattern.value}' (${effExisting.displayIdPattern.origin})`,
        `'${child.displayIdPattern}' (${childOrigin})`,
      ));
      return undefined;
    }
    // Parent had no pattern — child contributes it.
    if (effExisting.displayIdPattern.value === undefined) {
      displayIdPattern = { value: child.displayIdPattern, origin: childOrigin };
    }
  }

  // Enforcement — tighten only (off < warn < error).
  let enforcement = effExisting.displayIdPatternEnforcement;
  if (child.displayIdPatternEnforcement !== enforcement.value) {
    const parentLevel = ENFORCEMENT_ORDER[enforcement.value];
    const childLevel = ENFORCEMENT_ORDER[child.displayIdPatternEnforcement];
    if (childLevel < parentLevel) {
      diagnostics.push(mergeRelaxation(
        `type '${name}'`,
        "display-id-pattern-enforcement",
        `${enforcement.value} (${enforcement.origin})`,
        `${child.displayIdPatternEnforcement} (${childOrigin})`,
      ));
      return undefined;
    }
    enforcement = {
      value: child.displayIdPatternEnforcement,
      origin: childOrigin,
    };
  }

  // Recurse into attributes + traceability.
  const attributes = unionAttrMap(
    effExisting.attributes,
    child.attributes,
    childOrigin,
    diagnostics,
  );
  const traceability = unionTraceMap(
    effExisting.traceability,
    child.traceability,
    childOrigin,
    diagnostics,
  );
  const required = unionList(
    effExisting.required,
    child.required,
    childOrigin,
  );

  const merged: EffectiveTypeDef = {
    name,
    shape: effExisting.shape,
    displayIdPattern,
    displayIdPatternEnforcement: enforcement,
    required,
    attributes,
    traceability,
  };
  const overrides = [
    ...(existing.overrides ?? []),
    existing.origin,
  ];
  return { value: merged, origin: childOrigin, overrides };
}
```

Also import `TypeDef` at the top of `merge.ts` (replace the inline
`import("../model/mod.ts")` above):

```typescript
import type {
  AttrDecl,
  Diagnostic,
  DocTypeDef,
  EffectiveProfile,
  EffectiveShapeScope,
  EffectiveTypeDef,
  LoadedProfile,
  ProfileChain,
  ProfileId,
  ProfileManifest,
  ProvenancedMap,
  ProvenancedMapEntry,
  ProvenancedValue,
  TraceRule,
  TypeDef,
} from "../model/mod.ts";
```

And use `TypeDef` instead of the inline type in `tightenType`'s signature.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/merge_test.ts` Expected: all
tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/merge.ts packages/markspec/core/profile/merge_test.ts
git commit -m "feat(core): type-level merge tightening (pattern + enforcement)"
```

---

## Task 3.7 — Traceability target subset rule

A child's traceability rule `target` must be a subset of the parent's. If the
parent said `target: [req, test]`, the child may narrow to `target: [req]`.
Adding a new target type (or a shape matcher not in the parent) is
`PROFILE-MERGE-002`.

Shape matchers `{ shape: identified }` and `{ shape: referenced }` are treated
as covering every entry of that shape. So if the parent has
`target: [{shape: identified}]`, the child may narrow to `target: [requirement]`
(assuming requirement's shape is identified) — but we only check the matcher
equivalence at this level, not type→shape lookup. For v1, the subset check is
literal (matcher-by-matcher): a child matcher must appear in the parent's list,
or be subsumed by a shape matcher in the parent's list.

**Files:**

- Modify: `packages/markspec/core/profile/merge.ts`
- Modify: `packages/markspec/core/profile/merge_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/markspec/core/profile/merge_test.ts`:

```typescript
Deno.test("mergeChain: traceability target narrows valid subset", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
      traceability:
        Derived-from:
          target: [stakeholder-req, system-req]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      shape: identified
      traceability:
        Derived-from:
          target: [stakeholder-req]
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const trace = result.effective!.types.get("requirement")!.value
    .traceability.get("Derived-from")!;
  assertEquals(trace.value.target, ["stakeholder-req"]);
  assertEquals(trace.origin, "@acme/child");
});

Deno.test("mergeChain: traceability target adds type not in parent emits PROFILE-MERGE-002", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
      traceability:
        Derived-from:
          target: [stakeholder-req]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      shape: identified
      traceability:
        Derived-from:
          target: [stakeholder-req, system-req]
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-002");
});

Deno.test("mergeChain: child narrows shape matcher to specific type is allowed", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  identified:
    traceability:
      Derived-from:
        target: [{shape: identified}]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  identified:
    traceability:
      Derived-from:
        target: [stakeholder-req]
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const trace = result.effective!.identified.traceability
    .get("Derived-from")!;
  assertEquals(trace.value.target, ["stakeholder-req"]);
});

Deno.test("mergeChain: child adds shape matcher not in parent emits PROFILE-MERGE-002", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  identified:
    traceability:
      Derived-from:
        target: [{shape: identified}]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  identified:
    traceability:
      Derived-from:
        target: [{shape: identified}, {shape: referenced}]
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-002");
});

Deno.test("mergeChain: traceability cardinality tightens like attribute cardinality", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
      traceability:
        Derived-from:
          target: [stakeholder-req]
          cardinality: 0..N
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      shape: identified
      traceability:
        Derived-from:
          target: [stakeholder-req]
          cardinality: 1..N
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const trace = result.effective!.types.get("requirement")!.value
    .traceability.get("Derived-from")!;
  assertEquals(trace.value.cardinality, { lower: 1, upper: Infinity });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/merge_test.ts` Expected: 5 new
tests fail — `unionTraceMap` currently keeps the parent's rule without any
subset check.

- [ ] **Step 3: Implement target subset check**

Replace the body of `unionTraceMap` in
`packages/markspec/core/profile/merge.ts`:

```typescript
function unionTraceMap(
  parent: ProvenancedMap<TraceRule>,
  childTrace: ReadonlyMap<string, TraceRule>,
  childOrigin: ProfileId,
  diagnostics: Diagnostic[],
): ProvenancedMap<TraceRule> {
  const out = new Map(parent);
  for (const [name, rule] of childTrace) {
    const existing = out.get(name);
    if (!existing) {
      out.set(name, { value: rule, origin: childOrigin });
      continue;
    }
    const tightened = tightenTraceRule(
      existing,
      name,
      rule,
      childOrigin,
      diagnostics,
    );
    if (tightened) {
      out.set(name, tightened);
    }
  }
  return out;
}

function tightenTraceRule(
  existing: ProvenancedMapEntry<TraceRule>,
  linkName: string,
  child: TraceRule,
  childOrigin: ProfileId,
  diagnostics: Diagnostic[],
): ProvenancedMapEntry<TraceRule> | undefined {
  const parent = existing.value;

  // Subset check: every child target must be covered by some parent target.
  for (const ct of child.target) {
    if (!targetCoveredBy(ct, parent.target)) {
      diagnostics.push({
        code: "PROFILE-MERGE-002",
        severity: "error",
        message: `traceability '${linkName}': child target ${
          stringifyMatcher(ct)
        } not covered by parent target [${
          parent.target.map(stringifyMatcher).join(", ")
        }] (${existing.origin} vs ${childOrigin})`,
        location: { file: "<merge>", line: 1, column: 1 },
      });
      return undefined;
    }
  }

  // Cardinality tightening (same rule as attribute cardinality).
  let cardinality = parent.cardinality;
  if (child.cardinality !== undefined) {
    const parentCard = parent.cardinality ??
      { lower: 0, upper: Infinity };
    if (child.cardinality.lower < parentCard.lower) {
      diagnostics.push(mergeRelaxation(
        `traceability '${linkName}'`,
        "cardinality.lower",
        `${parentCard.lower} (${existing.origin})`,
        `${child.cardinality.lower} (${childOrigin})`,
      ));
      return undefined;
    }
    if (child.cardinality.upper > parentCard.upper) {
      diagnostics.push(mergeRelaxation(
        `traceability '${linkName}'`,
        "cardinality.upper",
        `${formatUpper(parentCard.upper)} (${existing.origin})`,
        `${formatUpper(child.cardinality.upper)} (${childOrigin})`,
      ));
      return undefined;
    }
    cardinality = child.cardinality;
  }

  // Required flag: once required, cannot be un-required.
  if (parent.required === true && child.required === false) {
    diagnostics.push(mergeRelaxation(
      `traceability '${linkName}'`,
      "required",
      `true (${existing.origin})`,
      `false (${childOrigin})`,
    ));
    return undefined;
  }

  const merged: TraceRule = {
    target: child.target, // already proven to be a subset
    cardinality,
    required: parent.required || child.required,
  };
  const overrides = [
    ...(existing.overrides ?? []),
    existing.origin,
  ];
  return { value: merged, origin: childOrigin, overrides };
}

/**
 * True when a child target matcher is covered by the parent's target list.
 * A type-name matcher is covered by an identical type-name matcher, or by a
 * shape matcher whose shape this type is declared under — but in v1 we don't
 * resolve type→shape here (the profile's types map isn't available to us in
 * this module without threading it through). So we accept:
 *   - exact type-name match in parent list
 *   - OR any {shape: X} in parent list covers any type-name matcher
 *     (conservative: type-name matchers inherit from their shape at validator
 *     time; subset merge trusts that type-name ⊆ its-shape).
 *   - AND {shape: X} in child covered only by identical {shape: X} in parent.
 */
function targetCoveredBy(
  child: import("../model/mod.ts").TargetMatcher,
  parentList: readonly import("../model/mod.ts").TargetMatcher[],
): boolean {
  if (typeof child === "string") {
    // Type-name matcher.
    for (const p of parentList) {
      if (typeof p === "string" && p === child) return true;
      if (typeof p !== "string") return true; // any shape matcher covers type names
    }
    return false;
  }
  // Shape matcher — only covered by an identical shape matcher in parent.
  for (const p of parentList) {
    if (typeof p !== "string" && p.shape === child.shape) return true;
  }
  return false;
}

function stringifyMatcher(
  m: import("../model/mod.ts").TargetMatcher,
): string {
  return typeof m === "string" ? m : `{shape: ${m.shape}}`;
}
```

Also add `TargetMatcher` to the top-of-file import list and replace the inline
imports:

```typescript
import type {
  AttrDecl,
  Diagnostic,
  DocTypeDef,
  EffectiveProfile,
  EffectiveShapeScope,
  EffectiveTypeDef,
  LoadedProfile,
  ProfileChain,
  ProfileId,
  ProfileManifest,
  ProvenancedMap,
  ProvenancedMapEntry,
  ProvenancedValue,
  TargetMatcher,
  TraceRule,
  TypeDef,
} from "../model/mod.ts";
```

Then change `targetCoveredBy`'s signature to use `TargetMatcher` directly and
drop the inline `import(...)` syntax.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/merge_test.ts` Expected: all
tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/merge.ts packages/markspec/core/profile/merge_test.ts
git commit -m "feat(core): traceability target subset rule + rule-level tightening"
```

---

## Task 3.8 — Wire merge into `loadChain` + e2e fixture tests

Replace `loadChain`'s placeholder `effective` with a call to `mergeChain`.
Export `mergeChain` through the barrels. Add e2e fixtures + tests exercising a
real two-tier chain through `markspec validate`.

**Files:**

- Modify: `packages/markspec/core/profile/chain.ts`
- Modify: `packages/markspec/core/profile/mod.ts`
- Modify: `packages/markspec/core/mod.ts`
- Create: `tests/fixtures/profiles/phase3/base/markspec.yaml`
- Create: `tests/fixtures/profiles/phase3/child-valid/markspec.yaml`
- Create: `tests/fixtures/profiles/phase3/child-relaxation/markspec.yaml`
- Create: `tests/e2e/profile_merge_test.ts`

- [ ] **Step 1: Wire `mergeChain` into `loadChain`**

In `packages/markspec/core/profile/chain.ts`:

1. Add import at the top: `import { mergeChain } from "./merge.ts";`
2. Delete the `buildPlaceholderEffective` helper (from Task 3.2).
3. Replace the return-site `placeholderEffective` usage with a real merge call:

```typescript
const preliminary = {
  tiers,
  effective: undefined as unknown as EffectiveProfile,
};
// (A temporary shape — immediately replaced below.)

const mergeResult = mergeChain({
  tiers,
  effective: undefined as unknown as EffectiveProfile, // seed; mergeChain only reads tiers
});
diagnostics.push(...mergeResult.diagnostics);
if (!mergeResult.effective) {
  return { chain: null, diagnostics };
}
return {
  chain: { tiers, effective: mergeResult.effective },
  diagnostics,
};
```

Alternatively (cleaner), refactor `mergeChain` to accept
`readonly LoadedProfile[]` directly instead of a full `ProfileChain`. Change the
signature to:

```typescript
export function mergeChain(tiers: readonly LoadedProfile[]): MergeResult;
```

and update callers. The `ProfileChain` container is built by `loadChain` after
merging succeeds.

Pick one approach and apply consistently. Either works; the signature change is
preferred if existing merge tests can be updated in tandem.

4. If you refactored the signature, update `merge_test.ts`'s test helpers
   (`singleTierChain`, `multiTierChain`) to return `LoadedProfile[]` instead of
   a full chain, and update each test's `mergeChain(chain)` call accordingly.

- [ ] **Step 2: Run unit tests**

Run:
`deno test packages/markspec/core/profile/merge_test.ts packages/markspec/core/profile/chain_test.ts`
Expected: all tests pass.

- [ ] **Step 3: Export `mergeChain` from barrels**

In `packages/markspec/core/profile/mod.ts`, append:

```typescript
export { mergeChain } from "./merge.ts";
export type { MergeResult } from "./merge.ts";
```

In `packages/markspec/core/mod.ts`, extend the existing
`Profile system (ADR-008)` re-export block:

```typescript
export {
  loadChain,
  loadProfileForCommand,
  mergeChain,
  parseManifest,
  resolveLocalSpecifier,
} from "./profile/mod.ts";
export type {
  LoadChainResult,
  LoadProfileForCommandResult,
  MergeResult,
  ParseManifestResult,
  ResolvedProfileSource,
} from "./profile/mod.ts";
```

- [ ] **Step 4: Full workspace check**

Run: `deno task check && deno task test` Expected: green.

- [ ] **Step 5: Create e2e fixtures**

Create `tests/fixtures/profiles/phase3/base/markspec.yaml`:

```yaml
id: "@acme/phase3-base"
version: 1.0.0
description: Phase 3 e2e — parent base profile
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved, deprecated]
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: warn
      attributes:
        - name: Rationale
          type: text
      traceability:
        Derived-from:
          target: [{ shape: identified }]
          cardinality: 0..N
```

Create `tests/fixtures/profiles/phase3/child-valid/markspec.yaml`:

```yaml
id: "@acme/phase3-child"
version: 1.0.0
description: Phase 3 e2e — valid child that tightens the base
extends: "../base"
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved] # narrowed
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: error # tightened
      traceability:
        Derived-from:
          target: [{ shape: identified }]
          cardinality: 1..N # tightened
```

Create `tests/fixtures/profiles/phase3/child-relaxation/markspec.yaml`:

```yaml
id: "@acme/phase3-bad-child"
version: 1.0.0
description: Phase 3 e2e — child that relaxes (invalid)
extends: "../base"
profile:
  attributes:
    - name: Status
      type: enum
      values: [
        draft,
        approved,
        deprecated,
        new-value,
      ] # added 'new-value' — relaxation
```

- [ ] **Step 6: Write e2e tests**

Create `tests/e2e/profile_merge_test.ts`:

```typescript
/**
 * @module tests/e2e/profile_merge_test
 *
 * E2E tests for extends-chain + merge through `markspec validate`.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: phase3-e2e\nversion: 0.1.0\n`;

const BASE_YAML = `id: "@acme/phase3-base"
version: 1.0.0
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved, deprecated]
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
`;

const CHILD_VALID_YAML = `id: "@acme/phase3-child"
version: 1.0.0
extends: "../base"
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved]
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
`;

const CHILD_RELAX_YAML = `id: "@acme/phase3-bad-child"
version: 1.0.0
extends: "../base"
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved, deprecated, new-value]
`;

const REQ_MD = `# Example

- [NOTE-001] A note

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
`;

Deno.test("profile merge e2e: valid two-tier chain loads cleanly", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/child\n`,
      "profiles/base/markspec.yaml": BASE_YAML,
      "profiles/child/markspec.yaml": CHILD_VALID_YAML,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 0);
  // No merge / load errors in stderr
  const lines = stderr.split("\n").filter((l) =>
    l.includes("PROFILE-LOAD") || l.includes("PROFILE-MERGE")
  );
  assertEquals(lines, []);
});

Deno.test("profile merge e2e: relaxation in child fails with PROFILE-MERGE-001", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/child\n`,
      "profiles/base/markspec.yaml": BASE_YAML,
      "profiles/child/markspec.yaml": CHILD_RELAX_YAML,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "PROFILE-MERGE-001");
});

Deno.test("profile merge e2e: direct extends cycle fails with PROFILE-LOAD-004", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/a\n`,
      "profiles/a/markspec.yaml":
        `id: "@acme/a"\nversion: 1.0.0\nextends: "../b"\n`,
      "profiles/b/markspec.yaml":
        `id: "@acme/b"\nversion: 1.0.0\nextends: "../a"\n`,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "PROFILE-LOAD-004");
});

Deno.test("profile merge e2e: unreachable parent in chain fails with PROFILE-LOAD-001", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/leaf\n`,
      "profiles/leaf/markspec.yaml":
        `id: "@acme/leaf"\nversion: 1.0.0\nextends: "../missing"\n`,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "PROFILE-LOAD-001");
});
```

- [ ] **Step 7: Run the e2e test file**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/profile_merge_test.ts`
Expected: all 4 tests pass.

- [ ] **Step 8: Run full suite**

Run: `deno task test` Expected: all tests pass. Count is prior total + 4 e2e +
(however many unit tests were added by Tasks 3.3–3.7, expected ~25–30 new).

- [ ] **Step 9: Commit**

```bash
git add packages/markspec/core/profile/chain.ts packages/markspec/core/profile/mod.ts packages/markspec/core/mod.ts tests/fixtures/profiles/phase3 tests/e2e/profile_merge_test.ts
git commit -m "feat(core): wire merge into loadChain + e2e coverage"
```

---

## Phase 3 acceptance

All tasks checked, all commits on `feat/profile-system-phase-3`,
`deno task test` green, `deno task check` clean. Loader + merger covers:

- Multi-tier chains walked from leaf to root via `extends:` (local paths only;
  git still Phase 4).
- Cycle detection via `PROFILE-LOAD-004` (direct, self, and multi-step cycles).
- Depth limit 20 via `PROFILE-LOAD-005`.
- Chain merged once at load, producing an `EffectiveProfile` with per-rule
  provenance.
- Additive rules: `required`, `attributes`, `labels`, `types`, per-type
  `attributes` + `traceability` keys — all unioned with provenance.
- Tightening rules: attribute cardinality (both bounds), enum values (subset),
  required flag, value-type (equality), plus type-level `display-id-pattern`
  identity + enforcement monotonic tightening — each relaxation emits
  `PROFILE-MERGE-001`.
- Subset rule: traceability targets must be ⊆ parent — violations emit
  `PROFILE-MERGE-002`.
- Traceability rule-level tightening (cardinality + required) treated
  analogously to attributes.
- `ProfileChain.effective` populated end-to-end; consumed by CLI only for
  diagnostic surface (validator wiring is Phase 5).
- E2E fixtures demonstrate happy-path, relaxation, cycle, and unreachable-parent
  flows through `markspec validate`.

---

## Self-review

**Spec coverage (§3):**

- ✅ §3.1 in-memory model — `EffectiveProfile`, `ProvenancedValue`,
  `ProvenancedMap`, `ProvenancedMapEntry` declared in Task 3.1; shape matches
  spec.
- ✅ §3.2 additive (union across tiers) — Task 3.4 covers every row of the
  additive table.
- ✅ §3.2 tightening (child may narrow, never relax) — Task 3.5 (attribute
  fields) + Task 3.6 (type-level fields). `display-id-pattern` identity rule in
  3.6.
- ✅ §3.2 subset (traceability targets) — Task 3.7.
- ✅ §3.3 scope layering within one profile — implicitly via the tightening
  primitives that apply the same rule within a tier. Explicit cross-scope ⊂
  chain (`profile.required ⊂ shape.required ⊂ type.required`) is **not directly
  exercised** by Phase 3 tests. Validator pipeline (Phase 5+) will exercise the
  combined effective set; flagged as a future-phase concern, not a Phase 3 gap.
- ✅ §3.4 load-time merge validation — all merge errors fail fast before
  returning a chain; violating tier IDs embedded in diagnostic messages; merge
  happens once inside `loadChain`.

**Placeholder scan:** No TBDs, TODOs, or vague "handle edge cases" instructions.
Every TDD cycle has complete code blocks.

**Type consistency:** `mergeChain` signature is consistent across Tasks 3.3–3.8
(takes a chain/tiers, returns `MergeResult`). Helper names (`unionList`,
`unionAttrMap`, `unionTraceMap`, `tightenAttr`, `tightenType`,
`tightenTraceRule`, `mergeRelaxation`) consistent across tasks.

**Known minor caveat:** the merge error-accumulation strategy (push diagnostic,
keep going to find more errors, but also return `effective: null` if any error
fires) follows the Phase-1 precedent (`parseManifest`). The tests assert only
the first diagnostic's code; they don't assert that exactly one is emitted. This
is intentional — multiple relaxations in one merge should all surface, and the
test harness shouldn't be coupled to ordering.

**Scope check:** single subsystem, fits one PR.

---

## Execution handoff

Plan complete and saved to
`docs/superpowers/plans/2026-04-22-adr-008-profile-system-v1-phase-3.md`. Two
execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task,
   review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans,
   batch execution with checkpoints.

Which approach?
