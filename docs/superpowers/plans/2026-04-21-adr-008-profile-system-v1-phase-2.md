# ADR-008 Profile System v1 — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `.markspec.yaml` consumer binding + single local profile load, so
a markspec project can declare an active profile and the CLI surfaces
profile-load errors even before anything consumes the loaded profile.

**Architecture:** Three new leaf modules (`core/config/markspec.ts`,
`core/profile/resolver.ts`, `core/profile/chain.ts`) plus a thin orchestrator
(`loadProfileForCommand`) called by every profile-aware CLI command. Walking the
`extends:` chain and merging tiers stay out of scope — a Phase 2 chain is always
exactly one tier.

**Tech Stack:** Deno + TypeScript, `@std/yaml`, `@std/path`, `@std/assert`.
Composes with the Phase 1 `parseManifest` parser. Reuses the existing `ReadFile`
abstraction from `core/config/mod.ts` for testability.

**Spec:**
[docs/superpowers/specs/2026-04-21-adr-008-profile-system-v1-design.md](../specs/2026-04-21-adr-008-profile-system-v1-design.md),
§7.5 (Chain resolution) + §7.6 (Consumer binding) + §7.7 (Error codes).

**Phase 1 state:** merged PR #227, branch `feat/profile-system-phase-1`. Phase 2
stacks on top (`feat/profile-system-phase-2` branched from Phase 1 branch).

---

## Scope

### In Phase 2

- **`.markspec.yaml` loader** — discover at project root (sibling of
  `project.yaml`), parse, validate shape (`profiles:` list of strings), reject
  unknown top-level keys with a warning.
- **Local specifier resolver** — resolve `{ kind: "local", path }` specifiers
  against a context directory, read `markspec.yaml` from the target dir.
- **Single-profile chain loader** — compose resolver + `parseManifest` to
  produce one `LoadedProfile`, wrapped in a one-element `ProfileChain`. No
  extends walking.
- **`loadProfileForCommand` orchestrator** — single public entry point for the
  CLI: "given a project root, give me the active profile chain (or null) plus
  any diagnostics." Called by every profile-aware command.
- **CLI wiring** — hook `loadProfileForCommand` into `validate`, `compile`,
  `format`, `show`, `context`, `report`. Surface load diagnostics to the user;
  exit non-zero on load errors.
- **E2E coverage** — fixture-based tests confirming happy path + common errors
  (missing profile, multiple profiles, unknown key, malformed YAML).

### Deferred (not Phase 2)

- **`extends:` chain resolution + merge semantics** — Phase 3.
- **Git specifier resolution + cache** — Phase 4.
- **Validator pipeline stages** — Phases 5–7 (the loaded profile is held but
  nothing consumes it yet in Phase 2; consumption lands in Phase 5).
- **Generated inverses** — Phase 8.
- **`markspec profile add` / `doctor` CLI** — Phase 9.

### Diagnostic codes introduced in Phase 2

| Code                | Severity | Meaning                                                          |
| ------------------- | -------- | ---------------------------------------------------------------- |
| `MARKSPEC-YAML-001` | warning  | Unknown top-level key in `.markspec.yaml`                        |
| `MARKSPEC-YAML-002` | error    | YAML parse error in `.markspec.yaml`                             |
| `MARKSPEC-YAML-003` | error    | Schema error in `.markspec.yaml` (shape / type of field)         |
| `PROFILE-LOAD-001`  | error    | Specifier unresolvable (local path missing, or file read failed) |
| `PROFILE-LOAD-006`  | error    | `.markspec.yaml` declares multiple content-bearing profiles      |

`PROFILE-LOAD-002` and `PROFILE-LOAD-003` are already emitted from the Phase 1
`parseManifest`; they still apply when a profile's own `markspec.yaml` is
malformed.

---

## Files this PR creates or modifies

### New files

- `packages/markspec/core/config/markspec.ts` — `.markspec.yaml` loader
  (discovery, parse, schema validation).
- `packages/markspec/core/config/markspec_test.ts` — unit tests for the loader.
- `packages/markspec/core/profile/resolver.ts` — local specifier resolver.
- `packages/markspec/core/profile/resolver_test.ts` — unit tests.
- `packages/markspec/core/profile/chain.ts` — single-profile chain loader.
- `packages/markspec/core/profile/chain_test.ts` — unit tests.
- `packages/markspec/core/profile/load.ts` — `loadProfileForCommand`
  orchestrator (kept separate from `chain.ts` so its CLI-oriented concerns don't
  leak into the pure chain logic).
- `packages/markspec/core/profile/load_test.ts` — unit tests.
- `tests/e2e/profile_loader_test.ts` — end-to-end CLI tests exercising the whole
  loader through `markspec validate`.
- `tests/fixtures/profiles/phase2/minimal/markspec.yaml` — fixture profile with
  a single type, used by e2e happy path.

### Modified files

- `packages/markspec/core/model/profile.ts` — add `LoadedProfile` and
  `ProfileChain` types.
- `packages/markspec/core/model/mod.ts` — re-export the new types.
- `packages/markspec/core/profile/mod.ts` — re-export the new public API.
- `packages/markspec/core/mod.ts` — re-export `loadProfileForCommand` and
  related types for CLI consumption.
- `packages/markspec/main.ts` — call `loadProfileForCommand` in each
  profile-aware command.

No changes to: `core/validator/**`, `core/compiler/**`, `core/parser/**`,
`core/formatter/**`. The profile is loaded and held but not yet consumed.

---

## Task overview

| #   | Task                                     | Files touched                                     |
| --- | ---------------------------------------- | ------------------------------------------------- |
| 2.1 | Profile runtime types                    | `model/profile.ts`, `model/mod.ts`                |
| 2.2 | `.markspec.yaml` loader — discovery      | `config/markspec.ts`, `config/markspec_test.ts`   |
| 2.3 | `.markspec.yaml` loader — parse + schema | `config/markspec.ts`, `config/markspec_test.ts`   |
| 2.4 | Local specifier resolver                 | `profile/resolver.ts`, `profile/resolver_test.ts` |
| 2.5 | Single-profile chain loader              | `profile/chain.ts`, `profile/chain_test.ts`       |
| 2.6 | `loadProfileForCommand` orchestrator     | `profile/load.ts`, `profile/load_test.ts`         |
| 2.7 | Export from barrels                      | `profile/mod.ts`, `core/mod.ts`                   |
| 2.8 | Wire into `main.ts`                      | `main.ts`                                         |
| 2.9 | End-to-end fixture test                  | `tests/e2e/profile_loader_test.ts`, fixture YAML  |

