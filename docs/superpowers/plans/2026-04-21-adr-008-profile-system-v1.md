# ADR-008 Profile System v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v1 mechanism for ADR-008 so external profiles can declare
types, attributes, and traceability rules that are enforced by a profile-aware
validator and compiler, without bundling any default profile or language pack.

**Architecture:** Chain + pipeline. A `.markspec.yaml` points at a single
content-bearing profile; the loader resolves specifiers (local path or git),
walks the `extends:` chain with cycle and depth detection, and merges tiers into
one `EffectiveProfile` preserving provenance. A four-stage validator pipeline
(core hygiene → type classification → typed attributes → traceability) runs
against loaded entries; the compiler adds a generated-inverses pass.

**Tech Stack:** Deno + TypeScript, `@std/yaml`, `@std/assert`, `@std/path`,
`@cliffy/command`. Git CLI invoked via `Deno.Command` for git specifiers.
Existing `@driftsys/markspec` monorepo under `packages/markspec/`.

**Spec:**
[docs/superpowers/specs/2026-04-21-adr-008-profile-system-v1-design.md](../specs/2026-04-21-adr-008-profile-system-v1-design.md)

---

## Phase overview (9 PRs)

| # | Phase                                       | Scope                                                                                        |
| - | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1 | **Model + manifest parsing**                | `model/profile.ts` types, `profile/manifest.ts` YAML → `ProfileManifest` + schema validation |
| 2 | **Single local profile + consumer binding** | `.markspec.yaml` loader, local specifier resolution, single-profile load (no extends)        |
| 3 | **Extends chain + merge semantics**         | Chain resolution (cycle + depth), additive/tightening/subset merge, provenance               |
| 4 | **Git specifier + cache**                   | `git+https://…#tag` parsing, shallow+sparse clone, `.markspec/cache/`                        |
| 5 | **Validator stage 2: type classification**  | Display-ID pattern matcher, `Type:` trailer override, strict-mode errors                     |
| 6 | **Validator stage 3: typed attributes**     | Scope layering + all 14 value-type validators, required/cardinality/unknown                  |
| 7 | **Validator stage 4: traceability**         | Target matcher (type/shape/mixed), cardinality, required                                     |
| 8 | **Generated inverses**                      | `AttributeValue.origin` field, `compiler/inverses.ts`, conflict detection                    |
| 9 | **CLI: `profile add` + `doctor`**           | Vendor to `profiles/<id>/`, chain diagnostics                                                |

Each phase is one PR. This document details **Phase 1** in full TDD cycles.
Subsequent phases have task-level outlines — writing-plans should be re-invoked
to expand each phase before implementation.

---

# Phase 1 — Profile model + manifest parsing

**PR scope:** Define the TypeScript types for a loaded profile and implement
YAML → `ProfileManifest` parsing with schema validation. No loader, no
validator, no CLI — just the data model and parser.

**Files this PR creates or modifies:**

- **Create** `packages/markspec/core/model/profile.ts` — type declarations for
  `ProfileManifest`, `TypeDef`, `AttrDef`, `TraceRule`, `ProfileSpecifier`,
  diagnostic codes.
- **Modify** `packages/markspec/core/model/mod.ts` — re-export profile types.
- **Create** `packages/markspec/core/profile/manifest.ts` —
  `parseManifest(rawYaml)` → `ParseManifestResult`.
- **Create** `packages/markspec/core/profile/manifest_test.ts` — unit tests.
- **Create** `tests/fixtures/profiles/phase1/` — sample manifest YAMLs (happy +
  error cases).

**Dependency install check:** `@std/yaml` is already imported in
`core/config/mod.ts` — no new dependencies.

---

### Task 1.1 — Declare profile model types

**Files:**

- Create: `packages/markspec/core/model/profile.ts`

- [ ] **Step 1: Write the type declarations**

```typescript
/**
 * @module model/profile
 *
 * Profile data model — TypeScript types that mirror ADR-008 §4 manifest
 * schema. Used by the profile loader, merger, and validator.
 */

// ---------------------------------------------------------------------------
// Value types (ADR-002 Annex C)
// ---------------------------------------------------------------------------

/** All 14 attribute value-type keywords recognized by the core. */
export const VALUE_TYPES = [
  "id",
  "id-list",
  "uri",
  "url",
  "path",
  "path-or-id",
  "enum",
  "tag-list",
  "text",
  "citation",
  "external-id",
  "integer",
  "date",
  "boolean",
] as const;

export type ValueType = typeof VALUE_TYPES[number];

/** Types whose default cardinality is a list (`0..N`). */
export const LIST_VALUE_TYPES: ReadonlySet<ValueType> = new Set([
  "id-list",
  "tag-list",
]);

// ---------------------------------------------------------------------------
// Cardinality
// ---------------------------------------------------------------------------

/** Count bounds `lower..upper` where upper = Infinity represents `N`. */
export interface Cardinality {
  readonly lower: number;
  readonly upper: number; // Infinity when upper is N
}

// ---------------------------------------------------------------------------
// Attribute declaration
// ---------------------------------------------------------------------------

/** Inverse declaration for link attributes (`id` / `id-list`). */
export interface InverseDecl {
  readonly name: string;
  readonly category: string; // type name where inverse appears
}

/** A single attribute declaration within a profile scope. */
export interface AttrDecl {
  readonly name: string; // Title-Case trailer convention
  readonly type: ValueType;
  readonly required: boolean;
  readonly cardinality: Cardinality; // inferred from type if unspecified
  readonly values?: readonly string[]; // required when type === "enum"
  readonly inverse?: InverseDecl; // only valid when type is "id" or "id-list"
}

// ---------------------------------------------------------------------------
// Traceability rule
// ---------------------------------------------------------------------------

/** Target matcher: either a type name or a shape matcher object. */
export type TargetMatcher = string | {
  readonly shape: "identified" | "referenced";
};

/** Traceability rule declared on a shape or type scope. */
export interface TraceRule {
  readonly target: readonly TargetMatcher[];
  readonly cardinality?: Cardinality;
  readonly required: boolean;
}

// ---------------------------------------------------------------------------
// Type definition
// ---------------------------------------------------------------------------

export type EntryShape = "identified" | "referenced";

export type EnforcementMode = "off" | "warn" | "error";

export interface TypeDef {
  readonly name: string;
  readonly shape: EntryShape;
  readonly displayIdPattern?: string;
  readonly displayIdPatternEnforcement: EnforcementMode;
  readonly required: readonly string[];
  readonly attributes: readonly AttrDecl[];
  readonly traceability: ReadonlyMap<string, TraceRule>;
}

// ---------------------------------------------------------------------------
// Document scope
// ---------------------------------------------------------------------------

export interface DocTypeDef {
  readonly id: string;
  readonly contains: readonly string[];
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Profile manifest
// ---------------------------------------------------------------------------

/** Specifier scheme identifying where a profile lives. */
export type ProfileSpecifier =
  | { readonly kind: "local"; readonly path: string }
  | {
    readonly kind: "git";
    readonly repo: string;
    readonly subpath?: string;
    readonly tag: string;
  };

/** Parsed `markspec.yaml` content — the manifest authored in a profile. */
export interface ProfileManifest {
  // top-level fields
  readonly id: string;
  readonly version: string;
  readonly description?: string;
  readonly license?: string;
  readonly extends?: ProfileSpecifier;

  // profile: content section
  readonly universalRequired: readonly string[];
  readonly universalAttributes: readonly AttrDecl[];
  readonly labels: readonly string[];

  readonly identified: {
    readonly required: readonly string[];
    readonly attributes: readonly AttrDecl[];
    readonly traceability: ReadonlyMap<string, TraceRule>;
  };
  readonly referenced: {
    readonly required: readonly string[];
    readonly attributes: readonly AttrDecl[];
  };

  readonly types: ReadonlyMap<string, TypeDef>;

  readonly documents: {
    readonly types: readonly DocTypeDef[];
    readonly frontMatter: readonly AttrDecl[];
  };
}
```

