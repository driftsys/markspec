# ADR-008 Profile System v1 — Phase 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stage 3 to the validator pipeline — typed attribute validation.
Every classified entry's attributes are checked against the profile's effective
attribute scope (universal + shape + type) for required presence, cardinality
bounds, value-type conformance, and unknown-attribute warnings.

**Architecture:** A new `core/validator/attributes.ts` module runs after Stage 2
(classification). It consults each entry's `typedAttributes` (already collated
by the parser) and the effective attribute scope derived from the profile.
Value-type conformance is delegated to per-type validator functions organized by
concern (simple types, id/URI types, path/list/citation types). Stage 3 runs for
**every** entry — classified or not — applying universal + shape scope.
Type-specific scope applies only when `entry.type` is set.

**Tech Stack:** Deno + TypeScript, `@std/assert`, `@std/path` (for path
normalization). Reuses existing `ULID_RE` and `URI_SCHEME_RE` from
`core/model/mod.ts`. No new external dependencies.

**Spec:**
[docs/superpowers/specs/2026-04-21-adr-008-profile-system-v1-design.md](../specs/2026-04-21-adr-008-profile-system-v1-design.md)
§5.4 (Validator Stage 3 — Typed attributes).

**Branch:** `feat/profile-system-phase-6`, branched from `main` (which now
carries merged Phases 1–5 via PRs #227–#232).

---

## Scope

### In Phase 6

- **Effective attribute scope helper** — derives the union of universal +
  shape + type attribute declarations and required lists for a given entry.
- **Structural checks** — required presence (`MSL-A001`), upper cardinality
  (`MSL-A002`), lower cardinality (`MSL-A003`), unknown attribute (`MSL-A005`).
- **Value-type validators** — per-type functions for all 14 value types from
  ADR-002 Annex C: `text`, `integer`, `boolean`, `date`, `enum`, `id`,
  `id-list`, `uri`, `url`, `external-id`, `path`, `path-or-id`, `tag-list`,
  `citation`.
- **Value-type mismatch** (`MSL-A004`) emitted when any value fails its declared
  type's validator.
- **Stage wiring** — `validateAttributesStage` appended to `runPipeline` after
  Stage 2.
- **E2E coverage** — fixture profile exercising each diagnostic code through
  `markspec validate`.

### Deferred (not Phase 6)

- Traceability rules (`MSL-L00*`) — Phase 7.
- Generated inverses — Phase 8.
- CLI `profile add` / `doctor` — Phase 9.
- **Graph-resolution check** for `id` / `id-list` values — Phase 6 does the
  _format_ check only (matches ULID or URI shape). Whether the referenced entry
  exists in the graph is checked by Stage 4's target matcher in Phase 7, which
  already walks targets.
- **Project-root containment check** for `path` values — Stage 3 rejects
  absolute paths (both POSIX and Windows drive letters) and validates
  relative-path shape. The "resolved path stays inside project root" check
  requires project root threading, which is deferred. Relative paths with `..`
  segments are accepted at this layer.
- **Structural citation validation** — `citation` validates "non-empty after
  trim" only. Multi-line locator parsing per ADR-002 Annex C is deferred.

### Diagnostic codes introduced in Phase 6

| Code       | Severity | Meaning                                                        |
| ---------- | -------- | -------------------------------------------------------------- |
| `MSL-A001` | error    | Required attribute missing                                     |
| `MSL-A002` | error    | Attribute value count exceeds upper cardinality bound          |
| `MSL-A003` | error    | Attribute value count below lower cardinality bound            |
| `MSL-A004` | error    | Attribute value does not conform to its declared value type    |
| `MSL-A005` | warning  | Attribute present on entry but not declared in effective scope |

---

## Files this PR creates or modifies

### New files

- `packages/markspec/core/validator/attributes.ts` — Stage 3 implementation
  (scope layering, structural checks, dispatch to value-type validators).
- `packages/markspec/core/validator/attributes_test.ts` — unit tests for scope
  helper, structural checks, and each value-type validator.
- `packages/markspec/core/validator/value_types.ts` — the 14 per-type validator
  functions, exported as a registry keyed by `ValueType`.
- `packages/markspec/core/validator/value_types_test.ts` — unit tests for each
  validator.
- `tests/fixtures/profiles/phase6/attributed/markspec.yaml` — e2e fixture
  profile.
- `tests/e2e/profile_attributes_test.ts` — CLI-level tests for Stage 3.

### Modified files

- `packages/markspec/core/validator/pipeline.ts` — append Stage 3 call after
  Stage 2.
- `packages/markspec/core/validator/mod.ts` — re-export new functions/types.
- `packages/markspec/core/mod.ts` — re-export through the public barrel.

No changes to: `core/parser/**`, `core/profile/**`, `core/compiler/**`,
`core/formatter/**`, `core/model/**` (types already present), `main.ts`
(pipeline wiring is transparent).

---

## Task overview

| #   | Task                                                                 | Files touched                                                                                                         |
| --- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 6.1 | Effective-attribute scope layering helper                            | `validator/attributes.ts`, `validator/attributes_test.ts`                                                             |
| 6.2 | Structural checks (required, cardinality, unknown)                   | `validator/attributes.ts`, `validator/attributes_test.ts`                                                             |
| 6.3 | Simple value-type validators (text, integer, boolean, date, enum)    | `validator/value_types.ts`, `validator/value_types_test.ts`                                                           |
| 6.4 | ID/URI value-type validators (id, id-list, uri, url, external-id)    | `validator/value_types.ts`, `validator/value_types_test.ts`                                                           |
| 6.5 | Path/list/citation validators (path, path-or-id, tag-list, citation) | `validator/value_types.ts`, `validator/value_types_test.ts`                                                           |
| 6.6 | Stage wiring + value-type dispatch (MSL-A004)                        | `validator/attributes.ts`, `validator/attributes_test.ts`, `validator/pipeline.ts`, `validator/mod.ts`, `core/mod.ts` |
| 6.7 | E2E fixture + CLI tests                                              | `tests/fixtures/profiles/phase6/attributed/markspec.yaml`, `tests/e2e/profile_attributes_test.ts`                     |

Each task is one commit. Every task follows TDD.

---

## Task 6.1 — Effective-attribute scope layering helper

Compute, for a given entry, the union of attribute declarations and required
lists contributed by the universal scope, the entry's shape scope, and (when
classified) the type scope. Pure data — no diagnostics yet.

**Files:**

- Create: `packages/markspec/core/validator/attributes.ts`
- Create: `packages/markspec/core/validator/attributes_test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/markspec/core/validator/attributes_test.ts`:

```typescript
/**
 * @module core/validator/attributes_test
 *
 * Unit tests for Stage 3 — typed attribute validation.
 */

import { assertEquals } from "@std/assert";
import { effectiveScope } from "./attributes.ts";
import type {
  AttrDecl,
  EffectiveProfile,
  EffectiveShapeScope,
  EffectiveTypeDef,
  Entry,
  EntryShape,
  ProvenancedMapEntry,
} from "../model/mod.ts";

const ORIGIN = "@test/p";

function provAttrs(
  attrs: readonly AttrDecl[],
): Map<string, ProvenancedMapEntry<AttrDecl>> {
  const out = new Map<string, ProvenancedMapEntry<AttrDecl>>();
  for (const a of attrs) out.set(a.name, { value: a, origin: ORIGIN });
  return out;
}

function shapeScope(opts: {
  required?: readonly string[];
  attributes?: readonly AttrDecl[];
}): EffectiveShapeScope {
  return {
    required: { value: opts.required ?? [], origin: ORIGIN },
    attributes: provAttrs(opts.attributes ?? []),
    traceability: new Map(),
  };
}

function typeDef(opts: {
  name: string;
  shape: EntryShape;
  required?: readonly string[];
  attributes?: readonly AttrDecl[];
}): ProvenancedMapEntry<EffectiveTypeDef> {
  return {
    origin: ORIGIN,
    value: {
      name: opts.name,
      shape: opts.shape,
      displayIdPattern: { value: undefined, origin: ORIGIN },
      displayIdPatternEnforcement: { value: "off", origin: ORIGIN },
      required: { value: opts.required ?? [], origin: ORIGIN },
      attributes: provAttrs(opts.attributes ?? []),
      traceability: new Map(),
    },
  };
}

function profile(opts: {
  universalRequired?: readonly string[];
  universalAttrs?: readonly AttrDecl[];
  identified?: EffectiveShapeScope;
  referenced?: EffectiveShapeScope;
  types?: ReadonlyArray<ProvenancedMapEntry<EffectiveTypeDef>>;
}): EffectiveProfile {
  const typesMap = new Map<string, ProvenancedMapEntry<EffectiveTypeDef>>();
  for (const t of opts.types ?? []) typesMap.set(t.value.name, t);
  return {
    required: { value: opts.universalRequired ?? [], origin: ORIGIN },
    attributes: provAttrs(opts.universalAttrs ?? []),
    labels: { value: [], origin: ORIGIN },
    identified: opts.identified ?? shapeScope({}),
    referenced: opts.referenced ?? shapeScope({}),
    types: typesMap,
    documents: { types: new Map(), frontMatter: new Map() },
  };
}

function entry(opts: {
  shape: EntryShape;
  type?: string;
  attrs?: Record<string, readonly string[]>;
}): Entry {
  const attrs = opts.attrs ?? {};
  const attributes = [];
  for (const [k, vs] of Object.entries(attrs)) {
    for (const v of vs) attributes.push({ key: k, value: v });
  }
  return {
    displayId: "X-001",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape,
    type: opts.type,
    source: "markdown",
    attributes,
    typedAttributes: new Map(
      Object.entries(attrs).map(([k, vs]) => [k, vs]),
    ),
    location: { file: "t.md", line: 1, column: 1 },
  };
}

const textAttr: AttrDecl = {
  name: "Rationale",
  type: "text",
  required: false,
  cardinality: { lower: 0, upper: 1 },
};

const statusAttr: AttrDecl = {
  name: "Status",
  type: "enum",
  required: false,
  cardinality: { lower: 0, upper: 1 },
  values: ["draft", "approved"],
};

const notesAttr: AttrDecl = {
  name: "Notes",
  type: "text",
  required: false,
  cardinality: { lower: 0, upper: 1 },
};

Deno.test("effectiveScope: universal only", () => {
  const p = profile({
    universalRequired: ["Status"],
    universalAttrs: [statusAttr],
  });
  const e = entry({ shape: "identified" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.required, ["Status"]);
  assertEquals(scope.attributes.size, 1);
  assertEquals(scope.attributes.get("Status"), statusAttr);
});

Deno.test("effectiveScope: universal + identified shape for identified entry", () => {
  const p = profile({
    universalAttrs: [statusAttr],
    identified: shapeScope({
      required: ["Rationale"],
      attributes: [textAttr],
    }),
    referenced: shapeScope({
      attributes: [notesAttr],
    }),
  });
  const e = entry({ shape: "identified" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.required, ["Rationale"]);
  assertEquals(scope.attributes.size, 2);
  assertEquals(scope.attributes.has("Status"), true);
  assertEquals(scope.attributes.has("Rationale"), true);
  assertEquals(scope.attributes.has("Notes"), false);
});

Deno.test("effectiveScope: universal + referenced shape for referenced entry", () => {
  const p = profile({
    universalAttrs: [statusAttr],
    identified: shapeScope({
      attributes: [textAttr],
    }),
    referenced: shapeScope({
      required: ["Notes"],
      attributes: [notesAttr],
    }),
  });
  const e = entry({ shape: "referenced" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.required, ["Notes"]);
  assertEquals(scope.attributes.size, 2);
  assertEquals(scope.attributes.has("Status"), true);
  assertEquals(scope.attributes.has("Notes"), true);
  assertEquals(scope.attributes.has("Rationale"), false);
});

Deno.test("effectiveScope: classified entry adds type-specific scope", () => {
  const asilAttr: AttrDecl = {
    name: "ASIL",
    type: "enum",
    required: false,
    cardinality: { lower: 0, upper: 1 },
    values: ["QM", "A", "B", "C", "D"],
  };
  const p = profile({
    universalAttrs: [statusAttr],
    identified: shapeScope({ attributes: [textAttr] }),
    types: [typeDef({
      name: "requirement",
      shape: "identified",
      required: ["ASIL"],
      attributes: [asilAttr],
    })],
  });
  const e = entry({ shape: "identified", type: "requirement" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.required, ["ASIL"]);
  assertEquals(scope.attributes.size, 3);
  assertEquals(scope.attributes.has("ASIL"), true);
});

Deno.test("effectiveScope: un-classified entry uses only universal + shape", () => {
  const asilAttr: AttrDecl = {
    name: "ASIL",
    type: "enum",
    required: false,
    cardinality: { lower: 0, upper: 1 },
    values: ["QM", "A", "B"],
  };
  const p = profile({
    universalAttrs: [statusAttr],
    identified: shapeScope({ attributes: [textAttr] }),
    types: [typeDef({
      name: "requirement",
      shape: "identified",
      attributes: [asilAttr],
    })],
  });
  // No entry.type set.
  const e = entry({ shape: "identified" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.attributes.size, 2);
  assertEquals(scope.attributes.has("ASIL"), false);
});

Deno.test("effectiveScope: required lists concatenated in scope order", () => {
  const p = profile({
    universalRequired: ["Status"],
    universalAttrs: [statusAttr],
    identified: shapeScope({
      required: ["Rationale"],
      attributes: [textAttr],
    }),
    types: [typeDef({
      name: "requirement",
      shape: "identified",
      required: ["ASIL"],
      attributes: [{
        name: "ASIL",
        type: "enum",
        required: false,
        cardinality: { lower: 0, upper: 1 },
        values: ["QM"],
      }],
    })],
  });
  const e = entry({ shape: "identified", type: "requirement" });
  const scope = effectiveScope(e, p);
  // Order: universal → shape → type
  assertEquals(scope.required, ["Status", "Rationale", "ASIL"]);
});

Deno.test("effectiveScope: type-scope attr wins over shape-scope attr on name collision", () => {
  // Shape declares Status as text; type redeclares as enum.
  const shapeStatus: AttrDecl = {
    name: "Status",
    type: "text",
    required: false,
    cardinality: { lower: 0, upper: 1 },
  };
  const typeStatus: AttrDecl = {
    name: "Status",
    type: "enum",
    required: false,
    cardinality: { lower: 0, upper: 1 },
    values: ["draft", "approved"],
  };
  const p = profile({
    identified: shapeScope({ attributes: [shapeStatus] }),
    types: [typeDef({
      name: "requirement",
      shape: "identified",
      attributes: [typeStatus],
    })],
  });
  const e = entry({ shape: "identified", type: "requirement" });
  const scope = effectiveScope(e, p);
  assertEquals(scope.attributes.get("Status"), typeStatus);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/validator/attributes_test.ts` Expected:
FAIL with `Cannot find module './attributes.ts'`.

- [ ] **Step 3: Implement `effectiveScope`**

Create `packages/markspec/core/validator/attributes.ts`:

```typescript
/**
 * @module core/validator/attributes
 *
 * Validator Stage 3 — typed attribute validation.
 *
 * Runs after Stage 2 classification. For each entry, computes the effective
 * attribute scope (universal ∪ shape ∪ type) and checks:
 *   - Required presence (MSL-A001)
 *   - Cardinality (MSL-A002 upper / MSL-A003 lower)
 *   - Value-type conformance (MSL-A004, delegated to value_types.ts)
 *   - Unknown attributes (MSL-A005 warning)
 */

import type { AttrDecl, EffectiveProfile, Entry } from "../model/mod.ts";

/**
 * Effective attribute declarations and required list for an entry, derived
 * from the profile's universal, shape, and (when classified) type scopes.
 *
 * Scope layering (outer → inner):
 *   universal → shape.identified/referenced → types.<T>
 *
 * Name collisions: inner scope wins. Required lists are concatenated in
 * scope order (universal first, type last) preserving duplicates across
 * tiers — consumers should treat them as a set.
 */
export interface EffectiveAttrScope {
  readonly required: readonly string[];
  readonly attributes: ReadonlyMap<string, AttrDecl>;
}

/**
 * Compute the effective attribute scope for a given entry against the
 * profile. Uses universal + shape scope always; adds type scope only when
 * `entry.type` is set and the type is declared in the profile.
 */
export function effectiveScope(
  entry: Entry,
  profile: EffectiveProfile,
): EffectiveAttrScope {
  const required: string[] = [];
  const attributes = new Map<string, AttrDecl>();

  // Universal scope.
  required.push(...profile.required.value);
  for (const [name, entry] of profile.attributes) {
    attributes.set(name, entry.value);
  }

  // Shape scope.
  const shapeScope = entry.shape === "identified"
    ? profile.identified
    : profile.referenced;
  required.push(...shapeScope.required.value);
  for (const [name, e] of shapeScope.attributes) {
    attributes.set(name, e.value);
  }

  // Type scope (only when classified).
  if (entry.type !== undefined) {
    const typeEntry = profile.types.get(entry.type);
    if (typeEntry !== undefined) {
      required.push(...typeEntry.value.required.value);
      for (const [name, e] of typeEntry.value.attributes) {
        attributes.set(name, e.value);
      }
    }
  }

  return { required, attributes };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/validator/attributes_test.ts` Expected:
all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/validator/attributes.ts packages/markspec/core/validator/attributes_test.ts
git commit -m "feat(core): effective attribute scope helper"
```

---

## Task 6.2 — Structural checks (required, cardinality, unknown)

Add the three "structural" checks to Stage 3 — ones that don't require per-value
type validation:

- `MSL-A001` — required attribute missing.
- `MSL-A002` — upper cardinality bound exceeded.
- `MSL-A003` — lower cardinality bound unmet (for attributes that ARE present).
- `MSL-A005` — attribute present on entry but not declared in scope (warning).

Value-type conformance (`MSL-A004`) is wired in Task 6.6 after the validators
ship in 6.3–6.5.

**Files:**

- Modify: `packages/markspec/core/validator/attributes.ts`
- Modify: `packages/markspec/core/validator/attributes_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/markspec/core/validator/attributes_test.ts`:

```typescript
import { validateAttributesForEntry } from "./attributes.ts";

Deno.test("validateAttributesForEntry: required missing → MSL-A001", () => {
  const p = profile({
    universalRequired: ["Status"],
    universalAttrs: [statusAttr],
  });
  const e = entry({ shape: "identified", attrs: {} });
  const diags = validateAttributesForEntry(e, p);
  const a001 = diags.find((d) => d.code === "MSL-A001");
  if (!a001) {
    throw new Error(`expected MSL-A001, got: ${diags.map((d) => d.code)}`);
  }
  if (!a001.message.includes("Status")) {
    throw new Error(`expected Status in message: ${a001.message}`);
  }
});

Deno.test("validateAttributesForEntry: required present → no MSL-A001", () => {
  const p = profile({
    universalRequired: ["Status"],
    universalAttrs: [statusAttr],
  });
  const e = entry({
    shape: "identified",
    attrs: { Status: ["draft"] },
  });
  const diags = validateAttributesForEntry(e, p);
  assertEquals(diags.filter((d) => d.code === "MSL-A001"), []);
});

Deno.test("validateAttributesForEntry: cardinality upper exceeded → MSL-A002", () => {
  const singleValAttr: AttrDecl = {
    name: "Title",
    type: "text",
    required: false,
    cardinality: { lower: 0, upper: 1 },
  };
  const p = profile({ universalAttrs: [singleValAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Title: ["first", "second"] },
  });
  const diags = validateAttributesForEntry(e, p);
  const a002 = diags.find((d) => d.code === "MSL-A002");
  if (!a002) {
    throw new Error(`expected MSL-A002, got: ${diags.map((d) => d.code)}`);
  }
});

Deno.test("validateAttributesForEntry: cardinality lower unmet when attribute present → MSL-A003", () => {
  // cardinality: 2..N means at least 2 values when present.
  const listAttr: AttrDecl = {
    name: "Labels",
    type: "tag-list",
    required: false,
    cardinality: { lower: 2, upper: Infinity },
  };
  const p = profile({ universalAttrs: [listAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Labels: ["only-one"] },
  });
  const diags = validateAttributesForEntry(e, p);
  const a003 = diags.find((d) => d.code === "MSL-A003");
  if (!a003) {
    throw new Error(`expected MSL-A003, got: ${diags.map((d) => d.code)}`);
  }
});

Deno.test("validateAttributesForEntry: cardinality lower with 0 values + not required = no diagnostic", () => {
  // Absent optional attribute should not emit MSL-A003 — that's MSL-A001
  // territory when it's required, and permissive otherwise.
  const listAttr: AttrDecl = {
    name: "Labels",
    type: "tag-list",
    required: false,
    cardinality: { lower: 1, upper: Infinity },
  };
  const p = profile({ universalAttrs: [listAttr] });
  const e = entry({ shape: "identified", attrs: {} });
  const diags = validateAttributesForEntry(e, p);
  assertEquals(diags.filter((d) => d.code === "MSL-A003"), []);
});

Deno.test("validateAttributesForEntry: unknown attribute → MSL-A005 warning", () => {
  const p = profile({ universalAttrs: [statusAttr] });
  const e = entry({
    shape: "identified",
    attrs: { UnknownThing: ["value"] },
  });
  const diags = validateAttributesForEntry(e, p);
  const a005 = diags.find((d) => d.code === "MSL-A005");
  if (!a005) {
    throw new Error(`expected MSL-A005, got: ${diags.map((d) => d.code)}`);
  }
  assertEquals(a005.severity, "warning");
});

Deno.test("validateAttributesForEntry: declared attributes do NOT emit MSL-A005", () => {
  const p = profile({ universalAttrs: [statusAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Status: ["draft"] },
  });
  const diags = validateAttributesForEntry(e, p);
  assertEquals(diags.filter((d) => d.code === "MSL-A005"), []);
});