Each task is one commit. Every task follows TDD where it introduces new code
paths.

---

## Task 2.1 — Profile runtime types (`LoadedProfile`, `ProfileChain`)

Add the runtime data structures that the resolver, chain loader, and
orchestrator produce. No logic yet — pure type declarations.

**Files:**

- Modify: `packages/markspec/core/model/profile.ts`
- Modify: `packages/markspec/core/model/mod.ts`

- [ ] **Step 1: Extend `model/profile.ts`**

Append to `packages/markspec/core/model/profile.ts` (after the existing
`ProfileManifest` interface, before the final closing brace of the file — the
file has no classes, so just append at EOF):

```typescript
// ---------------------------------------------------------------------------
// Runtime: loaded profile + chain
// ---------------------------------------------------------------------------

/**
 * A profile after it has been resolved and parsed. One tier of a
 * {@linkcode ProfileChain}.
 *
 * `sourcePath` is the absolute path of the `markspec.yaml` the manifest was
 * parsed from. `baseDir` is the directory containing that file — used as the
 * context for resolving this profile's `extends:` (in Phase 3+).
 */
export interface LoadedProfile {
  readonly id: string;
  readonly version: string;
  readonly specifier: ProfileSpecifier;
  readonly manifest: ProfileManifest;
  readonly sourcePath: string;
  readonly baseDir: string;
}

/**
 * The resolved profile chain for a project. A Phase 2 chain always contains
 * exactly one tier (no `extends:` walking). Phase 3 introduces multi-tier
 * chains ordered root-parent → leaf-child.
 */
export interface ProfileChain {
  readonly tiers: readonly LoadedProfile[];
}
```

- [ ] **Step 2: Re-export from model barrel**

Modify `packages/markspec/core/model/mod.ts` — find the `export type {` block
from Phase 1 (it re-exports `AttrDecl`, `Cardinality`, etc. from
`./profile.ts`). Add `LoadedProfile` and `ProfileChain` to that list so the
block reads (alphabetized):

```typescript
export type {
  AttrDecl,
  Cardinality,
  DocTypeDef,
  EnforcementMode,
  InverseDecl,
  LoadedProfile,
  ProfileChain,
  ProfileManifest,
  ProfileSpecifier,
  TargetMatcher,
  TraceRule,
  TypeDef,
  ValueType,
} from "./profile.ts";
```

- [ ] **Step 3: Type-check both files**

Run:
`deno check packages/markspec/core/model/profile.ts packages/markspec/core/model/mod.ts`
Expected: no errors.

- [ ] **Step 4: Run the full workspace check**

Run: `deno task check` (or `just check`) Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/model/profile.ts packages/markspec/core/model/mod.ts
git commit -m "feat(core): LoadedProfile and ProfileChain runtime types"
```

---

## Task 2.2 — `.markspec.yaml` loader: discovery

Discover a `.markspec.yaml` file at a known project root and return its raw
contents (or `null` if absent). No parsing yet — that's Task 2.3.

**Files:**

- Create: `packages/markspec/core/config/markspec.ts`
- Create: `packages/markspec/core/config/markspec_test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/markspec/core/config/markspec_test.ts`:

```typescript
/**
 * @module core/config/markspec_test
 *
 * Unit tests for .markspec.yaml loading.
 */

import { assertEquals } from "@std/assert";
import { MARKSPEC_YAML_FILENAME, readMarkspecYaml } from "./markspec.ts";

function mockReadFile(map: Record<string, string>) {
  return async (path: string): Promise<string | undefined> => map[path];
}

Deno.test("readMarkspecYaml: returns null when file absent", async () => {
  const result = await readMarkspecYaml(
    "/project",
    mockReadFile({}),
  );
  assertEquals(result, null);
});

Deno.test("readMarkspecYaml: returns contents when file present", async () => {
  const result = await readMarkspecYaml(
    "/project",
    mockReadFile({
      [`/project/${MARKSPEC_YAML_FILENAME}`]: "profiles: []\n",
    }),
  );
  assertEquals(result, "profiles: []\n");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test packages/markspec/core/config/markspec_test.ts` Expected: FAIL
with `Cannot find module './markspec.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/markspec/core/config/markspec.ts`:

```typescript
/**
 * @module core/config/markspec
 *
 * Load and validate `.markspec.yaml` — the consumer-project binding that
 * declares which profiles the project uses.
 *
 * Emits diagnostics (MARKSPEC-YAML-*) on parse or schema errors. See
 * [spec §7.6](../../../../docs/superpowers/specs/2026-04-21-adr-008-profile-system-v1-design.md).
 */

import { join } from "@std/path";
import type { ReadFile } from "./mod.ts";

/** The consumer-binding config filename, placed next to `project.yaml`. */
export const MARKSPEC_YAML_FILENAME = ".markspec.yaml";

/**
 * Read a `.markspec.yaml` file at the given project root.
 *
 * @param projectRoot - Absolute path to the directory containing `project.yaml`
 * @param readFile - File reader (returns `undefined` when missing)
 * @returns Raw file contents, or `null` when the file is absent
 */
export async function readMarkspecYaml(
  projectRoot: string,
  readFile: ReadFile,
): Promise<string | null> {
  const path = join(projectRoot, MARKSPEC_YAML_FILENAME);
  const content = await readFile(path);
  return content ?? null;
}
```

Note: `ReadFile` is already exported from `core/config/mod.ts`. Import it from
the sibling module.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/config/markspec_test.ts` Expected: both
tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/config/markspec.ts packages/markspec/core/config/markspec_test.ts
git commit -m "feat(core): .markspec.yaml discovery"
```

---

## Task 2.3 — `.markspec.yaml` loader: parse + schema validation

Parse the YAML, validate the shape (`profiles:` list of specifier strings), emit
diagnostics with the `MARKSPEC-YAML-*` codes. Each specifier string is parsed
into a `ProfileSpecifier`.

**Files:**

- Modify: `packages/markspec/core/config/markspec.ts`
- Modify: `packages/markspec/core/config/markspec_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/markspec/core/config/markspec_test.ts`:

```typescript
import { parseMarkspecYaml } from "./markspec.ts";

Deno.test("parseMarkspecYaml: empty file produces empty config", () => {
  const result = parseMarkspecYaml("", "/project/.markspec.yaml");
  assertEquals(result.diagnostics, []);
  assertEquals(result.config?.profiles, []);
});

Deno.test("parseMarkspecYaml: single local profile parsed", () => {
  const result = parseMarkspecYaml(
    `profiles:\n  - ./profiles/custom\n`,
    "/project/.markspec.yaml",
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.config?.profiles, [
    { kind: "local", path: "./profiles/custom" },
  ]);
});

Deno.test("parseMarkspecYaml: git specifier parsed", () => {
  const result = parseMarkspecYaml(
    `profiles:\n  - git+https://github.com/acme/base.git#v1.0\n`,
    "/project/.markspec.yaml",
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.config?.profiles[0], {
    kind: "git",
    repo: "https://github.com/acme/base.git",
    subpath: undefined,
    tag: "v1.0",
  });
});