- [ ] **Step 2: Type-check the file**

Run: `deno check packages/markspec/core/model/profile.ts` Expected: no errors.

- [ ] **Step 3: Re-export from model barrel**

Modify: `packages/markspec/core/model/mod.ts` — add at the end of the file,
before the closing statements:

```typescript
export type {
  AttrDecl,
  Cardinality,
  DocTypeDef,
  EnforcementMode,
  EntryShape,
  InverseDecl,
  ProfileManifest,
  ProfileSpecifier,
  TargetMatcher,
  TraceRule,
  TypeDef,
  ValueType,
} from "./profile.ts";
export { LIST_VALUE_TYPES, VALUE_TYPES } from "./profile.ts";
```

- [ ] **Step 4: Type-check the barrel**

Run: `deno check packages/markspec/core/model/mod.ts` Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/model/profile.ts packages/markspec/core/model/mod.ts
git commit -m "feat(core): profile data model types"
```

---

### Task 1.2 — Parse empty manifest happy path

**Files:**

- Create: `packages/markspec/core/profile/manifest.ts`
- Create: `packages/markspec/core/profile/manifest_test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/markspec/core/profile/manifest_test.ts`:

```typescript
/**
 * @module core/profile/manifest_test
 *
 * Unit tests for markspec.yaml manifest parsing.
 */

import { assertEquals } from "@std/assert";
import { parseManifest } from "./manifest.ts";

