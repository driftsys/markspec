# ADR-008 Profile System v1 — Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the loaded profile actually _do_ something — classify each entry
against the profile's type vocabulary (via display-ID pattern or explicit
`Type:` trailer), emit classification diagnostics, and wire the result into the
`validate` + `compile` CLI commands.

**Architecture:** A two-stage pipeline assembled in a new
`core/validator/pipeline.ts` runner. Stage 1 is the existing `validate()`
function wrapped as-is (core hygiene, unchanged). Stage 2 is a new
`core/validator/types.ts` classifier that matches each entry's display ID
against the profile's compiled patterns, or honors an explicit `Type:` trailer.
Classification produces _new_ `Entry` objects with `type` set (immutable
update); downstream stages read `entry.type`.

**Tech Stack:** Deno + TypeScript, `@std/assert`. Builds on Phases 1–4's
`EffectiveProfile` (with provenance), `loadProfileForCommand`, and the existing
`validate()` core hygiene function. No new external dependencies.

**Spec:**
[docs/superpowers/specs/2026-04-21-adr-008-profile-system-v1-design.md](../specs/2026-04-21-adr-008-profile-system-v1-design.md)
§5 (Validator pipeline).

**Branch:** `feat/profile-system-phase-5`, branched from `main` (which now
carries merged Phases 1–4 via PRs #227–#231).

---

## Scope

### In Phase 5

- **Display-ID pattern compiler** (`core/validator/pattern.ts`) — compiles
  `REQ-{n:04d}`-style templates into `RegExp` instances.
- **Entry classifier** (`core/validator/types.ts`) — classifies a single entry
  against the profile's types, emitting `MSL-T001`/`-T002`/`-T003`/`-T004`
  diagnostics.
- **Pipeline runner** (`core/validator/pipeline.ts`) —
  `runPipeline(entries, profile)` composing Stage 1 (existing `validate()`) +
  Stage 2 (classifier). Returns classified entries + accumulated diagnostics +
  valid flag.
- **Strict-mode semantics** — when the profile declares ≥1 type, unclassified
  identified entries become `MSL-T003` errors (per ADR-008 §6).
- **Display-ID pattern enforcement** — `warn`/`error` severities honored; `off`
  skips the check.
- **CLI wiring** — `validate` and `compile` subcommands use
  `runPipeline(entries, profile.effective)` instead of calling `validate()`
  directly.
- **E2E coverage** — fixtures + CLI tests exercising: happy path (prefix match),
  ambiguity, explicit override, un-classified strict failure.

### Deferred (not Phase 5)

- Typed attribute validation (`MSL-A00*` codes) — Phase 6.
- Traceability rules (`MSL-L00*` codes) — Phase 7.
- Generated inverses — Phase 8.
- CLI `profile add` / `doctor` — Phase 9.
- Per-profile "disable strict mode" toggle — not in ADR-008 §6 as a first-class
  schema feature; default strict behavior is per spec.

### Diagnostic codes introduced in Phase 5

| Code       | Severity     | Meaning                                                                                                        |
| ---------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| `MSL-T001` | error        | Explicit `Type:` trailer value is not a declared type                                                          |
| `MSL-T002` | error        | Display ID matches multiple type patterns (ambiguous)                                                          |
| `MSL-T003` | error        | Un-classified entry in strict profile (types declared, no match)                                               |
| `MSL-T004` | warn / error | Classified entry's display ID doesn't match the type's pattern (severity per `display-id-pattern-enforcement`) |

---

## Files this PR creates or modifies

### New files

- `packages/markspec/core/validator/pattern.ts` — display-ID pattern template →
  `RegExp` compiler.
- `packages/markspec/core/validator/pattern_test.ts` — unit tests for pattern
  compilation.
- `packages/markspec/core/validator/types.ts` — entry classifier
  (`classifyEntry`, `classifyTypesStage`).
- `packages/markspec/core/validator/types_test.ts` — unit tests for
  classification.
- `packages/markspec/core/validator/pipeline.ts` — pipeline runner composing
  stages.
- `packages/markspec/core/validator/pipeline_test.ts` — integration tests for
  the runner.
- `tests/fixtures/profiles/phase5/typed/markspec.yaml` — e2e fixture profile
  with types.
- `tests/e2e/profile_types_test.ts` — CLI-level classification tests.

### Modified files

- `packages/markspec/core/validator/mod.ts` — re-export `runPipeline` and stage
  helpers (leave existing `validate()` untouched so Phase 1–4 code paths keep
  working).
- `packages/markspec/core/mod.ts` — re-export `runPipeline` and associated
  types.
- `packages/markspec/main.ts` — `validate` and `compile` commands call
  `runPipeline(entries, chain?.effective ?? null)` instead of
  `validate(entries)`.

No changes to: `core/parser/**`, `core/compiler/**`, `core/formatter/**`,
`core/model/**` (Entry already has `type?: string`), `core/profile/**`.

---

## Task overview

| #   | Task                                  | Files touched                                                                           |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------- |
| 5.1 | Display-ID pattern compiler           | `validator/pattern.ts`, `validator/pattern_test.ts`                                     |
| 5.2 | Classify single entry                 | `validator/types.ts`, `validator/types_test.ts`                                         |
| 5.3 | Classification stage (batch + strict) | `validator/types.ts`, `validator/types_test.ts`                                         |
| 5.4 | Pipeline runner                       | `validator/pipeline.ts`, `validator/pipeline_test.ts`, `validator/mod.ts`               |
| 5.5 | CLI wiring + barrel exports           | `main.ts`, `core/mod.ts`, `validator/mod.ts`                                            |
| 5.6 | E2E fixture + tests                   | `tests/fixtures/profiles/phase5/typed/markspec.yaml`, `tests/e2e/profile_types_test.ts` |

Each task is one commit. Every task follows TDD.

---

## Task 5.1 — Display-ID pattern compiler

Compile a profile's `display-id-pattern` template string (e.g. `REQ-{n:04d}`)
into a `RegExp`. Pure function, no I/O. Consumed by Stage 2 classification in
Task 5.3.

**Files:**

- Create: `packages/markspec/core/validator/pattern.ts`
- Create: `packages/markspec/core/validator/pattern_test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/markspec/core/validator/pattern_test.ts`:

```typescript
/**
 * @module core/validator/pattern_test
 *
 * Unit tests for display-ID pattern compilation.
 */

import { assertEquals } from "@std/assert";
import { compileDisplayIdPattern } from "./pattern.ts";

Deno.test("compileDisplayIdPattern: bare {n} becomes \\d+", () => {
  const r = compileDisplayIdPattern("REQ-{n}");
  assertEquals(r.test("REQ-1"), true);
  assertEquals(r.test("REQ-123"), true);
  assertEquals(r.test("REQ-9999"), true);
  assertEquals(r.test("REQ-"), false);
  assertEquals(r.test("REQ-abc"), false);
  assertEquals(r.test("XREQ-1"), false);
  assertEquals(r.test("REQ-1X"), false);
});

Deno.test("compileDisplayIdPattern: {n:04d} requires exactly 4 digits", () => {
  const r = compileDisplayIdPattern("REQ-{n:04d}");
  assertEquals(r.test("REQ-0001"), true);
  assertEquals(r.test("REQ-9999"), true);
  assertEquals(r.test("REQ-1"), false);
  assertEquals(r.test("REQ-12345"), false);
});

Deno.test("compileDisplayIdPattern: multi-segment prefix allowed", () => {
  const r = compileDisplayIdPattern("STAKE-REQ-{n:06d}");
  assertEquals(r.test("STAKE-REQ-000001"), true);
  assertEquals(r.test("STAKE-REQ-999999"), true);
  assertEquals(r.test("STAKE-REQ-123"), false);
});

Deno.test("compileDisplayIdPattern: pattern is anchored (no prefix/suffix slop)", () => {
  const r = compileDisplayIdPattern("REQ-{n:03d}");
  assertEquals(r.test("REQ-001"), true);
  assertEquals(r.test("XREQ-001"), false);
  assertEquals(r.test("REQ-001X"), false);
  assertEquals(r.test(" REQ-001"), false);
  assertEquals(r.test("REQ-001 "), false);
});

Deno.test("compileDisplayIdPattern: regex metachars in literal prefix are escaped", () => {
  // Although the display-ID grammar per spec doesn't use these, a defensive
  // compiler should escape them. Using `.` as a test case since it's common.
  const r = compileDisplayIdPattern("A.B-{n}");
  assertEquals(r.test("A.B-42"), true);
  assertEquals(r.test("AXB-42"), false); // '.' must be literal
});

Deno.test("compileDisplayIdPattern: missing {n} placeholder throws", () => {
  try {
    compileDisplayIdPattern("REQ-");
    throw new Error("expected compileDisplayIdPattern to throw");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes("{n}")) {
      throw new Error(`expected '{n}' in error message, got: ${msg}`);
    }
  }
});

Deno.test("compileDisplayIdPattern: invalid padding spec throws", () => {
  try {
    compileDisplayIdPattern("REQ-{n:abc}");
    throw new Error("expected compileDisplayIdPattern to throw");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes("invalid")) {
      throw new Error(`expected 'invalid' in error message, got: ${msg}`);
    }
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/validator/pattern_test.ts` Expected: FAIL
with `Cannot find module './pattern.ts'`.

- [ ] **Step 3: Implement the compiler**

Create `packages/markspec/core/validator/pattern.ts`:

```typescript
/**
 * @module core/validator/pattern
 *
 * Display-ID pattern template → anchored RegExp.
 *
 * Grammar (per ADR-009 §5):
 *   pattern   := literal-prefix placeholder (literal-suffix)?
 *   placeholder := "{n}" | "{n:" PADDING "d}"
 *   PADDING   := "0" digits
 *
 * Examples:
 *   REQ-{n}           → ^REQ-(\d+)$
 *   REQ-{n:04d}       → ^REQ-(\d{4})$
 *   STAKE-REQ-{n:06d} → ^STAKE-REQ-(\d{6})$
 */

const PLACEHOLDER_RE = /\{n(?::(0\d+)d)?\}/;

/**
 * Compile a display-ID pattern template into an anchored RegExp.
 *
 * Throws if the template is missing the `{n}` placeholder or has an invalid
 * padding specifier.
 */
export function compileDisplayIdPattern(template: string): RegExp {
  const match = PLACEHOLDER_RE.exec(template);
  if (!match) {
    // Check whether user tried `{n:abc}` with invalid padding.
    if (/\{n:[^}]*\}/.test(template)) {
      throw new Error(
        `display-id-pattern '${template}': invalid padding specifier ` +
          `(expected {n} or {n:NNd})`,
      );
    }
    throw new Error(
      `display-id-pattern '${template}': missing {n} placeholder`,
    );
  }

  const padding = match[1]; // e.g. "04" for {n:04d}
  const placeholderStart = match.index;
  const placeholderEnd = match.index + match[0].length;

  const prefix = template.slice(0, placeholderStart);
  const suffix = template.slice(placeholderEnd);

  const digitGroup = padding ? `\\d{${Number(padding)}}` : `\\d+`;

  const regexSource = "^" + escapeRegex(prefix) + "(" + digitGroup + ")" +
    escapeRegex(suffix) + "$";
  return new RegExp(regexSource);
}

/** Escape regex metacharacters in a literal string. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/validator/pattern_test.ts` Expected: all
7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/validator/pattern.ts packages/markspec/core/validator/pattern_test.ts
git commit -m "feat(core): display-ID pattern compiler"
```

---

## Task 5.2 — Classify a single entry

`classifyEntry(entry, profile)` returns `{ type, diagnostics }` for one entry:

- Uses explicit `Type:` trailer when present (emits `MSL-T001` on unknown
  value).
- Otherwise matches display ID against patterns of types with
  `shape === entry.shape` (emits `MSL-T002` on ambiguity).
- Emits `MSL-T003` when strict and un-classified.

**Files:**

- Create: `packages/markspec/core/validator/types.ts`
- Create: `packages/markspec/core/validator/types_test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/markspec/core/validator/types_test.ts`:

```typescript
/**
 * @module core/validator/types_test
 *
 * Unit tests for entry classification against a profile.
 */

import { assertEquals } from "@std/assert";
import { classifyEntry } from "./types.ts";
import type {
  EffectiveProfile,
  EffectiveTypeDef,
  Entry,
  EntryShape,
  ProvenancedMapEntry,
} from "../model/mod.ts";

/** Helper: build a minimal Entry for tests. */
function buildEntry(opts: {
  displayId: string;
  shape: EntryShape;
  type?: string;
  typeAttribute?: string;
}): Entry {
  const attributes = opts.typeAttribute
    ? [{ key: "Type", value: opts.typeAttribute }]
    : [];
  return {
    displayId: opts.displayId,
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape,
    type: opts.type,
    source: "markdown",
    attributes,
    location: { file: "t.md", line: 1, column: 1 },
  };
}

/** Helper: build an EffectiveTypeDef for tests. */
function buildType(opts: {
  name: string;
  shape: EntryShape;
  displayIdPattern?: string;
  enforcement?: "off" | "warn" | "error";
}): ProvenancedMapEntry<EffectiveTypeDef> {
  const origin = "@test/profile";
  return {
    value: {
      name: opts.name,
      shape: opts.shape,
      displayIdPattern: { value: opts.displayIdPattern, origin },
      displayIdPatternEnforcement: {
        value: opts.enforcement ?? "off",
        origin,
      },
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map(),
    },
    origin,
  };
}

/** Helper: build an EffectiveProfile with the given types. */
function buildProfile(
  types: ReadonlyArray<ProvenancedMapEntry<EffectiveTypeDef>>,
): EffectiveProfile {
  const origin = "@test/profile";
  const typesMap = new Map<string, ProvenancedMapEntry<EffectiveTypeDef>>();
  for (const t of types) typesMap.set(t.value.name, t);
  return {
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
    types: typesMap,
    documents: { types: new Map(), frontMatter: new Map() },
  };
}

// ---------------------------------------------------------------------------
// Display-ID pattern matching
// ---------------------------------------------------------------------------

Deno.test("classifyEntry: unique pattern match classifies entry", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  const entry = buildEntry({ displayId: "REQ-0001", shape: "identified" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, "requirement");
  assertEquals(result.diagnostics, []);
});

Deno.test("classifyEntry: no match + strict mode emits MSL-T003", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  const entry = buildEntry({ displayId: "FOO-001", shape: "identified" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, undefined);
  assertEquals(result.diagnostics[0].code, "MSL-T003");
});

Deno.test("classifyEntry: ambiguous match emits MSL-T002", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n}",
    }),
    buildType({
      name: "req-extended",
      shape: "identified",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  const entry = buildEntry({ displayId: "REQ-0001", shape: "identified" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, undefined);
  assertEquals(result.diagnostics[0].code, "MSL-T002");
});

Deno.test("classifyEntry: only types with matching shape are considered", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n:04d}",
    }),
    buildType({
      name: "citation",
      shape: "referenced",
      displayIdPattern: "REQ-{n:04d}", // same pattern but different shape
    }),
  ]);
  const entry = buildEntry({ displayId: "REQ-0001", shape: "identified" });
  const result = classifyEntry(entry, profile);
  // Should classify as requirement (shape matches); citation is filtered out.
  assertEquals(result.type, "requirement");
  assertEquals(result.diagnostics, []);
});