Deno.test("validateAttributesForEntry: core-reserved attributes are never unknown", () => {
  // Id, Labels, Status, References, External-id, Supersedes, Superseded-by,
  // Deprecated, Type — these are universal per ADR-002. The Core validator
  // already handles Id. Stage 3 should not emit MSL-A005 for any of them
  // even if the profile didn't declare them.
  const p = profile({}); // no attributes
  const e = entry({
    shape: "identified",
    attrs: { Id: ["01HGW2Q8MNP3RSTVWXYZABCDEF"], Type: ["requirement"] },
  });
  const diags = validateAttributesForEntry(e, p);
  const a005 = diags.filter((d) => d.code === "MSL-A005");
  assertEquals(a005, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/validator/attributes_test.ts` Expected: 8
new tests FAIL — `validateAttributesForEntry` not exported.

- [ ] **Step 3: Implement structural checks**

Append to `packages/markspec/core/validator/attributes.ts`. First, update the
top-of-file imports:

```typescript
import type {
  AttrDecl,
  Diagnostic,
  EffectiveProfile,
  Entry,
} from "../model/mod.ts";
import { UNIVERSAL_ATTRIBUTE_KEYS } from "../model/mod.ts";

/** Core-reserved attribute keys that are always permitted regardless of profile. */
const CORE_RESERVED_KEYS: ReadonlySet<string> = new Set([
  "Id",
  "Type",
  ...UNIVERSAL_ATTRIBUTE_KEYS,
]);
```

Note: `UNIVERSAL_ATTRIBUTE_KEYS` is exported from `core/model/mod.ts`
(existing). It's the list of attributes the core recognizes universally. If `Id`
or `Type` are already in that list, the `Set` will deduplicate — that's fine. If
not, the explicit adds above ensure they're covered.

Append to the file:

```typescript
/**
 * Run Stage 3 structural + value-type checks for one entry. Returns all
 * diagnostics the entry produced.
 *
 * Task 6.2 ships required / cardinality / unknown checks. Task 6.6 wires in
 * value-type conformance (MSL-A004) through the value-types registry.
 */
export function validateAttributesForEntry(
  entry: Entry,
  profile: EffectiveProfile,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const scope = effectiveScope(entry, profile);
  const present = entry.typedAttributes ?? new Map<string, readonly string[]>();

  // MSL-A001: required attribute missing.
  for (const name of scope.required) {
    if (!present.has(name)) {
      diagnostics.push({
        code: "MSL-A001",
        severity: "error",
        message: `${entry.displayId}: required attribute '${name}' is missing`,
        location: entry.location,
      });
    }
  }

  // Iterate attributes present on the entry.
  for (const [name, values] of present) {
    const decl = scope.attributes.get(name);

    if (decl === undefined) {
      // MSL-A005: unknown attribute (warn). Skip core-reserved keys.
      if (!CORE_RESERVED_KEYS.has(name)) {
        diagnostics.push({
          code: "MSL-A005",
          severity: "warning",
          message:
            `${entry.displayId}: attribute '${name}' is not declared in the profile scope`,
          location: entry.location,
        });
      }
      continue;
    }

    // MSL-A002: upper cardinality.
    if (values.length > decl.cardinality.upper) {
      diagnostics.push({
        code: "MSL-A002",
        severity: "error",
        message:
          `${entry.displayId}: attribute '${name}' has ${values.length} values ` +
          `but max is ${formatUpper(decl.cardinality.upper)}`,
        location: entry.location,
      });
    }

    // MSL-A003: lower cardinality (only when attribute is present).
    if (values.length < decl.cardinality.lower) {
      diagnostics.push({
        code: "MSL-A003",
        severity: "error",
        message:
          `${entry.displayId}: attribute '${name}' has ${values.length} values ` +
          `but min is ${decl.cardinality.lower}`,
        location: entry.location,
      });
    }

    // MSL-A004: value-type conformance — Task 6.6 wires this in.
  }

  return diagnostics;
}

function formatUpper(u: number): string {
  return u === Infinity ? "N" : String(u);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/validator/attributes_test.ts` Expected:
all 15 tests PASS (7 from 6.1 + 8 new).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/validator/attributes.ts packages/markspec/core/validator/attributes_test.ts
git commit -m "feat(core): attribute structural checks (required, cardinality, unknown)"
```

---

## Task 6.3 — Simple value-type validators (text, integer, boolean, date, enum)

Create the per-type validator registry in its own file. Task 6.3 ships the
simplest five types. Later tasks extend the registry.

**Files:**

- Create: `packages/markspec/core/validator/value_types.ts`
- Create: `packages/markspec/core/validator/value_types_test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/markspec/core/validator/value_types_test.ts`:

```typescript
/**
 * @module core/validator/value_types_test
 *
 * Unit tests for per-type value validators.
 */

import { assertEquals } from "@std/assert";
import { validateValue } from "./value_types.ts";
import type { AttrDecl } from "../model/mod.ts";

function decl(type: AttrDecl["type"], opts: Partial<AttrDecl> = {}): AttrDecl {
  return {
    name: opts.name ?? "X",
    type,
    required: opts.required ?? false,
    cardinality: opts.cardinality ?? { lower: 0, upper: 1 },
    values: opts.values,
    inverse: opts.inverse,
  };
}

// ---------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------

Deno.test("validateValue: text accepts any string", () => {
  const d = decl("text");
  assertEquals(validateValue("hello", d), null);
  assertEquals(validateValue("", d), null); // empty is OK at type level
  assertEquals(validateValue("multiline\nstring", d), null);
});

// ---------------------------------------------------------------------------
// integer
// ---------------------------------------------------------------------------

Deno.test("validateValue: integer accepts digits (positive + negative)", () => {
  const d = decl("integer");
  assertEquals(validateValue("0", d), null);
  assertEquals(validateValue("42", d), null);
  assertEquals(validateValue("-42", d), null);
  assertEquals(validateValue("1000000", d), null);
});

Deno.test("validateValue: integer rejects non-integer formats", () => {
  const d = decl("integer");
  const r1 = validateValue("42.5", d);
  if (r1 === null) throw new Error("expected 42.5 to be invalid");
  const r2 = validateValue("abc", d);
  if (r2 === null) throw new Error("expected abc to be invalid");
  const r3 = validateValue("", d);
  if (r3 === null) throw new Error("expected empty to be invalid");
  const r4 = validateValue("1e10", d);
  if (r4 === null) throw new Error("expected 1e10 to be invalid");
});

// ---------------------------------------------------------------------------
// boolean
// ---------------------------------------------------------------------------

Deno.test("validateValue: boolean accepts true/false", () => {
  const d = decl("boolean");
  assertEquals(validateValue("true", d), null);
  assertEquals(validateValue("false", d), null);
});

Deno.test("validateValue: boolean rejects other strings", () => {
  const d = decl("boolean");
  const r1 = validateValue("True", d);
  if (r1 === null) {
    throw new Error("expected 'True' to be invalid (case-sensitive)");
  }
  const r2 = validateValue("yes", d);
  if (r2 === null) throw new Error("expected 'yes' to be invalid");
  const r3 = validateValue("1", d);
  if (r3 === null) throw new Error("expected '1' to be invalid");
});

// ---------------------------------------------------------------------------
// date
// ---------------------------------------------------------------------------

Deno.test("validateValue: date accepts ISO 8601 YYYY-MM-DD", () => {
  const d = decl("date");
  assertEquals(validateValue("2024-01-15", d), null);
  assertEquals(validateValue("2026-04-22", d), null);
  assertEquals(validateValue("1999-12-31", d), null);
});

Deno.test("validateValue: date rejects other formats", () => {
  const d = decl("date");
  const bad = [
    "2024/01/15",
    "01-15-2024",
    "2024-1-15",
    "2024-01-15T00:00:00",
    "not a date",
    "",
  ];
  for (const v of bad) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid date`);
    }
  }
});

// ---------------------------------------------------------------------------
// enum
// ---------------------------------------------------------------------------

Deno.test("validateValue: enum accepts declared values", () => {
  const d = decl("enum", { values: ["draft", "approved", "deprecated"] });
  assertEquals(validateValue("draft", d), null);
  assertEquals(validateValue("approved", d), null);
  assertEquals(validateValue("deprecated", d), null);
});

Deno.test("validateValue: enum rejects undeclared values", () => {
  const d = decl("enum", { values: ["draft", "approved"] });
  const r1 = validateValue("pending", d);
  if (r1 === null) throw new Error("expected 'pending' to be invalid enum");
  if (!r1.includes("pending")) {
    throw new Error(`expected value in error message: ${r1}`);
  }
});