Deno.test("parseManifest: minimal valid manifest", () => {
  const yaml = `
id: "@acme/profile-minimal"
version: 0.1.0
`;
  const result = parseManifest(yaml);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.manifest?.id, "@acme/profile-minimal");
  assertEquals(result.manifest?.version, "0.1.0");
  assertEquals(result.manifest?.types.size, 0);
  assertEquals(result.manifest?.universalAttributes.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: FAIL
with `Cannot find module './manifest.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/markspec/core/profile/manifest.ts`:

```typescript
/**
 * @module core/profile/manifest
 *
 * Parse a markspec.yaml manifest string into a validated ProfileManifest.
 * Emits PROFILE-LOAD-002 for YAML parse errors and PROFILE-LOAD-003 for
 * schema violations.
 */

import { parse as parseYaml } from "@std/yaml";
import type { Diagnostic, ProfileManifest } from "../model/mod.ts";

/** Result of parsing a profile manifest. */
export interface ParseManifestResult {
  readonly manifest: ProfileManifest | null;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Parse and validate a raw markspec.yaml string.
 *
 * @param rawYaml - File contents as a UTF-8 string
 * @param sourcePath - Optional file path for diagnostic location
 */
export function parseManifest(
  rawYaml: string,
  sourcePath = "<markspec.yaml>",
): ParseManifestResult {
  const diagnostics: Diagnostic[] = [];

  let parsed: unknown;
  try {
    parsed = parseYaml(rawYaml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    diagnostics.push({
      code: "PROFILE-LOAD-002",
      severity: "error",
      message: `YAML parse error: ${message}`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { manifest: null, diagnostics };
  }

  if (parsed == null || typeof parsed !== "object") {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: "manifest must be a YAML mapping",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { manifest: null, diagnostics };
  }

  const root = parsed as Record<string, unknown>;
  const id = requireString(root, "id", sourcePath, diagnostics);
  const version = requireString(root, "version", sourcePath, diagnostics);

  if (id === undefined || version === undefined) {
    return { manifest: null, diagnostics };
  }

  const manifest: ProfileManifest = {
    id,
    version,
    description: typeof root.description === "string"
      ? root.description
      : undefined,
    license: typeof root.license === "string" ? root.license : undefined,
    extends: undefined, // parsed in later task
    universalRequired: [],
    universalAttributes: [],
    labels: [],
    identified: { required: [], attributes: [], traceability: new Map() },
    referenced: { required: [], attributes: [] },
    types: new Map(),
    documents: { types: [], frontMatter: [] },
  };

  return { manifest, diagnostics };
}

function requireString(
  root: Record<string, unknown>,
  key: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): string | undefined {
  const v = root[key];
  if (typeof v !== "string" || v.length === 0) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `manifest missing required field '${key}' (string)`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  return v;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/manifest.ts packages/markspec/core/profile/manifest_test.ts
git commit -m "feat(core): manifest parser — minimal happy path"
```

---

### Task 1.3 — Reject non-mapping root and missing required fields

**Files:**

- Modify: `packages/markspec/core/profile/manifest_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/markspec/core/profile/manifest_test.ts`:

```typescript
Deno.test("parseManifest: empty string fails with PROFILE-LOAD-003", () => {
  const result = parseManifest("");
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: scalar root fails with PROFILE-LOAD-003", () => {
  const result = parseManifest(`42`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: missing id and version", () => {
  const result = parseManifest(`description: Nope`);
  assertEquals(result.manifest, null);
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes, ["PROFILE-LOAD-003", "PROFILE-LOAD-003"]);
});

Deno.test("parseManifest: malformed YAML fails with PROFILE-LOAD-002", () => {
  const result = parseManifest(`id: "@acme/x\n  version:`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-002");
});
```

- [ ] **Step 2: Run tests to verify they pass (existing code already handles
      these)**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: all 5
tests PASS — the implementation from Task 1.2 already covers these.

- [ ] **Step 3: Commit**

```bash
git add packages/markspec/core/profile/manifest_test.ts
git commit -m "test(core): manifest parser — root shape + required field errors"
```

---

### Task 1.4 — Reject unknown top-level manifest keys

**Files:**

- Modify: `packages/markspec/core/profile/manifest.ts`
- Modify: `packages/markspec/core/profile/manifest_test.ts`

- [ ] **Step 1: Write failing test**

Append to `manifest_test.ts`:

```typescript
Deno.test("parseManifest: unknown top-level key errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
bogus: whatever
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
  // message mentions the offending key
  const msg = result.diagnostics[0].message;
  if (!msg.includes("bogus")) {
    throw new Error(`expected 'bogus' in message, got: ${msg}`);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
`deno test packages/markspec/core/profile/manifest_test.ts --filter "unknown top-level"`
Expected: FAIL (the manifest is currently returned with `bogus` silently
ignored).

- [ ] **Step 3: Implement the check**

In `manifest.ts`, add near the top of the file:

```typescript
const ALLOWED_ROOT_KEYS = new Set([
  "id",
  "version",
  "description",
  "license",
  "extends",
  "profile",
]);
```

In `parseManifest`, after `const root = parsed as Record<string, unknown>;`:

```typescript
for (const key of Object.keys(root)) {
  if (!ALLOWED_ROOT_KEYS.has(key)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `unknown top-level manifest key '${key}'`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
  }
}
// if any unknown key, bail out now before further parsing
if (diagnostics.length > 0) {
  return { manifest: null, diagnostics };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: all
tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/manifest.ts packages/markspec/core/profile/manifest_test.ts
git commit -m "feat(core): reject unknown top-level manifest keys"
```

---

### Task 1.5 — Parse `profile:` content section keys (stub)

**Files:**

- Modify: `packages/markspec/core/profile/manifest.ts`
- Modify: `packages/markspec/core/profile/manifest_test.ts`

This task validates the shape of the `profile:` sub-map without yet parsing its
contents (types, attributes, etc.). Those come in subsequent tasks.

- [ ] **Step 1: Write failing test**

Append to `manifest_test.ts`:

```typescript
Deno.test("parseManifest: profile section accepts only recognized keys", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  required: []
  nonsense: {}
`);
  assertEquals(result.manifest, null);
  const msg = result.diagnostics[0].message;
  if (!msg.includes("nonsense")) {
    throw new Error(`expected 'nonsense' in message, got: ${msg}`);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
`deno test packages/markspec/core/profile/manifest_test.ts --filter "profile section accepts"`
Expected: FAIL.

- [ ] **Step 3: Implement the check**

In `manifest.ts`, add:

```typescript
const ALLOWED_PROFILE_KEYS = new Set([
  "required",
  "attributes",
  "labels",
  "identified",
  "referenced",
  "types",
  "documents",
]);
```

In `parseManifest`, after the unknown-root-key check and before returning the
manifest:

```typescript
const rawProfile = root.profile;
if (rawProfile !== undefined) {
  if (
    rawProfile == null || typeof rawProfile !== "object" ||
    Array.isArray(rawProfile)
  ) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: "'profile' must be a mapping",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { manifest: null, diagnostics };
  }
  for (const key of Object.keys(rawProfile as Record<string, unknown>)) {
    if (!ALLOWED_PROFILE_KEYS.has(key)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `unknown key under 'profile': '${key}'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    }
  }
  if (diagnostics.length > 0) {
    return { manifest: null, diagnostics };
  }
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: all
tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/manifest.ts packages/markspec/core/profile/manifest_test.ts
git commit -m "feat(core): validate 'profile' section key whitelist"
```

---

### Task 1.6 — Parse `profile.required`, `profile.attributes`, `profile.labels` (universal scope)

**Files:**

- Modify: `packages/markspec/core/profile/manifest.ts`
- Modify: `packages/markspec/core/profile/manifest_test.ts`

This task introduces the attribute-parsing helper used in many subsequent
scopes. The helper lives in `manifest.ts` so it's reused across universal /
shape / type scopes.

- [ ] **Step 1: Write failing test**

Append to `manifest_test.ts`:

```typescript
Deno.test("parseManifest: universal attributes + required + labels", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  required: [Status]
  labels: [DRAFT, INTERNAL]
  attributes:
    - name: Status
      type: enum
      values: [draft, approved, deprecated]
      required: false
`);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.manifest?.universalRequired, ["Status"]);
  assertEquals(result.manifest?.labels, ["DRAFT", "INTERNAL"]);
  assertEquals(result.manifest?.universalAttributes.length, 1);
  const attr = result.manifest?.universalAttributes[0];
  assertEquals(attr?.name, "Status");
  assertEquals(attr?.type, "enum");
  assertEquals(attr?.values, ["draft", "approved", "deprecated"]);
  assertEquals(attr?.required, false);
});

Deno.test("parseManifest: attribute with invalid value type errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  attributes:
    - name: Weird
      type: bogus
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: enum attribute without values errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  attributes:
    - name: Mode
      type: enum
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: the
three new tests FAIL.

- [ ] **Step 3: Implement attribute parsing + universal scope**

Add to `manifest.ts` (before `parseManifest`):

```typescript
import {
  type AttrDecl,
  type Cardinality,
  LIST_VALUE_TYPES,
  VALUE_TYPES,
  type ValueType,
} from "../model/mod.ts";

const VALUE_TYPE_SET: ReadonlySet<string> = new Set(VALUE_TYPES);

function parseStringList(
  raw: unknown,
  key: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string")) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `'${key}' must be a list of strings`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return [];
  }
  return raw as string[];
}

function defaultCardinality(type: ValueType): Cardinality {
  return LIST_VALUE_TYPES.has(type)
    ? { lower: 0, upper: Infinity }
    : { lower: 0, upper: 1 };
}

function parseCardinality(
  raw: unknown,
  fallback: Cardinality,
  context: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): Cardinality {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string") {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: cardinality must be a string like '1..N'`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return fallback;
  }
  const m = /^(\d+)\.\.(\d+|N)$/.exec(raw);
  if (!m) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: invalid cardinality '${raw}'`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return fallback;
  }
  const lower = Number(m[1]);
  const upper = m[2] === "N" ? Infinity : Number(m[2]);
  if (upper < lower) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: cardinality upper (${
        m[2]
      }) less than lower (${lower})`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return fallback;
  }
  return { lower, upper };
}

function parseAttrDecl(
  raw: unknown,
  context: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): AttrDecl | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: attribute entry must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  const name = r.name;
  const type = r.type;
  if (typeof name !== "string" || name.length === 0) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: attribute missing 'name'`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  if (typeof type !== "string" || !VALUE_TYPE_SET.has(type)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: attribute '${name}' has invalid type '${type}'`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const vtype = type as ValueType;
  const required = r.required === true;
  const cardinality = parseCardinality(
    r.cardinality,
    defaultCardinality(vtype),
    `${context}/${name}`,
    sourcePath,
    diagnostics,
  );
  let values: readonly string[] | undefined;
  if (vtype === "enum") {
    const rawValues = r.values;
    if (
      !Array.isArray(rawValues) || rawValues.some((v) => typeof v !== "string")
    ) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message:
          `${context}: enum attribute '${name}' requires a 'values' list of strings`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    values = rawValues as string[];
  }
  // inverse: parsed in a later task (Phase 1 can leave this undefined)
  return { name, type: vtype, required, cardinality, values };
}

