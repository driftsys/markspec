# Bundled Default Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle the default profile into the binary and auto-register it as the
implicit root of the `extends:` chain, with a `default-profile: false` opt-out,
so consumers never write `extends: npm:@markspec/profile-default`.

**Architecture:** A new embedded string constant holds a minimal identity
manifest. A new `ProfileSpecifier` variant `{ kind: "builtin" }` resolves to
that constant with no I/O. `loadChain` splices the builtin as the implicit root
when a chain's top tier declares no `extends:` and `bundledDefault` is enabled;
`loadProfileForCommand` enables it unless `.markspec.yaml` sets
`default-profile: false`. `profile show` / `doctor` present the leaf tier (not
the builtin root) as the headline.

**Tech Stack:** Deno, TypeScript (strict), `@std/assert`, `@std/yaml`. Tests are
colocated `*_test.ts` (unit) and `tests/e2e/*_test.ts` (blackbox via the
`markspec()` helper).

**Spec:**
[docs/superpowers/specs/2026-05-19-bundled-default-profile-design.md](../specs/2026-05-19-bundled-default-profile-design.md)

**Conventions:**

- Production code under `packages/markspec/core/` must use **no `Deno.*` APIs**
  (Node-compat rule). Tests may use `Deno.*`.
- Conventional Commits with a git-std-allowed scope: one of
  `auto, repo, ci, spec, core, cli, lsp, mcp, render, book, deck, docs, deps, release`.
  `core` covers anything under `packages/markspec/core/`; `cli` covers
  `packages/markspec/main.ts`; `docs` covers documentation.
- Run `deno fmt` (TS) before each commit. `deno fmt --check` and `dprint check`
  are separate CI gates.
- Unit test command:
  `deno test packages/markspec/core/profile/ packages/markspec/core/config/`
- E2E test command:
  `deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/`

---

## File Structure

| File                                                                                    | Responsibility                                                                            | Action             |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------ |
| `packages/markspec/core/profile/default_profile.ts`                                     | The embedded manifest string + builtin specifier + source-path sentinel                   | Create             |
| `packages/markspec/core/profile/default_profile_test.ts`                                | Asserts the embedded manifest parses & merges clean                                       | Create             |
| `packages/markspec/core/model/profile.ts`                                               | Add `{ kind: "builtin" }` to `ProfileSpecifier`                                           | Modify             |
| `packages/markspec/core/profile/chain.ts`                                               | Builtin resolver branch, `specifierKey`/`stringifySpec` branches, `bundledDefault` splice | Modify             |
| `packages/markspec/core/profile/chain_test.ts`                                          | Splice behaviour cases                                                                    | Modify (add tests) |
| `packages/markspec/core/config/markspec.ts`                                             | `default-profile` key: allowlist, type, parse                                             | Modify             |
| `packages/markspec/core/config/markspec_test.ts`                                        | `default-profile` parsing + round-trip                                                    | Modify (add tests) |
| `packages/markspec/core/profile/load.ts`                                                | Wire builtin-only / spliced chain into `loadProfileForCommand`                            | Modify             |
| `packages/markspec/core/profile/load_test.ts`                                           | Rewrite core-only-mode tests; add opt-out tests                                           | Modify             |
| `packages/markspec/core/profile/strawman_test.ts`                                       | Drop the local-default rewrite hack; use real auto-registration                           | Modify             |
| `docs/examples/profiles/aspice-swe-mini/markspec.yaml`                                  | Remove `extends: npm:@markspec/profile-default@^1.0`                                      | Modify             |
| `packages/markspec/main.ts`                                                             | `profile show` / `doctor` present the leaf tier, list the chain                           | Modify             |
| `tests/e2e/profile_doctor_test.ts`                                                      | Opt-out keeps "no profile"; add builtin-shown tests; tier count 1→2                       | Modify             |
| `tests/e2e/profile_test.ts`                                                             | `profile show --format json`: assert leaf tier                                            | Modify             |
| `docs/architecture/adr-010-default-profile.md`, `docs/specs/markspec-profile-schema.md` | One-line status note                                                                      | Modify             |

---

## Task 1: Embedded default-profile constant + `builtin` specifier variant

**Files:**

- Create: `packages/markspec/core/profile/default_profile.ts`
- Create: `packages/markspec/core/profile/default_profile_test.ts`
- Modify: `packages/markspec/core/model/profile.ts` (`ProfileSpecifier` union)
- Modify: `packages/markspec/core/profile/chain.ts` (`specifierKey`,
  `stringifySpec` exhaustiveness branches only)

- [ ] **Step 1: Add the `builtin` variant to the `ProfileSpecifier` union**

In `packages/markspec/core/model/profile.ts`, the union currently ends with the
`npm` member. Replace:

```typescript
| {
  readonly kind: "npm";
  readonly scope?: string;
  readonly name: string;
  readonly range: string;
};
```

with:

```typescript
| {
  readonly kind: "npm";
  readonly scope?: string;
  readonly name: string;
  readonly range: string;
}
| { readonly kind: "builtin" };
```

- [ ] **Step 2: Create the embedded manifest module**

Create `packages/markspec/core/profile/default_profile.ts`:

```typescript
/**
 * @module core/profile/default_profile
 *
 * The bundled default profile (profile-schema §7 / §2.2). It ships as an
 * embedded string constant — never a file on disk — so it survives
 * `deno compile` and runs under Node without I/O. It is auto-registered as
 * the implicit root of the `extends:` chain unless `default-profile: false`
 * is set in `.markspec.yaml`.
 *
 * Scope (mechanism only): a minimal identity profile — stable id + the
 * default colour roles, no types, no rules. The profile-schema §7.1
 * display-ID pattern bindings, RFC 2119 hygiene, and `{{def.}}` glossary
 * are deferred (they need a core-type-binding schema construct).
 */

import type { ProfileSpecifier } from "../model/mod.ts";

/** Specifier that resolves to the embedded default profile. */
export const BUILTIN_DEFAULT_SPECIFIER: ProfileSpecifier = { kind: "builtin" };

/**
 * Synthetic source path used for the embedded manifest in diagnostics and
 * tier bookkeeping. Not a real filesystem path.
 */
export const BUILTIN_DEFAULT_SOURCE_PATH = "<bundled:@markspec/profile-default>";

/** The embedded default-profile manifest, authored as YAML. */
export const DEFAULT_PROFILE_MANIFEST = `id: "@markspec/profile-default"
version: 1.0.0
markspec-schema: "1"
description: Baseline MarkSpec profile
license: MIT
profile:
  attributes: []
  labels: []
  colors:
    primary: blue
    secondary: teal
    tertiary: cyan
    accent: purple
    muted: grey
    warning: orange
    danger: red
  types: {}
  documents:
    types: []
    frontMatter: []
`;
```

- [ ] **Step 3: Add `builtin` branches to `specifierKey` and `stringifySpec`**

These two functions end with `const _exhaustive: never = spec;`. Adding the
union member breaks that exhaustiveness check until each handles `builtin`. In
`packages/markspec/core/profile/chain.ts`:

In `specifierKey`, immediately before `const _exhaustive: never = spec;`, add:

```typescript
if (spec.kind === "builtin") {
  return "builtin:@markspec/profile-default";
}
```

In `stringifySpec`, immediately before `const _exhaustive: never = spec;`, add:

```typescript
if (spec.kind === "builtin") {
  return "@markspec/profile-default (bundled)";
}
```

- [ ] **Step 4: Write the failing test**

Create `packages/markspec/core/profile/default_profile_test.ts`:

```typescript
/**
 * @module core/profile/default_profile_test
 *
 * The embedded default-profile manifest must parse and merge cleanly as a
 * lone tier — it ships in the binary and a malformed constant would break
 * every project that does not opt out.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  BUILTIN_DEFAULT_SOURCE_PATH,
  DEFAULT_PROFILE_MANIFEST,
} from "./default_profile.ts";
import { parseManifest } from "./manifest.ts";
import { loadChain } from "./chain.ts";
import { BUILTIN_DEFAULT_SPECIFIER } from "./default_profile.ts";

Deno.test("default profile manifest parses with zero error diagnostics", () => {
  const result = parseManifest(
    DEFAULT_PROFILE_MANIFEST,
    BUILTIN_DEFAULT_SOURCE_PATH,
  );
  assertExists(result.manifest);
  assertEquals(result.manifest.id, "@markspec/profile-default");
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  assertEquals(errors, []);
  // markspec-schema is pinned, so PROFILE-SCHEMA-002 must not fire.
  const schemaMiss = result.diagnostics.filter((d) =>
    d.code === "PROFILE-SCHEMA-002"
  );
  assertEquals(schemaMiss, []);
});

Deno.test("builtin specifier resolves to a lone one-tier chain", async () => {
  const readFile = (): Promise<string | undefined> =>
    Promise.resolve(undefined);
  const result = await loadChain(
    BUILTIN_DEFAULT_SPECIFIER,
    "/project",
    "/project",
    readFile,
    { bundledDefault: true },
  );
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  assertExists(result.chain);
  assertEquals(result.chain.tiers.length, 1);
  assertEquals(result.chain.tiers[0].id, "@markspec/profile-default");
});
```

- [ ] **Step 5: Run the test to verify the first test passes and the second
      fails**

Run: `deno test packages/markspec/core/profile/default_profile_test.ts`
Expected: `default profile manifest parses…` PASSES;
`builtin specifier resolves…` FAILS (the `bundledDefault` option and the builtin
resolver branch do not exist yet — a type error on `{ bundledDefault: true }` or
a resolver fall-through to local). This failure is implemented in Task 2.

- [ ] **Step 6: Run type-check**

Run: `deno check packages/markspec/core/mod.ts packages/markspec/main.ts`
Expected: PASS (the union member is handled by `specifierKey`/`stringifySpec`;
the builtin resolver fall-through compiles because the loadChain dispatch is an
`if/else`, not a `never` switch).

- [ ] **Step 7: Commit**

```bash
deno fmt packages/markspec/core/profile/default_profile.ts packages/markspec/core/profile/default_profile_test.ts packages/markspec/core/model/profile.ts packages/markspec/core/profile/chain.ts
git add packages/markspec/core/profile/default_profile.ts packages/markspec/core/profile/default_profile_test.ts packages/markspec/core/model/profile.ts packages/markspec/core/profile/chain.ts
git commit -m "feat(core): add embedded default-profile manifest and builtin specifier

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `loadChain` — builtin resolver + `bundledDefault` splice

**Files:**

- Modify: `packages/markspec/core/profile/chain.ts`
- Test: `packages/markspec/core/profile/chain_test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/markspec/core/profile/chain_test.ts`:

```typescript
import {
  BUILTIN_DEFAULT_SPECIFIER,
} from "./default_profile.ts";