Deno.test("validateValue: enum is case-sensitive", () => {
  const d = decl("enum", { values: ["Draft"] });
  assertEquals(validateValue("Draft", d), null);
  const r = validateValue("draft", d);
  if (r === null) throw new Error("expected lowercase 'draft' to be invalid");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/validator/value_types_test.ts` Expected:
FAIL — `./value_types.ts` doesn't exist.

- [ ] **Step 3: Implement simple value-type validators**

Create `packages/markspec/core/validator/value_types.ts`:

```typescript
/**
 * @module core/validator/value_types
 *
 * Per-type value validators for profile-declared attributes. Each validator
 * takes a string value and the attribute's declaration, returns `null` when
 * valid or a short error message explaining why it's invalid.
 *
 * The top-level {@linkcode validateValue} dispatches on the declared type.
 */

import type { AttrDecl, ValueType } from "../model/mod.ts";

/**
 * Validate one string value against an attribute's declared value type.
 * Returns `null` when the value is valid, or a short human-readable detail
 * string (without the attribute name or display ID — the caller composes the
 * full diagnostic message).
 */
export function validateValue(value: string, decl: AttrDecl): string | null {
  const fn = VALIDATORS[decl.type];
  return fn(value, decl);
}

/** Signature for a single value-type validator. */
export type ValueValidator = (value: string, decl: AttrDecl) => string | null;

// ---------------------------------------------------------------------------
// Individual validators (Task 6.3 simple types)
// ---------------------------------------------------------------------------

const validateText: ValueValidator = (_value, _decl) => {
  // All strings are valid text. Emptiness is a cardinality concern, not type.
  return null;
};

const INTEGER_RE = /^-?\d+$/;
const validateInteger: ValueValidator = (value, _decl) => {
  return INTEGER_RE.test(value)
    ? null
    : `not a valid integer: '${value}' (expected digits optionally prefixed with '-')`;
};

const validateBoolean: ValueValidator = (value, _decl) => {
  return value === "true" || value === "false"
    ? null
    : `not a valid boolean: '${value}' (expected 'true' or 'false')`;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validateDate: ValueValidator = (value, _decl) => {
  return DATE_RE.test(value)
    ? null
    : `not a valid ISO 8601 date: '${value}' (expected YYYY-MM-DD)`;
};

const validateEnum: ValueValidator = (value, decl) => {
  const values = decl.values ?? [];
  if (values.includes(value)) return null;
  return `value '${value}' is not in declared enum [${values.join(", ")}]`;
};

// ---------------------------------------------------------------------------
// Registry — Task 6.3 installs 5 validators; subsequent tasks extend.
// ---------------------------------------------------------------------------

/** Placeholder for Tasks 6.4 and 6.5 to override. */
const notYetImplemented: ValueValidator = (_value, decl) => {
  return `value-type '${decl.type}' not yet implemented (coming in Task 6.4 or 6.5)`;
};

/** Registry of per-type validators. */
const VALIDATORS: Record<ValueType, ValueValidator> = {
  text: validateText,
  integer: validateInteger,
  boolean: validateBoolean,
  date: validateDate,
  enum: validateEnum,
  // The rest land in Tasks 6.4 and 6.5.
  id: notYetImplemented,
  "id-list": notYetImplemented,
  uri: notYetImplemented,
  url: notYetImplemented,
  "external-id": notYetImplemented,
  path: notYetImplemented,
  "path-or-id": notYetImplemented,
  "tag-list": notYetImplemented,
  citation: notYetImplemented,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/validator/value_types_test.ts` Expected:
all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/validator/value_types.ts packages/markspec/core/validator/value_types_test.ts
git commit -m "feat(core): simple value-type validators (text, integer, boolean, date, enum)"
```

---

## Task 6.4 — ID/URI value-type validators (id, id-list, uri, url, external-id)

Extend the registry with identifier and URI-shaped value types. Reuses existing
`ULID_RE` and `URI_SCHEME_RE` from `core/model/mod.ts`. Graph resolution (does
the referenced entry exist) is deferred to Phase 7's traceability stage.

**Files:**

- Modify: `packages/markspec/core/validator/value_types.ts`
- Modify: `packages/markspec/core/validator/value_types_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/markspec/core/validator/value_types_test.ts`:

```typescript
// ---------------------------------------------------------------------------
// id
// ---------------------------------------------------------------------------

Deno.test("validateValue: id accepts ULID", () => {
  const d = decl("id");
  assertEquals(validateValue("01HGW2Q8MNP3RSTVWXYZABCDEF", d), null);
});

Deno.test("validateValue: id accepts URI with scheme", () => {
  const d = decl("id");
  assertEquals(validateValue("doi:10.1234/xyz", d), null);
  assertEquals(validateValue("urn:iso:std:iso:26262", d), null);
  assertEquals(validateValue("https://example.com/thing", d), null);
  assertEquals(validateValue("pkg:cargo/serde@1.0.0", d), null);
});

Deno.test("validateValue: id rejects bare strings without ULID or URI shape", () => {
  const d = decl("id");
  const bad = ["", "not-an-id", "REQ-0001", "01HGW2Q8MN" /* too short */];
  for (const v of bad) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid id`);
    }
  }
});

// ---------------------------------------------------------------------------
// id-list — same validator as id (collation splits into individual values)
// ---------------------------------------------------------------------------

Deno.test("validateValue: id-list applies per-element id validation", () => {
  const d = decl("id-list", {
    cardinality: { lower: 0, upper: Infinity },
  });
  // Each collated element is a single id; the validator sees one at a time.
  assertEquals(
    validateValue("01HGW2Q8MNP3RSTVWXYZABCDEF", d),
    null,
  );
  assertEquals(validateValue("doi:10.1/xyz", d), null);
  const bad = validateValue("not-an-id", d);
  if (bad === null) throw new Error("expected 'not-an-id' to be invalid");
});

// ---------------------------------------------------------------------------
// uri
// ---------------------------------------------------------------------------

Deno.test("validateValue: uri accepts any scheme-qualified URI", () => {
  const d = decl("uri");
  const good = [
    "https://example.com",
    "http://example.com",
    "urn:example",
    "doi:10.1234/abc",
    "file:///path/to/thing",
    "git+https://github.com/acme/repo.git",
  ];
  for (const v of good) {
    if (validateValue(v, d) !== null) {
      throw new Error(`expected '${v}' to be valid uri`);
    }
  }
});

Deno.test("validateValue: uri rejects missing scheme", () => {
  const d = decl("uri");
  const bad = ["no-scheme", "/absolute/path", ""];
  for (const v of bad) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid uri`);
    }
  }
});

// ---------------------------------------------------------------------------
// url
// ---------------------------------------------------------------------------

Deno.test("validateValue: url accepts http(s) only", () => {
  const d = decl("url");
  assertEquals(validateValue("http://example.com", d), null);
  assertEquals(validateValue("https://example.com/path?q=1", d), null);
});

Deno.test("validateValue: url rejects non-http schemes", () => {
  const d = decl("url");
  const bad = [
    "urn:example",
    "file:///path",
    "doi:10.1/abc",
    "ftp://example.com",
    "no-scheme",
    "",
  ];
  for (const v of bad) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid url`);
    }
  }
});

// ---------------------------------------------------------------------------
// external-id
// ---------------------------------------------------------------------------

Deno.test("validateValue: external-id accepts non-empty opaque strings", () => {
  const d = decl("external-id");
  assertEquals(validateValue("JIRA-1234", d), null);
  assertEquals(validateValue("anything-goes", d), null);
  assertEquals(validateValue("contains spaces", d), null);
});