function parseAttrList(
  raw: unknown,
  context: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): AttrDecl[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: 'attributes' must be a list`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return [];
  }
  const out: AttrDecl[] = [];
  for (const item of raw) {
    const attr = parseAttrDecl(item, context, sourcePath, diagnostics);
    if (attr) out.push(attr);
  }
  return out;
}
```

Now update `parseManifest` to parse the universal scope. Replace the
manifest-construction block with:

```typescript
const profileSection = (rawProfile ?? {}) as Record<string, unknown>;

const universalRequired = parseStringList(
  profileSection.required,
  "profile.required",
  sourcePath,
  diagnostics,
);
const universalAttributes = parseAttrList(
  profileSection.attributes,
  "profile.attributes",
  sourcePath,
  diagnostics,
);
const labels = parseStringList(
  profileSection.labels,
  "profile.labels",
  sourcePath,
  diagnostics,
);

if (diagnostics.length > 0) {
  return { manifest: null, diagnostics };
}

const manifest: ProfileManifest = {
  id,
  version,
  description: typeof root.description === "string"
    ? root.description
    : undefined,
  license: typeof root.license === "string" ? root.license : undefined,
  extends: undefined,
  universalRequired,
  universalAttributes,
  labels,
  identified: { required: [], attributes: [], traceability: new Map() },
  referenced: { required: [], attributes: [] },
  types: new Map(),
  documents: { types: [], frontMatter: [] },
};

return { manifest, diagnostics };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: all
tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/manifest.ts packages/markspec/core/profile/manifest_test.ts
git commit -m "feat(core): parse universal scope (required, attributes, labels)"
```

---

### Task 1.7 — Parse shape scopes (`identified`, `referenced`)

**Files:**

- Modify: `packages/markspec/core/profile/manifest.ts`
- Modify: `packages/markspec/core/profile/manifest_test.ts`

- [ ] **Step 1: Write failing test**

Append to `manifest_test.ts`:

```typescript
Deno.test("parseManifest: shape scopes parsed", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  identified:
    required: [Rationale]
    attributes:
      - name: Rationale
        type: text
  referenced:
    attributes:
      - name: Description
        type: text
`);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.manifest?.identified.required, ["Rationale"]);
  assertEquals(result.manifest?.identified.attributes.length, 1);
  assertEquals(result.manifest?.identified.attributes[0].name, "Rationale");
  assertEquals(result.manifest?.referenced.attributes.length, 1);
  assertEquals(result.manifest?.referenced.attributes[0].name, "Description");
});

Deno.test("parseManifest: referenced.traceability is not a recognized key", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  referenced:
    traceability:
      Something: {target: []}
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: the
two new tests FAIL.

- [ ] **Step 3: Implement shape scopes (without traceability yet)**

Traceability parsing is its own task (1.8). For now, parse
`identified.required`, `identified.attributes`, `referenced.required`,
`referenced.attributes`, and enforce that `referenced` doesn't carry
`traceability`.

Add to `manifest.ts`:

```typescript
const ALLOWED_IDENTIFIED_KEYS = new Set([
  "required",
  "attributes",
  "traceability",
]);
const ALLOWED_REFERENCED_KEYS = new Set(["required", "attributes"]);

function parseShapeScope(
  raw: unknown,
  allowedKeys: Set<string>,
  context: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): Record<string, unknown> | undefined {
  if (raw === undefined) return {};
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!allowedKeys.has(key)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `${context}: unknown key '${key}'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    }
  }
  return r;
}
```

In `parseManifest`, replace the hard-coded `identified:`/`referenced:` literals
with parsed scopes:

```typescript
const idRaw = parseShapeScope(
  profileSection.identified,
  ALLOWED_IDENTIFIED_KEYS,
  "profile.identified",
  sourcePath,
  diagnostics,
);
const refRaw = parseShapeScope(
  profileSection.referenced,
  ALLOWED_REFERENCED_KEYS,
  "profile.referenced",
  sourcePath,
  diagnostics,
);

if (idRaw === undefined || refRaw === undefined || diagnostics.length > 0) {
  return { manifest: null, diagnostics };
}

const identifiedRequired = parseStringList(
  idRaw.required,
  "profile.identified.required",
  sourcePath,
  diagnostics,
);
const identifiedAttributes = parseAttrList(
  idRaw.attributes,
  "profile.identified.attributes",
  sourcePath,
  diagnostics,
);
// identifiedTraceability parsed in Task 1.8; empty map for now

const referencedRequired = parseStringList(
  refRaw.required,
  "profile.referenced.required",
  sourcePath,
  diagnostics,
);
const referencedAttributes = parseAttrList(
  refRaw.attributes,
  "profile.referenced.attributes",
  sourcePath,
  diagnostics,
);

if (diagnostics.length > 0) {
  return { manifest: null, diagnostics };
}
```

Update the manifest construction to use these fields:

```typescript
const manifest: ProfileManifest = {
  id,
  version,
  description: typeof root.description === "string"
    ? root.description
    : undefined,
  license: typeof root.license === "string" ? root.license : undefined,
  extends: undefined,
  universalRequired,
  universalAttributes,
  labels,
  identified: {
    required: identifiedRequired,
    attributes: identifiedAttributes,
    traceability: new Map(),
  },
  referenced: {
    required: referencedRequired,
    attributes: referencedAttributes,
  },
  types: new Map(),
  documents: { types: [], frontMatter: [] },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: all
tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/manifest.ts packages/markspec/core/profile/manifest_test.ts
git commit -m "feat(core): parse identified/referenced shape scopes"
```

---

### Task 1.8 — Parse traceability rules (in identified scope)

**Files:**

- Modify: `packages/markspec/core/profile/manifest.ts`
- Modify: `packages/markspec/core/profile/manifest_test.ts`

- [ ] **Step 1: Write failing test**

Append to `manifest_test.ts`:

```typescript
Deno.test("parseManifest: identified.traceability parsed", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  identified:
    traceability:
      Derived-from:
        target: [{shape: identified}]
        cardinality: 0..N
        required: false
`);
  assertEquals(result.diagnostics.length, 0);
  const trace = result.manifest?.identified.traceability;
  assertEquals(trace?.size, 1);
  const rule = trace?.get("Derived-from");
  assertEquals(rule?.target.length, 1);
  assertEquals(rule?.target[0], { shape: "identified" });
  assertEquals(rule?.required, false);
  assertEquals(rule?.cardinality?.lower, 0);
  assertEquals(rule?.cardinality?.upper, Infinity);
});

Deno.test("parseManifest: traceability rejects bad shape matcher", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  identified:
    traceability:
      Bad:
        target: [{shape: nonsense}]
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: traceability target is required", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  identified:
    traceability:
      MissingTarget:
        required: true
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: the
three new tests FAIL.

- [ ] **Step 3: Implement traceability parsing**

Add to `manifest.ts`:

```typescript
import type { TargetMatcher, TraceRule } from "../model/mod.ts";

function parseTargetMatcher(
  raw: unknown,
  context: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): TargetMatcher | undefined {
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    if (
      typeof r.shape === "string" &&
      (r.shape === "identified" || r.shape === "referenced")
    ) {
      return { shape: r.shape };
    }
  }
  diagnostics.push({
    code: "PROFILE-LOAD-003",
    severity: "error",
    message:
      `${context}: target matcher must be a type-name string or {shape: identified|referenced}`,
    location: { file: sourcePath, line: 1, column: 1 },
  });
  return undefined;
}

function parseTraceRule(
  raw: unknown,
  context: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): TraceRule | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: trace rule must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.target) || r.target.length === 0) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: trace rule requires non-empty 'target' list`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const targets: TargetMatcher[] = [];
  for (const item of r.target) {
    const m = parseTargetMatcher(
      item,
      `${context}.target`,
      sourcePath,
      diagnostics,
    );
    if (m !== undefined) targets.push(m);
  }
  if (targets.length === 0) return undefined;
  const cardinality = r.cardinality !== undefined
    ? parseCardinality(
      r.cardinality,
      { lower: 0, upper: Infinity },
      `${context}.cardinality`,
      sourcePath,
      diagnostics,
    )
    : undefined;
  const required = r.required === true;
  return { target: targets, cardinality, required };
}

function parseTraceabilityMap(
  raw: unknown,
  context: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): Map<string, TraceRule> {
  const out = new Map<string, TraceRule>();
  if (raw === undefined) return out;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: 'traceability' must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return out;
  }
  for (
    const [linkName, ruleRaw] of Object.entries(raw as Record<string, unknown>)
  ) {
    const rule = parseTraceRule(
      ruleRaw,
      `${context}.${linkName}`,
      sourcePath,
      diagnostics,
    );
    if (rule) out.set(linkName, rule);
  }
  return out;
}
```

