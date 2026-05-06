# Profile-Driven Entry Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded display-ID prefix → color-bucket heuristic in
the renderer with a profile-declared semantic-name → palette-color resolution.
Drop the V-model assumption (`req` / `spec` / `test`) from core.

**Architecture:** Profile manifest gains an optional `profile.colors:` map
(semantic-name → palette hue) and per-type `color:` field. Renderer drops
`displayIdCategory()` and the `entries.req/spec/test` token group; emits a
palette hue name (or `none`) directly to Typst, which looks it up in the theme.
Default profile fixture ships seven role bindings — `primary`, `secondary`,
`tertiary`, `accent`, `muted`, `warning`, `danger` — one per palette hue.

**Tech Stack:** Deno/TypeScript, `@std/yaml`, `@std/assert`, Typst (theming),
`scripts/gen_theme.ts` (token codegen).

**Spec:**
[docs/superpowers/specs/2026-05-06-profile-driven-entry-colors-design.md](../specs/2026-05-06-profile-driven-entry-colors-design.md)

---

## File Structure

### New files

| File                                            | Responsibility                                                |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `packages/markspec/render/typst/colors.ts`      | `PALETTE_HUES` constant + `resolveEntryColor(entry, profile)` |
| `packages/markspec/render/typst/colors_test.ts` | Unit tests for `resolveEntryColor()` covering the 5-row table |

### Modified files

| File                                                         | Change                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `packages/markspec/core/model/profile.ts`                    | Add `color?: string` to `TypeDef` + `EffectiveTypeDef`; add `colors` map to `ProfileManifest` + `EffectiveProfile` |
| `packages/markspec/core/profile/manifest.ts`                 | Parse `profile.colors:` block + per-type `color:`; emit MSL-PROFILE-COLOR-001/002/003                              |
| `packages/markspec/core/profile/manifest_test.ts`            | Coverage for the three new diagnostics + happy-path parsing                                                        |
| `packages/markspec/core/profile/merge.ts`                    | Merge `colors:` map across the extends chain (last-write-wins per key)                                             |
| `packages/markspec/core/profile/merge_test.ts`               | Coverage for `colors:` merging                                                                                     |
| `packages/markspec/core/profile/strawman_test.ts`            | Assert color resolution for strawman entries                                                                       |
| `packages/markspec/render/typst/template.ts`                 | Drop `displayIdCategory()`; call `resolveEntryColor()`; thread profile through                                     |
| `packages/markspec/render/typst/template_test.ts`            | Update snapshots / call signatures for `color:` argument                                                           |
| `packages/markspec/render/mod.ts`                            | Add `profile?: EffectiveProfile` to `RenderOptions`                                                                |
| `packages/markspec/main.ts`                                  | `compileProject()` returns chain; CLI passes profile to `renderPdf` / book build                                   |
| `packages/markspec-typst/entry.typ`                          | New `color:` parameter on `req-block`; uncolored path; drop `entry-category`                                       |
| `packages/markspec-typst/lib.typ`                            | Drop `entry-category` re-export                                                                                    |
| `theme/tokens.yaml`                                          | Drop `entries:` group                                                                                              |
| `scripts/gen_theme.ts`                                       | Generate `entry-<hue>` from `diagram:` palette instead of from `entries:`                                          |
| `packages/markspec-typst/tokens.typ` (generated)             | Regenerate via `just tokens`                                                                                       |
| `packages/markspec-typst/themes/light.typ`, `dark.typ` (gen) | Regenerate via `just tokens`                                                                                       |
| `theme/markspec.css` (generated)                             | Regenerate via `just tokens`                                                                                       |
| `docs/examples/profiles/default/markspec.yaml`               | Add `profile.colors:` map (the seven role bindings)                                                                |
| `docs/examples/profiles/aspice-swe-mini/markspec.yaml`       | Add `color:` to each identified type                                                                               |
| `docs/spec/typography/typography.md`                         | Update entry-color section: explain the role-based default + resolution table                                      |

---

## Working directory

Run all commands from
`/Users/sebastientasson/Workspace/driftsys/markspec/.claude/worktrees/feat+profile-driven-entry-colors`.

The branch is `feat/profile-driven-entry-colors`. The design spec is committed
at `docs/superpowers/specs/2026-05-06-profile-driven-entry-colors-design.md`.

Conventional commit scopes used in this plan: `feat(core)`, `feat(render)`,
`feat(spec)`, `chore(repo)`, `test(core)`, `test(render)`, `docs(docs)`. All
commits get the trailer:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