// ---------------------------------------------------------------------------
// Explicit Type: trailer
// ---------------------------------------------------------------------------

Deno.test("classifyEntry: explicit Type: trailer used when present", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  // Display ID doesn't match the pattern, but Type: says requirement.
  const entry = buildEntry({
    displayId: "FOO-001",
    shape: "identified",
    typeAttribute: "requirement",
  });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, "requirement");
  assertEquals(result.diagnostics, []);
});

Deno.test("classifyEntry: explicit Type: unknown value emits MSL-T001", () => {
  const profile = buildProfile([
    buildType({ name: "requirement", shape: "identified" }),
  ]);
  const entry = buildEntry({
    displayId: "REQ-0001",
    shape: "identified",
    typeAttribute: "bogus",
  });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, undefined);
  assertEquals(result.diagnostics[0].code, "MSL-T001");
});

Deno.test("classifyEntry: explicit Type: overrides pattern inference", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n}",
    }),
    buildType({
      name: "note",
      shape: "identified",
      displayIdPattern: "NOTE-{n}",
    }),
  ]);
  // Display ID matches requirement, but Type: says note.
  const entry = buildEntry({
    displayId: "REQ-1",
    shape: "identified",
    typeAttribute: "note",
  });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, "note");
  assertEquals(result.diagnostics, []);
});