In `parseManifest`, after `identifiedAttributes` is computed, add:

```typescript
const identifiedTraceability = parseTraceabilityMap(
  idRaw.traceability,
  "profile.identified.traceability",
  sourcePath,
  diagnostics,
);

if (diagnostics.length > 0) {
  return { manifest: null, diagnostics };
}
```

And update the manifest construction:
`identified.traceability: identifiedTraceability`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: all
tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/manifest.ts packages/markspec/core/profile/manifest_test.ts
git commit -m "feat(core): parse traceability rules in identified scope"
```

---

### Task 1.9 — Parse `types` keyed map

**Files:**

- Modify: `packages/markspec/core/profile/manifest.ts`
- Modify: `packages/markspec/core/profile/manifest_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `manifest_test.ts`:

```typescript
Deno.test("parseManifest: types map parsed", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: error
      required: [Rationale]
      attributes:
        - name: Rationale
          type: text
      traceability:
        Derived-from:
          target: [stakeholder-requirement]
          cardinality: 1..N
          required: true
    standard:
      shape: referenced
`);
  assertEquals(result.diagnostics.length, 0);
  const types = result.manifest?.types;
  assertEquals(types?.size, 2);
  const req = types?.get("requirement");
  assertEquals(req?.shape, "identified");
  assertEquals(req?.displayIdPattern, "REQ-{n:04d}");
  assertEquals(req?.displayIdPatternEnforcement, "error");
  assertEquals(req?.required, ["Rationale"]);
  assertEquals(req?.attributes[0].name, "Rationale");
  const trace = req?.traceability.get("Derived-from");
  assertEquals(trace?.target, ["stakeholder-requirement"]);
  const std = types?.get("standard");
  assertEquals(std?.shape, "referenced");
  assertEquals(std?.displayIdPatternEnforcement, "off");
});

Deno.test("parseManifest: type must declare shape", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    requirement:
      attributes: []
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: type with bad shape errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    thing:
      shape: sideways
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: referenced type with traceability errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    standard:
      shape: referenced
      traceability:
        Something:
          target: [other]
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: the
four new tests FAIL.

- [ ] **Step 3: Implement type parsing**

Add to `manifest.ts`:

```typescript
import type { EnforcementMode, EntryShape, TypeDef } from "../model/mod.ts";

const ALLOWED_TYPE_KEYS = new Set([
  "shape",
  "display-id-pattern",
  "display-id-pattern-enforcement",
  "required",
  "attributes",
  "traceability",
]);

function parseTypeDef(
  name: string,
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): TypeDef | undefined {
  const ctx = `profile.types.${name}`;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${ctx}: must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!ALLOWED_TYPE_KEYS.has(key)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `${ctx}: unknown key '${key}'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    }
  }

  const shape = r.shape;
  if (shape !== "identified" && shape !== "referenced") {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${ctx}: 'shape' must be 'identified' or 'referenced'`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }

  if (shape === "referenced" && r.traceability !== undefined) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message:
        `${ctx}: referenced types cannot declare traceability (referenced entries don't originate links)`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }

  let displayIdPattern: string | undefined;
  if (r["display-id-pattern"] !== undefined) {
    if (typeof r["display-id-pattern"] !== "string") {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `${ctx}: 'display-id-pattern' must be a string`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    displayIdPattern = r["display-id-pattern"];
  }

  let enforcement: EnforcementMode = "off";
  const rawEnf = r["display-id-pattern-enforcement"];
  if (rawEnf !== undefined) {
    if (rawEnf !== "off" && rawEnf !== "warn" && rawEnf !== "error") {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message:
          `${ctx}: 'display-id-pattern-enforcement' must be off|warn|error`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    enforcement = rawEnf;
  }

  const required = parseStringList(
    r.required,
    `${ctx}.required`,
    sourcePath,
    diagnostics,
  );
  const attributes = parseAttrList(
    r.attributes,
    `${ctx}.attributes`,
    sourcePath,
    diagnostics,
  );
  const traceability = shape === "identified"
    ? parseTraceabilityMap(
      r.traceability,
      `${ctx}.traceability`,
      sourcePath,
      diagnostics,
    )
    : new Map<string, TraceRule>();

  return {
    name,
    shape: shape as EntryShape,
    displayIdPattern,
    displayIdPatternEnforcement: enforcement,
    required,
    attributes,
    traceability,
  };
}

function parseTypesMap(
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): Map<string, TypeDef> {
  const out = new Map<string, TypeDef>();
  if (raw === undefined) return out;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `profile.types: must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return out;
  }
  for (
    const [name, rawType] of Object.entries(raw as Record<string, unknown>)
  ) {
    const td = parseTypeDef(name, rawType, sourcePath, diagnostics);
    if (td) out.set(name, td);
  }
  return out;
}
```

In `parseManifest`, add:

```typescript
const types = parseTypesMap(profileSection.types, sourcePath, diagnostics);
if (diagnostics.length > 0) {
  return { manifest: null, diagnostics };
}
```

And update the manifest construction: `types`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: all
tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/manifest.ts packages/markspec/core/profile/manifest_test.ts
git commit -m "feat(core): parse profile.types map"
```

---

### Task 1.10 — Parse `documents` scope

**Files:**

- Modify: `packages/markspec/core/profile/manifest.ts`
- Modify: `packages/markspec/core/profile/manifest_test.ts`

- [ ] **Step 1: Write failing test**

Append to `manifest_test.ts`:

```typescript
Deno.test("parseManifest: documents section parsed", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  documents:
    types:
      - id: requirements-doc
        contains: [requirement]
        description: Requirements specifications
    frontMatter:
      - name: document-version
        type: text
`);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.manifest?.documents.types.length, 1);
  assertEquals(result.manifest?.documents.types[0].id, "requirements-doc");
  assertEquals(result.manifest?.documents.types[0].contains, ["requirement"]);
  assertEquals(result.manifest?.documents.frontMatter.length, 1);
  assertEquals(
    result.manifest?.documents.frontMatter[0].name,
    "document-version",
  );
});

Deno.test("parseManifest: document type missing id errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  documents:
    types:
      - contains: [requirement]
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: the
two new tests FAIL.

- [ ] **Step 3: Implement document scope parsing**

Add to `manifest.ts`:

```typescript
import type { DocTypeDef } from "../model/mod.ts";

const ALLOWED_DOC_TYPE_KEYS = new Set(["id", "contains", "description"]);
const ALLOWED_DOCUMENTS_KEYS = new Set(["types", "frontMatter"]);

function parseDocTypeDef(
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): DocTypeDef | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `profile.documents.types: each entry must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!ALLOWED_DOC_TYPE_KEYS.has(key)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `profile.documents.types: unknown key '${key}'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    }
  }
  if (typeof r.id !== "string" || r.id.length === 0) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `profile.documents.types: entry missing 'id'`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const contains = parseStringList(
    r.contains,
    `profile.documents.types.${r.id}.contains`,
    sourcePath,
    diagnostics,
  );
  const description = typeof r.description === "string"
    ? r.description
    : undefined;
  return { id: r.id, contains, description };
}

function parseDocumentsSection(
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): { types: DocTypeDef[]; frontMatter: AttrDecl[] } {
  if (raw === undefined) return { types: [], frontMatter: [] };
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `profile.documents: must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { types: [], frontMatter: [] };
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!ALLOWED_DOCUMENTS_KEYS.has(key)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `profile.documents: unknown key '${key}'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    }
  }
  const types: DocTypeDef[] = [];
  if (r.types !== undefined) {
    if (!Array.isArray(r.types)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `profile.documents.types: must be a list`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    } else {
      for (const item of r.types) {
        const dt = parseDocTypeDef(item, sourcePath, diagnostics);
        if (dt) types.push(dt);
      }
    }
  }
  const frontMatter = parseAttrList(
    r.frontMatter,
    "profile.documents.frontMatter",
    sourcePath,
    diagnostics,
  );
  return { types, frontMatter };
}
```

In `parseManifest`, before final manifest construction:

```typescript
const documents = parseDocumentsSection(
  profileSection.documents,
  sourcePath,
  diagnostics,
);
if (diagnostics.length > 0) {
  return { manifest: null, diagnostics };
}
```

Update manifest construction: `documents`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: all
tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/manifest.ts packages/markspec/core/profile/manifest_test.ts
git commit -m "feat(core): parse documents scope"
```