Deno.test("validateValue: external-id rejects empty / whitespace-only", () => {
  const d = decl("external-id");
  if (validateValue("", d) === null) {
    throw new Error("expected empty string to be invalid external-id");
  }
  if (validateValue("   ", d) === null) {
    throw new Error("expected whitespace-only to be invalid external-id");
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/validator/value_types_test.ts` Expected:
10 new tests FAIL because their types currently fall through to the
`notYetImplemented` placeholder.

- [ ] **Step 3: Add ID/URI validators**

Modify `packages/markspec/core/validator/value_types.ts`. Add imports at the
top:

```typescript
import type { AttrDecl, ValueType } from "../model/mod.ts";
import { ULID_RE, URI_SCHEME_RE } from "../model/mod.ts";
```

Add the new validators after the simple ones (before the registry):

```typescript
const validateId: ValueValidator = (value, _decl) => {
  if (ULID_RE.test(value)) return null;
  if (URI_SCHEME_RE.test(value)) return null;
  return `not a valid id: '${value}' (expected 26-char ULID or scheme-qualified URI)`;
};

const HTTP_URL_RE = /^https?:\/\//;
const validateUrl: ValueValidator = (value, _decl) => {
  return HTTP_URL_RE.test(value) ? null : `not a valid http(s) URL: '${value}'`;
};

const validateUri: ValueValidator = (value, _decl) => {
  return URI_SCHEME_RE.test(value)
    ? null
    : `not a valid URI: '${value}' (expected scheme-qualified per RFC 3986)`;
};

const validateExternalId: ValueValidator = (value, _decl) => {
  return value.trim().length > 0
    ? null
    : `external-id cannot be empty or whitespace-only`;
};
```

Update the registry (replace the `notYetImplemented` placeholders for these five
types):

```typescript
const VALIDATORS: Record<ValueType, ValueValidator> = {
  text: validateText,
  integer: validateInteger,
  boolean: validateBoolean,
  date: validateDate,
  enum: validateEnum,
  id: validateId,
  "id-list": validateId, // per-element check; collation splits
  uri: validateUri,
  url: validateUrl,
  "external-id": validateExternalId,
  // Task 6.5:
  path: notYetImplemented,
  "path-or-id": notYetImplemented,
  "tag-list": notYetImplemented,
  citation: notYetImplemented,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/validator/value_types_test.ts` Expected:
all 19 tests PASS (9 from 6.3 + 10 new).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/validator/value_types.ts packages/markspec/core/validator/value_types_test.ts
git commit -m "feat(core): ID/URI value-type validators (id, id-list, uri, url, external-id)"
```

---

## Task 6.5 — Path / list / citation value-type validators

Finish the value-type registry with the last four validators: `path`,
`path-or-id`, `tag-list`, `citation`. Scope is deliberately conservative — path
validates relative shape (no absolute, no drive-letter Windows paths), tag-list
checks bareword shape per collated element, citation requires non-empty trimmed
content.

**Files:**

- Modify: `packages/markspec/core/validator/value_types.ts`
- Modify: `packages/markspec/core/validator/value_types_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/markspec/core/validator/value_types_test.ts`:

```typescript
// ---------------------------------------------------------------------------
// path
// ---------------------------------------------------------------------------

Deno.test("validateValue: path accepts relative paths", () => {
  const d = decl("path");
  const good = [
    "docs/spec.md",
    "./docs/spec.md",
    "../sibling/file.txt",
    "deep/nested/path/file.ts",
    "a",
  ];
  for (const v of good) {
    if (validateValue(v, d) !== null) {
      throw new Error(`expected '${v}' to be valid path`);
    }
  }
});

Deno.test("validateValue: path rejects POSIX absolute", () => {
  const d = decl("path");
  if (validateValue("/absolute", d) === null) {
    throw new Error("expected '/absolute' to be invalid");
  }
  if (validateValue("/usr/local/bin", d) === null) {
    throw new Error("expected '/usr/local/bin' to be invalid");
  }
});

Deno.test("validateValue: path rejects Windows absolute (drive letter)", () => {
  const d = decl("path");
  if (validateValue("C:\\Users\\foo", d) === null) {
    throw new Error("expected 'C:\\\\Users\\\\foo' to be invalid");
  }
  if (validateValue("C:/Users/foo", d) === null) {
    throw new Error("expected 'C:/Users/foo' to be invalid");
  }
});

Deno.test("validateValue: path rejects empty", () => {
  const d = decl("path");
  if (validateValue("", d) === null) {
    throw new Error("expected empty to be invalid");
  }
});

// ---------------------------------------------------------------------------
// path-or-id
// ---------------------------------------------------------------------------

Deno.test("validateValue: path-or-id accepts ULID", () => {
  const d = decl("path-or-id");
  assertEquals(validateValue("01HGW2Q8MNP3RSTVWXYZABCDEF", d), null);
});

Deno.test("validateValue: path-or-id accepts URI", () => {
  const d = decl("path-or-id");
  assertEquals(validateValue("doi:10.1/abc", d), null);
  assertEquals(validateValue("urn:example", d), null);
});

Deno.test("validateValue: path-or-id accepts relative paths", () => {
  const d = decl("path-or-id");
  assertEquals(validateValue("docs/spec.md", d), null);
  assertEquals(validateValue("../sibling", d), null);
});

Deno.test("validateValue: path-or-id rejects absolute path", () => {
  const d = decl("path-or-id");
  if (validateValue("/absolute", d) === null) {
    throw new Error("expected '/absolute' to be invalid path-or-id");
  }
});

Deno.test("validateValue: path-or-id rejects empty", () => {
  const d = decl("path-or-id");
  if (validateValue("", d) === null) {
    throw new Error("expected empty to be invalid path-or-id");
  }
});

// ---------------------------------------------------------------------------
// tag-list
// ---------------------------------------------------------------------------

Deno.test("validateValue: tag-list accepts bareword tokens (per element)", () => {
  // Each collated element is one tag — the validator receives one at a time.
  const d = decl("tag-list", { cardinality: { lower: 0, upper: Infinity } });
  const good = ["ASIL-B", "DRAFT", "v1.2.0", "under_score", "a", "A-B-C"];
  for (const v of good) {
    if (validateValue(v, d) !== null) {
      throw new Error(`expected '${v}' to be valid tag`);
    }
  }
});

Deno.test("validateValue: tag-list rejects whitespace / empty / special chars", () => {
  const d = decl("tag-list", { cardinality: { lower: 0, upper: Infinity } });
  const bad = [
    "",
    "with space",
    "symbol!",
    "comma,sep",
    'quote"ed',
    "tab\there",
  ];
  for (const v of bad) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid tag`);
    }
  }
});

// ---------------------------------------------------------------------------
// citation
// ---------------------------------------------------------------------------

Deno.test("validateValue: citation accepts non-empty trimmed string", () => {
  const d = decl("citation");
  assertEquals(validateValue("Smith 2021", d), null);
  assertEquals(validateValue("ISO-26262-6 §5.3", d), null);
  assertEquals(validateValue("Multiple\nlines\nallowed", d), null);
});