// ---------------------------------------------------------------------------
// Permissive mode (no types declared)
// ---------------------------------------------------------------------------

Deno.test("classifyEntry: permissive (empty types map) never emits MSL-T003", () => {
  const profile = buildProfile([]); // no types declared
  const entry = buildEntry({ displayId: "FOO-001", shape: "identified" });
  const result = classifyEntry(entry, profile);
  assertEquals(result.type, undefined);
  assertEquals(result.diagnostics, []);
});

// ---------------------------------------------------------------------------
// Types without a display-id-pattern (matchable only via Type: trailer)
// ---------------------------------------------------------------------------

Deno.test("classifyEntry: type without pattern doesn't participate in pattern match", () => {
  const profile = buildProfile([
    buildType({ name: "generic", shape: "identified" }), // no pattern
  ]);
  const entry = buildEntry({ displayId: "FOO-001", shape: "identified" });
  const result = classifyEntry(entry, profile);
  // Strict mode + no match → MSL-T003 (generic has no pattern so can't match)
  assertEquals(result.type, undefined);
  assertEquals(result.diagnostics[0].code, "MSL-T003");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/validator/types_test.ts` Expected: FAIL —
`classifyEntry` not exported.

- [ ] **Step 3: Implement `classifyEntry`**

Create `packages/markspec/core/validator/types.ts`:

```typescript
/**
 * @module core/validator/types
 *
 * Validator Stage 2 — entry classification.
 *
 * Each entry is assigned a profile-declared type either by an explicit
 * `Type:` trailer attribute or by display-ID pattern matching. Un-classified
 * entries in a strict profile (types declared) produce MSL-T003.
 */

import type {
  Diagnostic,
  EffectiveProfile,
  EffectiveTypeDef,
  Entry,
  ProvenancedMapEntry,
} from "../model/mod.ts";
import { compileDisplayIdPattern } from "./pattern.ts";

/** Result of classifying a single entry. */
export interface ClassifyResult {
  /** The assigned type name, or `undefined` if un-classified. */
  readonly type: string | undefined;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Classify one {@linkcode Entry} against the profile's type vocabulary.
 *
 * Order of precedence:
 *   1. Explicit `Type:` trailer attribute (if present).
 *   2. Display-ID pattern match across types whose `shape` matches
 *      `entry.shape`.
 *
 * Emits:
 *   - `MSL-T001` when explicit `Type:` value is not in the profile's type
 *     vocabulary.
 *   - `MSL-T002` when the display ID matches more than one type's pattern.
 *   - `MSL-T003` when strict mode (types declared) and no classification
 *     could be assigned.
 */
export function classifyEntry(
  entry: Entry,
  profile: EffectiveProfile,
): ClassifyResult {
  const diagnostics: Diagnostic[] = [];

  // 1. Explicit Type: trailer?
  const explicitType = findExplicitTypeAttribute(entry);
  if (explicitType !== undefined) {
    if (profile.types.has(explicitType)) {
      return { type: explicitType, diagnostics };
    }
    diagnostics.push({
      code: "MSL-T001",
      severity: "error",
      message:
        `${entry.displayId}: explicit Type: '${explicitType}' is not a declared type`,
      location: entry.location,
    });
    return { type: undefined, diagnostics };
  }

  // 2. Display-ID pattern match across same-shape types.
  const matches: string[] = [];
  for (const [typeName, typeEntry] of profile.types) {
    if (typeEntry.value.shape !== entry.shape) continue;
    const pattern = typeEntry.value.displayIdPattern.value;
    if (pattern === undefined) continue;
    const regex = compileDisplayIdPattern(pattern);
    if (regex.test(entry.displayId)) {
      matches.push(typeName);
    }
  }

  if (matches.length === 1) {
    return { type: matches[0], diagnostics };
  }

  if (matches.length > 1) {
    diagnostics.push({
      code: "MSL-T002",
      severity: "error",
      message:
        `${entry.displayId}: display ID matches multiple type patterns ` +
        `(${
          matches.join(", ")
        }); add an explicit 'Type:' trailer to disambiguate`,
      location: entry.location,
    });
    return { type: undefined, diagnostics };
  }

  // 0 matches. Strict mode → MSL-T003; permissive → OK.
  if (profile.types.size > 0) {
    diagnostics.push({
      code: "MSL-T003",
      severity: "error",
      message: `${entry.displayId}: un-classified entry ` +
        `(profile declares ${profile.types.size} types; display ID matched none)`,
      location: entry.location,
    });
  }
  return { type: undefined, diagnostics };
}

/** Return the value of the first `Type:` trailer attribute, or undefined. */
function findExplicitTypeAttribute(entry: Entry): string | undefined {
  for (const attr of entry.attributes) {
    if (attr.key === "Type") {
      return attr.value.trim();
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/validator/types_test.ts` Expected: all 9
tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/validator/types.ts packages/markspec/core/validator/types_test.ts
git commit -m "feat(core): classify single entry against profile types"
```

---

## Task 5.3 — Classification stage (batch + enforcement)

A stage function that processes all entries, sets `entry.type` on successful
classification, and emits `MSL-T004` when a classified entry's display ID
violates the type's enforcement level.

**Files:**

- Modify: `packages/markspec/core/validator/types.ts`
- Modify: `packages/markspec/core/validator/types_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/markspec/core/validator/types_test.ts`:

```typescript
import { classifyEntriesStage } from "./types.ts";

Deno.test("classifyEntriesStage: sets entry.type on successful classification", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  const entries = [
    buildEntry({ displayId: "REQ-0001", shape: "identified" }),
    buildEntry({ displayId: "REQ-0002", shape: "identified" }),
  ];
  const result = classifyEntriesStage(entries, profile);
  assertEquals(result.diagnostics, []);
  assertEquals(result.entries[0].type, "requirement");
  assertEquals(result.entries[1].type, "requirement");
});

Deno.test("classifyEntriesStage: preserves entries for un-classified (permissive mode)", () => {
  const profile = buildProfile([]); // permissive
  const entries = [
    buildEntry({ displayId: "FOO-001", shape: "identified" }),
  ];
  const result = classifyEntriesStage(entries, profile);
  assertEquals(result.diagnostics, []);
  assertEquals(result.entries[0].type, undefined);
});

Deno.test("classifyEntriesStage: accumulates diagnostics across entries", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n:04d}",
    }),
  ]);
  const entries = [
    buildEntry({ displayId: "FOO-001", shape: "identified" }), // MSL-T003
    buildEntry({ displayId: "BAR-002", shape: "identified" }), // MSL-T003
    buildEntry({ displayId: "REQ-0001", shape: "identified" }), // OK
  ];
  const result = classifyEntriesStage(entries, profile);
  const t003 = result.diagnostics.filter((d) => d.code === "MSL-T003");
  assertEquals(t003.length, 2);
});

Deno.test("classifyEntriesStage: MSL-T004 warn when enforcement=warn and pattern mismatches", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n:04d}",
      enforcement: "warn",
    }),
  ]);
  // Classified via explicit Type:, display ID doesn't match pattern.
  const entries = [
    buildEntry({
      displayId: "FOO-001",
      shape: "identified",
      typeAttribute: "requirement",
    }),
  ];
  const result = classifyEntriesStage(entries, profile);
  assertEquals(result.entries[0].type, "requirement");
  const t004 = result.diagnostics.find((d) => d.code === "MSL-T004");
  if (!t004) {
    throw new Error(
      `expected MSL-T004, got: ${result.diagnostics.map((d) => d.code)}`,
    );
  }
  assertEquals(t004.severity, "warning");
});

Deno.test("classifyEntriesStage: MSL-T004 error when enforcement=error", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n:04d}",
      enforcement: "error",
    }),
  ]);
  const entries = [
    buildEntry({
      displayId: "FOO-001",
      shape: "identified",
      typeAttribute: "requirement",
    }),
  ];
  const result = classifyEntriesStage(entries, profile);
  const t004 = result.diagnostics.find((d) => d.code === "MSL-T004");
  if (!t004) {
    throw new Error(
      `expected MSL-T004, got: ${result.diagnostics.map((d) => d.code)}`,
    );
  }
  assertEquals(t004.severity, "error");
});

Deno.test("classifyEntriesStage: no MSL-T004 when enforcement=off", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n:04d}",
      enforcement: "off",
    }),
  ]);
  const entries = [
    buildEntry({
      displayId: "FOO-001",
      shape: "identified",
      typeAttribute: "requirement",
    }),
  ];
  const result = classifyEntriesStage(entries, profile);
  const t004 = result.diagnostics.find((d) => d.code === "MSL-T004");
  assertEquals(t004, undefined);
});

Deno.test("classifyEntriesStage: pattern-matched classification is never MSL-T004 (by definition)", () => {
  const profile = buildProfile([
    buildType({
      name: "requirement",
      shape: "identified",
      displayIdPattern: "REQ-{n:04d}",
      enforcement: "error",
    }),
  ]);
  // Display ID matches the pattern, so no enforcement violation can occur.
  const entries = [
    buildEntry({ displayId: "REQ-0001", shape: "identified" }),
  ];
  const result = classifyEntriesStage(entries, profile);
  assertEquals(result.diagnostics, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/validator/types_test.ts` Expected: the 7
new tests FAIL — `classifyEntriesStage` not exported.

- [ ] **Step 3: Implement `classifyEntriesStage`**

Append to `packages/markspec/core/validator/types.ts`:

```typescript
/** Result of running the classification stage over a batch of entries. */
export interface ClassifyStageResult {
  /** Entries with `type` set on successful classification. */
  readonly entries: readonly Entry[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Run classification across all entries. Produces new {@linkcode Entry}
 * objects with `type` set when classification succeeds; un-classified
 * entries pass through with `type` unchanged.
 *
 * Also emits {@linkcode MSL_T004} when a classified entry's display ID
 * violates the type's `display-id-pattern-enforcement` level.
 */
export function classifyEntriesStage(
  entries: readonly Entry[],
  profile: EffectiveProfile,
): ClassifyStageResult {
  const diagnostics: Diagnostic[] = [];
  const out: Entry[] = [];

  for (const entry of entries) {
    const classified = classifyEntry(entry, profile);
    diagnostics.push(...classified.diagnostics);

    if (classified.type !== undefined) {
      // Check enforcement (MSL-T004) when the type has a pattern.
      const typeEntry = profile.types.get(classified.type);
      if (typeEntry !== undefined) {
        const enforceDiag = checkEnforcement(entry, typeEntry);
        if (enforceDiag !== undefined) {
          diagnostics.push(enforceDiag);
        }
      }
      out.push({ ...entry, type: classified.type });
    } else {
      out.push(entry);
    }
  }

  return { entries: out, diagnostics };
}

/**
 * If the classified type declares a display-id-pattern and the entry's
 * display ID doesn't match it, emit an MSL-T004 at the configured severity.
 * Returns `undefined` when everything is fine or enforcement is `off`.
 */
function checkEnforcement(
  entry: Entry,
  typeEntry: ProvenancedMapEntry<EffectiveTypeDef>,
): Diagnostic | undefined {
  const pattern = typeEntry.value.displayIdPattern.value;
  if (pattern === undefined) return undefined;
  const level = typeEntry.value.displayIdPatternEnforcement.value;
  if (level === "off") return undefined;
  const regex = compileDisplayIdPattern(pattern);
  if (regex.test(entry.displayId)) return undefined;
  return {
    code: "MSL-T004",
    severity: level, // "warn" | "error" — both are valid Diagnostic severities
    message: `${entry.displayId}: display ID doesn't match pattern ` +
      `'${pattern}' for type '${typeEntry.value.name}'`,
    location: entry.location,
  };
}
```

Note: `Diagnostic.severity` is typed as `"error" | "warning" | "info"`.
`EnforcementMode` is `"off" | "warn" | "error"`. The word `warn` in enforcement
maps to `warning` in diagnostics — so the assignment `severity: level` above
won't type-check directly. Map explicitly:

Update the `checkEnforcement` return site:

```typescript
return {
  code: "MSL-T004",
  severity: level === "error" ? "error" : "warning",
  message: `${entry.displayId}: display ID doesn't match pattern ` +
    `'${pattern}' for type '${typeEntry.value.name}'`,
  location: entry.location,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/validator/types_test.ts` Expected: all 16
tests PASS (9 from Task 5.2 + 7 new).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/validator/types.ts packages/markspec/core/validator/types_test.ts
git commit -m "feat(core): classification stage with pattern enforcement"
```

---

## Task 5.4 — Pipeline runner

`runPipeline(entries, profile)` composes Stage 1 (existing `validate()`) + Stage
2 (`classifyEntriesStage`). Returns classified entries + all diagnostics + valid
flag.

**Files:**

- Create: `packages/markspec/core/validator/pipeline.ts`
- Create: `packages/markspec/core/validator/pipeline_test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/markspec/core/validator/pipeline_test.ts`:

```typescript
/**
 * @module core/validator/pipeline_test
 *
 * Integration tests for the pipeline runner composing Stages 1 + 2.
 */

import { assertEquals } from "@std/assert";
import { runPipeline } from "./pipeline.ts";
import type {
  EffectiveProfile,
  EffectiveTypeDef,
  Entry,
  EntryShape,
  ProvenancedMapEntry,
} from "../model/mod.ts";

function buildEntry(opts: {
  displayId: string;
  id?: string;
  shape: EntryShape;
  idKey?: string;
  typeAttribute?: string;
}): Entry {
  const attributes = [
    { key: opts.idKey ?? "Id", value: opts.id ?? "01HGW2Q8MNP3RSTVWXYZABCDEF" },
  ];
  if (opts.typeAttribute) {
    attributes.push({ key: "Type", value: opts.typeAttribute });
  }
  return {
    displayId: opts.displayId,
    id: opts.id ?? "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape,
    source: "markdown",
    attributes,
    location: { file: "t.md", line: 1, column: 1 },
  };
}

function buildProfileWithRequirement(): EffectiveProfile {
  const origin = "@test/p";
  const reqType: ProvenancedMapEntry<EffectiveTypeDef> = {
    value: {
      name: "requirement",
      shape: "identified",
      displayIdPattern: { value: "REQ-{n:04d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map(),
    },
    origin,
  };
  return {
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
}

Deno.test("runPipeline: null profile runs Stage 1 only, entries pass through unchanged", () => {
  const entries = [
    buildEntry({
      displayId: "REQ-0001",
      shape: "identified",
    }),
  ];
  const result = runPipeline(entries, null);
  assertEquals(result.entries[0].type, undefined);
  assertEquals(result.valid, true);
});

Deno.test("runPipeline: profile present runs Stage 2, entries classified", () => {
  const profile = buildProfileWithRequirement();
  const entries = [
    buildEntry({ displayId: "REQ-0001", shape: "identified" }),
  ];
  const result = runPipeline(entries, profile);
  assertEquals(result.entries[0].type, "requirement");
  assertEquals(result.valid, true);
});

Deno.test("runPipeline: Stage 1 error contributes to diagnostics + valid=false", () => {
  // Missing Id → Stage 1 MSL-R003.
  const entry: Entry = {
    displayId: "REQ-0001",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "identified",
    source: "markdown",
    attributes: [], // no Id attribute → MSL-R003
    location: { file: "t.md", line: 1, column: 1 },
  };
  const result = runPipeline([entry], null);
  const msl_r003 = result.diagnostics.find((d) => d.code === "MSL-R003");
  if (!msl_r003) {
    throw new Error(
      `expected MSL-R003, got: ${result.diagnostics.map((d) => d.code)}`,
    );
  }
  assertEquals(result.valid, false);
});

Deno.test("runPipeline: both stages contribute diagnostics independently", () => {
  const profile = buildProfileWithRequirement();
  // Missing Id AND display ID doesn't match the only type's pattern.
  const entry: Entry = {
    displayId: "FOO-001",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "identified",
    source: "markdown",
    attributes: [], // triggers MSL-R003 in Stage 1
    location: { file: "t.md", line: 1, column: 1 },
  };
  const result = runPipeline([entry], profile);
  const codes = new Set(result.diagnostics.map((d) => d.code));
  if (!codes.has("MSL-R003")) throw new Error("expected MSL-R003");
  if (!codes.has("MSL-T003")) throw new Error("expected MSL-T003");
  assertEquals(result.valid, false);
});

Deno.test("runPipeline: profile with zero types runs Stage 2 permissively", () => {
  const origin = "@test/p";
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
    types: new Map(), // empty
    documents: { types: new Map(), frontMatter: new Map() },
  };
  const entries = [
    buildEntry({ displayId: "FOO-001", shape: "identified" }),
  ];
  const result = runPipeline(entries, profile);
  // Empty types → permissive → no MSL-T003.
  const t003 = result.diagnostics.filter((d) => d.code === "MSL-T003");
  assertEquals(t003.length, 0);
  assertEquals(result.valid, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/validator/pipeline_test.ts` Expected:
FAIL — `runPipeline` not exported.

- [ ] **Step 3: Implement the runner**

Create `packages/markspec/core/validator/pipeline.ts`:

```typescript
/**
 * @module core/validator/pipeline
 *
 * Validator pipeline. Composes Stage 1 (core hygiene — existing `validate`)
 * with Stage 2 (type classification — {@linkcode classifyEntriesStage}).
 *
 * Subsequent phases will append Stage 3 (typed attribute validation) and
 * Stage 4 (traceability rules) to the same runner.
 */

import type { Diagnostic, EffectiveProfile, Entry } from "../model/mod.ts";
import { validate } from "./mod.ts";
import { classifyEntriesStage } from "./types.ts";

/** Result of running the full validator pipeline. */
export interface PipelineResult {
  /** Entries after classification — `type` set on those that classified. */
  readonly entries: readonly Entry[];
  readonly diagnostics: readonly Diagnostic[];
  /** `true` when no error-severity diagnostics were emitted. */
  readonly valid: boolean;
}

/**
 * Run the validator pipeline.
 *
 * - Stage 1 (always): core hygiene via {@linkcode validate}.
 * - Stage 2 (when `profile` is non-null): entry classification via
 *   {@linkcode classifyEntriesStage}.
 *
 * When `profile` is `null`, entries pass through unchanged (no `type`
 * assignments).
 */
export function runPipeline(
  entries: readonly Entry[],
  profile: EffectiveProfile | null,
): PipelineResult {
  const diagnostics: Diagnostic[] = [];

  // Stage 1 — core hygiene.
  const stage1 = validate(entries);
  diagnostics.push(...stage1.diagnostics);

  // Stage 2 — classification (only when a profile is loaded).
  let finalEntries: readonly Entry[] = entries;
  if (profile !== null) {
    const stage2 = classifyEntriesStage(entries, profile);
    finalEntries = stage2.entries;
    diagnostics.push(...stage2.diagnostics);
  }

  const valid = !diagnostics.some((d) => d.severity === "error");
  return { entries: finalEntries, diagnostics, valid };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/validator/pipeline_test.ts` Expected: all
5 tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `deno task test` Expected: all tests pass. Prior 414 + 7 pattern + 16
classify + 5 pipeline = 442 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/validator/pipeline.ts packages/markspec/core/validator/pipeline_test.ts
git commit -m "feat(core): validator pipeline runner (Stages 1 + 2)"
```

---

## Task 5.5 — CLI wiring + barrel exports

Swap `validate(entries)` for `runPipeline(entries, effective)` in `main.ts`
subcommands. Expose the runner through barrels.

**Files:**

- Modify: `packages/markspec/core/validator/mod.ts`
- Modify: `packages/markspec/core/mod.ts`
- Modify: `packages/markspec/main.ts`

- [ ] **Step 1: Extend `core/validator/mod.ts` with runner re-exports**

Append to `packages/markspec/core/validator/mod.ts` (keeping the existing
`validate` function and `ValidateResult` interface untouched):

```typescript
export { runPipeline } from "./pipeline.ts";
export type { PipelineResult } from "./pipeline.ts";

export { classifyEntriesStage, classifyEntry } from "./types.ts";
export type { ClassifyResult, ClassifyStageResult } from "./types.ts";

export { compileDisplayIdPattern } from "./pattern.ts";
```

- [ ] **Step 2: Re-export from `core/mod.ts`**

Open `packages/markspec/core/mod.ts`. Find the existing `Validator` or
validator-related export block. If `validate` is already re-exported, add
`runPipeline` alongside:

```typescript
export { runPipeline, validate } from "./validator/mod.ts";
export type { PipelineResult, ValidateResult } from "./validator/mod.ts";
```

(Adapt the existing block — don't duplicate. If the current re-exports are in
different blocks, match the file's style.)

- [ ] **Step 3: Wire `runPipeline` into `main.ts validate` command**

In `packages/markspec/main.ts`, find the `validate` subcommand's action. It
currently does something like:

```typescript
const { parseFile, validate } = await import("./core/mod.ts");
// ... collect entries ...
const result = validate(allEntries);
```

Replace the import + call:

```typescript
const { parseFile, runPipeline } = await import("./core/mod.ts");
// ... collect entries ...

// Load active profile (already wired; may return null).
const { discoverProjectRoot } = await import("./core/mod.ts");
const projectRoot = await discoverProjectRoot(Deno.cwd(), readFile);
const profile = projectRoot ? await loadActiveProfile(projectRoot) : null;

const result = runPipeline(allEntries, profile?.effective ?? null);
```

Note: `loadActiveProfile` is already defined in main.ts (Phase 2 Task 2.8). It
returns `ProfileChain | null`. Use `profile?.effective` (the `EffectiveProfile`)
as the second arg to `runPipeline`.

Read the existing action handler first to understand exactly how it collects
entries, diagnostics, and exit codes. Minimal rule: wherever
`result.diagnostics` is consumed, keep it. Wherever `result.valid` is consumed,
keep it. Only the call itself changes.

- [ ] **Step 4: Wire `runPipeline` into `compile` via `compileProject` helper**

`compileProject` in main.ts doesn't currently run the validator — it calls
`compile(paths)` from core. Compile's own internal pipeline is orthogonal; Phase
5 doesn't require touching it. Skip this step unless the `compile` action
explicitly calls `validate(entries)`.

Verify by `grep -n "validate(" packages/markspec/main.ts`. If no matches inside
the `compile` handler, leave it alone.

- [ ] **Step 5: Type-check**

Run: `deno task check` Expected: clean.

- [ ] **Step 6: Run full test suite**

Run: `deno task test` Expected: all tests pass (no existing e2e test should
break because the only project-level effect is: with no `.markspec.yaml`,
profile is null, pipeline behaves exactly like `validate` alone).

- [ ] **Step 7: Commit**

```bash
git add packages/markspec/core/validator/mod.ts packages/markspec/core/mod.ts packages/markspec/main.ts
git commit -m "feat(cli): use runPipeline in validate command"
```

---

## Task 5.6 — E2E fixture + tests

Write an end-to-end test that exercises the full stack: `.markspec.yaml` → local
profile with types + patterns → `markspec validate` against entries that hit
each classification outcome.

**Files:**

- Create: `tests/fixtures/profiles/phase5/typed/markspec.yaml`
- Create: `tests/e2e/profile_types_test.ts`

- [ ] **Step 1: Create the fixture profile**

Create `tests/fixtures/profiles/phase5/typed/markspec.yaml`:

```yaml
id: "@acme/phase5-typed"
version: 0.1.0
description: Phase 5 e2e — profile with typed entries
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: error
    note:
      shape: identified
      display-id-pattern: "NOTE-{n:03d}"
      display-id-pattern-enforcement: off
```

- [ ] **Step 2: Write the e2e tests**

Create `tests/e2e/profile_types_test.ts`:

```typescript
/**
 * @module tests/e2e/profile_types_test
 *
 * E2E tests for validator Stage 2 — entry classification through
 * `markspec validate`.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: phase5-e2e\nversion: 0.1.0\n`;

const PROFILE_YAML = `id: "@acme/phase5-typed"
version: 0.1.0
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: error
    note:
      shape: identified
      display-id-pattern: "NOTE-{n:03d}"
      display-id-pattern-enforcement: off
`;

Deno.test("profile types e2e: entry matching REQ pattern classifies cleanly", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/typed\n`,
      "profiles/typed/markspec.yaml": PROFILE_YAML,
      "req.md": `# Example

- [REQ-0001] A requirement

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
`,
    },
  });
  assertEquals(code, 0);
  const msl_t = stderr.split("\n").filter((l) => l.includes("MSL-T"));
  assertEquals(msl_t, []);
});

Deno.test("profile types e2e: un-classified entry emits MSL-T003", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/typed\n`,
      "profiles/typed/markspec.yaml": PROFILE_YAML,
      "req.md": `# Example

- [FOO-001] An entry with no matching type

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-T003");
});

Deno.test("profile types e2e: explicit Type: attribute overrides display-ID inference", async () => {
  const { code } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/typed\n`,
      "profiles/typed/markspec.yaml": PROFILE_YAML,
      "req.md": `# Example

- [FOO-001] Explicitly typed as note

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  Type: note
`,
    },
  });
  // note has enforcement=off, so FOO-001 as note doesn't trigger MSL-T004.
  assertEquals(code, 0);
});

Deno.test("profile types e2e: explicit Type: unknown value emits MSL-T001", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/typed\n`,
      "profiles/typed/markspec.yaml": PROFILE_YAML,
      "req.md": `# Example

- [REQ-0001] Unknown type

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  Type: bogus
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-T001");
});

Deno.test("profile types e2e: pattern-enforcement=error + mismatch emits MSL-T004 error", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": `profiles:\n  - ./profiles/typed\n`,
      "profiles/typed/markspec.yaml": PROFILE_YAML,
      "req.md": `# Example

- [FOO-001] Requirement via explicit Type: but wrong display-ID form

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  Type: requirement
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-T004");
});

Deno.test("profile types e2e: no .markspec.yaml — core-only mode, no MSL-T diagnostics", async () => {
  const { code, stderr } = await markspec(["validate", "req.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "req.md": `# Example

- [FOO-001] An entry

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
`,
    },
  });
  assertEquals(code, 0);
  const msl_t = stderr.split("\n").filter((l) => l.includes("MSL-T"));
  assertEquals(msl_t, []);
});
```

- [ ] **Step 3: Run the e2e tests**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/profile_types_test.ts`
Expected: all 6 tests pass.

Debugging tips if any fail:

- If test 1 reports MSL-T004 unexpectedly, the fixture's
  `display-id-pattern-enforcement: error` + a matching display ID should NOT
  trigger T004. Double-check the pattern and the classifier's `checkEnforcement`
  skipping when the pattern matches.
- If test 3 reports MSL-T003 or MSL-T004, the `note` type's `enforcement: off`
  should silence T004 for non-matching display IDs, and the explicit `Type:`
  should prevent the T003 path.
- If test 6 reports MSL-T003, main.ts may not be correctly passing `null` for
  the profile when `.markspec.yaml` is absent.

- [ ] **Step 4: Run the full test suite**

Run: `deno task test` Expected: all tests pass. Grand total ~448 (442
unit/integration + 6 e2e).

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/profiles/phase5/typed/markspec.yaml tests/e2e/profile_types_test.ts
git commit -m "test(core): e2e coverage for validator Stage 2 classification"
```

---

## Phase 5 acceptance

All tasks checked, all commits on `feat/profile-system-phase-5`,
`deno task test` green, `deno task check` clean. Classifier covers:

- Display-ID pattern compilation (`{n}` and `{n:NNd}` forms, multi-segment
  prefixes, anchored, metachars escaped).
- Explicit `Type:` trailer attribute (overrides pattern inference; unknown value
  → MSL-T001).
- Display-ID pattern matching (0 / 1 / many match paths; MSL-T002 for
  ambiguity).
- Strict mode enforcement (MSL-T003 when any types declared and no match).
- Permissive mode (zero types declared → no MSL-T003 emission).
- Display-ID pattern enforcement level (`off` / `warn` / `error` → no diag /
  warning / error).
- Shape filter — only types with the same shape as the entry are considered.
- Pipeline runner composing Stage 1 + Stage 2; profile=null path equivalent to
  old `validate()`.
- CLI `validate` subcommand calls `runPipeline` with the loaded profile.
- E2E fixtures demonstrate classification outcomes through the real CLI.

This PR lights up the first half of the validator pipeline. Phase 6 adds typed
attribute validation (`MSL-A00*`); Phase 7 adds traceability rules (`MSL-L00*`).
Both reuse the pipeline infrastructure added here.

---

## Self-review

**Spec coverage (§5.1 – §5.3):**

- ✅ §5.1 pipeline stage contract — implemented as
  `runPipeline(entries, profile)` returning classified entries + diagnostics.
- ✅ §5.3 type classification logic (Type trailer → pattern → ambiguity → strict
  → MSL-T001/2/3/4) — all four codes present.
- ✅ §5.3 display-id-pattern enforcement (off/warn/error) — handled in
  `checkEnforcement`.
- ✅ Shape filter — classifier only considers types whose
  `shape === entry.shape`.
- ✅ Permissive mode — when `profile.types` is empty, no MSL-T003 emitted (spec
  §5.3 strict rule requires ≥1 declared type).

**Placeholder scan:** None. Every TDD cycle has complete code blocks.

**Type consistency:** `classifyEntry`, `classifyEntriesStage`, `runPipeline`,
`PipelineResult`, `ClassifyResult`, `ClassifyStageResult` — all consistent
across tasks. `Entry.type` already exists in the model (confirmed; no model
change needed).

**Known small caveats:**

- `classifyEntry` compiles patterns inline per entry. For large entry sets this
  recompiles the same regex repeatedly. Acceptable for v1; if profile
  performance becomes a concern, cache compiled patterns keyed by type name.
  Left as a future optimization.
- `classifyEntry` throws if a profile's pattern fails to compile (invalid
  template). In practice manifests are validated at load time, so this should be
  unreachable — but worth a defensive try/catch once we have profiles with
  malformed patterns. Not a Phase 5 blocker.

**Scope check:** Single subsystem (validator Stage 2 + pipeline scaffolding). No
compiler/parser/profile-system changes. Fits one PR.

---

## Execution handoff

Plan complete and saved to
`docs/superpowers/plans/2026-04-22-adr-008-profile-system-v1-phase-5.md`. Two
execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task,
   review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans,
   batch execution with checkpoints.

Which approach?