---

### Task 1.11 — Parse `extends:` specifier

**Files:**

- Modify: `packages/markspec/core/profile/manifest.ts`
- Modify: `packages/markspec/core/profile/manifest_test.ts`

This task parses the string into a `ProfileSpecifier`. Resolution (fetching the
referenced profile) comes in Phase 2/4.

- [ ] **Step 1: Write failing tests**

Append to `manifest_test.ts`:

```typescript
Deno.test("parseManifest: extends local path", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
extends: "./base"
`);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.manifest?.extends, { kind: "local", path: "./base" });
});

Deno.test("parseManifest: extends git specifier", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
extends: "git+https://github.com/acme/repo.git/aspice#aspice/v1.0.0"
`);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.manifest?.extends, {
    kind: "git",
    repo: "https://github.com/acme/repo.git",
    subpath: "aspice",
    tag: "aspice/v1.0.0",
  });
});

Deno.test("parseManifest: extends git without tag errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
extends: "git+https://github.com/acme/repo.git"
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: extends unrecognized scheme errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
extends: "npm:@acme/profile@1.0"
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: the
four new tests FAIL.

- [ ] **Step 3: Implement extends parsing**

Add to `manifest.ts`:

```typescript
import type { ProfileSpecifier } from "../model/mod.ts";

function parseSpecifier(
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): ProfileSpecifier | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length === 0) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `'extends' must be a non-empty string specifier`,
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
        code: "PROFILE-LOAD-003",
        severity: "error",
        message:
          `'extends' git specifier malformed; expected git+https://host/.git[/subpath]#<tag>`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    const [, repo, rawSubpath, tag] = m;
    const subpath = rawSubpath ? rawSubpath.slice(1) : undefined;
    return { kind: "git", repo, subpath, tag };
  }
  diagnostics.push({
    code: "PROFILE-LOAD-003",
    severity: "error",
    message:
      `'extends' specifier scheme not supported in v1 (use local './path' or git+https URL with #tag)`,
    location: { file: sourcePath, line: 1, column: 1 },
  });
  return undefined;
}
```

In `parseManifest`, after the `version` check:

```typescript
const extendsSpec = parseSpecifier(root.extends, sourcePath, diagnostics);
if (root.extends !== undefined && extendsSpec === undefined) {
  return { manifest: null, diagnostics };
}
```

Update manifest construction: `extends: extendsSpec`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: all
tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/manifest.ts packages/markspec/core/profile/manifest_test.ts
git commit -m "feat(core): parse extends specifier (local + git)"
```

---

### Task 1.12 — Parse `inverse:` on link attributes

**Files:**