Deno.test("parseMarkspecYaml: YAML parse error emits MARKSPEC-YAML-002", () => {
  const result = parseMarkspecYaml(
    `profiles: [\n  unclosed`,
    "/project/.markspec.yaml",
  );
  assertEquals(result.config, null);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-002");
  assertEquals(result.diagnostics[0].severity, "error");
});

Deno.test("parseMarkspecYaml: non-mapping root emits MARKSPEC-YAML-003", () => {
  const result = parseMarkspecYaml("42", "/project/.markspec.yaml");
  assertEquals(result.config, null);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-003");
});

Deno.test("parseMarkspecYaml: 'profiles' must be a list", () => {
  const result = parseMarkspecYaml(
    `profiles: "oops"\n`,
    "/project/.markspec.yaml",
  );
  assertEquals(result.config, null);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-003");
});

Deno.test("parseMarkspecYaml: non-string specifier in profiles errors", () => {
  const result = parseMarkspecYaml(
    `profiles:\n  - 42\n`,
    "/project/.markspec.yaml",
  );
  assertEquals(result.config, null);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-003");
});

Deno.test("parseMarkspecYaml: unknown top-level key warns", () => {
  const result = parseMarkspecYaml(
    `profiles: []\nbogus: 1\n`,
    "/project/.markspec.yaml",
  );
  // config still produced (warning, not error)
  assertEquals(result.config?.profiles, []);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-001");
  assertEquals(result.diagnostics[0].severity, "warning");
  const msg = result.diagnostics[0].message;
  if (!msg.includes("bogus")) {
    throw new Error(`expected 'bogus' in message, got: ${msg}`);
  }
});