The pre-commit hook runs `just fmt`, format/lint/typecheck checks, and
`git std lint` on the message — never bypass with `--no-verify`. If a hook
fails, fix the underlying issue and create a NEW commit (don't amend).

---

## Task 1: Extend the model types

**Files:**

- Modify: `packages/markspec/core/model/profile.ts`

This is a pure type-level change. Both `TypeDef` (parsed source) and
`EffectiveTypeDef` (merged) gain `color`; both `ProfileManifest` and
`EffectiveProfile` gain a `colors:` map.

- [ ] **Step 1: Add `color?: string` to `TypeDef`**

Edit `packages/markspec/core/model/profile.ts` around line 92-101 (the `TypeDef`
interface). Add the field at the end:

```typescript
export interface TypeDef {
  readonly name: string;
  readonly shape: EntryShape;
  readonly displayIdPattern?: string;
  readonly displayIdPatternEnforcement: EnforcementMode;
  readonly required: readonly string[];
  readonly attributes: readonly AttrDecl[];
  readonly traceability: ReadonlyMap<string, TraceRule>;
  /** Optional semantic color-role name (key into `ProfileManifest.colors`). */
  readonly color?: string;
}
```

- [ ] **Step 2: Add `colors` map to `ProfileManifest`**

Same file, in `ProfileManifest` (around line 134-162). Add the field after
`labels`:

```typescript
  readonly labels: readonly string[];

  /**
   * Semantic color-role bindings authored on this manifest.
   * Maps a profile-author-chosen name (e.g. "primary") to a palette hue
   * name (one of "blue", "cyan", "teal", "orange", "red", "purple", "grey").
   * Empty when the manifest does not declare `profile.colors:`.
   */
  readonly colors: ReadonlyMap<string, string>;
```

- [ ] **Step 3: Add `color` to `EffectiveTypeDef`**

Same file, in `EffectiveTypeDef` (around line 234-244). Add after
`displayIdPatternEnforcement`:

```typescript
export interface EffectiveTypeDef {
  readonly name: string;
  readonly shape: EntryShape;
  readonly displayIdPattern: ProvenancedValue<string | undefined>;
  readonly displayIdPatternEnforcement: ProvenancedValue<EnforcementMode>;
  /** Resolved semantic color-role name, or `undefined` when unset. */
  readonly color: ProvenancedValue<string | undefined>;
  readonly required: ProvenancedValue<readonly string[]>;
  readonly attributes: ProvenancedMap<AttrDecl>;
  readonly traceability: ProvenancedMap<TraceRule>;
}
```

- [ ] **Step 4: Add `colors` map to `EffectiveProfile`**

Same file, in `EffectiveProfile` (around line 247-263). Add after `labels`:

```typescript
export interface EffectiveProfile {
  readonly required: ProvenancedValue<readonly string[]>;
  readonly attributes: ProvenancedMap<AttrDecl>;
  readonly labels: ProvenancedValue<readonly string[]>;
  /** Semantic color-role bindings merged across the chain. */
  readonly colors: ProvenancedMap<string>;
  readonly identified: EffectiveShapeScope;
  readonly referenced: EffectiveShapeScope;
  readonly types: ProvenancedMap<EffectiveTypeDef>;
  readonly documents: {
    readonly types: ProvenancedMap<DocTypeDef>;
    readonly frontMatter: ProvenancedMap<AttrDecl>;
  };
}
```

- [ ] **Step 5: Run type-check (expect failures)**

```bash
deno check packages/markspec/core/mod.ts
```

Expected: errors in `manifest.ts`, `merge.ts`, and possibly `chain.ts` — they
don't construct the new fields yet. These are fixed in subsequent tasks.

- [ ] **Step 6: Commit**

The commit will leave the build broken until Task 2 lands. That's fine for local
development; we'll run `just check` at the end of Task 4 once the chain is
green.

```bash
git add packages/markspec/core/model/profile.ts
git commit -m "$(cat <<'EOF'
feat(core): add color fields to profile model types

Adds optional color string to TypeDef and ProvenancedValue<string|undefined>
to EffectiveTypeDef. Adds ReadonlyMap<string,string> colors to
ProfileManifest and ProvenancedMap<string> colors to EffectiveProfile.

Implementation of parser, merge, and renderer follows in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Manifest parser — `profile.colors:` and per-type `color:`

**Files:**

- Modify: `packages/markspec/core/profile/manifest.ts`

Two additions: a `parseColorsMap()` helper that reads `profile.colors:` and
emits `MSL-PROFILE-COLOR-002` for unknown hues, and a `color:` field in
`parseTypeDef()` that emits `MSL-PROFILE-COLOR-001` when set on a referenced
type. Cross-reference validation (`MSL-PROFILE-COLOR-003`) lives in the merge
step (Task 4) — only the merged chain knows the full set of valid semantic
names.

- [ ] **Step 1: Add the palette constant**

Open `packages/markspec/core/profile/manifest.ts`. Just under the imports (near
the top of the file), add:

```typescript
/**
 * The seven palette hues a profile may bind a semantic name to.
 * Mirrors the `diagram:` group in `theme/tokens.yaml`.
 */
const PALETTE_HUES = [
  "blue",
  "cyan",
  "teal",
  "orange",
  "red",
  "purple",
  "grey",
] as const;

/** Regex for valid semantic-name keys in `profile.colors:`. */
const COLOR_NAME_RE = /^[a-z][a-z0-9-]*$/;
```

- [ ] **Step 2: Add `parseColorsMap()` helper**

Anywhere in `manifest.ts` (e.g., just above `parseTypeDef` — around line 556).
Insert:

```typescript
/**
 * Parse the `profile.colors:` block. Each key must match COLOR_NAME_RE;
 * each value must be one of PALETTE_HUES. Unknown hues emit
 * MSL-PROFILE-COLOR-002 (error). Returns an empty map when the block is
 * absent.
 */
function parseColorsMap(
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): Map<string, string> {
  const out = new Map<string, string>();
  if (raw === undefined) return out;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: "profile.colors: must be a mapping",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return out;
  }
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!COLOR_NAME_RE.test(name)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message:
          `profile.colors: '${name}' is not a valid semantic name (lowercase letters, digits, hyphens; must start with a letter)`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      continue;
    }
    if (typeof value !== "string") {
      diagnostics.push({
        code: "MSL-PROFILE-COLOR-002",
        severity: "error",
        message:
          `profile.colors.${name}: value must be a string palette hue name`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      continue;
    }
    if (!(PALETTE_HUES as readonly string[]).includes(value)) {
      diagnostics.push({
        code: "MSL-PROFILE-COLOR-002",
        severity: "error",
        message:
          `profile.colors.${name}: '${value}' is not a palette hue (allowed: ${
            PALETTE_HUES.join(", ")
          })`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      continue;
    }
    out.set(name, value);
  }
  return out;
}
```

- [ ] **Step 3: Wire `parseColorsMap()` into `parseManifest()`**

Find the `parseManifest()` function (search for
`export function parseManifest`). It builds a `ProfileManifest` object. Locate
the `labels` parsing — add colors right after. Then include `colors` in the
returned manifest object.

The exact existing code parses keys from `profileSection`; add:

```typescript
const colors = parseColorsMap(
  profileSection.colors,
  sourcePath,
  diagnostics,
);
```

In the returned manifest, add `colors,` next to `labels` (in the same property
block).

- [ ] **Step 4: Add `color:` parsing to `parseTypeDef()`**

Find `parseTypeDef()` (around line 537 — search for `function parseTypeDef`).
After the `displayIdPatternEnforcement` block (around line 607) and before the
`required = parseStringList(...)` line (around line 609), insert:

```typescript
let color: string | undefined;
if (r.color !== undefined) {
  if (typeof r.color !== "string") {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${ctx}: 'color' must be a string`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  color = r.color;
  if (shape === "referenced") {
    diagnostics.push({
      code: "MSL-PROFILE-COLOR-001",
      severity: "warning",
      message:
        `${ctx}: 'color' on a referenced-shape type is ignored at render time`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
  }
}
```

Then add `color,` to the returned object (just under `traceability`):

```typescript
return {
  name,
  shape: shape as EntryShape,
  displayIdPattern,
  displayIdPatternEnforcement: enforcement,
  required,
  attributes,
  traceability,
  color,
};
```

- [ ] **Step 5: Run type-check**

```bash
deno check packages/markspec/core/mod.ts
```

Expected: still errors in `merge.ts` (from Task 1), but `manifest.ts` is now
clean. If `manifest.ts` reports anything, fix it before committing.

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/profile/manifest.ts
git commit -m "$(cat <<'EOF'
feat(core): parse profile.colors and per-type color in manifest

Adds parseColorsMap helper that validates semantic-name keys and
palette-hue values. Adds color string parsing to parseTypeDef. Emits
MSL-PROFILE-COLOR-001 (warning) when color is set on a referenced type
and MSL-PROFILE-COLOR-002 (error) when a value is not in the seven-hue
palette.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Manifest parser tests

**Files:**

- Modify: `packages/markspec/core/profile/manifest_test.ts`

Pure additive test coverage for the new parsing behavior.

- [ ] **Step 1: Locate the test file's existing helpers**

Open `packages/markspec/core/profile/manifest_test.ts`. Note the existing
pattern — most tests build a minimal YAML string, call `parseManifest()`, then
assert on `manifest`/`diagnostics`. Reuse that style.

- [ ] **Step 2: Add the colors-block test**

Append to the file:

```typescript
Deno.test("parseManifest: profile.colors maps semantic names to palette hues", () => {
  const yaml = `
id: test
version: 1.0.0
profile:
  colors:
    primary: blue
    accent: red
  attributes: []
  labels: []
  identified: { attributes: [] }
  referenced: { attributes: [] }
  types: {}
  documents: { types: [], frontMatter: [] }
`;
  const result = parseManifest(yaml, "test.yaml");
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
  );
  assertExists(result.manifest);
  assertEquals(result.manifest.colors.get("primary"), "blue");
  assertEquals(result.manifest.colors.get("accent"), "red");
});

Deno.test("parseManifest: unknown palette hue emits MSL-PROFILE-COLOR-002", () => {
  const yaml = `
id: test
version: 1.0.0
profile:
  colors:
    primary: indigo
  attributes: []
  labels: []
  identified: { attributes: [] }
  referenced: { attributes: [] }
  types: {}
  documents: { types: [], frontMatter: [] }
`;
  const result = parseManifest(yaml, "test.yaml");
  const err = result.diagnostics.find((d) => d.code === "MSL-PROFILE-COLOR-002");
  assertExists(err);
  assertEquals(err.severity, "error");
});

Deno.test("parseManifest: invalid semantic name is rejected", () => {
  const yaml = `
id: test
version: 1.0.0
profile:
  colors:
    "Primary": blue
  attributes: []
  labels: []
  identified: { attributes: [] }
  referenced: { attributes: [] }
  types: {}
  documents: { types: [], frontMatter: [] }
`;
  const result = parseManifest(yaml, "test.yaml");
  const err = result.diagnostics.find((d) =>
    d.severity === "error" && d.message.includes("semantic name")
  );
  assertExists(err);
});

Deno.test("parseManifest: per-type color: is parsed", () => {
  const yaml = `
id: test
version: 1.0.0
profile:
  colors:
    primary: blue
  attributes: []
  labels: []
  identified: { attributes: [] }
  referenced: { attributes: [] }
  types:
    requirement:
      shape: identified
      color: primary
  documents: { types: [], frontMatter: [] }
`;
  const result = parseManifest(yaml, "test.yaml");
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
  );
  assertExists(result.manifest);
  const reqType = result.manifest.types.get("requirement");
  assertExists(reqType);
  assertEquals(reqType.color, "primary");
});

Deno.test("parseManifest: color on referenced type emits MSL-PROFILE-COLOR-001 warning", () => {
  const yaml = `
id: test
version: 1.0.0
profile:
  colors:
    primary: blue
  attributes: []
  labels: []
  identified: { attributes: [] }
  referenced: { attributes: [] }
  types:
    standard:
      shape: referenced
      color: primary
  documents: { types: [], frontMatter: [] }
`;
  const result = parseManifest(yaml, "test.yaml");
  const warn = result.diagnostics.find((d) =>
    d.code === "MSL-PROFILE-COLOR-001"
  );
  assertExists(warn);
  assertEquals(warn.severity, "warning");
  // Manifest still loads — warning, not error.
  assertExists(result.manifest);
});
```

- [ ] **Step 3: Run the new tests**

```bash
deno test --allow-read packages/markspec/core/profile/manifest_test.ts
```

Expected: all five new tests pass; pre-existing tests in the file still pass. If
any fail, fix the parser code in Task 2 (don't relax the tests).

- [ ] **Step 4: Commit**

```bash
git add packages/markspec/core/profile/manifest_test.ts
git commit -m "$(cat <<'EOF'
test(core): cover profile.colors and per-type color parsing

Five tests exercising the happy path, unknown palette hue
(MSL-PROFILE-COLOR-002), invalid semantic name, per-type color
parsing, and the referenced-type warning (MSL-PROFILE-COLOR-001).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Chain merge — colors map + cross-reference validation

**Files:**

- Modify: `packages/markspec/core/profile/merge.ts`
- Modify: `packages/markspec/core/profile/merge_test.ts`

Two responsibilities: merge `colors:` map across the chain (last-write-wins per
key, additive across tiers), and validate per-type `color:` references exist in
the merged map (`MSL-PROFILE-COLOR-003`).

- [ ] **Step 1: Add colors merging in `mergeChain()`**

Open `packages/markspec/core/profile/merge.ts`. Locate the section that builds
the `EffectiveProfile` return object — search for `effective: {` or the
construction of the final `EffectiveProfile`.

Find where `labels` is merged (or how singular fields get last-write-wins
treatment). Apply the same pattern to `colors`:

```typescript
// Merge colors map: last-write-wins per key, additive across tiers.
const mergedColors = new Map<string, ProvenancedMapEntry<string>>();
for (const tier of tiers) {
  for (const [name, hue] of tier.manifest.colors) {
    const prior = mergedColors.get(name);
    mergedColors.set(name, {
      value: hue,
      origin: tier.id,
      overrides: prior ? [...(prior.overrides ?? []), prior.origin] : undefined,
    });
  }
}
```

In the constructed `EffectiveProfile`, include the new field:

```typescript
colors: mergedColors,
```

- [ ] **Step 2: Add per-type color validation in the type merge**

Find where `EffectiveTypeDef` instances are built (search for the construction
of `EffectiveTypeDef` — there will be a function or a block that maps each
`TypeDef` from a tier into the merged form).

For each type that has a non-undefined `color:`, check whether the name is in
`mergedColors`; if not, append:

```typescript
diagnostics.push({
  code: "MSL-PROFILE-COLOR-003",
  severity: "error",
  message:
    `type '${typeDef.name}' references unknown color '${typeDef.color}' (not declared in profile.colors of this profile or any parent)`,
  location: { file: tier.sourcePath, line: 1, column: 1 },
});
```

Then propagate the (possibly invalid) value into the `EffectiveTypeDef.color`
provenanced wrapper anyway — the diagnostic records the error; the renderer's
resolver falls back to `blue` for unknown names. The type stays in the merged
map so downstream checks don't produce a cascade of "type X is missing" errors.

```typescript
color: {
  value: typeDef.color,        // may be undefined or invalid
  origin: tier.id,
},
```

- [ ] **Step 3: Run merge tests (expect partial failures)**

```bash
deno test --allow-read packages/markspec/core/profile/merge_test.ts
```

Existing tests should still pass; if they fail, the constructed
`EffectiveProfile` object is missing required new fields. Fix that.

- [ ] **Step 4: Add merge tests for colors**

Append to `packages/markspec/core/profile/merge_test.ts`:

```typescript
Deno.test("mergeChain: colors map is unioned across tiers, child overrides parent", () => {
  const parent = makeManifest({
    id: "parent",
    colors: new Map([["primary", "blue"], ["accent", "red"]]),
  });
  const child = makeManifest({
    id: "child",
    colors: new Map([["accent", "purple"], ["muted", "grey"]]),
  });
  const chain = makeChain([parent, child]);

  const result = mergeChain(chain);
  assertExists(result.effective);
  const colors = result.effective.colors;
  assertEquals(colors.get("primary")?.value, "blue");
  assertEquals(colors.get("primary")?.origin, "parent");
  assertEquals(colors.get("accent")?.value, "purple");   // child wins
  assertEquals(colors.get("accent")?.origin, "child");
  assertEquals(colors.get("muted")?.value, "grey");
});

Deno.test("mergeChain: type with unknown color emits MSL-PROFILE-COLOR-003", () => {
  const manifest = makeManifest({
    id: "leaf",
    colors: new Map([["primary", "blue"]]),
    types: new Map([
      ["t", makeTypeDef({ name: "t", shape: "identified", color: "missing" })],
    ]),
  });
  const result = mergeChain(makeChain([manifest]));
  const err = result.diagnostics.find(
    (d) => d.code === "MSL-PROFILE-COLOR-003",
  );
  assertExists(err);
  assertEquals(err.severity, "error");
});
```

> The test helpers `makeManifest`, `makeChain`, and `makeTypeDef` already exist
> in this file. If a helper is missing the new fields, extend it with sensible
> defaults (empty `colors` map; `color: undefined` on `TypeDef`). Read the file
> to confirm the exact helper names before using them.

- [ ] **Step 5: Run all tests in the file**

```bash
deno test --allow-read packages/markspec/core/profile/merge_test.ts
```

Expected: green.

- [ ] **Step 6: Run the full type-check + test suite**

```bash
just check
```

Expected: lint clean, type-check clean, all tests pass. After Tasks 1-4 the
model + parser + merge layer is complete; render layer changes (Task 5+) are
still pending but don't break the build.

- [ ] **Step 7: Commit**

```bash
git add packages/markspec/core/profile/merge.ts packages/markspec/core/profile/merge_test.ts
git commit -m "$(cat <<'EOF'
feat(core): merge profile.colors and validate per-type color refs

Merges colors maps across the extends chain (last-write-wins per key,
additive across tiers) into EffectiveProfile.colors. Validates per-type
color references against the merged map and emits MSL-PROFILE-COLOR-003
when the name is unknown. Adds test coverage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `resolveEntryColor()` resolver (TDD)

**Files:**

- Create: `packages/markspec/render/typst/colors.ts`
- Create: `packages/markspec/render/typst/colors_test.ts`

Pure function that captures the five-row resolution table from the spec. Built
test-first.

- [ ] **Step 1: Create the test file with all five cases**

Create `packages/markspec/render/typst/colors_test.ts`:

```typescript
/**
 * Tests for resolveEntryColor — the five rows of the resolution table
 * in docs/superpowers/specs/2026-05-06-profile-driven-entry-colors-design.md.
 */

import { assertEquals } from "@std/assert";
import { resolveEntryColor } from "./colors.ts";
import type { EffectiveProfile, Entry } from "../../core/mod.ts";

function makeIdentifiedEntry(type: string | undefined): Entry {
  return {
    shape: "identified",
    displayId: "TST_AAA_0001",
    title: "t",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    id: "TST_00000000000000000000000001",
    type,
    location: { file: "f.md", line: 1, column: 1 },
  } as Entry;
}

function makeReferencedEntry(type: string | undefined): Entry {
  return { ...makeIdentifiedEntry(type), shape: "referenced" } as Entry;
}

function makeProfile(
  colors: Record<string, string>,
  typeColors: Record<string, string | undefined>,
): EffectiveProfile {
  const colorsMap = new Map(
    Object.entries(colors).map(([k, v]) => [k, {
      value: v,
      origin: "test",
    }]),
  );
  const typesMap = new Map(
    Object.entries(typeColors).map(([name, color]) => [name, {
      value: {
        name,
        shape: "identified" as const,
        displayIdPattern: { value: undefined, origin: "test" },
        displayIdPatternEnforcement: { value: "off" as const, origin: "test" },
        color: { value: color, origin: "test" },
        required: { value: [], origin: "test" },
        attributes: new Map(),
        traceability: new Map(),
      },
      origin: "test",
    }]),
  );
  return {
    required: { value: [], origin: "test" },
    attributes: new Map(),
    labels: { value: [], origin: "test" },
    colors: colorsMap,
    identified: {
      required: { value: [], origin: "test" },
      attributes: new Map(),
      traceability: new Map(),
    },
    referenced: {
      required: { value: [], origin: "test" },
      attributes: new Map(),
      traceability: new Map(),
    },
    types: typesMap,
    documents: { types: new Map(), frontMatter: new Map() },
  } as EffectiveProfile;
}

Deno.test("resolveEntryColor: referenced shape returns null regardless of profile/type", () => {
  const profile = makeProfile({ primary: "blue" }, { ref: "primary" });
  assertEquals(resolveEntryColor(makeReferencedEntry("ref"), profile), null);
  assertEquals(resolveEntryColor(makeReferencedEntry(undefined), profile), null);
  assertEquals(resolveEntryColor(makeReferencedEntry("ref"), undefined), null);
});

Deno.test("resolveEntryColor: identified + profile + known type with color resolves the hue", () => {
  const profile = makeProfile(
    { primary: "blue", danger: "red" },
    { req: "primary", test: "danger" },
  );
  assertEquals(resolveEntryColor(makeIdentifiedEntry("req"), profile), "blue");
  assertEquals(resolveEntryColor(makeIdentifiedEntry("test"), profile), "red");
});

Deno.test("resolveEntryColor: identified + profile + type without color falls back to blue", () => {
  const profile = makeProfile(
    { primary: "blue" },
    { req: undefined },
  );
  assertEquals(resolveEntryColor(makeIdentifiedEntry("req"), profile), "blue");
});

Deno.test("resolveEntryColor: identified + profile + unknown type falls back to blue", () => {
  const profile = makeProfile({ primary: "blue" }, {});
  assertEquals(
    resolveEntryColor(makeIdentifiedEntry("nonexistent"), profile),
    "blue",
  );
});

Deno.test("resolveEntryColor: identified + no profile falls back to blue", () => {
  assertEquals(
    resolveEntryColor(makeIdentifiedEntry("anything"), undefined),
    "blue",
  );
  assertEquals(
    resolveEntryColor(makeIdentifiedEntry(undefined), undefined),
    "blue",
  );
});

Deno.test("resolveEntryColor: type's color name not in colors map falls back to blue", () => {
  // The type was authored with color: 'unknown', merge would have already
  // emitted MSL-PROFILE-COLOR-003 — the renderer must still produce something.
  const profile = makeProfile(
    { primary: "blue" },
    { req: "unknown" },
  );
  assertEquals(resolveEntryColor(makeIdentifiedEntry("req"), profile), "blue");
});
```

- [ ] **Step 2: Run the tests (expect failure — module doesn't exist)**

```bash
deno test --allow-read packages/markspec/render/typst/colors_test.ts
```

Expected: error "no such file or directory" or "module not found" for
`./colors.ts`.

- [ ] **Step 3: Implement `colors.ts`**

Create `packages/markspec/render/typst/colors.ts`:

```typescript
/**
 * @module render/typst/colors
 *
 * Profile-driven entry color resolution. Pure function that maps an entry
 * and the active profile to a palette hue name (or `null` for uncolored).
 *
 * See docs/superpowers/specs/2026-05-06-profile-driven-entry-colors-design.md
 * for the resolution table.
 */

import type { EffectiveProfile, Entry } from "../../core/mod.ts";

/** The seven palette hues the renderer can emit. */
export const PALETTE_HUES = [
  "blue",
  "cyan",
  "teal",
  "orange",
  "red",
  "purple",
  "grey",
] as const;

export type PaletteHue = typeof PALETTE_HUES[number];

/** Default identified-entry hue when no profile / no type color resolves. */
const DEFAULT_HUE: PaletteHue = "blue";

/**
 * Resolve the palette hue for an entry under the active profile.
 *
 * Returns `null` for referenced-shape entries (uncolored block).
 * Returns a palette hue name for identified entries — using the type's
 * declared color when available, falling back to `"blue"` otherwise.
 *
 * The fallback is the palette hue directly (not the `primary` semantic
 * name) so the renderer works for files compiled without a profile.
 */
export function resolveEntryColor(
  entry: Entry,
  profile: EffectiveProfile | undefined,
): PaletteHue | null {
  if (entry.shape === "referenced") return null;

  if (!profile || !entry.type) return DEFAULT_HUE;

  const typeDef = profile.types.get(entry.type);
  const colorName = typeDef?.value.color.value;
  if (!colorName) return DEFAULT_HUE;

  const hueEntry = profile.colors.get(colorName);
  if (!hueEntry) return DEFAULT_HUE;

  return hueEntry.value as PaletteHue;
}
```

- [ ] **Step 4: Run the tests (expect pass)**

```bash
deno test --allow-read packages/markspec/render/typst/colors_test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/render/typst/colors.ts packages/markspec/render/typst/colors_test.ts
git commit -m "$(cat <<'EOF'
feat(render): add profile-driven entry color resolver

resolveEntryColor returns null for referenced entries, the resolved
palette hue for identified entries with a known type color, and falls
back to palette blue otherwise. Pure function, fully unit-tested
against the five-row resolution table.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update Typst entry block (`entry.typ`)

**Files:**

- Modify: `packages/markspec-typst/entry.typ`
- Modify: `packages/markspec-typst/lib.typ`

Replace the `type:` parameter on `req-block` with `color:`. Drop the
`entry-category()` function. Rework `entry-color()` to accept a hue name or
`none`.

- [ ] **Step 1: Rewrite `entry-color()` and remove `entry-category()`**

Open `packages/markspec-typst/entry.typ`. Replace lines 1-25 with:

```typst
// MarkSpec entry block rendering — admonition-style requirement blocks.

#import "tokens.typ": *

/// Resolve the theme color for an entry.
///
/// - color (str | none): a palette hue name ("blue", "cyan", "teal",
///   "orange", "red", "purple", "grey") or `none` for an uncolored block.
/// - theme (module): a theme module that exports `entry-<hue>` colors.
/// -> color | none
#let entry-color(color, theme) = {
  if color == none { none }
  else if color == "blue" { theme.entry-blue }
  else if color == "cyan" { theme.entry-cyan }
  else if color == "teal" { theme.entry-teal }
  else if color == "orange" { theme.entry-orange }
  else if color == "red" { theme.entry-red }
  else if color == "purple" { theme.entry-purple }
  else if color == "grey" { theme.entry-grey }
  else { theme.entry-blue }  // fallback for unexpected input
}
```

- [ ] **Step 2: Update `req-block` signature and rendering**

In the same file, find `#let req-block(` (currently around line 62). Replace its
parameter list and body so it accepts `color:` instead of `type:` and renders an
uncolored block when `color: none`:

```typst
/// Render a full entry block with admonition-style left border.
///
/// - color (str | none): palette hue name or `none` for uncolored.
/// - display-id (str): human-readable display ID (e.g. "SWE_BRK_0107").
/// - title (str): entry title
/// - body (content): body content
/// - attrs (array): array of (key, value) pairs for the metadata line
/// - labels (array): array of label strings for pill rendering
/// - theme (module): theme module for colors
/// -> content
#let req-block(
  color: none,
  display-id: "",
  title: "",
  body: [],
  attrs: (),
  labels: (),
  theme: none,
) = {
  let resolved = entry-color(color, theme)

  block(
    stroke: if resolved == none { none } else { (left: 2pt + resolved) },
    inset: (left: 12pt, top: 0pt, bottom: 4pt, right: 0pt),
    width: 100%,
    {
      // Title line
      {
        let id-fill = if resolved == none { theme.text } else { resolved }
        text(size: size-body, weight: "medium", fill: id-fill, display-id)
        h(6pt)
        text(size: size-body, weight: "medium", title)
        if labels.len() > 0 {
          h(6pt)
          box({
            for (i, label) in labels.enumerate() {
              if i > 0 { h(4pt) }
              pill(label, theme)
            }
          })
        }
      }

      // Body (unchanged)
      if body != [] and body != "" {
        v(space-1)
        text(size: size-body, body)
      }

      // Metadata line (unchanged)
      if attrs.len() > 0 {
        v(space-2)
        set text(size: size-small, style: "italic", fill: theme.secondary)
        let traceability-keys = ("Satisfies", "Verifies", "Derived-from")
        let parts = ()
        for (key, value) in attrs {
          if key in traceability-keys {
            let refs = value.split(",").map(s => s.trim())
            let linked = refs.map(r => cross-ref(r))
            parts.push([#key: #linked.join([, ])])
          } else {
            parts.push([#key: #value])
          }
        }
        parts.join[ #sym.dot.c ]
      }
    },
  )
}
```

- [ ] **Step 3: Drop `entry-category` re-export from `lib.typ`**

Open `packages/markspec-typst/lib.typ` line 14. Change:

```typst
#import "entry.typ": req-block, pill, cross-ref, entry-category
```

to:

```typst
#import "entry.typ": req-block, pill, cross-ref
```

If `lib.typ` re-exports `entry-category` further down, remove that too.

- [ ] **Step 4: Commit**

The build will be temporarily broken: `template.ts` still emits `type: "..."`
and `theme.entry-req` doesn't exist yet. Tasks 7-8 fix both.

```bash
git add packages/markspec-typst/entry.typ packages/markspec-typst/lib.typ
git commit -m "$(cat <<'EOF'
feat(render): replace req-block type: with color: parameter

req-block now accepts color: none for uncolored blocks (referenced
entries) or one of seven palette hue names. entry-color resolves the
hue to a theme color or none. entry-category is dropped — the TS layer
computes the hue, Typst just looks it up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Token regeneration — entry hues from `diagram:`

**Files:**

- Modify: `theme/tokens.yaml`
- Modify: `scripts/gen_theme.ts`
- Regenerate: `packages/markspec-typst/themes/light.typ`,
  `packages/markspec-typst/themes/dark.typ`,
  `packages/markspec-typst/tokens.typ`, `theme/markspec.css` (via `just tokens`)

The Typst theme needs `entry-blue`, `entry-cyan`, ..., `entry-grey` defined
(sourced from `diagram:`). The legacy `entry-req`, `entry-spec`, `entry-test`
defs go away. The CSS gets the same treatment.

- [ ] **Step 1: Drop the `entries:` block from `tokens.yaml`**

Open `theme/tokens.yaml`. Delete lines 1-5 (or whichever match the `entries:`
block):

```yaml
entries:
  req: { print: "#4477AA", screen: "#0077BB" }
  spec: { print: "#228833", screen: "#009988" }
  test: { print: "#EE6677", screen: "#EE7733" }
```

Keep the rest of the file untouched (the `# print = Tol bright (PDF); ...`
comment and the `alerts:` and `diagram:` blocks).

- [ ] **Step 2: Update `gen_theme.ts` to read `diagram:` for entry hues**

Open `scripts/gen_theme.ts`. Find the `entries:` field on the `Tokens` interface
(around line 27) and remove it:

```typescript
// Before
interface Tokens {
  ...
  entries: Record<string, { print: string; screen: string }>;
  ...
}

// After — remove the line entirely
```

Find the loop that emits `entry-${type}` Typst lets (around line 117-119):

```typescript
// Before
for (const [type, props] of Object.entries(tokens.entries)) {
  lines.push(`#let entry-${type} = rgb("${props[palette]}")`);
}
```

Replace with:

```typescript
for (const [hue, props] of Object.entries(tokens.diagram)) {
  lines.push(`#let entry-${hue} = rgb("${props[palette]}")`);
}
```

Find the equivalent CSS loop (around line 172-174):

```typescript
// Before
for (const [type, props] of Object.entries(tokens.entries)) {
  lines.push(`  --ms-entry-${type}: ${props.screen};`);
}
```

Replace with:

```typescript
for (const [hue, props] of Object.entries(tokens.diagram)) {
  lines.push(`  --ms-entry-${hue}: ${props.screen};`);
}
```

- [ ] **Step 3: Regenerate**

```bash
just tokens
```

This re-emits `packages/markspec-typst/tokens.typ`,
`packages/markspec-typst/themes/light.typ`,
`packages/markspec-typst/themes/dark.typ`, and `theme/markspec.css`.

- [ ] **Step 4: Sanity-check the generated output**

```bash
grep "entry-" packages/markspec-typst/themes/light.typ
```

Expected output (order may vary):

```
#let entry-blue = rgb("#4477AA")
#let entry-cyan = rgb("#66CCEE")
#let entry-teal = rgb("#228833")
#let entry-orange = rgb("#CCBB44")
#let entry-red = rgb("#EE6677")
#let entry-purple = rgb("#AA3377")
#let entry-grey = rgb("#BBBBBB")
```

`entry-req`, `entry-spec`, `entry-test` should be **absent**.

- [ ] **Step 5: Run the token-staleness check**

```bash
bash scripts/check_tokens.sh
```

Expected: clean (no diff between regenerated files and what's checked in). If
the script reports drift, re-run `just tokens` and stage the output.

- [ ] **Step 6: Commit**

```bash
git add theme/tokens.yaml scripts/gen_theme.ts \
  packages/markspec-typst/tokens.typ \
  packages/markspec-typst/themes/light.typ \
  packages/markspec-typst/themes/dark.typ \
  theme/markspec.css
git commit -m "$(cat <<'EOF'
chore(repo): generate entry hues from diagram palette

Drops the entries: token group (req/spec/test) — those were just a
3-pick of the diagram palette. gen_theme.ts now emits entry-blue,
entry-cyan, etc. directly from diagram: so the seven palette hues are
all available to req-block. CSS variables get the same treatment.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire `resolveEntryColor()` into the Typst template

**Files:**

- Modify: `packages/markspec/render/typst/template.ts`
- Modify: `packages/markspec/render/typst/template_test.ts`

Replace the prefix-heuristic call site with the profile-driven resolver and emit
the new `color:` Typst argument.

- [ ] **Step 1: Read the current `renderEntryTypst` for context**

```bash
sed -n '180,260p' packages/markspec/render/typst/template.ts
```

Note: `displayIdCategory(displayId, shape)` is called inside
`renderEntryTypst()` and the result is interpolated as `type: "${category}"`.

- [ ] **Step 2: Add the `profile` parameter and the resolver call**

Open `packages/markspec/render/typst/template.ts`. At the top of the file, add
the import:

```typescript
import { resolveEntryColor } from "./colors.ts";
import type { EffectiveProfile } from "../../core/mod.ts";
```

Delete `displayIdCategory()` (lines ~183-200, the function and its two docstring
blocks).

Change the signature of `renderEntryTypst` (around line 203) to:

```typescript
function renderEntryTypst(
  entry: Entry,
  profile: EffectiveProfile | undefined,
  scopeArg: string = "",
): string {
  const color = resolveEntryColor(entry, profile);
  // ...rest unchanged until the return template
```

Update the return template:

```typescript
  // Before
  return `#req-block(
  type: "${category}",
  display-id: "${escapeTypstString(entry.displayId)}",
  ...

  // After
  return `#req-block(
  color: ${color === null ? "none" : `"${color}"`},
  display-id: "${escapeTypstString(entry.displayId)}",
  ...
```

(Leave the rest of the template literal unchanged.)

- [ ] **Step 3: Thread `profile` through the public entrypoint**

Find `generateTypstDocument()` (search for
`export function
generateTypstDocument` or the module's main exported function).
Add the profile to its options interface or signature, then pass it down to
`renderEntryTypst()` at every call site within this file.

If the function takes a single options object (`GenerateOptions` or similar),
add:

```typescript
export interface GenerateOptions {
  // ...existing fields...
  readonly profile?: EffectiveProfile;
}
```

Inside the function, find each `renderEntryTypst(entry, ...)` call and pass
`options.profile`:

```typescript
const block = renderEntryTypst(entry, options.profile, scopeArg);
```

- [ ] **Step 4: Update template tests**

Open `packages/markspec/render/typst/template_test.ts`. Search for existing
assertions on `type: "req"` / `type: "spec"` / `type: "test"`. Replace with
`color: "blue"` / etc. according to which profile (if any) each test uses. Tests
that don't pass a profile should expect `color: "blue"` (the fallback).

If a test passes no profile and a referenced entry, expect `color: none`.

- [ ] **Step 5: Run all render tests**

```bash
deno test --allow-read --allow-ffi packages/markspec/render/
```

Expected: green. If a test's expected Typst snippet drifted in a way the test
isn't checking explicitly, re-read the assertion to be sure the new output is
correct (color name is right, fallback honored).

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/render/typst/template.ts packages/markspec/render/typst/template_test.ts
git commit -m "$(cat <<'EOF'
feat(render): resolve entry color via profile in Typst template

renderEntryTypst now takes the active EffectiveProfile and calls
resolveEntryColor to pick a palette hue (or none for referenced).
Emits color: argument to req-block. displayIdCategory is gone.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Thread profile through `renderPdf` and CLI

**Files:**

- Modify: `packages/markspec/render/mod.ts`
- Modify: `packages/markspec/main.ts`

The CLI loads the profile chain in `compileProject()` but discards it. Add
profile to `RenderOptions` and have the CLI pass `chain.effective` to
`renderPdf()`.

- [ ] **Step 1: Add `profile?: EffectiveProfile` to `RenderOptions`**

Open `packages/markspec/render/mod.ts`. Find `RenderOptions` (around line
20-35). Add:

```typescript
import type { EffectiveProfile } from "../core/mod.ts";

export interface RenderOptions {
  // ...existing fields...
  /** Active profile chain's merged view, if any. Drives entry coloring. */
  readonly profile?: EffectiveProfile;
}
```

In `renderPdf()` (or the equivalent function that calls
`generateTypstDocument`), pass `options.profile` through:

```typescript
const typstSource = generateTypstDocument(markdown, {
  // ...existing options...
  profile: options.profile,
});
```

- [ ] **Step 2: Refactor `compileProject` in `main.ts` to expose the chain**

Open `packages/markspec/main.ts`. Find `compileProject()` (around line 80-100).
Currently it returns just `CompileResult`. Change it to return both:

```typescript
async function compileProject(
  paths: string[],
): Promise<{ result: CompileResult; chain: ProfileChain | null }> {
  const configResult = await requireProjectConfig();
  const chain = await loadActiveProfile(configResult.projectRoot);
  const { compile } = await import("./core/mod.ts");
  const result = await compile(paths, {
    readFile: (p) => Deno.readTextFile(p),
    profile: chain?.effective ?? undefined,
  });

  for (const diag of result.diagnostics) {
    const loc = diag.location
      ? `${diag.location.file}:${diag.location.line}`
      : "";
    console.error(`${diag.severity}[${diag.code}]: ${loc} ${diag.message}`);
  }

  return { result, chain };
}
```

Update **every** call site in `main.ts` that destructures the return value.
Search for `await compileProject(`:

```bash
grep -n "compileProject(" packages/markspec/main.ts
```

For each site, change:

```typescript
const compiled = await compileProject(paths);
```

to:

```typescript
const { result: compiled, chain } = await compileProject(paths);
```

(Use `_chain` or just `chain` depending on whether the call site actually
consumes it.)

- [ ] **Step 3: Pass the profile to `renderPdf` in `doc build`**

Find the `doc build` action in `main.ts`. After the destructured
`compileProject` call, pass `chain?.effective` into `renderPdf`:

```typescript
const result = renderPdf(markdown, {
  compiled,
  config,
  typstPackagePath,
  sourceFilePath,
  profile: chain?.effective,
});
```

- [ ] **Step 4: Pass the profile to `buildBook` in `book build`**

Find the `book build` action. The book pipeline currently calls `compile()`
directly (not `compileProject`). Update it to also pass the profile:

```typescript
// Find this block and ensure profile loads + flows
const chain = await loadActiveProfile(projectRoot);
// ...
const compiled = await compile([...files.keys()], {
  readFile: (p) => Deno.readTextFile(p),
  profile: chain?.effective ?? undefined,
});
const result = buildBook(structure, {
  files,
  compiled,
  config,
  profile: chain?.effective,
});
```

> If `BuildBookOptions` or its book module entry points don't accept `profile`
> yet, this is **out of scope** for this plan: the book HTML renderer color
> application is listed as a non-goal in the spec. For now, just ensure the book
> module compiles cleanly without the profile field (don't add it to the book
> API). If passing profile to book would change book's signature, omit that
> line.

- [ ] **Step 5: Run lint + type-check + tests**

```bash
just check
```

Expected: green. If anything in `main.ts` complains, fix the call sites (usually
a missing destructure).

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/render/mod.ts packages/markspec/main.ts
git commit -m "$(cat <<'EOF'
feat(cli): thread active profile into render pipeline

compileProject now returns the loaded chain alongside CompileResult so
the CLI can pass the merged EffectiveProfile to renderPdf, where the
Typst template uses it to resolve entry colors. RenderOptions gains an
optional profile field.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Default profile fixture — ship the role bindings

**Files:**

- Modify: `docs/examples/profiles/default/markspec.yaml`

The local default profile fixture (which doubles as the test mock for
`@markspec/profile-default`) gets the seven role bindings.

- [ ] **Step 1: Add the colors block to the default fixture**

Edit `docs/examples/profiles/default/markspec.yaml`. Replace its current
`profile:` body so it includes a `colors:` map:

```yaml
# Baseline default profile — minimal identity, no rules.
# Used as the root of extends: chains in examples and tests.

id: "@markspec/profile-default"
version: 1.0.0
description: Baseline MarkSpec profile
license: MIT

profile:
  attributes: []
  labels: []

  colors:
    primary:   blue
    secondary: teal
    tertiary:  cyan
    accent:    purple
    muted:     grey
    warning:   orange
    danger:    red

  identified:
    attributes: []
  referenced:
    attributes: []

  types: {}

  documents:
    types: []
    frontMatter: []
```

- [ ] **Step 2: Verify the strawman test still loads it cleanly**

```bash
deno test --allow-read packages/markspec/core/profile/strawman_test.ts
```

Expected: existing assertions still pass. Color-aware assertions land in
Task 12.

- [ ] **Step 3: Commit**

```bash
git add docs/examples/profiles/default/markspec.yaml
git commit -m "$(cat <<'EOF'
feat(spec): default profile ships seven semantic color roles

@markspec/profile-default now declares profile.colors with one role per
palette hue (primary, secondary, tertiary, accent, muted, warning,
danger). Downstream profiles bind types to these roles or override the
bindings.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Strawman profile — assign per-type colors

**Files:**

- Modify: `docs/examples/profiles/aspice-swe-mini/markspec.yaml`

Each identified type gets a `color:` referencing one of the inherited roles from
the default profile.

- [ ] **Step 1: Edit the strawman manifest**

Open `docs/examples/profiles/aspice-swe-mini/markspec.yaml`. For each identified
type, add a `color:` line. Preserve all existing fields.

```yaml
  types:
    stakeholder-requirement:
      shape: identified
      description: Stakeholder requirement (SWE.1 input)
      display-id-pattern: "STK_{scope}_{n:04d}"
      color: primary

    software-requirement:
      shape: identified
      description: Software requirement (SWE.1 output)
      display-id-pattern: "SRS_{scope}_{n:04d}"
      color: primary
      required: [Derived-from]
      traceability:
        Derived-from:
          target: [stakeholder-requirement]
          cardinality: 1..N
          required: true

    software-element:
      shape: identified
      description: Software element spec (SWE.2)
      display-id-pattern: "SWE_{scope}_{n:04d}"
      color: secondary
      required: [Derived-from, Realized-by]
      # ...rest unchanged

    unit:
      shape: identified
      description: Source-code unit (function, method, module)
      color: tertiary
      attributes:
        - { name: Element-kind, type: enum, values: [module, class, function, source] }

    unit-test:
      shape: identified
      description: Software unit test (SWE.4)
      display-id-pattern: "SWT_{scope}_{n:04d}"
      color: danger
      required: [Verifies, Tests]
      # ...rest unchanged

    integration-test:
      shape: identified
      description: Software integration test (SWE.5)
      display-id-pattern: "SIT_{scope}_{n:04d}"
      color: danger
      required: [Verifies]
      # ...rest unchanged

    standard:
      shape: referenced
      description: External normative standard (ISO, DO, IEC, RFC, …)
      # No color: standards always render uncolored.
```

- [ ] **Step 2: Verify the strawman still loads cleanly**

```bash
deno test --allow-read packages/markspec/core/profile/strawman_test.ts
```

Expected: green. Color values resolve via the merged map (primary → blue, etc.).

- [ ] **Step 3: Commit**

```bash
git add docs/examples/profiles/aspice-swe-mini/markspec.yaml
git commit -m "$(cat <<'EOF'
feat(spec): assign colors to aspice-swe-mini types

Six identified types pick semantic roles from the inherited default
profile (primary, secondary, tertiary, danger). The standard type stays
referenced and uncolored.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Strawman test — assert color resolution

**Files:**

- Modify: `packages/markspec/core/profile/strawman_test.ts`

End-to-end check that color resolution works on the merged chain.

- [ ] **Step 1: Add the color-resolution test**

Append to `packages/markspec/core/profile/strawman_test.ts`:

```typescript
Deno.test("strawman: per-type color resolves through merged colors map", async () => {
  const result = await loadStrawmanChain();
  assertExists(result.chain);
  const types = result.chain.effective.types;
  const colors = result.chain.effective.colors;

  // Default profile colors are inherited.
  assertEquals(colors.get("primary")?.value, "blue");
  assertEquals(colors.get("secondary")?.value, "teal");
  assertEquals(colors.get("danger")?.value, "red");

  // Strawman types pick roles.
  const stk = types.get("stakeholder-requirement");
  assertExists(stk);
  assertEquals(stk.value.color.value, "primary");

  const swe = types.get("software-element");
  assertExists(swe);
  assertEquals(swe.value.color.value, "secondary");

  const swt = types.get("unit-test");
  assertExists(swt);
  assertEquals(swt.value.color.value, "danger");

  // Referenced type carries no color.
  const standard = types.get("standard");
  assertExists(standard);
  assertEquals(standard.value.color.value, undefined);
});
```

- [ ] **Step 2: Run the strawman tests**

```bash
deno test --allow-read packages/markspec/core/profile/strawman_test.ts
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add packages/markspec/core/profile/strawman_test.ts
git commit -m "$(cat <<'EOF'
test(core): assert color resolution end-to-end on the strawman

Verifies the merged colors map carries the inherited default-profile
bindings and that strawman types resolve to their declared roles.
Standard (referenced) carries no color value.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Documentation — typography spec

**Files:**

- Modify: `docs/spec/typography/typography.md`

Update the entry-color section so it describes the new model.

- [ ] **Step 1: Locate the existing entry-color section**

```bash
grep -n -i "entry.*color\|req\|spec\|test\|prefix" docs/spec/typography/typography.md | head -20
```

Find the section that describes how prefix → bucket → color worked.

- [ ] **Step 2: Replace prose**

Replace the prefix-heuristic explanation with: "Profiles declare semantic color
roles in `profile.colors:`; types pick a role; the renderer maps the role to a
palette hue and looks it up in the theme."

Keep all token tables, palette references, and other unrelated typography prose
intact.

Add the resolution table from the spec (the five-row truth table) so authors
know the fallback behavior.

- [ ] **Step 3: `just fmt` to align**

```bash
just fmt
```

- [ ] **Step 4: Commit**

```bash
git add docs/spec/typography/typography.md
git commit -m "$(cat <<'EOF'
docs(docs): describe profile-driven entry colors in typography spec

Replaces the prefix-heuristic explanation with the role-based
resolution model. Documents the five-row resolution table and the
default profile's seven role bindings.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Final verification

- [ ] **Step 1: Full `just check`**

```bash
just check
```

Expected: lint clean, type-check clean, every test passing.

- [ ] **Step 2: Manual render sanity check**

Render one of the showcase documents and eyeball the entry colors.

```bash
just compile
./dist/markspec doc build docs/examples/entry-rendering.md -o /tmp/ms-render.pdf
open /tmp/ms-render.pdf
```

Verify visually:

- Identified entries with a color show a colored 2pt left border.
- Referenced entries (if any in the example) show no border.
- The colors match the profile's role bindings (e.g. requirements blue,
  software-elements teal).

If the showcase doc relies on the old prefix-implied colors and the project
profile hasn't been color-annotated, that's expected (Task 11 only updated the
strawman). Either color-annotate this repo's project profile or accept all-blue
identified entries as the no-profile fallback. Note this in the PR description
either way.

- [ ] **Step 3: Run e2e tests**

```bash
deno test --allow-read --allow-write --allow-run --allow-env tests/e2e/
```

Expected: green. The CLI surface didn't change so e2e tests should be
unaffected.

- [ ] **Step 4: Confirm no debt items**

Re-read the spec's non-goals section. Items deferred (HTML book color
application, per-shape color overrides, per-document overrides) should not have
been pulled in. If any non-goal accidentally landed, split it into a follow-up
issue or revert it.

- [ ] **Step 5: Final commit (if any cleanup needed)**

If verification surfaced minor issues, fix and commit:

```bash
git add ...
git commit -m "..."
```

---

## Self-Review Checklist (run before opening PR)

1. **Spec coverage:** Every change in the spec's "Migration impact" table maps
   to a task above? ✓ (lines confirm)
2. **Placeholder scan:** No "TBD"/"TODO"/"implement later" in the plan?
3. **Type consistency:** `EffectiveTypeDef.color` is
   `ProvenancedValue<string |
   undefined>` everywhere;
   `EffectiveProfile.colors` is `ProvenancedMap<string>` everywhere; resolver
   returns `PaletteHue | null`.
4. **Diagnostic codes match the spec:** `MSL-PROFILE-COLOR-001` (warning),
   `-002` (error), `-003` (error). ✓
5. **No `--no-verify` instructions anywhere.** ✓

If any item fails, fix the plan inline before handoff.