- Modify: `packages/markspec/core/profile/manifest.ts`
- Modify: `packages/markspec/core/profile/manifest_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `manifest_test.ts`:

```typescript
Deno.test("parseManifest: attribute inverse parsed", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    test:
      shape: identified
      attributes:
        - name: Verifies
          type: id-list
          inverse:
            name: Verified-by
            category: requirement
`);
  assertEquals(result.diagnostics.length, 0);
  const attr = result.manifest?.types.get("test")?.attributes[0];
  assertEquals(attr?.inverse?.name, "Verified-by");
  assertEquals(attr?.inverse?.category, "requirement");
});

Deno.test("parseManifest: inverse on non-id attribute errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    x:
      shape: identified
      attributes:
        - name: Foo
          type: text
          inverse:
            name: Foo-back
            category: bar
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: inverse missing fields errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    x:
      shape: identified
      attributes:
        - name: Link
          type: id-list
          inverse:
            name: Back
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: the
three new tests FAIL.

- [ ] **Step 3: Implement inverse parsing**

Update `parseAttrDecl` in `manifest.ts`. Replace the
`return { name, type: vtype, required, cardinality, values };` line with:

```typescript
let inverse: { name: string; category: string } | undefined;
if (r.inverse !== undefined) {
  if (vtype !== "id" && vtype !== "id-list") {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message:
        `${context}/${name}: 'inverse' only valid on id or id-list attributes`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  if (
    r.inverse == null || typeof r.inverse !== "object" ||
    Array.isArray(r.inverse)
  ) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}/${name}: 'inverse' must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const inv = r.inverse as Record<string, unknown>;
  if (typeof inv.name !== "string" || typeof inv.category !== "string") {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message:
        `${context}/${name}: 'inverse' requires string 'name' and 'category'`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  inverse = { name: inv.name, category: inv.category };
}

return { name, type: vtype, required, cardinality, values, inverse };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/profile/manifest_test.ts` Expected: all
tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/manifest.ts packages/markspec/core/profile/manifest_test.ts
git commit -m "feat(core): parse inverse declarations on link attributes"
```

---

### Task 1.13 — Snapshot end-to-end happy path

**Files:**

- Create: `tests/fixtures/profiles/phase1/complete.yaml`
- Modify: `packages/markspec/core/profile/manifest_test.ts`

A single fixture exercising every field parsed in Phase 1, to catch regressions.

- [ ] **Step 1: Create the fixture**

Create `tests/fixtures/profiles/phase1/complete.yaml`:

```yaml
id: "@acme/profile-complete"
version: 1.2.3
description: A complete fixture exercising every Phase 1 parser feature
license: MIT
extends: "./base"
profile:
  required: [Status]
  labels: [DRAFT, INTERNAL]
  attributes:
    - name: Status
      type: enum
      values: [draft, approved, deprecated]
      required: false
  identified:
    required: [Rationale]
    attributes:
      - name: Rationale
        type: text
    traceability:
      Derived-from:
        target: [{ shape: identified }]
        cardinality: 0..N
        required: false
  referenced:
    required: []
    attributes:
      - name: Description
        type: text
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: warn
      required: [Rationale]
      attributes:
        - name: ASIL
          type: enum
          values: [QM, A, B, C, D]
      traceability:
        Derived-from:
          target: [stakeholder-requirement]
          cardinality: 1..N
          required: true
    test:
      shape: identified
      display-id-pattern: "TEST-{n:04d}"
      attributes:
        - name: Verifies
          type: id-list
          inverse:
            name: Verified-by
            category: requirement
    standard:
      shape: referenced
  documents:
    types:
      - id: requirements-doc
        contains: [requirement]
      - id: test-plan
        contains: [test]
    frontMatter:
      - name: document-version
        type: text
```

- [ ] **Step 2: Write the snapshot test**

Append to `manifest_test.ts`:

```typescript
import { fromFileUrl } from "@std/path";

Deno.test("parseManifest: complete fixture parses without diagnostics", async () => {
  const path = fromFileUrl(
    new URL(
      "../../../../tests/fixtures/profiles/phase1/complete.yaml",
      import.meta.url,
    ),
  );
  const yaml = await Deno.readTextFile(path);
  const result = parseManifest(yaml, path);
  assertEquals(result.diagnostics, []);
  const m = result.manifest!;
  assertEquals(m.id, "@acme/profile-complete");
  assertEquals(m.version, "1.2.3");
  assertEquals(m.extends, { kind: "local", path: "./base" });
  assertEquals(m.universalRequired, ["Status"]);
  assertEquals(m.universalAttributes.length, 1);
  assertEquals(m.identified.traceability.get("Derived-from")?.target.length, 1);
  assertEquals(m.referenced.attributes[0].name, "Description");
  assertEquals(m.types.size, 3);
  assertEquals(m.types.get("test")?.attributes[0].inverse?.name, "Verified-by");
  assertEquals(m.documents.types.length, 2);
  assertEquals(m.documents.frontMatter.length, 1);
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `deno test --allow-read packages/markspec/core/profile/manifest_test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/profiles/phase1/complete.yaml packages/markspec/core/profile/manifest_test.ts
git commit -m "test(core): end-to-end fixture for manifest parser"
```

---

### Task 1.14 — Re-export parser from profile barrel

**Files:**

- Create: `packages/markspec/core/profile/mod.ts`

- [ ] **Step 1: Create the barrel**

Create `packages/markspec/core/profile/mod.ts`:

```typescript
/**
 * @module core/profile
 *
 * Public API for the profile system: loading, manifest parsing, chain
 * resolution, and merging. Consumed by the validator pipeline and the CLI.
 */

export { parseManifest } from "./manifest.ts";
export type { ParseManifestResult } from "./manifest.ts";
```

- [ ] **Step 2: Type-check**

Run: `deno check packages/markspec/core/profile/mod.ts` Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `deno test --allow-read` Expected: all tests pass (including the new
`profile/manifest_test.ts`).

- [ ] **Step 4: Run lint + format**

Run: `just fmt && deno lint` Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/profile/mod.ts
git commit -m "feat(core): profile module barrel"
```

---

## Phase 1 acceptance

All steps checked; `deno test` green on all existing + new tests; `deno lint`
and `deno fmt` clean; manifest parser covers:

- Manifest fields: id, version, description, license, extends (local + git).
- `profile:` universal scope: required, attributes (all 14 value types
  parseable), labels.
- Shape scopes: identified (+ traceability), referenced.
- Types map (shape, display-id pattern + enforcement, required, attributes,
  traceability, inverse).
- Documents: types + frontMatter.
- Unknown-key rejection at manifest and `profile:` levels.
- All errors surface as `PROFILE-LOAD-002` (YAML) or `PROFILE-LOAD-003` (schema)
  with a descriptive message.

This PR ships a working parser. Nothing yet uses its output — that's Phase 2.

---

# Phases 2–9 — Outline

Each phase is one PR, expanded to full TDD detail by re-invoking writing-plans
when Phase (N-1) lands. Listed here so reviewers see the trajectory.

## Phase 2 — Single local profile + consumer binding

**Goal:** `.markspec.yaml` loader and single-profile local-path resolution wired
through to the CLI, without yet doing anything with the loaded profile.

**Tasks (outline):**

- Add `core/config/markspec.ts` (`.markspec.yaml` loader: discovery, parse
  `profiles:`).
- Add `core/profile/resolver.ts` with local-path resolution only (reads
  `markspec.yaml` from a directory).
- Add `core/profile/chain.ts` that loads a single profile (no `extends:` walking
  yet — returns one-element chain).
- Wire into `main.ts`: every profile-aware command calls a shared
  `loadProfileForCommand(projectRoot)` that returns `LoadedProfile | null`.
- Emit `PROFILE-LOAD-001` (specifier unresolvable), `PROFILE-LOAD-006` (multiple
  profiles), `MARKSPEC-YAML-001` (unknown `.markspec.yaml` key).
- E2E test: `tests/e2e/profile_loader_test.ts` covering happy-path load + absent
  config + missing profile directory.

## Phase 3 — Extends chain + merge semantics

**Goal:** Walk `extends:` chain with cycle + depth detection, merge tiers into
`EffectiveProfile` with provenance.

**Tasks (outline):**

- Extend `core/profile/chain.ts` to follow local `extends:` pointers (git still
  stubbed).
- Cycle detection (`PROFILE-LOAD-004`) + depth limit 20 (`PROFILE-LOAD-005`).
- Add `core/profile/merge.ts`:
  - Additive merge for lists.
  - Tightening check for cardinality / enum values / required / enforcement.
  - Subset check for traceability targets.
  - Provenance-tracked `EffectiveProfile` output.
- Emit `PROFILE-MERGE-001` (relaxation), `PROFILE-MERGE-002` (target not
  subset).
- Unit tests: each merge family in isolation; integration test with 2-tier
  chain.

## Phase 4 — Git specifier + cache

**Goal:** Resolve `git+https://…#tag` specifiers via shallow+sparse clone, cache
in `.markspec/cache/`.

**Tasks (outline):**

- Add `core/profile/git.ts`:
  - Shallow + sparse clone via `Deno.Command("git", [...])`.
  - Cache path =
    `<project-root>/.markspec/cache/<sha256(specifier)>/<subpath or top>/`.
  - Cache-hit reuse without re-fetching.
- Ensure `.markspec/cache/` is added to `.gitignore` on first use.
- Extend `core/profile/resolver.ts` to delegate to `git.ts` for git specifiers.
- E2E test using a local bare repo fixture (avoid network in tests).
- Error paths: unreachable URL, bad tag, malformed URL.

## Phase 5 — Validator stage 2: Type classification

**Goal:** Classify entries by display-ID pattern + explicit `Type:` trailer;
strict-mode enforcement.

**Tasks (outline):**

- Add `core/validator/pipeline.ts` with the stage runner shape.
- Add `core/validator/types.ts`:
  - Display-ID pattern compiler (template → regex).
  - Matcher that picks 0 / 1 / many types for a display ID.
  - Explicit `Type:` trailer handling.
  - `MSL-T001`–`MSL-T004` diagnostics.
- Add `entry.type` mutation at this stage (document in model/profile.ts).
- Hook pipeline into `main.ts validate` / `main.ts compile`.
- E2E fixtures: prefix-match, no match (strict error), ambiguity, explicit
  override.

## Phase 6 — Validator stage 3: Typed attributes

**Goal:** Validate attribute presence, cardinality, and value types against the
effective profile scope.

**Tasks (outline):**

- Add `core/validator/attributes.ts`:
  - Scope layering (universal ∪ shape ∪ type).
  - Required / cardinality / unknown (`MSL-A001`–`MSL-A005`).
  - Value-type validators for all 14 types.
    - ULID / URI resolution for `id` / `id-list`.
    - URL / URI scheme checks.
    - Path validation (relative, stays in project).
    - Enum membership.
    - Citation multi-line format.
    - ISO 8601 date.
    - Integer / boolean parsing.
- Unit tests per value-type validator.
- E2E fixtures: each diagnostic code triggered.

## Phase 7 — Validator stage 4: Traceability

**Goal:** Enforce per-type traceability rules (target matcher + cardinality +
required).

**Tasks (outline):**

- Add `core/validator/traceability.ts`:
  - Target matcher evaluator (type name, shape, mixed).
  - Cardinality + required checks.
  - `MSL-L001`–`MSL-L004` diagnostics.
- E2E fixtures: each diagnostic code triggered.
- Integration test: ADR-008 §7 ASPICE-style example resolves correctly.

## Phase 8 — Generated inverses

**Goal:** Compile-time pass emits synthetic back-link attributes on target
entries.

**Tasks (outline):**

- Add `origin: 'authored' | 'generated'` to `AttributeValue`; update parser +
  formatter to set `origin: 'authored'` on read.
- Add `core/compiler/inverses.ts`:
  - Walk classified entries, consult profile for `inverse:` declarations.
  - Emit synthetic attributes on targets, aggregated as id-lists.
  - Category-match filter (skip if target.type !== inverse.category).
  - Conflict detection: authored vs generated mismatch → `MSL-L005` warning.
- Ensure `markspec format` never writes `generated` values back to source.
- E2E: compile produces back-links; `context` / `report` observe them.

## Phase 9 — CLI: `profile add` + `doctor`

**Goal:** Ergonomic vendor + diagnostic commands.

**Tasks (outline):**

- Add `markspec profile add <spec>` subcommand:
  - Resolve + validate chain.
  - Copy leaf into `profiles/<manifest.id>/`.
  - Update `.markspec.yaml` to point at vendored path.
  - `--dry-run` flag.
- Add `markspec doctor` subcommand:
  - Print project root, config, active chain (root → leaf) with id, version,
    specifier, resolved location.
  - Merge status + summary counts.
  - Cache state.
  - Exit codes: 0 clean, 1 error, 2 warnings.
- E2E tests for both commands.

---

## Self-review

**Spec coverage of Phase 1 goals:**

- ✅ Profile model types declared (Task 1.1).
- ✅ Manifest YAML parsing with schema validation (Tasks 1.2 – 1.13).
- ✅ All 14 value types accepted by the parser (Task 1.6's VALUE_TYPE_SET +
  fixture in 1.13).
- ✅ `extends:` specifier parsed for both local and git (Task 1.11).
- ✅ Inverse declarations on link attributes (Task 1.12).
- ✅ Types map including display-ID patterns + enforcement + traceability (Task
  1.9).
- ✅ Document scope (Task 1.10).
- ✅ Universal / shape / type scopes (Tasks 1.6, 1.7, 1.8, 1.9).
- ✅ Unknown-key rejection at both manifest and profile levels (Tasks 1.4, 1.5).
- ✅ Error codes `PROFILE-LOAD-002` and `PROFILE-LOAD-003` emitted per spec.

Load/resolution/merge error codes (`PROFILE-LOAD-001`, `-004`, `-005`, `-006`,
`PROFILE-MERGE-*`) are intentionally out of Phase 1 scope — they belong to
Phases 2–3.

**Placeholder scan:** None. Every step has complete code blocks or runnable
commands.

**Type consistency:** Types declared in Task 1.1 (`AttrDecl`, `TypeDef`,
`TraceRule`, `DocTypeDef`, `ProfileManifest`) are referenced by name in Tasks
1.6–1.12 with matching field names.

**Scope check:** Phase 1 is bounded (parser only, no file I/O beyond reading the
fixture in 1.13, no network, no validator changes). Ships a working, testable
unit.

---

## Execution handoff

Plan complete and saved to
`docs/superpowers/plans/2026-04-21-adr-008-profile-system-v1.md`. Two execution
options:

1. **Subagent-Driven (recommended)** — Fresh subagent per task, review between
   tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans,
   batch execution with checkpoints.

Which approach?