Deno.test("parseMarkspecYaml: malformed specifier errors", () => {
  const result = parseMarkspecYaml(
    `profiles:\n  - "oops-not-local-or-git"\n`,
    "/project/.markspec.yaml",
  );
  assertEquals(result.config, null);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-003");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/config/markspec_test.ts` Expected: the
nine new tests FAIL with `Cannot find name 'parseMarkspecYaml'` (or similar).

- [ ] **Step 3: Implement `parseMarkspecYaml`**

Modify `packages/markspec/core/config/markspec.ts`. Add the new imports at the
top and append the new types/functions:

```typescript
// Add to imports at the top of the file:
import { parse as parseYaml } from "@std/yaml";
import type { Diagnostic, ProfileSpecifier } from "../model/mod.ts";

// ---------------------------------------------------------------------------
// Parsed .markspec.yaml shape
// ---------------------------------------------------------------------------

/** The parsed content of a `.markspec.yaml`. */
export interface MarkspecYaml {
  readonly profiles: readonly ProfileSpecifier[];
}

/** Result of parsing a `.markspec.yaml` string. */
export interface ParseMarkspecYamlResult {
  readonly config: MarkspecYaml | null;
  readonly diagnostics: readonly Diagnostic[];
}

const ALLOWED_MARKSPEC_YAML_KEYS = new Set(["profiles"]);

/**
 * Parse and validate a `.markspec.yaml` string.
 *
 * - `MARKSPEC-YAML-002` — YAML parse error.
 * - `MARKSPEC-YAML-003` — schema error (wrong type, bad specifier).
 * - `MARKSPEC-YAML-001` — unknown top-level key (warning; config still produced).
 */
export function parseMarkspecYaml(
  rawYaml: string,
  sourcePath: string,
): ParseMarkspecYamlResult {
  const diagnostics: Diagnostic[] = [];

  // Empty file is equivalent to `profiles: []`
  const trimmed = rawYaml.trim();
  if (trimmed.length === 0) {
    return { config: { profiles: [] }, diagnostics };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(rawYaml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    diagnostics.push({
      code: "MARKSPEC-YAML-002",
      severity: "error",
      message: `.markspec.yaml: YAML parse error: ${message}`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { config: null, diagnostics };
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    diagnostics.push({
      code: "MARKSPEC-YAML-003",
      severity: "error",
      message: ".markspec.yaml must be a YAML mapping",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { config: null, diagnostics };
  }

  const root = parsed as Record<string, unknown>;

  // Unknown keys — warn, but continue parsing.
  for (const key of Object.keys(root)) {
    if (!ALLOWED_MARKSPEC_YAML_KEYS.has(key)) {
      diagnostics.push({
        code: "MARKSPEC-YAML-001",
        severity: "warning",
        message: `.markspec.yaml: unknown top-level key '${key}'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    }
  }

  const rawProfiles = root.profiles;
  if (rawProfiles !== undefined && !Array.isArray(rawProfiles)) {
    diagnostics.push({
      code: "MARKSPEC-YAML-003",
      severity: "error",
      message: ".markspec.yaml: 'profiles' must be a list",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { config: null, diagnostics };
  }

  const profiles: ProfileSpecifier[] = [];
  if (Array.isArray(rawProfiles)) {
    for (let i = 0; i < rawProfiles.length; i++) {
      const spec = parseProfileSpecifier(
        rawProfiles[i],
        `.markspec.yaml: profiles[${i}]`,
        sourcePath,
        diagnostics,
      );
      if (spec) profiles.push(spec);
    }
  }

  // If any specifier failed to parse, treat the whole file as invalid.
  const hasErrors = diagnostics.some((d) => d.severity === "error");
  if (hasErrors) {
    return { config: null, diagnostics };
  }

  return { config: { profiles }, diagnostics };
}

/**
 * Parse a single specifier string into a {@linkcode ProfileSpecifier}.
 * Emits `MARKSPEC-YAML-003` on malformed input.
 */
function parseProfileSpecifier(
  raw: unknown,
  context: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): ProfileSpecifier | undefined {
  if (typeof raw !== "string" || raw.length === 0) {
    diagnostics.push({
      code: "MARKSPEC-YAML-003",
      severity: "error",
      message: `${context}: specifier must be a non-empty string`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  if (raw.startsWith("./") || raw.startsWith("../")) {
    return { kind: "local", path: raw };
  }
  if (raw.startsWith("git+")) {
    const m = /^git\+(https?:\/\/[^#]+?\.git)(\/[^#]+)?#(.+)$/.exec(raw);
    if (!m) {
      diagnostics.push({
        code: "MARKSPEC-YAML-003",
        severity: "error",
        message:
          `${context}: git specifier malformed; expected git+https://host/.git[/subpath]#<tag>`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    const [, repo, rawSubpath, tag] = m;
    const subpath = rawSubpath ? rawSubpath.slice(1) : undefined;
    return { kind: "git", repo, subpath, tag };
  }
  diagnostics.push({
    code: "MARKSPEC-YAML-003",
    severity: "error",
    message:
      `${context}: unsupported specifier scheme (use './path' or 'git+https://…#<tag>')`,
    location: { file: sourcePath, line: 1, column: 1 },
  });
  return undefined;
}
```

Design note: the specifier-parser is duplicated from the private
`parseSpecifier` in `core/profile/manifest.ts`. Extracting a shared helper is
deferred until the duplication feels painful — their error codes differ
(`MARKSPEC-YAML-003` vs `PROFILE-LOAD-003`) so parametrizing that would cost as
much as duplicating.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/config/markspec_test.ts` Expected: all 11
tests PASS (2 from Task 2.2 + 9 new).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/config/markspec.ts packages/markspec/core/config/markspec_test.ts
git commit -m "feat(core): .markspec.yaml parse + schema validation"
```

---

## Task 2.4 — Local specifier resolver

Resolve a `{ kind: "local", path }` specifier against a base directory: read
`<baseDir>/<path>/markspec.yaml` and return its contents plus resolved paths.
Emits `PROFILE-LOAD-001` when the target file cannot be read.

**Files:**

- Create: `packages/markspec/core/profile/resolver.ts`
- Create: `packages/markspec/core/profile/resolver_test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/markspec/core/profile/resolver_test.ts`:

```typescript
/**
 * @module core/profile/resolver_test
 *
 * Unit tests for local profile specifier resolution.
 */

import { assertEquals } from "@std/assert";
import { resolveLocalSpecifier } from "./resolver.ts";
import type { Diagnostic } from "../model/mod.ts";

function mockReadFile(map: Record<string, string>) {
  return async (path: string): Promise<string | undefined> => map[path];
}

Deno.test("resolveLocalSpecifier: happy path reads markspec.yaml", async () => {
  const diagnostics: Diagnostic[] = [];
  const result = await resolveLocalSpecifier(
    { kind: "local", path: "./profiles/custom" },
    "/project",
    mockReadFile({
      "/project/profiles/custom/markspec.yaml": "id: @acme/x\nversion: 1.0.0\n",
    }),
    diagnostics,
  );
  assertEquals(diagnostics, []);
  assertEquals(result?.rawYaml, "id: @acme/x\nversion: 1.0.0\n");
  assertEquals(result?.sourcePath, "/project/profiles/custom/markspec.yaml");
  assertEquals(result?.baseDir, "/project/profiles/custom");
});

Deno.test("resolveLocalSpecifier: missing markspec.yaml emits PROFILE-LOAD-001", async () => {
  const diagnostics: Diagnostic[] = [];
  const result = await resolveLocalSpecifier(
    { kind: "local", path: "./profiles/missing" },
    "/project",
    mockReadFile({}),
    diagnostics,
  );
  assertEquals(result, null);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "PROFILE-LOAD-001");
  assertEquals(diagnostics[0].severity, "error");
  const msg = diagnostics[0].message;
  if (!msg.includes("./profiles/missing")) {
    throw new Error(`expected specifier in message, got: ${msg}`);
  }
});

Deno.test("resolveLocalSpecifier: parent-relative path resolves correctly", async () => {
  const diagnostics: Diagnostic[] = [];
  const result = await resolveLocalSpecifier(
    { kind: "local", path: "../shared/base" },
    "/workspace/project",
    mockReadFile({
      "/workspace/shared/base/markspec.yaml":
        "id: @acme/base\nversion: 1.0.0\n",
    }),
    diagnostics,
  );
  assertEquals(diagnostics, []);
  assertEquals(result?.sourcePath, "/workspace/shared/base/markspec.yaml");
  assertEquals(result?.baseDir, "/workspace/shared/base");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/resolver_test.ts` Expected: FAIL
with `Cannot find module './resolver.ts'`.

- [ ] **Step 3: Implement the resolver**

Create `packages/markspec/core/profile/resolver.ts`:

```typescript
/**
 * @module core/profile/resolver
 *
 * Resolve a {@linkcode ProfileSpecifier} into the raw `markspec.yaml`
 * contents + resolved paths, ready for the chain loader to parse.
 *
 * Phase 2 supports local specifiers only. Git specifiers land in Phase 4.
 */

import { join, resolve } from "@std/path";
import type { ReadFile } from "../config/mod.ts";
import type { Diagnostic, ProfileSpecifier } from "../model/mod.ts";

/**
 * A profile that has been located on disk (or in a cache) and read.
 * Ready for the chain loader to hand to `parseManifest`.
 */
export interface ResolvedProfileSource {
  /** Raw `markspec.yaml` contents. */
  readonly rawYaml: string;
  /** Absolute path of `<baseDir>/markspec.yaml`. */
  readonly sourcePath: string;
  /** Absolute directory the profile lives in (used for future extends resolution). */
  readonly baseDir: string;
}

/**
 * Resolve a local specifier. The specifier's `path` is joined to `contextDir`
 * and the `markspec.yaml` inside that directory is read.
 *
 * @param specifier - The local-kind specifier
 * @param contextDir - Absolute path of the directory that declared the specifier
 *                      (the `.markspec.yaml` parent dir for top-level specifiers)
 * @param readFile - File reader abstraction
 * @param diagnostics - Accumulator for emit errors (PROFILE-LOAD-001)
 */
export async function resolveLocalSpecifier(
  specifier: Extract<ProfileSpecifier, { kind: "local" }>,
  contextDir: string,
  readFile: ReadFile,
  diagnostics: Diagnostic[],
): Promise<ResolvedProfileSource | null> {
  const baseDir = resolve(contextDir, specifier.path);
  const sourcePath = join(baseDir, "markspec.yaml");
  const rawYaml = await readFile(sourcePath);
  if (rawYaml === undefined) {
    diagnostics.push({
      code: "PROFILE-LOAD-001",
      severity: "error",
      message: `profile specifier '${specifier.path}' cannot be resolved: ` +
        `no markspec.yaml at ${sourcePath}`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return null;
  }
  return { rawYaml, sourcePath, baseDir };
}
```

Note: `ReadFile` lives in `core/config/mod.ts`, hence the separate import line.
The main `core/mod.ts` barrel re-exports it for CLI use, but resolver.ts imports
it directly from its defining module to keep the dependency explicit.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/resolver_test.ts` Expected: all 3
tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/resolver.ts packages/markspec/core/profile/resolver_test.ts
git commit -m "feat(core): local profile specifier resolver"
```

---

## Task 2.5 — Single-profile chain loader

Compose the resolver with `parseManifest` (Phase 1) to produce one
`LoadedProfile`, wrapped in a one-element `ProfileChain`. Git specifiers are
acknowledged but left unimplemented (they emit `PROFILE-LOAD-001` with a
descriptive message) — Phase 4 lights them up.

**Files:**

- Create: `packages/markspec/core/profile/chain.ts`
- Create: `packages/markspec/core/profile/chain_test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/markspec/core/profile/chain_test.ts`:

```typescript
/**
 * @module core/profile/chain_test
 *
 * Unit tests for single-profile chain loading.
 */

import { assertEquals } from "@std/assert";
import { loadChain } from "./chain.ts";

function mockReadFile(map: Record<string, string>) {
  return async (path: string): Promise<string | undefined> => map[path];
}

Deno.test("loadChain: happy path returns a one-tier chain", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/custom" },
    "/project",
    mockReadFile({
      "/project/profiles/custom/markspec.yaml":
        `id: "@acme/custom"\nversion: 1.0.0\n`,
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 1);
  const tier = result.chain?.tiers[0];
  assertEquals(tier?.id, "@acme/custom");
  assertEquals(tier?.version, "1.0.0");
  assertEquals(tier?.specifier, { kind: "local", path: "./profiles/custom" });
  assertEquals(tier?.sourcePath, "/project/profiles/custom/markspec.yaml");
  assertEquals(tier?.baseDir, "/project/profiles/custom");
});

Deno.test("loadChain: unresolvable specifier propagates PROFILE-LOAD-001", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/missing" },
    "/project",
    mockReadFile({}),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-001");
});

Deno.test("loadChain: malformed manifest propagates PROFILE-LOAD-003", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/broken" },
    "/project",
    mockReadFile({
      "/project/profiles/broken/markspec.yaml": `no_id: true\n`,
    }),
  );
  assertEquals(result.chain, null);
  const codes = result.diagnostics.map((d) => d.code);
  // parseManifest emits PROFILE-LOAD-003 twice here (missing id AND missing version)
  assertEquals(codes[0], "PROFILE-LOAD-003");
});

Deno.test("loadChain: git specifier errors with PROFILE-LOAD-001 (Phase 4 scope)", async () => {
  const result = await loadChain(
    {
      kind: "git",
      repo: "https://github.com/acme/base.git",
      subpath: undefined,
      tag: "v1.0",
    },
    "/project",
    mockReadFile({}),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-001");
  const msg = result.diagnostics[0].message;
  if (!msg.toLowerCase().includes("git")) {
    throw new Error(`expected 'git' in message, got: ${msg}`);
  }
});

Deno.test("loadChain: manifest with extends: is loaded but extends is ignored", async () => {
  // Phase 2 does not walk extends. The chain is the single leaf profile.
  // Phase 3 will replace this behavior with real chain resolution.
  const result = await loadChain(
    { kind: "local", path: "./profiles/leaf" },
    "/project",
    mockReadFile({
      "/project/profiles/leaf/markspec.yaml":
        `id: "@acme/leaf"\nversion: 1.0.0\nextends: "./parent"\n`,
      // parent intentionally unreadable — Phase 2 must not try to fetch it
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.chain?.tiers[0].id, "@acme/leaf");
  // The manifest still carries the parsed extends — Phase 3 will consume it.
  assertEquals(result.chain?.tiers[0].manifest.extends, {
    kind: "local",
    path: "./parent",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/chain_test.ts` Expected: FAIL
with `Cannot find module './chain.ts'`.

- [ ] **Step 3: Implement the chain loader**

Create `packages/markspec/core/profile/chain.ts`:

```typescript
/**
 * @module core/profile/chain
 *
 * Single-profile chain loader. Composes the resolver and `parseManifest` to
 * produce a one-element {@linkcode ProfileChain}.
 *
 * Phase 2 scope: local specifiers only, no `extends:` walking. A manifest's
 * `extends:` field is parsed (by Phase 1's parser) and preserved on the
 * returned {@linkcode LoadedProfile}, but nothing is fetched for it. Phase 3
 * replaces this with full chain walking + merge.
 */

import type { ReadFile } from "../config/mod.ts";
import type {
  Diagnostic,
  LoadedProfile,
  ProfileChain,
  ProfileSpecifier,
} from "../model/mod.ts";
import { parseManifest } from "./manifest.ts";
import { resolveLocalSpecifier } from "./resolver.ts";

/** Result of loading a profile chain. */
export interface LoadChainResult {
  readonly chain: ProfileChain | null;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Load a profile chain from a specifier. In Phase 2 the returned chain always
 * has exactly one tier.
 *
 * @param specifier - The leaf specifier (from `.markspec.yaml`)
 * @param contextDir - Directory the specifier was declared in (for local
 *                     path resolution)
 * @param readFile - File reader abstraction
 */
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

  const resolved = await resolveLocalSpecifier(
    specifier,
    contextDir,
    readFile,
    diagnostics as Diagnostic[],
  );
  if (!resolved) {
    return { chain: null, diagnostics };
  }

  const parsed = parseManifest(resolved.rawYaml, resolved.sourcePath);
  if (!parsed.manifest) {
    diagnostics.push(...parsed.diagnostics);
    return { chain: null, diagnostics };
  }
  diagnostics.push(...parsed.diagnostics);

  const tier: LoadedProfile = {
    id: parsed.manifest.id,
    version: parsed.manifest.version,
    specifier,
    manifest: parsed.manifest,
    sourcePath: resolved.sourcePath,
    baseDir: resolved.baseDir,
  };

  return { chain: { tiers: [tier] }, diagnostics };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/chain_test.ts` Expected: all 5
tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/chain.ts packages/markspec/core/profile/chain_test.ts
git commit -m "feat(core): single-profile chain loader"
```

---

## Task 2.6 — `loadProfileForCommand` orchestrator

Single public entry point the CLI calls. Composes `readMarkspecYaml` +
`parseMarkspecYaml` + `loadChain`. Enforces the "at most one content-bearing
profile" rule (`PROFILE-LOAD-006`). Returns the loaded chain (or null when no
`.markspec.yaml` exists or `profiles:` is empty).

**Files:**

- Create: `packages/markspec/core/profile/load.ts`
- Create: `packages/markspec/core/profile/load_test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/markspec/core/profile/load_test.ts`:

```typescript
/**
 * @module core/profile/load_test
 *
 * Unit tests for the loadProfileForCommand orchestrator.
 */

import { assertEquals } from "@std/assert";
import { loadProfileForCommand } from "./load.ts";

function mockReadFile(map: Record<string, string>) {
  return async (path: string): Promise<string | undefined> => map[path];
}

Deno.test("loadProfileForCommand: no .markspec.yaml returns null chain", async () => {
  const result = await loadProfileForCommand("/project", mockReadFile({}));
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics, []);
});

Deno.test("loadProfileForCommand: empty profiles list returns null chain", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({ "/project/.markspec.yaml": "profiles: []\n" }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics, []);
});

Deno.test("loadProfileForCommand: single local profile loads end-to-end", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml": `profiles:\n  - ./profiles/custom\n`,
      "/project/profiles/custom/markspec.yaml":
        `id: "@acme/custom"\nversion: 1.0.0\n`,
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.chain?.tiers[0].id, "@acme/custom");
});

Deno.test("loadProfileForCommand: multiple profiles emits PROFILE-LOAD-006", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml":
        `profiles:\n  - ./profiles/a\n  - ./profiles/b\n`,
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-006");
});

Deno.test("loadProfileForCommand: .markspec.yaml YAML error surfaces", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml": `profiles: [\n  unclosed`,
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-002");
});

Deno.test("loadProfileForCommand: unknown key warning does not block loading", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml":
        `profiles:\n  - ./profiles/custom\nbogus: true\n`,
      "/project/profiles/custom/markspec.yaml":
        `id: "@acme/custom"\nversion: 1.0.0\n`,
    }),
  );
  // Loading succeeded despite the warning
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-001");
  assertEquals(result.diagnostics[0].severity, "warning");
});

Deno.test("loadProfileForCommand: profile load errors propagate", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml": `profiles:\n  - ./profiles/missing\n`,
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-001");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/load_test.ts` Expected: FAIL with
`Cannot find module './load.ts'`.

- [ ] **Step 3: Implement the orchestrator**

Create `packages/markspec/core/profile/load.ts`:

```typescript
/**
 * @module core/profile/load
 *
 * The CLI-facing profile loader. Discovers `.markspec.yaml`, validates it,
 * resolves the active profile specifier, loads the chain, and surfaces any
 * diagnostics. Single entry point consumed by every profile-aware `markspec`
 * subcommand.
 */

import { parseMarkspecYaml, readMarkspecYaml } from "../config/markspec.ts";
import type { ReadFile } from "../config/mod.ts";
import type { Diagnostic, ProfileChain } from "../model/mod.ts";
import { loadChain } from "./chain.ts";

/** Result of `loadProfileForCommand`. */
export interface LoadProfileForCommandResult {
  /** The active profile chain, or `null` when no profile is declared / resolvable. */
  readonly chain: ProfileChain | null;
  /** All diagnostics gathered during loading. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Load the active profile chain for the project at `projectRoot`.
 *
 * Discovery: looks for `.markspec.yaml` at the project root (sibling of
 * `project.yaml`). Absent or empty → `chain: null` (core-only mode).
 *
 * v1 constraint: at most **one** content-bearing profile per project. Two or
 * more entries in `profiles:` produces `PROFILE-LOAD-006` and no chain.
 */
export async function loadProfileForCommand(
  projectRoot: string,
  readFile: ReadFile,
): Promise<LoadProfileForCommandResult> {
  const diagnostics: Diagnostic[] = [];

  const rawYaml = await readMarkspecYaml(projectRoot, readFile);
  if (rawYaml === null) {
    return { chain: null, diagnostics };
  }

  const sourcePath = `${projectRoot}/.markspec.yaml`;
  const parsed = parseMarkspecYaml(rawYaml, sourcePath);
  diagnostics.push(...parsed.diagnostics);
  if (!parsed.config) {
    return { chain: null, diagnostics };
  }

  const { profiles } = parsed.config;
  if (profiles.length === 0) {
    return { chain: null, diagnostics };
  }

  if (profiles.length > 1) {
    diagnostics.push({
      code: "PROFILE-LOAD-006",
      severity: "error",
      message: `.markspec.yaml declares ${profiles.length} profiles; ` +
        "v1 accepts at most one content-bearing profile per project",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { chain: null, diagnostics };
  }

  const chainResult = await loadChain(profiles[0], projectRoot, readFile);
  diagnostics.push(...chainResult.diagnostics);
  return { chain: chainResult.chain, diagnostics };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/load_test.ts` Expected: all 7
tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/load.ts packages/markspec/core/profile/load_test.ts
git commit -m "feat(core): loadProfileForCommand orchestrator"
```

---

## Task 2.7 — Export from barrels

Make `loadProfileForCommand` and its result type reachable through the main
`core/mod.ts` entry point so `main.ts` can consume it via a single dynamic
import. Also export the profile-loading primitives from `core/profile/mod.ts`
for downstream phases and tests.

**Files:**

- Modify: `packages/markspec/core/profile/mod.ts`
- Modify: `packages/markspec/core/mod.ts`

- [ ] **Step 1: Extend `core/profile/mod.ts`**

Open `packages/markspec/core/profile/mod.ts` and replace its contents with:

```typescript
/**
 * @module core/profile
 *
 * Public API for the profile system: loading, manifest parsing, chain
 * resolution, and merging. Consumed by the validator pipeline and the CLI.
 */

export { parseManifest } from "./manifest.ts";
export type { ParseManifestResult } from "./manifest.ts";

export { resolveLocalSpecifier } from "./resolver.ts";
export type { ResolvedProfileSource } from "./resolver.ts";

export { loadChain } from "./chain.ts";
export type { LoadChainResult } from "./chain.ts";

export { loadProfileForCommand } from "./load.ts";
export type { LoadProfileForCommandResult } from "./load.ts";
```

- [ ] **Step 2: Re-export from `core/mod.ts`**

Open `packages/markspec/core/mod.ts` and find the existing export block (below
the config re-exports). Append:

```typescript
// Profile system (ADR-008)
export {
  loadChain,
  loadProfileForCommand,
  parseManifest,
  resolveLocalSpecifier,
} from "./profile/mod.ts";
export type {
  LoadChainResult,
  LoadProfileForCommandResult,
  ParseManifestResult,
  ResolvedProfileSource,
} from "./profile/mod.ts";
```

Also re-export the `.markspec.yaml` loader so the CLI or external consumers can
reach it without importing from `core/config/markspec.ts` directly. Find the
existing `config` section of `core/mod.ts` and add alongside:

```typescript
export {
  MARKSPEC_YAML_FILENAME,
  parseMarkspecYaml,
  readMarkspecYaml,
} from "./config/markspec.ts";
export type {
  MarkspecYaml,
  ParseMarkspecYamlResult,
} from "./config/markspec.ts";
```

(Read `core/mod.ts` first to see where the existing config re-exports live and
match that style.)

- [ ] **Step 3: Type-check the full workspace**

Run: `deno task check` Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `deno task test` Expected: all tests pass (322 Phase 1 + 25 Phase 2 unit
tests so far).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/mod.ts packages/markspec/core/mod.ts
git commit -m "feat(core): export profile loader from public barrel"
```

---

## Task 2.8 — Wire `loadProfileForCommand` into `main.ts` profile-aware commands

Call `loadProfileForCommand` in every subcommand that would ever consume a
profile (`validate`, `compile`, `format`, `show`, `context`, `report`). Print
diagnostics to stderr using the same `severity[code]: file:line message` format
the rest of the CLI uses. Exit non-zero when an error-severity load diagnostic
fires.

The loaded chain itself is **not** consumed yet (nothing reads it); this wiring
is the plumbing that downstream phases light up.

**Files:**

- Modify: `packages/markspec/main.ts`

- [ ] **Step 1: Read the file and locate the existing command handlers**

Run: `grep -n "async action" packages/markspec/main.ts` Expected: several action
handlers for `format`, `validate`, `compile`, `show`, `context`, `report`. Note
their line numbers for the edit below. Also grep for the existing
`requireProjectConfig` helper — you'll reuse its pattern for consistency.

- [ ] **Step 2: Add a shared `loadActiveProfile` helper**

Near the top of `main.ts` (after the existing `requireProjectConfig` helper,
around the "helpers" section), add:

```typescript
/**
 * Load the active profile chain (or null) for the current project and
 * surface any diagnostics. Called by every profile-aware subcommand so
 * `.markspec.yaml` errors are caught uniformly.
 *
 * The loaded chain itself is not yet consumed by the validator / compiler —
 * that lands in Phase 5+ of the profile system rollout.
 */
async function loadActiveProfile(projectRoot: string) {
  const { loadProfileForCommand } = await import("./core/mod.ts");
  const result = await loadProfileForCommand(projectRoot, readFile);

  let sawError = false;
  for (const diag of result.diagnostics) {
    const loc = diag.location
      ? `${diag.location.file}:${diag.location.line}`
      : "";
    console.error(`${diag.severity}[${diag.code}]: ${loc} ${diag.message}`);
    if (diag.severity === "error") sawError = true;
  }
  if (sawError) {
    Deno.exit(1);
  }
  return result.chain;
}
```

- [ ] **Step 3: Call `loadActiveProfile` from each profile-aware command**

For each profile-aware command (`format`, `validate`, `compile`, `show`,
`context`, `report`), add a call to `loadActiveProfile` after the project-config
load and before the command's main work. The return value is currently unused —
assign to `_chain` with an underscore prefix to silence the "unused" lint.

Example pattern (adapt to the exact action-handler shape of each command):

```typescript
// inside the .action(async (...) => { ... }) of each command:
const { projectRoot } = await requireProjectConfig();
const _chain = await loadActiveProfile(projectRoot);
// ... existing command logic ...
```

The `format` command may not call `requireProjectConfig` today (per
`core/config/mod.ts` docstring, some commands work without project context). For
`format`, only call `loadActiveProfile` if a project root is discoverable
without erroring. Pattern:

```typescript
const { discoverProjectRoot } = await import("./core/mod.ts");
const projectRoot = await discoverProjectRoot(Deno.cwd(), readFile);
if (projectRoot) {
  const _chain = await loadActiveProfile(projectRoot);
}
```

Read the existing handlers carefully — each is subtly different. The invariant
after this change: every profile-aware command, when run inside a project, tries
to load the profile and fails fast on errors.

- [ ] **Step 4: Type-check + lint**

Run: `deno task check && deno lint packages/markspec/main.ts` Expected: no
errors.

- [ ] **Step 5: Run the existing e2e suite**

Run: `deno task test` Expected: all tests pass. This step verifies no
regressions — pre-Phase-2 behavior (no `.markspec.yaml` present) should be fully
preserved.

- [ ] **Step 6: Manual smoke test**

From the repo root, run:

```bash
deno run --allow-read --allow-write --allow-env --allow-ffi --allow-run packages/markspec/main.ts validate
```

Expected: same behavior as today (no profile loaded, no errors from the new
wiring) because there's no `.markspec.yaml` at the repo root.

- [ ] **Step 7: Commit**

```bash
git add packages/markspec/main.ts
git commit -m "feat(cli): load active profile in profile-aware commands"
```

---

## Task 2.9 — End-to-end fixture test

Exercise the whole loader chain through the `markspec validate` subcommand: a
project with a `.markspec.yaml` pointing to a local profile that parses cleanly
produces no extra errors; a project with a broken specifier fails fast with a
`PROFILE-LOAD-001` diagnostic; a project with two profiles fails with
`PROFILE-LOAD-006`.

**Files:**

- Create: `tests/fixtures/profiles/phase2/minimal/markspec.yaml`
- Create: `tests/e2e/profile_loader_test.ts`

- [ ] **Step 1: Create the minimal profile fixture**

Create `tests/fixtures/profiles/phase2/minimal/markspec.yaml`:

```yaml
id: "@acme/phase2-minimal"
version: 0.1.0
description: Minimal profile used by Phase 2 e2e tests
profile:
  types:
    note:
      shape: identified
      display-id-pattern: "NOTE-{n:03d}"
```

- [ ] **Step 2: Write the e2e tests**

Create `tests/e2e/profile_loader_test.ts`:

```typescript
/**
 * @module tests/e2e/profile_loader_test
 *
 * E2E tests for .markspec.yaml-driven profile loading via `markspec validate`.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

// Minimal project.yaml the helper writes whenever we declare files.
const PROJECT_YAML = `name: phase2-e2e\nversion: 0.1.0\n`;

// Minimal profile that parses cleanly (inlined so the test is self-contained).
const MINIMAL_PROFILE = `id: "@acme/phase2-minimal"\nversion: 0.1.0\n`;

// Minimal markdown file for validate to process.
const REQ_MD =
  `# Example\n\n- [NOTE-001] A note\n\n  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\\n`;

Deno.test("profile loader e2e: no .markspec.yaml — core-only mode, exit 0", async () => {
  const { code } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 0);
});

Deno.test("profile loader e2e: happy path with local profile — no profile errors", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/minimal\n`,
      "profiles/minimal/markspec.yaml": MINIMAL_PROFILE,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 0);
  // No profile-loader errors in stderr
  const lines = stderr.split("\n").filter((l) =>
    l.includes("PROFILE-LOAD") || l.includes("MARKSPEC-YAML")
  );
  assertEquals(lines, []);
});

Deno.test("profile loader e2e: missing specifier target fails with PROFILE-LOAD-001", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/does-not-exist\n`,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "PROFILE-LOAD-001");
});

Deno.test("profile loader e2e: multiple profiles fails with PROFILE-LOAD-006", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/a\n  - ./profiles/b\n`,
      "profiles/a/markspec.yaml": MINIMAL_PROFILE,
      "profiles/b/markspec.yaml": MINIMAL_PROFILE,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "PROFILE-LOAD-006");
});

Deno.test("profile loader e2e: malformed .markspec.yaml fails with MARKSPEC-YAML-002", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles: [\n  unclosed`,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MARKSPEC-YAML-002");
});

Deno.test("profile loader e2e: unknown .markspec.yaml key warns but doesn't block", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/minimal\nbogus: true\n`,
      "profiles/minimal/markspec.yaml": MINIMAL_PROFILE,
      "req.md": REQ_MD,
    },
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "MARKSPEC-YAML-001");
  assertStringIncludes(stderr, "bogus");
});
```

- [ ] **Step 3: Run the e2e test file**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/profile_loader_test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 4: Run the full workspace test suite**

Run: `deno task test` Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/profiles/phase2/minimal/markspec.yaml tests/e2e/profile_loader_test.ts
git commit -m "test(core): e2e coverage for .markspec.yaml profile loading"
```

---

## Phase 2 acceptance

All tasks checked, all commits on `feat/profile-system-phase-2`,
`deno task test` green, `deno task check` clean, `deno lint` clean. Loader
covers:

- `.markspec.yaml` discovery (absent → core-only mode).
- `.markspec.yaml` parsing + schema validation (`profiles:` list of specifier
  strings).
- Unknown top-level keys surface as `MARKSPEC-YAML-001` warnings.
- Malformed YAML produces `MARKSPEC-YAML-002`; schema errors produce
  `MARKSPEC-YAML-003`.
- Local specifier resolution reads `markspec.yaml` from the target directory;
  missing files surface as `PROFILE-LOAD-001`.
- Git specifiers emit a clear "Phase 4" message via `PROFILE-LOAD-001`.
- Multiple profiles in one `.markspec.yaml` surface as `PROFILE-LOAD-006`.
- `loadProfileForCommand` orchestrator composes all of the above; returns a
  one-element `ProfileChain` in the happy path.
- Every profile-aware CLI command (`validate`, `compile`, `format`, `show`,
  `context`, `report`) calls the loader; load errors abort the command with exit
  code 1; warnings surface on stderr but don't block.
- `extends:` declarations in loaded manifests are parsed and preserved but not
  walked — Phase 3 scope.

This PR ships a working profile loader wired into the CLI. The loaded chain is
held but not yet consumed — Phase 5 (validator pipeline) lights that up.

---

## Self-review

**Spec coverage (§7.5 + §7.6):**

- ✅ §7.5 chain resolution algorithm — Task 2.5 implements the Phase 2
  single-profile case; `extends:` walking is explicitly deferred per spec
  wording.
- ✅ §7.6 `.markspec.yaml` discovery + shape — Tasks 2.2 + 2.3.
- ✅ §7.6 discovery: absent → core-only mode — tested in Task 2.6 / 2.9.
- ✅ §7.6 "at most one content-bearing profile" — Task 2.6, code
  `PROFILE-LOAD-006`.
- ✅ §7.7 error codes `PROFILE-LOAD-001`, `PROFILE-LOAD-006`,
  `MARKSPEC-YAML-001` — all emitted in the expected places.
- ➕ `MARKSPEC-YAML-002` / `MARKSPEC-YAML-003` — added for parse + schema errors
  on `.markspec.yaml`. Not in the spec's §7.7 list; additive and consistent with
  the `PROFILE-LOAD-002` / `-003` pattern used for profile manifests.

**Placeholder scan:** none. Every step contains runnable code or a concrete
command with expected output.

**Type consistency:** `LoadedProfile`, `ProfileChain`, `ResolvedProfileSource`,
`MarkspecYaml`, `LoadChainResult`, `LoadProfileForCommandResult`,
`ParseMarkspecYamlResult` — each declared once, referenced with matching field
names in all consumer tasks.

**Scope check:** single subsystem (profile loader + CLI wiring). No validator or
compiler changes. No extends or git work. Fits cleanly in one PR.

---

## Execution handoff

Plan complete and saved to
`docs/superpowers/plans/2026-04-21-adr-008-profile-system-v1-phase-2.md`. Two
execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task,
   review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans,
   batch execution with checkpoints.

Which approach?