Deno.test("loadChain: bundledDefault splices builtin as root of an extends-less leaf", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/custom" },
    "/project",
    "/project",
    mockReadFile({
      "/project/profiles/custom/markspec.yaml":
        `id: "@acme/custom"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
    }),
    { bundledDefault: true },
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 2);
  assertEquals(result.chain?.tiers[0].id, "@markspec/profile-default");
  assertEquals(result.chain?.tiers[1].id, "@acme/custom");
});

Deno.test("loadChain: bundledDefault disabled does not splice", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/custom" },
    "/project",
    "/project",
    mockReadFile({
      "/project/profiles/custom/markspec.yaml":
        `id: "@acme/custom"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
    }),
    { bundledDefault: false },
  );
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.chain?.tiers[0].id, "@acme/custom");
});

Deno.test("loadChain: builtin leaf with bundledDefault yields exactly one tier (no self-splice)", async () => {
  const result = await loadChain(
    BUILTIN_DEFAULT_SPECIFIER,
    "/project",
    "/project",
    mockReadFile({}),
    { bundledDefault: true },
  );
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.chain?.tiers[0].id, "@markspec/profile-default");
});

Deno.test("loadChain: builtin spliced below a multi-tier local chain", async () => {
  const result = await loadChain(
    { kind: "local", path: "./profiles/leaf" },
    "/project",
    "/project",
    mockReadFile({
      "/project/profiles/leaf/markspec.yaml":
        `id: "@acme/leaf"\nversion: 1.0.0\nmarkspec-schema: "1"\nextends: "../root"\n`,
      "/project/profiles/root/markspec.yaml":
        `id: "@acme/root"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
    }),
    { bundledDefault: true },
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 3);
  assertEquals(result.chain?.tiers[0].id, "@markspec/profile-default");
  assertEquals(result.chain?.tiers[1].id, "@acme/root");
  assertEquals(result.chain?.tiers[2].id, "@acme/leaf");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test packages/markspec/core/profile/chain_test.ts` Expected: the four
new tests FAIL — `LoadChainOptions` has no `bundledDefault`, so
`{ bundledDefault: true }` is a type error and no splice happens.

- [ ] **Step 3: Add `bundledDefault` to `LoadChainOptions`**

In `packages/markspec/core/profile/chain.ts`, replace:

```typescript
/** Options accepted by {@linkcode loadChain}. */
export interface LoadChainOptions {
  readonly runGit?: RunGit;
  readonly appendFile?: AppendFile;
}
```

with:

```typescript
/** Options accepted by {@linkcode loadChain}. */
export interface LoadChainOptions {
  readonly runGit?: RunGit;
  readonly appendFile?: AppendFile;
  /**
   * When true, the bundled default profile is spliced as the implicit
   * root of the chain (the ultimate `extends:` parent of any tier that
   * declares none). Default false — only `loadProfileForCommand` enables
   * it, so direct `loadChain` callers (e.g. `profile add` validation)
   * keep core-only behaviour.
   */
  readonly bundledDefault?: boolean;
}
```

- [ ] **Step 4: Add the import**

In `packages/markspec/core/profile/chain.ts`, after the existing
`import { mergeChain } from "./merge.ts";` line, add:

```typescript
import {
  BUILTIN_DEFAULT_SOURCE_PATH,
  BUILTIN_DEFAULT_SPECIFIER,
  DEFAULT_PROFILE_MANIFEST,
} from "./default_profile.ts";
```

- [ ] **Step 5: Add the builtin resolver branch**

In `loadChain`, the resolver dispatch currently reads:

```typescript
} else if (cursorSpec.kind === "npm") {
  const { resolveNpmSpecifier } = await import("./npm.ts");
  const { cacheDir: cacheDirFn } = await import("./cache.ts");
  resolved = await resolveNpmSpecifier(
    cursorSpec,
    diagnostics,
    {
      cacheRoot: cacheDirFn(),
      readFile,
    },
  );
} else {
  resolved = await resolveLocalSpecifier(
    cursorSpec,
    cursorDir,
    readFile,
    diagnostics,
  );
}
```

Replace the final `} else {` block so the dispatch becomes:

```typescript
} else if (cursorSpec.kind === "npm") {
  const { resolveNpmSpecifier } = await import("./npm.ts");
  const { cacheDir: cacheDirFn } = await import("./cache.ts");
  resolved = await resolveNpmSpecifier(
    cursorSpec,
    diagnostics,
    {
      cacheRoot: cacheDirFn(),
      readFile,
    },
  );
} else if (cursorSpec.kind === "builtin") {
  resolved = {
    rawYaml: DEFAULT_PROFILE_MANIFEST,
    sourcePath: BUILTIN_DEFAULT_SOURCE_PATH,
    baseDir: BUILTIN_DEFAULT_SOURCE_PATH,
  };
} else {
  resolved = await resolveLocalSpecifier(
    cursorSpec,
    cursorDir,
    readFile,
    diagnostics,
  );
}
```

- [ ] **Step 6: Add the splice to the cursor-advance step**

In `loadChain`, replace:

```typescript
// Advance cursor to the parent, if any.
if (parsed.manifest.extends !== undefined) {
  cursorSpec = parsed.manifest.extends;
  cursorDir = resolved.baseDir;
} else {
  cursorSpec = undefined;
}
```

with:

```typescript
// Advance cursor to the parent, if any. When the tier declares no
// explicit parent, splice the bundled default as the implicit root
// (once — never below the builtin itself).
if (parsed.manifest.extends !== undefined) {
  cursorSpec = parsed.manifest.extends;
  cursorDir = resolved.baseDir;
} else if (opts.bundledDefault && cursorSpec.kind !== "builtin") {
  cursorSpec = BUILTIN_DEFAULT_SPECIFIER;
  cursorDir = resolved.baseDir;
} else {
  cursorSpec = undefined;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run:
`deno test packages/markspec/core/profile/chain_test.ts packages/markspec/core/profile/default_profile_test.ts`
Expected: PASS (all chain_test cases including the four new ones; both
default_profile_test cases).

- [ ] **Step 8: Commit**

```bash
deno fmt packages/markspec/core/profile/chain.ts packages/markspec/core/profile/chain_test.ts
git add packages/markspec/core/profile/chain.ts packages/markspec/core/profile/chain_test.ts
git commit -m "feat(core): splice bundled default as implicit chain root in loadChain

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `.markspec.yaml` — `default-profile` opt-out key

**Files:**

- Modify: `packages/markspec/core/config/markspec.ts`
- Test: `packages/markspec/core/config/markspec_test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/markspec/core/config/markspec_test.ts`:

```typescript
Deno.test("parseMarkspecYaml: default-profile false parsed", () => {
  const result = parseMarkspecYaml(
    "profiles: []\ndefault-profile: false\n",
    "/p/.markspec.yaml",
  );
  assertExists(result.config);
  assertEquals(result.config.defaultProfile, false);
  assertEquals(result.diagnostics, []);
});

Deno.test("parseMarkspecYaml: default-profile true parsed", () => {
  const result = parseMarkspecYaml(
    "default-profile: true\n",
    "/p/.markspec.yaml",
  );
  assertExists(result.config);
  assertEquals(result.config.defaultProfile, true);
});

Deno.test("parseMarkspecYaml: default-profile absent leaves field undefined", () => {
  const result = parseMarkspecYaml(
    "profiles:\n  - ./profiles/x\n",
    "/p/.markspec.yaml",
  );
  assertExists(result.config);
  assertEquals(result.config.defaultProfile, undefined);
});

Deno.test("parseMarkspecYaml: non-boolean default-profile emits MARKSPEC-YAML-003", () => {
  const result = parseMarkspecYaml(
    'default-profile: "no"\n',
    "/p/.markspec.yaml",
  );
  assertEquals(result.config, null);
  assertEquals(result.diagnostics[0].code, "MARKSPEC-YAML-003");
});

Deno.test("addProfileSpecifier: preserves an existing default-profile key", async () => {
  const store: Record<string, string> = {
    "/p/.markspec.yaml": "default-profile: false\nprofiles:\n  - ./a\n",
  };
  await addProfileSpecifier(
    "./b",
    (path: string) => Promise.resolve(store[path]),
    (path: string, content: string) => {
      store[path] = content;
      return Promise.resolve();
    },
    "/p",
  );
  assertStringIncludes(store["/p/.markspec.yaml"], "default-profile: false");
  assertStringIncludes(store["/p/.markspec.yaml"], '- "./b"');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test packages/markspec/core/config/markspec_test.ts` Expected: the
new tests FAIL — `result.config.defaultProfile` does not exist (type error /
undefined) and `default-profile` is currently an unknown-key warning, not
parsed.

- [ ] **Step 3: Allow the key**

In `packages/markspec/core/config/markspec.ts`, replace:

```typescript
const ALLOWED_MARKSPEC_YAML_KEYS = new Set(["profiles"]);
```

with:

```typescript
const ALLOWED_MARKSPEC_YAML_KEYS = new Set(["profiles", "default-profile"]);
```

- [ ] **Step 4: Add the field to the parsed shape**

Replace:

```typescript
/** The parsed content of a `.markspec.yaml`. */
export interface MarkspecYaml {
  readonly profiles: readonly ProfileSpecifier[];
}
```

with:

```typescript
/** The parsed content of a `.markspec.yaml`. */
export interface MarkspecYaml {
  readonly profiles: readonly ProfileSpecifier[];
  /**
   * Opt out of the bundled default profile when explicitly `false`.
   * `undefined` (key absent) means the default is active.
   */
  readonly defaultProfile?: boolean;
}
```

- [ ] **Step 5: Parse and validate the key**

In `parseMarkspecYaml`, locate the block that ends the specifier loop:

```typescript
  // If any specifier failed to parse, treat the whole file as invalid.
  const hasErrors = diagnostics.some((d) => d.severity === "error");
  if (hasErrors) {
    return { config: null, diagnostics };
  }

  return { config: { profiles }, diagnostics };
```

Replace it with:

```typescript
  // default-profile: optional boolean opt-out for the bundled default.
  let defaultProfile: boolean | undefined;
  const rawDefaultProfile = root["default-profile"];
  if (rawDefaultProfile !== undefined) {
    if (typeof rawDefaultProfile !== "boolean") {
      diagnostics.push({
        code: "MARKSPEC-YAML-003",
        severity: "error",
        message: ".markspec.yaml: 'default-profile' must be a boolean",
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return { config: null, diagnostics };
    }
    defaultProfile = rawDefaultProfile;
  }

  // If any specifier failed to parse, treat the whole file as invalid.
  const hasErrors = diagnostics.some((d) => d.severity === "error");
  if (hasErrors) {
    return { config: null, diagnostics };
  }

  return { config: { profiles, defaultProfile }, diagnostics };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `deno test packages/markspec/core/config/markspec_test.ts` Expected: PASS
(all existing tests plus the five new ones).

- [ ] **Step 7: Commit**

```bash
deno fmt packages/markspec/core/config/markspec.ts packages/markspec/core/config/markspec_test.ts
git add packages/markspec/core/config/markspec.ts packages/markspec/core/config/markspec_test.ts
git commit -m "feat(core): parse default-profile opt-out key in .markspec.yaml

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire `loadProfileForCommand`

**Files:**

- Modify: `packages/markspec/core/profile/load.ts`
- Test: `packages/markspec/core/profile/load_test.ts`

- [ ] **Step 1: Rewrite the affected tests and add opt-out tests**

In `packages/markspec/core/profile/load_test.ts`, replace the test at lines
15–28 (the two "returns null chain" tests) with:

```typescript
Deno.test("loadProfileForCommand: no .markspec.yaml yields the bundled default chain", async () => {
  const result = await loadProfileForCommand("/project", mockReadFile({}));
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.chain?.tiers[0].id, "@markspec/profile-default");
});

Deno.test("loadProfileForCommand: empty profiles list yields the bundled default chain", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({ "/project/.markspec.yaml": "profiles: []\n" }),
  );
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.chain?.tiers[0].id, "@markspec/profile-default");
});

Deno.test("loadProfileForCommand: default-profile false yields core-only (null chain)", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml": "profiles: []\ndefault-profile: false\n",
    }),
  );
  assertEquals(result.chain, null);
  assertEquals(result.diagnostics, []);
});
```

In the same file, replace the test "loadProfileForCommand: single local profile
loads end-to-end" (lines 30–42) with:

```typescript
Deno.test("loadProfileForCommand: single local profile is spliced onto the bundled default", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml": `profiles:\n  - ./profiles/custom\n`,
      "/project/profiles/custom/markspec.yaml":
        `id: "@acme/custom"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 2);
  assertEquals(result.chain?.tiers[0].id, "@markspec/profile-default");
  assertEquals(result.chain?.tiers[1].id, "@acme/custom");
});

Deno.test("loadProfileForCommand: default-profile false keeps a single-tier chain", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml":
        `default-profile: false\nprofiles:\n  - ./profiles/custom\n`,
      "/project/profiles/custom/markspec.yaml":
        `id: "@acme/custom"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
    }),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.chain?.tiers.length, 1);
  assertEquals(result.chain?.tiers[0].id, "@acme/custom");
});
```

In the same file, replace the test "loadProfileForCommand: unknown key warning
does not block loading" (lines 68–83) with:

```typescript
Deno.test("loadProfileForCommand: unknown key warning does not block loading", async () => {
  const result = await loadProfileForCommand(
    "/project",
    mockReadFile({
      "/project/.markspec.yaml":
        `profiles:\n  - ./profiles/custom\nbogus: true\n`,
      "/project/profiles/custom/markspec.yaml":
        `id: "@acme/custom"\nversion: 1.0.0\nmarkspec-schema: "1"\n`,
    }),
  );
  // Loading succeeded despite the warning; builtin spliced as root.
  assertEquals(result.chain?.tiers.length, 2);
  assertEquals(result.chain?.tiers[0].id, "@markspec/profile-default");
  assertEquals(result.chain?.tiers[1].id, "@acme/custom");
  const warnings = result.diagnostics.filter((d) => d.code === "MARKSPEC-YAML-001");
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0].severity, "warning");
});
```

(The tests "multiple profiles emits PROFILE-LOAD-006", ".markspec.yaml YAML
error surfaces", and "profile load errors propagate" are unchanged — resolution
fails before any splice, so they still return `chain: null`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test packages/markspec/core/profile/load_test.ts` Expected: the
rewritten tests FAIL — `loadProfileForCommand` still returns `chain: null` for
no/empty profiles and a single-tier chain for one profile.

- [ ] **Step 3: Add the import and helper**

In `packages/markspec/core/profile/load.ts`, after
`import { loadChain } from "./chain.ts";` add:

```typescript
import { BUILTIN_DEFAULT_SPECIFIER } from "./default_profile.ts";
```

After the `loadProfileForCommand` function (before
`const RESERVED_ATTRIBUTE_KEYS`), add:

```typescript
/**
 * Build a chain containing only the bundled default profile. Used when no
 * project profile is declared but the default is not opted out.
 */
async function loadBuiltinOnlyChain(
  projectRoot: string,
  readFile: ReadFile,
  diagnostics: Diagnostic[],
): Promise<LoadProfileForCommandResult> {
  const chainResult = await loadChain(
    BUILTIN_DEFAULT_SPECIFIER,
    projectRoot,
    projectRoot,
    readFile,
    { bundledDefault: true },
  );
  diagnostics.push(...chainResult.diagnostics);
  if (chainResult.chain) {
    diagnostics.push(...checkReservedRedefinitions(chainResult.chain));
  }
  return { chain: chainResult.chain, diagnostics };
}
```

- [ ] **Step 4: Wire the four decision points**

In `loadProfileForCommand`, replace:

```typescript
const rawYaml = await readMarkspecYaml(projectRoot, readFile);
if (rawYaml === null) {
  return { chain: null, diagnostics };
}
```

with:

```typescript
const rawYaml = await readMarkspecYaml(projectRoot, readFile);
if (rawYaml === null) {
  // No .markspec.yaml — the default is active (no file to opt out in).
  return await loadBuiltinOnlyChain(projectRoot, readFile, diagnostics);
}
```

Then replace:

```typescript
const { profiles } = parsed.config;
if (profiles.length === 0) {
  return { chain: null, diagnostics };
}
```

with:

```typescript
const { profiles, defaultProfile } = parsed.config;
const bundledDefault = defaultProfile !== false;
if (profiles.length === 0) {
  return bundledDefault
    ? await loadBuiltinOnlyChain(projectRoot, readFile, diagnostics)
    : { chain: null, diagnostics };
}
```

Then replace:

```typescript
const chainResult = await loadChain(
  profiles[0],
  projectRoot,
  projectRoot,
  readFile,
);
```

with:

```typescript
const chainResult = await loadChain(
  profiles[0],
  projectRoot,
  projectRoot,
  readFile,
  { bundledDefault },
);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `deno test packages/markspec/core/profile/load_test.ts` Expected: PASS (all
tests, including unchanged PROFILE-LOAD-006 / YAML-error / missing-profile
cases).

- [ ] **Step 6: Run the full profile + config unit suite**

Run: `deno test packages/markspec/core/profile/ packages/markspec/core/config/`
Expected: PASS except `strawman_test.ts` (fixed in Task 5) — note any strawman
failures and continue.

- [ ] **Step 7: Commit**

```bash
deno fmt packages/markspec/core/profile/load.ts packages/markspec/core/profile/load_test.ts
git add packages/markspec/core/profile/load.ts packages/markspec/core/profile/load_test.ts
git commit -m "feat(core): activate bundled default profile in loadProfileForCommand

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Rewrite `strawman_test.ts` to use real auto-registration

**Files:**

- Modify: `packages/markspec/core/profile/strawman_test.ts`
- Modify: `docs/examples/profiles/aspice-swe-mini/markspec.yaml`

- [ ] **Step 1: Remove the explicit `extends:` from the strawman manifest**

In `docs/examples/profiles/aspice-swe-mini/markspec.yaml`, delete the line:

```yaml
extends: "npm:@markspec/profile-default@^1.0"
```

The surrounding lines become:

```yaml
license: MIT

profile:
```

- [ ] **Step 2: Replace the chain-loading helper**

In `packages/markspec/core/profile/strawman_test.ts`, replace the helper block
(lines 27–66, the doc comment plus the entire `loadStrawmanChain` function)
with:

```typescript
/**
 * The strawman declares no `extends:`. The bundled default profile is
 * auto-spliced as the implicit root when `bundledDefault: true`, exactly
 * as `loadProfileForCommand` does for real projects.
 */
async function loadStrawmanChain(): Promise<{
  chain: ProfileChain | null;
  diagnostics: readonly { severity: string; code: string; message: string }[];
}> {
  const specifier: ProfileSpecifier = {
    kind: "local",
    path: "./aspice-swe-mini",
  };
  return await loadChain(specifier, PROFILES_DIR, PROFILES_DIR, readFile, {
    bundledDefault: true,
  });
}
```

- [ ] **Step 3: Verify the assertion tests still describe the right shape**

The remaining tests (`chain resolves with 2 tiers`,
`effective profile has all 7 types`, `ASIL labels`, `Derived-from`,
`standard extends Specification`,
`per-type color resolves through merged colors map`) are unchanged: the embedded
default is tier 0 with id `@markspec/profile-default` and the same colour roles,
so `tiers.length === 2`, `tiers[0].id === "@markspec/profile-default"`,
`tiers[1].id === "@markspec/profile-aspice-swe-mini"`, and
`colors.get("primary")?.value === "blue"` all still hold. No edits needed to the
`Deno.test(...)` blocks.

- [ ] **Step 4: Run the strawman tests**

Run: `deno test --allow-read packages/markspec/core/profile/strawman_test.ts`
Expected: PASS — all six strawman tests.

- [ ] **Step 5: Commit**

```bash
deno fmt packages/markspec/core/profile/strawman_test.ts
dprint fmt docs/examples/profiles/aspice-swe-mini/markspec.yaml || true
git add packages/markspec/core/profile/strawman_test.ts docs/examples/profiles/aspice-swe-mini/markspec.yaml
git commit -m "test(core): strawman uses bundled default auto-registration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(`docs/examples/` is excluded from dprint per CLAUDE.md, so the `dprint fmt` is
a no-op guarded with `|| true`; the manifest edit only deletes a line and needs
no reformat.)

---

## Task 6: `profile show` / `doctor` present the leaf tier

**Files:**

- Modify: `packages/markspec/main.ts`
- Test: `tests/e2e/profile_doctor_test.ts`, `tests/e2e/profile_test.ts`

- [ ] **Step 1: Update the e2e expectations (failing tests first)**

In `tests/e2e/profile_doctor_test.ts`, replace the test "profile show: no
profile prints message" with:

```typescript
Deno.test("profile show: opted-out project prints no-profile message", async () => {
  const { code, stderr } = await markspec(["profile", "show"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": "default-profile: false\n",
    },
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "no profile");
});

Deno.test("profile show: bundled default shown when no .markspec.yaml", async () => {
  const { code, stdout } = await markspec(["profile", "show"], {
    files: {
      "project.yaml": PROJECT_YAML,
    },
  });
  assertEquals(code, 0);
  assertStringIncludes(stdout, "@markspec/profile-default");
});
```

In the same file, replace the test "doctor: no profile still exits 0" with:

```typescript
Deno.test("doctor: opted-out project still exits 0 with no-profile message", async () => {
  const { code, stderr } = await markspec(["doctor"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": "default-profile: false\n",
    },
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "no profile");
});

Deno.test("doctor: bundled default shown when no .markspec.yaml", async () => {
  const { code, stderr } = await markspec(["doctor"], {
    files: {
      "project.yaml": PROJECT_YAML,
    },
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "@markspec/profile-default");
});
```

In the same file, in "doctor: --format json outputs structured data", change:

```typescript
assertEquals(data.profile.tiers, 1);
```

to:

```typescript
assertEquals(data.profile.tiers, 2);
```

In `tests/e2e/profile_test.ts`, in "profile show: --format json outputs
ProfileOverview schema", change:

```typescript
assertStringIncludes(data.tiers[0].id, "my-profile");
```

to:

```typescript
assertStringIncludes(
  data.tiers[data.tiers.length - 1].id,
  "my-profile",
);
```

- [ ] **Step 2: Run the e2e tests to verify the relevant ones fail**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/profile_doctor_test.ts tests/e2e/profile_test.ts`
Expected: the edited tests FAIL — `profile show` still prints
`Active profile: @markspec/profile-default` for the multi-tier case,
`data.profile.tiers` is still numerically wrong, and the no-`.markspec.yaml`
path still says "no profile".

- [ ] **Step 3: Make `profile show` headline the leaf and list the chain**

In `packages/markspec/main.ts`, in the `profile show` action, replace:

```typescript
const active = overview.tiers[0];
console.log(`Active profile: ${active.id}@${active.version}`);
if (active.summary && active.summary !== active.id) {
  console.log(active.summary);
}
console.log("");
```

with:

```typescript
const active = overview.tiers[overview.tiers.length - 1];
console.log(`Active profile: ${active.id}@${active.version}`);
if (active.summary && active.summary !== active.id) {
  console.log(active.summary);
}
if (overview.tiers.length > 1) {
  console.log(
    `Profile chain: ${
      overview.tiers.map((t) => t.id).join(" → ")
    }`,
  );
}
console.log("");
```

- [ ] **Step 4: Make `doctor` headline the leaf**

In the `doctor` action, replace the JSON `profile` object:

```typescript
profile: chain
  ? {
    id: chain.tiers[0].id,
    version: chain.tiers[0].version,
    tiers: chain.tiers.length,
  }
  : null,
```

with:

```typescript
profile: chain
  ? {
    id: chain.tiers[chain.tiers.length - 1].id,
    version: chain.tiers[chain.tiers.length - 1].version,
    tiers: chain.tiers.length,
  }
  : null,
```

And replace the text branch:

```typescript
if (chain) {
  console.error(
    `Profile: ${chain.tiers[0].id}@${
      chain.tiers[0].version
    } (${chain.tiers.length} tier(s))`,
  );
} else {
  console.error("Profile: no profile configured");
}
```

with:

```typescript
if (chain) {
  const leaf = chain.tiers[chain.tiers.length - 1];
  console.error(
    `Profile: ${leaf.id}@${leaf.version} (${chain.tiers.length} tier(s))`,
  );
} else {
  console.error("Profile: no profile configured");
}
```

- [ ] **Step 5: Run the e2e tests to verify they pass**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/profile_doctor_test.ts tests/e2e/profile_test.ts`
Expected: PASS — including "profile show: prints chain info" (`@acme/test`,
`0.2.0` now appear because the leaf is the headline) and "doctor: clean project
exits 0".

- [ ] **Step 6: Commit**

```bash
deno fmt packages/markspec/main.ts tests/e2e/profile_doctor_test.ts tests/e2e/profile_test.ts
git add packages/markspec/main.ts tests/e2e/profile_doctor_test.ts tests/e2e/profile_test.ts
git commit -m "fix(cli): profile show/doctor headline the leaf tier, list the chain

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full-suite reconciliation

**Files:** any test that assumed core-only behaviour for a no-`.markspec.yaml`
project.

- [ ] **Step 1: Find other no-profile assumptions**

Run:

```bash
grep -rn "no profile configured\|no profile\|chain, null\|chain: null\|tiers, 1\|tiers.length, 1" packages/markspec/mcp tests/e2e
```

Expected: review each hit. The MCP profile resource test
(`packages/markspec/mcp/resources/profile_test.ts`) and any e2e that runs
`profile show` / `doctor` / `compile` without a `.markspec.yaml` and asserts a
core-only outcome are the candidates. For each that breaks: if the intent is to
test core-only, add `".markspec.yaml": "default-profile: false\n"` to its
fixture; if the intent is to test "some profile active", update the expected
id/tier count to include `@markspec/profile-default`.

- [ ] **Step 2: Run the entire test suite**

Run: `deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi`
Expected: enumerate every failure. Most e2e tests pass only `.md` files (no
`project.yaml`, no `.markspec.yaml`) and run file-locally without loading a
profile — they are unaffected. Failures should be limited to
profile/doctor/MCP-profile tests already addressed in Tasks 4–6 plus any found
in Step 1.

- [ ] **Step 3: Fix each remaining failure**

For each failure, apply the Step 1 rule (opt-out fixture vs. updated
expectation). Make the minimal change that preserves the test's original intent.
Do not blanket-update snapshots — there are no `.snap` files in this repo; all
assertions are behavioural.

- [ ] **Step 4: Re-run the full suite**

Run: `deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi`
Expected: PASS — 0 failures.

- [ ] **Step 5: Commit**

```bash
deno fmt
git add -A
git commit -m "test(repo): reconcile suite with bundled-default activation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(If Step 1–3 found nothing to change, skip this commit.)

---

## Task 8: Status notes, full build, finish

**Files:**

- Modify: `docs/architecture/adr-010-default-profile.md`
- Modify: `docs/specs/markspec-profile-schema.md`

- [ ] **Step 1: Add an ADR-010 status note**

At the very top of `docs/architecture/adr-010-default-profile.md`, immediately
after the first `# ADR-010: …` heading line, insert:

```markdown
> **Status note (2026-05-19):** The bundling + auto-registration mechanism and
> the `default-profile: false` opt-out shipped as a mechanism-only slice. The §2
> four-type vocabulary is superseded by the 19-name core taxonomy; the bundled
> default is the thin identity profile of profile-schema §7. §7.1 display-ID
> pattern bindings, RFC 2119 hygiene (`MSL-M061`), and the `{{def.}}` glossary
> remain deferred (they need a core-type-binding schema construct).
```

- [ ] **Step 2: Add a profile-schema §7 status note**

In `docs/specs/markspec-profile-schema.md`, immediately after the
`## 7. The default profile` heading line, insert:

```markdown
> **Implementation status (2026-05-19):** §2.2 bundling + auto-registration
>
> - `default-profile: false` opt-out shipped (identity/minimal manifest). §7.1
>   pattern bindings, §7 RFC 2119 hygiene, and the glossary `{{def.}}` binding
>   remain deferred — blocked on a core-type-binding construct.
```

- [ ] **Step 3: Format the docs**

Run:
`dprint fmt docs/architecture/adr-010-default-profile.md docs/specs/markspec-profile-schema.md`
Expected: `Formatted` (or already-formatted).

- [ ] **Step 4: Run the full build gate**

Run: `just build` Expected: lint, full test suite, and type-check all pass; the
binary compiles to `dist/markspec`.

- [ ] **Step 5: Run the two CI format gates `just build` does NOT cover**

Run: `deno fmt --check && dprint check` Expected: both PASS. (Per the project's
pre-push checklist, `just build` does not run `deno fmt --check`.)

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/adr-010-default-profile.md docs/specs/markspec-profile-schema.md
git commit -m "docs(docs): note bundled-default mechanism shipped; §7.1 deferred

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Finish the development branch**

Use the `superpowers:finishing-a-development-branch` skill to present merge / PR
/ cleanup options to the user. Acceptance criteria to confirm against the spec
before finishing:

- No `.markspec.yaml` → chain is `[@markspec/profile-default]` (Task 4 test).
- `default-profile: false` (+ no/empty profiles) → core-only, `chain: null`
  (Task 4 test).
- `profiles: [P]`, `P` has no `extends:` → `[@markspec/profile-default, P]`
  (Task 2 + Task 4 tests).
- `default-profile:` non-boolean → `MARKSPEC-YAML-003`, `config: null` (Task 3
  test).
- `markspec profile add` preserves `default-profile:` (Task 3 test).
- Embedded manifest parses with no error diagnostics and no `PROFILE-SCHEMA-002`
  (Task 1 test).
- `aspice-swe-mini` resolves with `extends:` removed; strawman test no longer
  rewrites it (Task 5).
- `profile show` / `doctor` headline the leaf, not the builtin (Task 6).
- `just build` + `deno fmt --check` + `dprint check` all pass (Task 8 Steps
  4–5).
- No `Deno.*` in the added `core/` production files (`default_profile.ts`, edits
  to `chain.ts` / `load.ts` / `markspec.ts`).

---

## Self-Review Notes

- **Spec coverage:** Spec §4 approach → Tasks 1–2; §5 manifest → Task 1; §6
  behaviour matrix → Tasks 2 + 4 (every row has a test); §7 components → Tasks
  1–4 + 6; §9 error handling → Task 3 (non-boolean) + Task 2 (no self-splice) +
  unchanged PROFILE-LOAD paths verified in Task 4; §10 testing → Tasks 1–7; §11
  breaking changes → Tasks 5–7; §12 acceptance criteria → Task 8 Step 7. The
  leaf-headline UX decision (post-spec clarification) → Task 6.
- **Placeholder scan:** none — every code step shows full code; every command
  states expected output.
- **Type consistency:** `BUILTIN_DEFAULT_SPECIFIER` /
  `BUILTIN_DEFAULT_SOURCE_PATH` / `DEFAULT_PROFILE_MANIFEST` (Task 1) used
  verbatim in Tasks 2 & 4. `LoadChainOptions.bundledDefault` (Task 2) consumed
  in Task 4. `MarkspecYaml.defaultProfile` (Task 3) read in Task 4.
  `loadBuiltinOnlyChain` defined and called in Task 4 only. `overview.tiers` /
  `chain.tiers` indexed as `[length - 1]` for the leaf in Task 6, consistent
  with `introspect.ts` root→leaf ordering.