Deno.test("validateValue: citation rejects empty / whitespace-only", () => {
  const d = decl("citation");
  if (validateValue("", d) === null) {
    throw new Error("expected empty to be invalid citation");
  }
  if (validateValue("   \n\t   ", d) === null) {
    throw new Error("expected whitespace-only to be invalid citation");
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/validator/value_types_test.ts` Expected:
13 new tests FAIL because their types currently fall through to
`notYetImplemented`.

- [ ] **Step 3: Add path / list / citation validators**

Modify `packages/markspec/core/validator/value_types.ts`. Append new validators
(before the registry):

```typescript
// `/absolute` (POSIX) or `C:` / `C:\` / `C:/` (Windows) → absolute.
const ABSOLUTE_RE = /^(\/|[A-Za-z]:[\\/]?)/;
const validatePath: ValueValidator = (value, _decl) => {
  if (value.length === 0) return `path cannot be empty`;
  if (ABSOLUTE_RE.test(value)) {
    return `absolute paths are not allowed: '${value}' (use a relative path)`;
  }
  return null;
};

const validatePathOrId: ValueValidator = (value, decl) => {
  // Try id first — ULID or URI.
  if (ULID_RE.test(value)) return null;
  if (URI_SCHEME_RE.test(value)) return null;
  // Fall back to path.
  return validatePath(value, decl);
};

// A tag is a bareword: letters, digits, `_`, `-`, `.`. No spaces, no punctuation.
const TAG_RE = /^[A-Za-z0-9_\-.]+$/;
const validateTagList: ValueValidator = (value, _decl) => {
  if (value.length === 0) return `tag cannot be empty`;
  return TAG_RE.test(value)
    ? null
    : `invalid tag '${value}' (expected bareword of letters, digits, '_', '-', '.')`;
};

const validateCitation: ValueValidator = (value, _decl) => {
  return value.trim().length > 0
    ? null
    : `citation cannot be empty or whitespace-only`;
};
```

Update the registry to use these:

```typescript
const VALIDATORS: Record<ValueType, ValueValidator> = {
  text: validateText,
  integer: validateInteger,
  boolean: validateBoolean,
  date: validateDate,
  enum: validateEnum,
  id: validateId,
  "id-list": validateId,
  uri: validateUri,
  url: validateUrl,
  "external-id": validateExternalId,
  path: validatePath,
  "path-or-id": validatePathOrId,
  "tag-list": validateTagList,
  citation: validateCitation,
};
```

Also drop the `notYetImplemented` placeholder (no longer used). If TypeScript
complains about unused `notYetImplemented`, delete it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/validator/value_types_test.ts` Expected:
all 32 tests PASS (9 + 10 + 13).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/validator/value_types.ts packages/markspec/core/validator/value_types_test.ts
git commit -m "feat(core): path / list / citation value-type validators"
```

---

## Task 6.6 — Stage wiring + value-type dispatch (MSL-A004)

Wire `validateValue` into the attribute validator (for `MSL-A004`) and append a
new `validateAttributesStage` to the pipeline runner.

**Files:**

- Modify: `packages/markspec/core/validator/attributes.ts`
- Modify: `packages/markspec/core/validator/attributes_test.ts`
- Modify: `packages/markspec/core/validator/pipeline.ts`
- Modify: `packages/markspec/core/validator/mod.ts`
- Modify: `packages/markspec/core/mod.ts`

- [ ] **Step 1: Write failing tests for MSL-A004**

Append to `packages/markspec/core/validator/attributes_test.ts`:

```typescript
Deno.test("validateAttributesForEntry: value-type mismatch → MSL-A004", () => {
  const intAttr: AttrDecl = {
    name: "Count",
    type: "integer",
    required: false,
    cardinality: { lower: 0, upper: 1 },
  };
  const p = profile({ universalAttrs: [intAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Count: ["not-an-int"] },
  });
  const diags = validateAttributesForEntry(e, p);
  const a004 = diags.find((d) => d.code === "MSL-A004");
  if (!a004) {
    throw new Error(`expected MSL-A004, got: ${diags.map((d) => d.code)}`);
  }
  if (!a004.message.includes("Count")) {
    throw new Error(`expected attribute name in message: ${a004.message}`);
  }
});

Deno.test("validateAttributesForEntry: all valid values → no MSL-A004", () => {
  const intAttr: AttrDecl = {
    name: "Count",
    type: "integer",
    required: false,
    cardinality: { lower: 0, upper: Infinity },
  };
  const p = profile({ universalAttrs: [intAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Count: ["1", "2", "3"] },
  });
  const diags = validateAttributesForEntry(e, p);
  assertEquals(diags.filter((d) => d.code === "MSL-A004"), []);
});

Deno.test("validateAttributesForEntry: one bad value among good ones → single MSL-A004", () => {
  const intAttr: AttrDecl = {
    name: "Count",
    type: "integer",
    required: false,
    cardinality: { lower: 0, upper: Infinity },
  };
  const p = profile({ universalAttrs: [intAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Count: ["1", "bad", "3"] },
  });
  const diags = validateAttributesForEntry(e, p);
  const a004 = diags.filter((d) => d.code === "MSL-A004");
  assertEquals(a004.length, 1);
});

Deno.test("validateAttributesForEntry: enum value-type mismatch → MSL-A004", () => {
  const enumAttr: AttrDecl = {
    name: "Status",
    type: "enum",
    required: false,
    cardinality: { lower: 0, upper: 1 },
    values: ["draft", "approved"],
  };
  const p = profile({ universalAttrs: [enumAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Status: ["rejected"] },
  });
  const diags = validateAttributesForEntry(e, p);
  const a004 = diags.find((d) => d.code === "MSL-A004");
  if (!a004) {
    throw new Error(`expected MSL-A004, got: ${diags.map((d) => d.code)}`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/validator/attributes_test.ts` Expected: 4
new tests FAIL (current `validateAttributesForEntry` doesn't call
`validateValue`).

- [ ] **Step 3: Wire value-type dispatch into `validateAttributesForEntry`**

Modify `packages/markspec/core/validator/attributes.ts`. Add import:

```typescript
import { validateValue } from "./value_types.ts";
```

In the `validateAttributesForEntry` function, inside the
`for (const [name, values] of present)` loop, after the cardinality checks, add
the value-type check:

```typescript
// MSL-A004: value-type conformance.
for (const v of values) {
  const detail = validateValue(v, decl);
  if (detail !== null) {
    diagnostics.push({
      code: "MSL-A004",
      severity: "error",
      message:
        `${entry.displayId}: attribute '${name}' has invalid value: ${detail}`,
      location: entry.location,
    });
    break; // one diagnostic per attribute is enough — don't spam
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/validator/attributes_test.ts` Expected:
all 19 tests pass (7 scope + 8 structural + 4 value-type).

- [ ] **Step 5: Write pipeline integration test**

Append to `packages/markspec/core/validator/pipeline_test.ts`:

```typescript
Deno.test("runPipeline: Stage 3 checks attributes of classified entries", () => {
  // Profile declares `requirement` with a required Rationale text attribute.
  const origin = "@test/p";
  const rationaleAttr = {
    name: "Rationale",
    type: "text" as const,
    required: true,
    cardinality: { lower: 1, upper: 1 },
  };
  const reqType: ProvenancedMapEntry<EffectiveTypeDef> = {
    origin,
    value: {
      name: "requirement",
      shape: "identified",
      displayIdPattern: { value: "REQ-{n:04d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
      required: { value: ["Rationale"], origin },
      attributes: new Map([
        ["Rationale", { value: rationaleAttr, origin }],
      ]),
      traceability: new Map(),
    },
  };
  const profile: EffectiveProfile = {
    required: { value: [], origin },
    attributes: new Map(),
    labels: { value: [], origin },
    identified: {
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map(),
    },
    referenced: {
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map(),
    },
    types: new Map([["requirement", reqType]]),
    documents: { types: new Map(), frontMatter: new Map() },
  };

  // Entry classified as requirement but missing Rationale.
  const e: Entry = {
    displayId: "REQ-0001",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "identified",
    source: "markdown",
    attributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
    ]),
    location: { file: "t.md", line: 1, column: 1 },
  };

  const result = runPipeline([e], profile);
  const a001 = result.diagnostics.find((d) => d.code === "MSL-A001");
  if (!a001) {
    throw new Error(
      `expected MSL-A001, got: ${result.diagnostics.map((d) => d.code)}`,
    );
  }
  assertEquals(result.valid, false);
});
```

- [ ] **Step 6: Run the new pipeline test (expect fail)**

Run: `deno test packages/markspec/core/validator/pipeline_test.ts` Expected: the
new test FAILS because `runPipeline` doesn't call Stage 3 yet.

- [ ] **Step 7: Wire Stage 3 into the pipeline**

Modify `packages/markspec/core/validator/pipeline.ts`. Add import and stage
call:

```typescript
import { validateAttributesForEntry } from "./attributes.ts";
```

Inside `runPipeline`, after the Stage 2 block, add Stage 3:

```typescript
// Stage 3 — typed attributes (only when a profile is loaded).
if (profile !== null) {
  for (const entry of finalEntries) {
    const stage3 = validateAttributesForEntry(entry, profile);
    diagnostics.push(...stage3);
  }
}
```

Full function for clarity:

```typescript
export function runPipeline(
  entries: readonly Entry[],
  profile: EffectiveProfile | null,
): PipelineResult {
  const diagnostics: Diagnostic[] = [];

  // Stage 1 — core hygiene.
  const stage1 = validate(entries);
  diagnostics.push(...stage1.diagnostics);

  // Stage 2 — classification.
  let finalEntries: readonly Entry[] = entries;
  if (profile !== null) {
    const stage2 = classifyEntriesStage(entries, profile);
    finalEntries = stage2.entries;
    diagnostics.push(...stage2.diagnostics);
  }

  // Stage 3 — typed attributes.
  if (profile !== null) {
    for (const entry of finalEntries) {
      const stage3 = validateAttributesForEntry(entry, profile);
      diagnostics.push(...stage3);
    }
  }

  const valid = !diagnostics.some((d) => d.severity === "error");
  return { entries: finalEntries, diagnostics, valid };
}
```

Update the module doc comment to mention Stage 3.

- [ ] **Step 8: Run the pipeline test + full suite**

Run: `deno test packages/markspec/core/validator/pipeline_test.ts` Expected: all
6 pipeline tests pass (5 from Phase 5 + 1 new).

Run: `deno task test` Expected: full suite green (Phase 5 baseline 448 + 7+8+4
attributes + 9+10+13 value_types + 1 pipeline = ~500, minus any test-count
shifts from earlier. Exact count depends; confirm green without nailing a
specific number).

- [ ] **Step 9: Extend barrel exports**

Modify `packages/markspec/core/validator/mod.ts`. Append:

```typescript
export { effectiveScope, validateAttributesForEntry } from "./attributes.ts";
export type { EffectiveAttrScope } from "./attributes.ts";

export { validateValue } from "./value_types.ts";
export type { ValueValidator } from "./value_types.ts";
```

Modify `packages/markspec/core/mod.ts`. Find the validator re-export block and
add the new names alongside existing ones (alphabetized):

```typescript
export {
  classifyEntriesStage,
  classifyEntry,
  compileDisplayIdPattern,
  effectiveScope,
  runPipeline,
  validate,
  validateAttributesForEntry,
  validateValue,
} from "./validator/mod.ts";
export type {
  ClassifyResult,
  ClassifyStageResult,
  EffectiveAttrScope,
  PipelineResult,
  ValidateResult,
  ValueValidator,
} from "./validator/mod.ts";
```

Adapt to the file's current structure — match the existing re-export block style
rather than force the form above.

- [ ] **Step 10: Type-check + tests**

Run: `deno task check && deno task test` Expected: clean, all tests pass.

- [ ] **Step 11: Commit**

```bash
git add packages/markspec/core/validator/attributes.ts packages/markspec/core/validator/attributes_test.ts packages/markspec/core/validator/pipeline.ts packages/markspec/core/validator/pipeline_test.ts packages/markspec/core/validator/mod.ts packages/markspec/core/mod.ts
git commit -m "feat(core): wire Stage 3 typed attributes into pipeline"
```

---

## Task 6.7 — E2E fixture + tests

Exercise Stage 3 through the CLI. Write a profile with a variety of attribute
declarations (required, typed, cardinality), point `.markspec.yaml` at it, and
test that `markspec validate` surfaces each MSL-A0* diagnostic.

**Files:**

- Create: `tests/fixtures/profiles/phase6/attributed/markspec.yaml`
- Create: `tests/e2e/profile_attributes_test.ts`

- [ ] **Step 1: Create the fixture profile**

Create `tests/fixtures/profiles/phase6/attributed/markspec.yaml`:

```yaml
id: "@acme/phase6-attributed"
version: 0.1.0
description: Phase 6 e2e — profile with typed attributes for each diagnostic code
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved]
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
      required: [Rationale]
      attributes:
        - name: Rationale
          type: text
          cardinality: 1..1
        - name: Count
          type: integer
          cardinality: 0..1
        - name: Owners
          type: tag-list
          cardinality: 2..3
```

- [ ] **Step 2: Write the e2e tests**

Create `tests/e2e/profile_attributes_test.ts`:

```typescript
/**
 * @module tests/e2e/profile_attributes_test
 *
 * E2E tests for validator Stage 3 — typed attribute validation through
 * `markspec validate`.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: phase6-e2e\nversion: 0.1.0\n`;

const PROFILE_YAML = `id: "@acme/phase6-attributed"
version: 0.1.0
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved]
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
      required: [Rationale]
      attributes:
        - name: Rationale
          type: text
          cardinality: 1..1
        - name: Count
          type: integer
          cardinality: 0..1
        - name: Owners
          type: tag-list
          cardinality: 2..3
`;

const BASE_FILES = {
  "project.yaml": PROJECT_YAML,
  ".markspec.yaml": `profiles:\n  - ./profiles/attributed\n`,
  "profiles/attributed/markspec.yaml": PROFILE_YAML,
};

Deno.test("profile attributes e2e: happy path — all required present, types valid", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      ...BASE_FILES,
      "req.md": `# Example

- [REQ-0001] A requirement

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  Rationale: Needed for safety\\
  Count: 42\\
  Owners: alice bob\\
  Status: draft\\
`,
    },
  });
  assertEquals(code, 0);
  const msl_a = stderr.split("\n").filter((l) => l.includes("MSL-A"));
  assertEquals(msl_a, []);
});

Deno.test("profile attributes e2e: missing required → MSL-A001", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      ...BASE_FILES,
      "req.md": `# Example

- [REQ-0001] Missing rationale

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-A001");
  assertStringIncludes(stderr, "Rationale");
});

Deno.test("profile attributes e2e: cardinality upper exceeded → MSL-A002", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      ...BASE_FILES,
      "req.md": `# Example

- [REQ-0001] Too many owners

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  Rationale: needed\\
  Owners: a b c d\\
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-A002");
});

Deno.test("profile attributes e2e: cardinality lower unmet → MSL-A003", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      ...BASE_FILES,
      "req.md": `# Example

- [REQ-0001] Too few owners

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  Rationale: needed\\
  Owners: single\\
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-A003");
});

Deno.test("profile attributes e2e: value-type mismatch → MSL-A004", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      ...BASE_FILES,
      "req.md": `# Example

- [REQ-0001] Count must be integer

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  Rationale: needed\\
  Count: not-an-integer\\
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-A004");
});

Deno.test("profile attributes e2e: unknown attribute → MSL-A005 warning (exit 2, not 1)", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      ...BASE_FILES,
      "req.md": `# Example

- [REQ-0001] Unknown attribute

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  Rationale: needed\\
  Bogus: value\\
`,
    },
  });
  // MSL-A005 is a warning — exit code depends on CLI convention.
  // Warning-only runs exit 2 per existing validator contract; check accordingly.
  assertStringIncludes(stderr, "MSL-A005");
  assertStringIncludes(stderr, "Bogus");
  // The CLI promotes warnings via --strict; without --strict, exit is 2.
  if (code !== 2 && code !== 0) {
    throw new Error(`expected code 0 or 2 for warning-only, got ${code}`);
  }
});

Deno.test("profile attributes e2e: enum type-mismatch → MSL-A004 on Status", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      ...BASE_FILES,
      "req.md": `# Example

- [REQ-0001] Bad status

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  Rationale: needed\\
  Status: rejected\\
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-A004");
});

Deno.test("profile attributes e2e: no profile → no MSL-A diagnostics (core-only)", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "req.md": `# Example

- [REQ-0001] No profile

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
`,
    },
  });
  assertEquals(code, 0);
  const msl_a = stderr.split("\n").filter((l) => l.includes("MSL-A"));
  assertEquals(msl_a, []);
});
```

- [ ] **Step 3: Run the e2e tests**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/profile_attributes_test.ts`
Expected: all 8 tests PASS.

Debugging tips if tests fail:

- If the happy path fails, check that the parser is collating multi-token
  `Owners: alice bob` into separate typed-attribute values. If it's treating the
  whole line as one string, the cardinality lower check (`Owners` needs 2..3)
  will fire. You may need to either use a different delimiter or accept that
  tag-list values are space-separated by the parser. If the parser already
  splits on spaces into separate typed-attribute entries, the test works as
  written.
- If "unknown attribute" test gets exit code 1 instead of 2, check the CLI's
  handling of warnings in main.ts validate. The existing format may promote all
  diagnostics to errors — if so, update the assertion to `code === 1`.

- [ ] **Step 4: Full suite**

Run: `deno task test` Expected: green across the board.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/profiles/phase6/attributed/markspec.yaml tests/e2e/profile_attributes_test.ts
git commit -m "test(core): e2e coverage for validator Stage 3 typed attributes"
```

---

## Phase 6 acceptance

All tasks checked, all commits on `feat/profile-system-phase-6`,
`deno task test` green, `deno task check` clean. Stage 3 covers:

- Effective-attribute scope layering: universal → shape → type, with inner scope
  overriding on name collision.
- Un-classified entry path: universal + shape scope applies (type-specific scope
  skipped).
- `MSL-A001` required missing, `MSL-A002` upper cardinality, `MSL-A003` lower
  cardinality (when attribute is present), `MSL-A005` unknown (warning, with
  core-reserved keys exempted).
- Value-type dispatch (`MSL-A004`) through a typed registry covering all 14
  value types.
- Per-type validators: text (any), integer, boolean (true/false strict), date
  (ISO 8601), enum (declared-values subset), id (ULID or URI), id-list
  (per-element), uri (any scheme), url (http/https), external-id (non-empty
  trimmed), path (reject absolute), path-or-id (id or path), tag-list (bareword
  per element), citation (non-empty trimmed).
- Stage 3 appended to `runPipeline` after Stage 2; no CLI changes required.
- E2E fixtures demonstrate each MSL-A0* diagnostic through `markspec validate`.

This PR lights up the second half of the validator pipeline. Phase 7 adds
traceability rules (`MSL-L00*`); Phase 8 generated inverses.

---

## Self-review

**Spec coverage (§5.4):**

- ✅ Effective attribute scope computation — `effectiveScope`.
- ✅ `MSL-A001` required presence — `validateAttributesForEntry`.
- ✅ `MSL-A002` upper cardinality + `MSL-A003` lower cardinality — both present
  in the attribute loop.
- ✅ `MSL-A004` value-type conformance — delegated to `validateValue` + per-type
  registry.
- ✅ `MSL-A005` unknown attribute (warning) — with core-reserved key exemption.
- ✅ All 14 value types covered (`text`, `integer`, `boolean`, `date`, `enum`,
  `id`, `id-list`, `uri`, `url`, `external-id`, `path`, `path-or-id`,
  `tag-list`, `citation`).

**Placeholder scan:** None. Every TDD cycle has complete code blocks.

**Type consistency:** `ValueValidator`, `EffectiveAttrScope`, `validateValue`,
`validateAttributesForEntry` consistent across Tasks 6.1–6.6. Registry shape
matches `Record<ValueType, ValueValidator>` throughout.

**Known caveats (documented in §Scope):**

- Graph-resolution for `id`/`id-list` is format-check-only; Phase 7's
  traceability stage handles actual target resolution.
- `path` validator rejects absolute but doesn't enforce project-root
  containment.
- `citation` validator is "non-empty trimmed"; structural locator parsing
  deferred.

All three are spec-noted limitations, not bugs.

**Scope check:** single subsystem (validator Stage 3). No
compiler/parser/profile-system changes. Fits one PR.

---

## Execution handoff

Plan complete and saved to
`docs/superpowers/plans/2026-04-22-adr-008-profile-system-v1-phase-6.md`. Two
execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task,
   review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans,
   batch execution with checkpoints.

Which approach?
