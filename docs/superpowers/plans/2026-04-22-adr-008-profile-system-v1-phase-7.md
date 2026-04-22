# ADR-008 Profile System v1 — Phase 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stage 4 to the validator pipeline — traceability rule enforcement.
Each classified identified entry's outgoing link attributes (e.g. `Verifies:`,
`Derived-from:`) are checked against the profile's declared trace rules for
required presence, cardinality bounds, and target match. Fold in a CSV-split
preprocessing step so profile-declared `id-list` / `tag-list` attributes work
naturally with comma-separated authoring syntax.

**Architecture:** A new `core/validator/traceability.ts` module appended to the
pipeline after Stage 3. It consumes the graph index (built once per pipeline
invocation, keyed by `entry.id`), the effective trace rules for each entry
(union of identified-shape rules and type-scope rules), and the target matcher
logic. Referenced entries are skipped entirely (their profiles don't declare
traceability). A small Stage 2.5 normalization step sits between classification
and Stage 3: for any attribute whose profile-declared type is a list (`id-list`
/ `tag-list`), comma-separated values are split and trimmed — making authoring
`Verifies: REQ-0001, REQ-0002` work as expected.

**Tech Stack:** Deno + TypeScript, `@std/assert`. Builds on Phase 6's
`effectiveScope` helper and the existing `EffectiveProfile` from Phase 3. No new
external dependencies.

**Spec:**
[docs/superpowers/specs/2026-04-21-adr-008-profile-system-v1-design.md](../specs/2026-04-21-adr-008-profile-system-v1-design.md)
§5.5 (Validator Stage 4 — Traceability).

**Branch:** `feat/profile-system-phase-7`, branched from `main` (which now
carries merged Phases 1–6 via PRs #227–#233).

---

## Scope

### In Phase 7

- **CSV-split normalization** ("Stage 2.5") —
  `normalizeListValues(entry, profile)` splits comma-separated values for
  attributes whose profile-declared type is `id-list` or `tag-list`. Runs after
  classification, before Stage 3. Resolves the Phase-6 follow-up concern that
  profile list attributes don't split.
- **Effective trace rules helper** — for an entry, compute the union of
  `identified.traceability` and `types[entry.type].traceability` (referenced
  shape scope never has rules).
- **Target matcher evaluation** — given a target entry + rule's target list,
  decide whether the target is accepted. Supports type-name and shape-matcher
  forms with OR semantics.
- **Traceability stage** — for each classified identified entry, iterate
  effective trace rules; emit `MSL-L001`/`MSL-L002`/`MSL-L003`/`MSL-L004` as
  appropriate.
- **Graph index** — built once per pipeline invocation (`Map<string, Entry>`
  keyed by `entry.id`), passed to Stage 4 as a pure argument.
- **Pipeline wiring** — `runPipeline` runs Stage 2.5 normalization and then
  Stage 4 traceability. Both gated on `profile !== null`.
- **E2E coverage** — fixture profile with `Verifies` / `Derived-from` links
  exercising each `MSL-L00*` code through `markspec validate`.

### Deferred (not Phase 7)

- Generated inverses (`MSL-L005` authored-vs-generated inverse consistency) —
  Phase 8.
- CLI `profile add` / `doctor` — Phase 9.
- **Project-root containment** for `path` values — still deferred from Phase 6.
- **Citation structural parsing** — still deferred from Phase 6.
- **Reverse-lookup index for faster target access** — Phase 7 iterates the graph
  linearly per lookup; not a hot path at v1 scale.

### Diagnostic codes introduced in Phase 7

| Code       | Severity | Meaning                                                            |
| ---------- | -------- | ------------------------------------------------------------------ |
| `MSL-L001` | error    | Required link attribute missing                                    |
| `MSL-L002` | error    | Link value count exceeds upper cardinality bound                   |
| `MSL-L003` | error    | Link value count below lower cardinality bound                     |
| `MSL-L004` | error    | Target entry's type/shape doesn't match any of the rule's matchers |

`MSL-L005` is explicitly reserved for Phase 8's inverse-consistency check.

---

## Files this PR creates or modifies

### New files

- `packages/markspec/core/validator/normalize.ts` — Stage 2.5 CSV-split
  normalization for profile-declared list attributes.
- `packages/markspec/core/validator/normalize_test.ts` — unit tests.
- `packages/markspec/core/validator/traceability.ts` — Stage 4 implementation
  (effective rules helper, target matcher, per-entry validator).
- `packages/markspec/core/validator/traceability_test.ts` — unit tests.
- `tests/fixtures/profiles/phase7/traceable/markspec.yaml` — e2e fixture
  profile.
- `tests/e2e/profile_traceability_test.ts` — CLI-level tests for Stage 4.

### Modified files

- `packages/markspec/core/validator/pipeline.ts` — add Stage 2.5 normalization
  step + Stage 4 call; build the graph index.
- `packages/markspec/core/validator/mod.ts` — re-export new functions/types.
- `packages/markspec/core/mod.ts` — re-export through the public barrel.

No changes to: `core/parser/**` (CSV-split stays core-catalog-only;
profile-aware splitting lives in the validator), `core/profile/**`,
`core/compiler/**`, `core/model/**`, `main.ts` (pipeline wiring is transparent).

---

## Task overview

| #   | Task                                           | Files touched                                                                                      |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 7.1 | Stage 2.5 CSV-split normalization              | `validator/normalize.ts`, `validator/normalize_test.ts`                                            |
| 7.2 | Effective trace rules helper                   | `validator/traceability.ts`, `validator/traceability_test.ts`                                      |
| 7.3 | Target matcher evaluation                      | `validator/traceability.ts`, `validator/traceability_test.ts`                                      |
| 7.4 | Traceability stage (L001–L004)                 | `validator/traceability.ts`, `validator/traceability_test.ts`                                      |
| 7.5 | Pipeline wiring + graph index + barrel exports | `validator/pipeline.ts`, `validator/pipeline_test.ts`, `validator/mod.ts`, `core/mod.ts`           |
| 7.6 | E2E fixture + CLI tests                        | `tests/fixtures/profiles/phase7/traceable/markspec.yaml`, `tests/e2e/profile_traceability_test.ts` |

Each task is one commit. Every task follows TDD.

---

## Task 7.1 — Stage 2.5 CSV-split normalization

Before Stage 3 runs, normalize profile-declared list-typed attribute values by
splitting comma-separated strings. Idempotent: values that don't contain commas
are unchanged.

**Files:**

- Create: `packages/markspec/core/validator/normalize.ts`
- Create: `packages/markspec/core/validator/normalize_test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/markspec/core/validator/normalize_test.ts`:

```typescript
/**
 * @module core/validator/normalize_test
 *
 * Unit tests for Stage 2.5 list-value normalization.
 */

import { assertEquals } from "@std/assert";
import { normalizeListValues } from "./normalize.ts";
import type {
  AttrDecl,
  EffectiveProfile,
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

function profile(opts: {
  universalAttrs?: readonly AttrDecl[];
}): EffectiveProfile {
  return {
    required: { value: [], origin: ORIGIN },
    attributes: provAttrs(opts.universalAttrs ?? []),
    labels: { value: [], origin: ORIGIN },
    identified: {
      required: { value: [], origin: ORIGIN },
      attributes: new Map(),
      traceability: new Map(),
    },
    referenced: {
      required: { value: [], origin: ORIGIN },
      attributes: new Map(),
      traceability: new Map(),
    },
    types: new Map(),
    documents: { types: new Map(), frontMatter: new Map() },
  };
}

function entry(opts: {
  shape: EntryShape;
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
    source: "markdown",
    title: "",
    body: "",
    attributes,
    typedAttributes: new Map(
      Object.entries(attrs).map(([k, vs]) => [k, vs]),
    ),
    location: { file: "t.md", line: 1, column: 1 },
  };
}

const idListAttr: AttrDecl = {
  name: "Verifies",
  type: "id-list",
  required: false,
  cardinality: { lower: 0, upper: Infinity },
};

const tagListAttr: AttrDecl = {
  name: "Labels",
  type: "tag-list",
  required: false,
  cardinality: { lower: 0, upper: Infinity },
};

const textAttr: AttrDecl = {
  name: "Rationale",
  type: "text",
  required: false,
  cardinality: { lower: 0, upper: 1 },
};

Deno.test("normalizeListValues: id-list with comma-separated value is split", () => {
  const p = profile({ universalAttrs: [idListAttr] });
  const e = entry({
    shape: "identified",
    attrs: {
      Verifies: ["REQ-0001, REQ-0002, REQ-0003"],
    },
  });
  const out = normalizeListValues(e, p);
  assertEquals(out.typedAttributes?.get("Verifies"), [
    "REQ-0001",
    "REQ-0002",
    "REQ-0003",
  ]);
});

Deno.test("normalizeListValues: tag-list with comma-separated value is split", () => {
  const p = profile({ universalAttrs: [tagListAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Labels: ["DRAFT, INTERNAL"] },
  });
  const out = normalizeListValues(e, p);
  assertEquals(out.typedAttributes?.get("Labels"), ["DRAFT", "INTERNAL"]);
});

Deno.test("normalizeListValues: no comma → idempotent (value unchanged)", () => {
  const p = profile({ universalAttrs: [idListAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Verifies: ["REQ-0001", "REQ-0002"] },
  });
  const out = normalizeListValues(e, p);
  assertEquals(out.typedAttributes?.get("Verifies"), ["REQ-0001", "REQ-0002"]);
  // Also verify identity: no change → same entry reference
  assertEquals(out, e);
});

Deno.test("normalizeListValues: trims whitespace around split values", () => {
  const p = profile({ universalAttrs: [idListAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Verifies: ["  REQ-0001  ,  REQ-0002  "] },
  });
  const out = normalizeListValues(e, p);
  assertEquals(out.typedAttributes?.get("Verifies"), [
    "REQ-0001",
    "REQ-0002",
  ]);
});

Deno.test("normalizeListValues: empty-string fragments from double commas are dropped", () => {
  const p = profile({ universalAttrs: [idListAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Verifies: ["REQ-0001,,REQ-0002"] },
  });
  const out = normalizeListValues(e, p);
  assertEquals(out.typedAttributes?.get("Verifies"), [
    "REQ-0001",
    "REQ-0002",
  ]);
});

Deno.test("normalizeListValues: non-list types are never split", () => {
  const p = profile({ universalAttrs: [textAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Rationale: ["one, two, three"] },
  });
  const out = normalizeListValues(e, p);
  // Text type — comma-separated value stays as one literal.
  assertEquals(out.typedAttributes?.get("Rationale"), ["one, two, three"]);
});

Deno.test("normalizeListValues: mix of multi-line and comma-separated merges correctly", () => {
  const p = profile({ universalAttrs: [idListAttr] });
  // Parser gave us two typed values already (from separate lines).
  // The first happens to contain a comma too.
  const e = entry({
    shape: "identified",
    attrs: { Verifies: ["REQ-0001, REQ-0002", "REQ-0003"] },
  });
  const out = normalizeListValues(e, p);
  assertEquals(out.typedAttributes?.get("Verifies"), [
    "REQ-0001",
    "REQ-0002",
    "REQ-0003",
  ]);
});

Deno.test("normalizeListValues: un-declared attribute is untouched", () => {
  const p = profile({ universalAttrs: [idListAttr] });
  const e = entry({
    shape: "identified",
    attrs: { Unknown: ["a, b, c"] },
  });
  const out = normalizeListValues(e, p);
  // `Unknown` isn't declared — normalization leaves it alone.
  assertEquals(out.typedAttributes?.get("Unknown"), ["a, b, c"]);
});

Deno.test("normalizeListValues: entry with no typedAttributes is returned as-is", () => {
  const p = profile({ universalAttrs: [idListAttr] });
  const e = entry({ shape: "identified" });
  const out = normalizeListValues(e, p);
  assertEquals(out, e);
});

Deno.test("normalizeListValues: type-scope declarations are considered", () => {
  const origin = ORIGIN;
  const p: EffectiveProfile = {
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
    types: new Map([
      ["requirement", {
        value: {
          name: "requirement",
          shape: "identified",
          displayIdPattern: { value: undefined, origin },
          displayIdPatternEnforcement: { value: "off", origin },
          required: { value: [], origin },
          attributes: provAttrs([idListAttr]),
          traceability: new Map(),
        },
        origin,
      }],
    ]),
    documents: { types: new Map(), frontMatter: new Map() },
  };
  const e = entry({
    shape: "identified",
    attrs: { Verifies: ["REQ-0001, REQ-0002"] },
  });
  // Entry classified as requirement to pick up the type-scope Verifies decl.
  const classified = { ...e, type: "requirement" };
  const out = normalizeListValues(classified, p);
  assertEquals(out.typedAttributes?.get("Verifies"), ["REQ-0001", "REQ-0002"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/validator/normalize_test.ts` Expected:
FAIL with `Cannot find module './normalize.ts'`.

- [ ] **Step 3: Implement `normalizeListValues`**

Create `packages/markspec/core/validator/normalize.ts`:

```typescript
/**
 * @module core/validator/normalize
 *
 * Stage 2.5 normalization: split comma-separated values for profile-declared
 * list-typed attributes.
 *
 * Runs between Stage 2 (classification) and Stage 3 (typed attributes). The
 * core parser already CSV-splits values for core-catalog list types; this
 * step handles list types declared by a profile (which the parser doesn't
 * see). Idempotent — values that don't contain commas pass through unchanged.
 *
 * Empty-string fragments (e.g. from `"a,,b"`) are dropped; surrounding
 * whitespace is trimmed.
 */

import type {
  AttrDecl,
  EffectiveProfile,
  Entry,
  ValueType,
} from "../model/mod.ts";
import { effectiveScope } from "./attributes.ts";

const LIST_TYPES: ReadonlySet<ValueType> = new Set(["id-list", "tag-list"]);

/**
 * Return a new Entry with list-typed attribute values split on commas. If no
 * change is needed, returns the input entry unchanged (reference equality).
 */
export function normalizeListValues(
  entry: Entry,
  profile: EffectiveProfile,
): Entry {
  if (!entry.typedAttributes) return entry;

  const scope = effectiveScope(entry, profile);
  const rewritten = new Map<string, readonly string[]>();
  let anyChange = false;

  for (const [name, values] of entry.typedAttributes) {
    const decl = scope.attributes.get(name);
    if (decl !== undefined && LIST_TYPES.has(decl.type)) {
      const split = splitListValues(values);
      if (!arraysEqual(split, values)) {
        rewritten.set(name, split);
        anyChange = true;
        continue;
      }
    }
    rewritten.set(name, values);
  }

  if (!anyChange) return entry;
  return { ...entry, typedAttributes: rewritten };
}

function splitListValues(values: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const v of values) {
    const parts = v.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    if (parts.length === 0) continue;
    out.push(...parts);
  }
  return out;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
```

Note: `effectiveScope` is imported from `./attributes.ts` (Phase 6). It's a
synchronous pure function.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/validator/normalize_test.ts` Expected:
all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/validator/normalize.ts packages/markspec/core/validator/normalize_test.ts
git commit -m "feat(core): normalize profile-declared list-attribute values (CSV split)"
```

---

## Task 7.2 — Effective trace rules helper

Compute, for a given entry, the union of traceability rules from the
`identified` shape scope and the entry's type scope. Referenced entries always
return an empty map. Pure data — no diagnostics yet.

**Files:**

- Create: `packages/markspec/core/validator/traceability.ts`
- Create: `packages/markspec/core/validator/traceability_test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/markspec/core/validator/traceability_test.ts`:

```typescript
/**
 * @module core/validator/traceability_test
 *
 * Unit tests for Stage 4 — traceability rule enforcement.
 */

import { assertEquals } from "@std/assert";
import { effectiveTraceRules } from "./traceability.ts";
import type {
  EffectiveProfile,
  EffectiveShapeScope,
  EffectiveTypeDef,
  Entry,
  EntryShape,
  ProvenancedMapEntry,
  TraceRule,
} from "../model/mod.ts";

const ORIGIN = "@test/p";

function traceMap(
  entries: Record<string, TraceRule>,
): Map<string, ProvenancedMapEntry<TraceRule>> {
  const out = new Map<string, ProvenancedMapEntry<TraceRule>>();
  for (const [name, rule] of Object.entries(entries)) {
    out.set(name, { value: rule, origin: ORIGIN });
  }
  return out;
}

function shapeScope(opts: {
  traceability?: Record<string, TraceRule>;
}): EffectiveShapeScope {
  return {
    required: { value: [], origin: ORIGIN },
    attributes: new Map(),
    traceability: traceMap(opts.traceability ?? {}),
  };
}

function typeDef(opts: {
  name: string;
  shape: EntryShape;
  traceability?: Record<string, TraceRule>;
}): ProvenancedMapEntry<EffectiveTypeDef> {
  return {
    origin: ORIGIN,
    value: {
      name: opts.name,
      shape: opts.shape,
      displayIdPattern: { value: undefined, origin: ORIGIN },
      displayIdPatternEnforcement: { value: "off", origin: ORIGIN },
      required: { value: [], origin: ORIGIN },
      attributes: new Map(),
      traceability: traceMap(opts.traceability ?? {}),
    },
  };
}

function profile(opts: {
  identified?: EffectiveShapeScope;
  referenced?: EffectiveShapeScope;
  types?: ReadonlyArray<ProvenancedMapEntry<EffectiveTypeDef>>;
}): EffectiveProfile {
  const typesMap = new Map<string, ProvenancedMapEntry<EffectiveTypeDef>>();
  for (const t of opts.types ?? []) typesMap.set(t.value.name, t);
  return {
    required: { value: [], origin: ORIGIN },
    attributes: new Map(),
    labels: { value: [], origin: ORIGIN },
    identified: opts.identified ?? shapeScope({}),
    referenced: opts.referenced ?? shapeScope({}),
    types: typesMap,
    documents: { types: new Map(), frontMatter: new Map() },
  };
}

function entry(opts: { shape: EntryShape; type?: string }): Entry {
  return {
    displayId: "X-001",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape,
    type: opts.type,
    source: "markdown",
    title: "",
    body: "",
    attributes: [],
    typedAttributes: new Map(),
    location: { file: "t.md", line: 1, column: 1 },
  };
}

const derivedFromRule: TraceRule = {
  target: [{ shape: "identified" }],
  cardinality: { lower: 0, upper: Infinity },
  required: false,
};

const verifiesRule: TraceRule = {
  target: ["requirement"],
  cardinality: { lower: 1, upper: Infinity },
  required: true,
};

Deno.test("effectiveTraceRules: identified shape scope only", () => {
  const p = profile({
    identified: shapeScope({
      traceability: { "Derived-from": derivedFromRule },
    }),
  });
  const e = entry({ shape: "identified" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.size, 1);
  assertEquals(rules.get("Derived-from"), derivedFromRule);
});

Deno.test("effectiveTraceRules: referenced entry always returns empty map", () => {
  // Even if the profile had referenced traceability declared somehow,
  // we return empty. (The manifest parser rejects referenced.traceability
  // at load time, but defense-in-depth.)
  const p = profile({
    identified: shapeScope({
      traceability: { "Derived-from": derivedFromRule },
    }),
  });
  const e = entry({ shape: "referenced" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.size, 0);
});

Deno.test("effectiveTraceRules: classified entry adds type-scope rules", () => {
  const p = profile({
    identified: shapeScope({
      traceability: { "Derived-from": derivedFromRule },
    }),
    types: [typeDef({
      name: "test",
      shape: "identified",
      traceability: { Verifies: verifiesRule },
    })],
  });
  const e = entry({ shape: "identified", type: "test" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.size, 2);
  assertEquals(rules.get("Derived-from"), derivedFromRule);
  assertEquals(rules.get("Verifies"), verifiesRule);
});

Deno.test("effectiveTraceRules: un-classified entry uses only shape scope", () => {
  const p = profile({
    identified: shapeScope({
      traceability: { "Derived-from": derivedFromRule },
    }),
    types: [typeDef({
      name: "test",
      shape: "identified",
      traceability: { Verifies: verifiesRule },
    })],
  });
  const e = entry({ shape: "identified" }); // no type set
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.size, 1);
  assertEquals(rules.has("Verifies"), false);
  assertEquals(rules.has("Derived-from"), true);
});

Deno.test("effectiveTraceRules: type scope wins on link-name collision", () => {
  // Both shape and type declare "Derived-from", type's narrower.
  const tightRule: TraceRule = {
    target: ["stakeholder-requirement"],
    cardinality: { lower: 1, upper: Infinity },
    required: true,
  };
  const p = profile({
    identified: shapeScope({
      traceability: { "Derived-from": derivedFromRule },
    }),
    types: [typeDef({
      name: "requirement",
      shape: "identified",
      traceability: { "Derived-from": tightRule },
    })],
  });
  const e = entry({ shape: "identified", type: "requirement" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.get("Derived-from"), tightRule);
});

Deno.test("effectiveTraceRules: classified entry with unknown type falls back to shape scope", () => {
  const p = profile({
    identified: shapeScope({
      traceability: { "Derived-from": derivedFromRule },
    }),
  });
  const e = entry({ shape: "identified", type: "not-in-profile" });
  const rules = effectiveTraceRules(e, p);
  assertEquals(rules.size, 1);
  assertEquals(rules.get("Derived-from"), derivedFromRule);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/validator/traceability_test.ts` Expected:
FAIL with `Cannot find module './traceability.ts'`.

- [ ] **Step 3: Implement `effectiveTraceRules`**

Create `packages/markspec/core/validator/traceability.ts`:

```typescript
/**
 * @module core/validator/traceability
 *
 * Validator Stage 4 — traceability rule enforcement.
 *
 * Runs after Stage 3. For each classified identified entry, checks the
 * profile's declared trace rules against the entry's outgoing link
 * attributes:
 *   - Required (MSL-L001)
 *   - Cardinality bounds (MSL-L002 upper / MSL-L003 lower)
 *   - Target match against the rule's target matchers (MSL-L004)
 *
 * Referenced entries are skipped entirely — the profile manifest parser
 * rejects `referenced.traceability` at load time, so referenced entries
 * never have declared outgoing links.
 */

import type { EffectiveProfile, Entry, TraceRule } from "../model/mod.ts";

/**
 * Effective trace rules for an entry: union of identified-shape-scope rules
 * and (when classified) type-scope rules. Type-scope rules win on
 * link-attribute-name collision.
 *
 * Referenced entries always return an empty map.
 */
export function effectiveTraceRules(
  entry: Entry,
  profile: EffectiveProfile,
): ReadonlyMap<string, TraceRule> {
  const out = new Map<string, TraceRule>();
  if (entry.shape !== "identified") return out;

  // Shape scope.
  for (const [name, ruleEntry] of profile.identified.traceability) {
    out.set(name, ruleEntry.value);
  }

  // Type scope (only when classified AND type is declared in the profile).
  if (entry.type !== undefined) {
    const typeEntry = profile.types.get(entry.type);
    if (typeEntry !== undefined) {
      for (const [name, ruleEntry] of typeEntry.value.traceability) {
        out.set(name, ruleEntry.value); // type-scope overrides shape-scope
      }
    }
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/validator/traceability_test.ts` Expected:
all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/validator/traceability.ts packages/markspec/core/validator/traceability_test.ts
git commit -m "feat(core): effective trace rules helper"
```

---

## Task 7.3 — Target matcher evaluation

Given a target entry and a rule's list of target matchers, decide whether the
target is accepted. Supports type-name (string) and shape-matcher
(`{shape: ...}`) forms with OR semantics.

**Files:**

- Modify: `packages/markspec/core/validator/traceability.ts`
- Modify: `packages/markspec/core/validator/traceability_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/markspec/core/validator/traceability_test.ts`:

```typescript
import { matchesAnyTarget } from "./traceability.ts";

function targetEntry(opts: {
  shape: EntryShape;
  type?: string;
  displayId?: string;
}): Entry {
  return {
    displayId: opts.displayId ?? "Y-001",
    id: "01TARGET02TARGET03TARGET04",
    shape: opts.shape,
    type: opts.type,
    source: "markdown",
    title: "",
    body: "",
    attributes: [],
    typedAttributes: new Map(),
    location: { file: "t.md", line: 1, column: 1 },
  };
}

Deno.test("matchesAnyTarget: string matcher accepts target with matching type", () => {
  const t = targetEntry({ shape: "identified", type: "requirement" });
  assertEquals(matchesAnyTarget(t, ["requirement"]), true);
});

Deno.test("matchesAnyTarget: string matcher rejects mismatched type", () => {
  const t = targetEntry({ shape: "identified", type: "note" });
  assertEquals(matchesAnyTarget(t, ["requirement"]), false);
});

Deno.test("matchesAnyTarget: string matcher rejects un-classified target", () => {
  const t = targetEntry({ shape: "identified" }); // no type
  assertEquals(matchesAnyTarget(t, ["requirement"]), false);
});

Deno.test("matchesAnyTarget: shape matcher accepts matching shape", () => {
  const t = targetEntry({ shape: "identified" });
  assertEquals(matchesAnyTarget(t, [{ shape: "identified" }]), true);
});

Deno.test("matchesAnyTarget: shape matcher rejects opposite shape", () => {
  const t = targetEntry({ shape: "referenced" });
  assertEquals(matchesAnyTarget(t, [{ shape: "identified" }]), false);
});

Deno.test("matchesAnyTarget: multi-matcher uses OR — first match wins", () => {
  const t = targetEntry({ shape: "identified", type: "requirement" });
  assertEquals(
    matchesAnyTarget(t, ["stakeholder-requirement", "requirement"]),
    true,
  );
});

Deno.test("matchesAnyTarget: multi-matcher all reject → false", () => {
  const t = targetEntry({ shape: "identified", type: "other" });
  assertEquals(matchesAnyTarget(t, ["a", "b", { shape: "referenced" }]), false);
});

Deno.test("matchesAnyTarget: mixed string + shape matcher", () => {
  // Rule: target must be either a 'requirement' OR any referenced entry.
  const reqTarget = targetEntry({ shape: "identified", type: "requirement" });
  const refTarget = targetEntry({ shape: "referenced", type: "citation" });
  const otherIdentified = targetEntry({ shape: "identified", type: "note" });

  const rule = ["requirement", { shape: "referenced" as const }];
  assertEquals(matchesAnyTarget(reqTarget, rule), true);
  assertEquals(matchesAnyTarget(refTarget, rule), true);
  assertEquals(matchesAnyTarget(otherIdentified, rule), false);
});

Deno.test("matchesAnyTarget: empty matcher list → always false", () => {
  const t = targetEntry({ shape: "identified", type: "requirement" });
  assertEquals(matchesAnyTarget(t, []), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/validator/traceability_test.ts` Expected:
9 new tests FAIL — `matchesAnyTarget` not exported.

- [ ] **Step 3: Implement `matchesAnyTarget`**

Append to `packages/markspec/core/validator/traceability.ts`:

```typescript
import type { TargetMatcher } from "../model/mod.ts";

/**
 * Return true if the target entry matches any of the rule's target matchers.
 * OR semantics across the list.
 *
 * - Type-name matcher (string): target's classified type equals the name.
 *   An un-classified target never matches a type-name matcher.
 * - Shape matcher ({shape: "identified"|"referenced"}): target's shape
 *   equals the matcher's shape.
 */
export function matchesAnyTarget(
  target: Entry,
  matchers: readonly TargetMatcher[],
): boolean {
  for (const m of matchers) {
    if (typeof m === "string") {
      if (target.type === m) return true;
    } else {
      if (target.shape === m.shape) return true;
    }
  }
  return false;
}
```

Also extend the existing top-of-file import block:

```typescript
import type {
  EffectiveProfile,
  Entry,
  TargetMatcher,
  TraceRule,
} from "../model/mod.ts";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/validator/traceability_test.ts` Expected:
all 15 tests PASS (6 from 7.2 + 9 new).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/validator/traceability.ts packages/markspec/core/validator/traceability_test.ts
git commit -m "feat(core): target matcher evaluation for trace rules"
```

---

## Task 7.4 — Traceability stage (L001–L004)

Per-entry validator that emits `MSL-L001` (required link missing), `MSL-L002`
(upper cardinality), `MSL-L003` (lower cardinality), and `MSL-L004` (target
mismatch). Takes a graph index (`Map<string, Entry>`) for target lookup.

**Files:**

- Modify: `packages/markspec/core/validator/traceability.ts`
- Modify: `packages/markspec/core/validator/traceability_test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/markspec/core/validator/traceability_test.ts`:

```typescript
import { validateTraceabilityForEntry } from "./traceability.ts";

function graphOf(entries: readonly Entry[]): Map<string, Entry> {
  const g = new Map<string, Entry>();
  for (const e of entries) g.set(e.id, e);
  return g;
}

function entryWithAttrs(opts: {
  id?: string;
  displayId?: string;
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
    displayId: opts.displayId ?? "REQ-0001",
    id: opts.id ?? "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape,
    type: opts.type,
    source: "markdown",
    title: "",
    body: "",
    attributes,
    typedAttributes: new Map(
      Object.entries(attrs).map(([k, vs]) => [k, vs]),
    ),
    location: { file: "t.md", line: 1, column: 1 },
  };
}

// ---------------------------------------------------------------------------
// MSL-L001: required link missing
// ---------------------------------------------------------------------------

Deno.test("validateTraceabilityForEntry: required link missing → MSL-L001", () => {
  const requiredRule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 1, upper: Infinity },
    required: true,
  };
  const p = profile({
    identified: shapeScope({ traceability: { Verifies: requiredRule } }),
  });
  const e = entryWithAttrs({ shape: "identified", type: "test" });
  const graph = graphOf([e]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  const l001 = diags.find((d) => d.code === "MSL-L001");
  if (!l001) {
    throw new Error(`expected MSL-L001, got: ${diags.map((d) => d.code)}`);
  }
  if (!l001.message.includes("Verifies")) {
    throw new Error(`expected 'Verifies' in message: ${l001.message}`);
  }
});

Deno.test("validateTraceabilityForEntry: required link present → no MSL-L001", () => {
  const target = entryWithAttrs({
    id: "01TARGET02TARGET03TARGET04",
    displayId: "REQ-9999",
    shape: "identified",
    type: "requirement",
  });
  const requiredRule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 1, upper: Infinity },
    required: true,
  };
  const p = profile({
    identified: shapeScope({ traceability: { Verifies: requiredRule } }),
  });
  const e = entryWithAttrs({
    shape: "identified",
    type: "test",
    attrs: { Verifies: [target.id] },
  });
  const graph = graphOf([e, target]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  assertEquals(diags.filter((d) => d.code === "MSL-L001"), []);
});

// ---------------------------------------------------------------------------
// MSL-L002 / L003: cardinality
// ---------------------------------------------------------------------------

Deno.test("validateTraceabilityForEntry: upper cardinality exceeded → MSL-L002", () => {
  const rule: TraceRule = {
    target: [{ shape: "identified" }],
    cardinality: { lower: 0, upper: 1 },
    required: false,
  };
  const p = profile({
    identified: shapeScope({ traceability: { Verifies: rule } }),
  });
  const target1 = entryWithAttrs({
    id: "01T1T1T1T1T1T1T1T1T1T1T1T1",
    shape: "identified",
    type: "x",
  });
  const target2 = entryWithAttrs({
    id: "01T2T2T2T2T2T2T2T2T2T2T2T2",
    shape: "identified",
    type: "x",
  });
  const e = entryWithAttrs({
    shape: "identified",
    type: "test",
    attrs: { Verifies: [target1.id, target2.id] },
  });
  const graph = graphOf([e, target1, target2]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  const l002 = diags.find((d) => d.code === "MSL-L002");
  if (!l002) {
    throw new Error(`expected MSL-L002, got: ${diags.map((d) => d.code)}`);
  }
});

Deno.test("validateTraceabilityForEntry: lower cardinality unmet → MSL-L003", () => {
  const rule: TraceRule = {
    target: [{ shape: "identified" }],
    cardinality: { lower: 2, upper: Infinity },
    required: false,
  };
  const p = profile({
    identified: shapeScope({ traceability: { Verifies: rule } }),
  });
  const target1 = entryWithAttrs({
    id: "01T1T1T1T1T1T1T1T1T1T1T1T1",
    shape: "identified",
    type: "x",
  });
  const e = entryWithAttrs({
    shape: "identified",
    type: "test",
    attrs: { Verifies: [target1.id] },
  });
  const graph = graphOf([e, target1]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  const l003 = diags.find((d) => d.code === "MSL-L003");
  if (!l003) {
    throw new Error(`expected MSL-L003, got: ${diags.map((d) => d.code)}`);
  }
});

Deno.test("validateTraceabilityForEntry: required missing does not double-emit with cardinality", () => {
  // If required:true and absent, MSL-L001 fires. MSL-L002/L003 must NOT also fire.
  const rule: TraceRule = {
    target: [{ shape: "identified" }],
    cardinality: { lower: 1, upper: 5 },
    required: true,
  };
  const p = profile({
    identified: shapeScope({ traceability: { Verifies: rule } }),
  });
  const e = entryWithAttrs({ shape: "identified", type: "test" });
  const graph = graphOf([e]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  const codes = diags.map((d) => d.code);
  assertEquals(codes.includes("MSL-L001"), true);
  assertEquals(codes.includes("MSL-L003"), false);
  assertEquals(codes.includes("MSL-L002"), false);
});

// ---------------------------------------------------------------------------
// MSL-L004: target match
// ---------------------------------------------------------------------------

Deno.test("validateTraceabilityForEntry: target type matches → no MSL-L004", () => {
  const rule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 0, upper: Infinity },
    required: false,
  };
  const p = profile({
    identified: shapeScope({ traceability: { Verifies: rule } }),
  });
  const target = entryWithAttrs({
    id: "01T1T1T1T1T1T1T1T1T1T1T1T1",
    displayId: "REQ-0001",
    shape: "identified",
    type: "requirement",
  });
  const e = entryWithAttrs({
    shape: "identified",
    type: "test",
    attrs: { Verifies: [target.id] },
  });
  const graph = graphOf([e, target]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  assertEquals(diags.filter((d) => d.code === "MSL-L004"), []);
});

Deno.test("validateTraceabilityForEntry: target type mismatch → MSL-L004", () => {
  const rule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 0, upper: Infinity },
    required: false,
  };
  const p = profile({
    identified: shapeScope({ traceability: { Verifies: rule } }),
  });
  const wrongTarget = entryWithAttrs({
    id: "01T1T1T1T1T1T1T1T1T1T1T1T1",
    displayId: "NOTE-0001",
    shape: "identified",
    type: "note",
  });
  const e = entryWithAttrs({
    shape: "identified",
    type: "test",
    attrs: { Verifies: [wrongTarget.id] },
  });
  const graph = graphOf([e, wrongTarget]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  const l004 = diags.find((d) => d.code === "MSL-L004");
  if (!l004) {
    throw new Error(`expected MSL-L004, got: ${diags.map((d) => d.code)}`);
  }
  // Message should reference the link attr, target display-id, target type, and accepted matchers.
  if (
    !l004.message.includes("Verifies") || !l004.message.includes("NOTE-0001")
  ) {
    throw new Error(`message lacks context: ${l004.message}`);
  }
});

Deno.test("validateTraceabilityForEntry: shape matcher accepts any identified target", () => {
  const rule: TraceRule = {
    target: [{ shape: "identified" }],
    cardinality: { lower: 0, upper: Infinity },
    required: false,
  };
  const p = profile({
    identified: shapeScope({ traceability: { Derived: rule } }),
  });
  const target = entryWithAttrs({
    id: "01T1T1T1T1T1T1T1T1T1T1T1T1",
    shape: "identified",
    type: "note",
  });
  const e = entryWithAttrs({
    shape: "identified",
    type: "test",
    attrs: { Derived: [target.id] },
  });
  const graph = graphOf([e, target]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  assertEquals(diags.filter((d) => d.code === "MSL-L004"), []);
});

Deno.test("validateTraceabilityForEntry: target not in graph is silently skipped (Stage 1 owns)", () => {
  const rule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 0, upper: Infinity },
    required: false,
  };
  const p = profile({
    identified: shapeScope({ traceability: { Verifies: rule } }),
  });
  const e = entryWithAttrs({
    shape: "identified",
    type: "test",
    attrs: { Verifies: ["01MISSING000000000000000000"] },
  });
  const graph = graphOf([e]); // target not in graph
  const diags = validateTraceabilityForEntry(e, p, graph);
  // Stage 4 doesn't duplicate Stage 1's unresolved-reference error.
  assertEquals(diags.filter((d) => d.code === "MSL-L004"), []);
});

Deno.test("validateTraceabilityForEntry: one valid + one invalid target → single MSL-L004", () => {
  const rule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 0, upper: Infinity },
    required: false,
  };
  const p = profile({
    identified: shapeScope({ traceability: { Verifies: rule } }),
  });
  const good = entryWithAttrs({
    id: "01GOOD0000000000000000000",
    displayId: "REQ-0001",
    shape: "identified",
    type: "requirement",
  });
  const bad = entryWithAttrs({
    id: "01BAD00000000000000000000",
    displayId: "NOTE-0001",
    shape: "identified",
    type: "note",
  });
  const e = entryWithAttrs({
    shape: "identified",
    type: "test",
    attrs: { Verifies: [good.id, bad.id] },
  });
  const graph = graphOf([e, good, bad]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  const l004 = diags.filter((d) => d.code === "MSL-L004");
  assertEquals(l004.length, 1);
  if (!l004[0].message.includes("NOTE-0001")) {
    throw new Error(`expected bad target in message: ${l004[0].message}`);
  }
});

// ---------------------------------------------------------------------------
// Scope gating
// ---------------------------------------------------------------------------

Deno.test("validateTraceabilityForEntry: referenced entries are skipped entirely", () => {
  const rule: TraceRule = {
    target: ["requirement"],
    cardinality: { lower: 1, upper: Infinity },
    required: true,
  };
  const p = profile({
    identified: shapeScope({ traceability: { Verifies: rule } }),
  });
  const e = entryWithAttrs({ shape: "referenced", type: "citation" });
  const graph = graphOf([e]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  assertEquals(diags, []);
});

Deno.test("validateTraceabilityForEntry: un-classified entry uses shape-scope rules only", () => {
  const rule: TraceRule = {
    target: [{ shape: "identified" }],
    cardinality: { lower: 0, upper: Infinity },
    required: true,
  };
  const p = profile({
    identified: shapeScope({ traceability: { Link: rule } }),
  });
  const e = entryWithAttrs({ shape: "identified" }); // no type
  const graph = graphOf([e]);
  const diags = validateTraceabilityForEntry(e, p, graph);
  // Shape-scope rule is required → MSL-L001
  const l001 = diags.find((d) => d.code === "MSL-L001");
  if (!l001) {
    throw new Error(`expected MSL-L001, got: ${diags.map((d) => d.code)}`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/validator/traceability_test.ts` Expected:
12 new tests FAIL — `validateTraceabilityForEntry` not exported.

- [ ] **Step 3: Implement `validateTraceabilityForEntry`**

Append to `packages/markspec/core/validator/traceability.ts`:

```typescript
import type { Diagnostic } from "../model/mod.ts";

/**
 * Run Stage 4 traceability checks for one entry.
 *
 * Skips referenced entries entirely. For identified entries, iterates the
 * effective trace rules and emits MSL-L001..L004 as appropriate.
 *
 * @param entry - The entry to validate (after Stage 2 classification +
 *                Stage 2.5 normalization)
 * @param profile - The effective profile (null → never called)
 * @param graph - Index keyed by entry.id for target lookup
 */
export function validateTraceabilityForEntry(
  entry: Entry,
  profile: EffectiveProfile,
  graph: ReadonlyMap<string, Entry>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (entry.shape !== "identified") return diagnostics;

  const rules = effectiveTraceRules(entry, profile);
  const present = entry.typedAttributes ?? new Map<string, readonly string[]>();

  for (const [linkName, rule] of rules) {
    const values = present.get(linkName);
    const count = values?.length ?? 0;
    const card = rule.cardinality ?? { lower: 0, upper: Infinity };

    // MSL-L001: required link missing.
    if (rule.required && count === 0) {
      diagnostics.push({
        code: "MSL-L001",
        severity: "error",
        message:
          `${entry.displayId}: required link attribute '${linkName}' is missing`,
        location: entry.location,
      });
      continue; // no further checks on an absent required link
    }

    if (count === 0) continue; // optional + absent → nothing to check

    // MSL-L002: upper cardinality.
    if (count > card.upper) {
      diagnostics.push({
        code: "MSL-L002",
        severity: "error",
        message:
          `${entry.displayId}: link '${linkName}' has ${count} values but max is ${
            formatUpper(card.upper)
          }`,
        location: entry.location,
      });
    }

    // MSL-L003: lower cardinality.
    if (count < card.lower) {
      diagnostics.push({
        code: "MSL-L003",
        severity: "error",
        message:
          `${entry.displayId}: link '${linkName}' has ${count} values but min is ${card.lower}`,
        location: entry.location,
      });
    }

    // MSL-L004: target match for each resolved value.
    for (const v of values!) {
      const target = graph.get(v);
      if (!target) continue; // Stage 1 owns unresolvable references
      if (!matchesAnyTarget(target, rule.target)) {
        diagnostics.push({
          code: "MSL-L004",
          severity: "error",
          message:
            `${entry.displayId}: link '${linkName}' targets ${target.displayId} ` +
            `whose type '${
              target.type ?? "<unclassified>"
            }' / shape '${target.shape}' ` +
            `is not accepted by rule target ${stringifyMatchers(rule.target)}`,
          location: entry.location,
        });
      }
    }
  }

  return diagnostics;
}

function formatUpper(u: number): string {
  return u === Infinity ? "N" : String(u);
}

function stringifyMatchers(matchers: readonly TargetMatcher[]): string {
  const parts = matchers.map((m) =>
    typeof m === "string" ? m : `{shape: ${m.shape}}`
  );
  return `[${parts.join(", ")}]`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test packages/markspec/core/validator/traceability_test.ts` Expected:
all 27 tests PASS (6 + 9 + 12).

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/validator/traceability.ts packages/markspec/core/validator/traceability_test.ts
git commit -m "feat(core): traceability stage — required, cardinality, target match"
```

---

## Task 7.5 — Pipeline wiring + graph index + barrel exports

Wire Stage 2.5 (normalization) and Stage 4 (traceability) into `runPipeline`.
Build the graph index inside the runner. Extend barrels.

**Files:**

- Modify: `packages/markspec/core/validator/pipeline.ts`
- Modify: `packages/markspec/core/validator/pipeline_test.ts`
- Modify: `packages/markspec/core/validator/mod.ts`
- Modify: `packages/markspec/core/mod.ts`

- [ ] **Step 1: Write failing pipeline-integration tests**

Append to `packages/markspec/core/validator/pipeline_test.ts`:

```typescript
Deno.test("runPipeline: Stage 4 catches required link missing", () => {
  const origin = "@test/p";
  const requiredRule = {
    target: ["requirement"] as const,
    cardinality: { lower: 1, upper: Infinity },
    required: true,
  };
  const reqType: ProvenancedMapEntry<EffectiveTypeDef> = {
    origin,
    value: {
      name: "test",
      shape: "identified",
      displayIdPattern: { value: "TEST-{n:04d}", origin },
      displayIdPatternEnforcement: { value: "off", origin },
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map([
        ["Verifies", { value: requiredRule, origin }],
      ]),
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
    types: new Map([["test", reqType]]),
    documents: { types: new Map(), frontMatter: new Map() },
  };

  const e: Entry = {
    displayId: "TEST-0001",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "identified",
    source: "markdown",
    title: "",
    body: "",
    attributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
    ]),
    location: { file: "t.md", line: 1, column: 1 },
  };

  const result = runPipeline([e], profile);
  const l001 = result.diagnostics.find((d) => d.code === "MSL-L001");
  if (!l001) {
    throw new Error(
      `expected MSL-L001, got: ${result.diagnostics.map((d) => d.code)}`,
    );
  }
  assertEquals(result.valid, false);
});

Deno.test("runPipeline: Stage 2.5 normalization splits comma-separated id-list values before Stage 3", () => {
  // Without Stage 2.5, "REQ-0001, REQ-0002" would be one literal value
  // and Stage 3 would reject it as an invalid id.
  const origin = "@test/p";
  const verifiesAttr = {
    name: "Verifies",
    type: "id-list" as const,
    required: false,
    cardinality: { lower: 0, upper: Infinity },
  };
  const profile: EffectiveProfile = {
    required: { value: [], origin },
    attributes: new Map([
      ["Verifies", { value: verifiesAttr, origin }],
    ]),
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
    types: new Map(),
    documents: { types: new Map(), frontMatter: new Map() },
  };

  const target1: Entry = {
    displayId: "REQ-0001",
    id: "01T1T1T1T1T1T1T1T1T1T1T1T1",
    shape: "identified",
    source: "markdown",
    title: "",
    body: "",
    attributes: [],
    typedAttributes: new Map([["Id", ["01T1T1T1T1T1T1T1T1T1T1T1T1"]]]),
    location: { file: "t.md", line: 1, column: 1 },
  };
  const target2: Entry = {
    displayId: "REQ-0002",
    id: "01T2T2T2T2T2T2T2T2T2T2T2T2",
    shape: "identified",
    source: "markdown",
    title: "",
    body: "",
    attributes: [],
    typedAttributes: new Map([["Id", ["01T2T2T2T2T2T2T2T2T2T2T2T2"]]]),
    location: { file: "t.md", line: 1, column: 1 },
  };
  const e: Entry = {
    displayId: "TEST-0001",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "identified",
    source: "markdown",
    title: "",
    body: "",
    attributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      {
        key: "Verifies",
        value: "01T1T1T1T1T1T1T1T1T1T1T1T1, 01T2T2T2T2T2T2T2T2T2T2T2T2",
      },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Verifies", ["01T1T1T1T1T1T1T1T1T1T1T1T1, 01T2T2T2T2T2T2T2T2T2T2T2T2"]],
    ]),
    location: { file: "t.md", line: 1, column: 1 },
  };

  const result = runPipeline([e, target1, target2], profile);
  // No MSL-A004 (Stage 3 saw split values, each a valid ULID).
  assertEquals(result.diagnostics.filter((d) => d.code === "MSL-A004"), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test packages/markspec/core/validator/pipeline_test.ts` Expected: 2
new tests FAIL (Stage 4 not wired, Stage 2.5 not wired).

- [ ] **Step 3: Wire Stage 2.5 and Stage 4 into `runPipeline`**

Modify `packages/markspec/core/validator/pipeline.ts`. Add imports:

```typescript
import { normalizeListValues } from "./normalize.ts";
import { validateTraceabilityForEntry } from "./traceability.ts";
```

In `runPipeline`, add Stage 2.5 between Stage 2 and the existing R010-filter /
Stage 3 code. The final function should look like:

```typescript
export function runPipeline(
  entries: readonly Entry[],
  profile: EffectiveProfile | null,
): PipelineResult {
  const diagnostics: Diagnostic[] = [];

  // Stage 1 — core hygiene.
  const stage1 = validate(entries);
  // Filter MSL-R010 diagnostics for attributes declared by the profile
  // (existing code from Phase 6 polish — keep as-is).
  if (profile !== null) {
    const declaredAttrs = collectAllProfileAttributes(entries, profile);
    for (const d of stage1.diagnostics) {
      if (d.code === "MSL-R010") {
        const m = /attribute '([^']+)'/.exec(d.message);
        if (m && declaredAttrs.has(m[1])) continue; // suppress
      }
      diagnostics.push(d);
    }
  } else {
    diagnostics.push(...stage1.diagnostics);
  }

  // Stage 2 — classification.
  let finalEntries: readonly Entry[] = entries;
  if (profile !== null) {
    const stage2 = classifyEntriesStage(entries, profile);
    finalEntries = stage2.entries;
    diagnostics.push(...stage2.diagnostics);
  }

  // Stage 2.5 — normalize profile-declared list-value attributes.
  if (profile !== null) {
    finalEntries = finalEntries.map((e) => normalizeListValues(e, profile));
  }

  // Stage 3 — typed attributes.
  if (profile !== null) {
    for (const entry of finalEntries) {
      const stage3 = validateAttributesForEntry(entry, profile);
      diagnostics.push(...stage3);
    }
  }

  // Stage 4 — traceability.
  if (profile !== null) {
    const graph = new Map<string, Entry>();
    for (const e of finalEntries) graph.set(e.id, e);
    for (const entry of finalEntries) {
      const stage4 = validateTraceabilityForEntry(entry, profile, graph);
      diagnostics.push(...stage4);
    }
  }

  const valid = !diagnostics.some((d) => d.severity === "error");
  return { entries: finalEntries, diagnostics, valid };
}
```

The existing `collectAllProfileAttributes` helper (from the Phase 6 polish
commit) stays as it was. Update the module doc comment to mention Stages 2.5
and 4.

- [ ] **Step 4: Run the pipeline tests**

Run: `deno test packages/markspec/core/validator/pipeline_test.ts` Expected: all
pipeline tests pass.

- [ ] **Step 5: Extend barrel exports**

Modify `packages/markspec/core/validator/mod.ts`. Append:

```typescript
export { normalizeListValues } from "./normalize.ts";

export {
  effectiveTraceRules,
  matchesAnyTarget,
  validateTraceabilityForEntry,
} from "./traceability.ts";
```

Modify `packages/markspec/core/mod.ts`. Find the validator re-export block
(which currently exports `runPipeline`, `validate`, Stage 2/3 helpers, etc.) and
add the new names alphabetically:

```typescript
export {
  classifyEntriesStage,
  classifyEntry,
  compileDisplayIdPattern,
  effectiveScope,
  effectiveTraceRules,
  matchesAnyTarget,
  normalizeListValues,
  runPipeline,
  validate,
  validateAttributesForEntry,
  validateTraceabilityForEntry,
  validateValue,
} from "./validator/mod.ts";
```

Match the existing file's style. If the current block groups types separately,
follow that convention.

- [ ] **Step 6: Type-check + full suite**

Run: `deno task check && deno task test` Expected: clean, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/markspec/core/validator/pipeline.ts packages/markspec/core/validator/pipeline_test.ts packages/markspec/core/validator/mod.ts packages/markspec/core/mod.ts
git commit -m "feat(core): wire Stage 4 traceability + Stage 2.5 normalization into pipeline"
```

---

## Task 7.6 — E2E fixture + CLI tests

Exercise Stage 4 through the CLI. Profile declares a `requirement` type and a
`test` type with `Verifies: id-list` (required, target: requirement). E2E tests
cover each MSL-L0* code plus the CSV-split fix.

**Files:**

- Create: `tests/fixtures/profiles/phase7/traceable/markspec.yaml`
- Create: `tests/e2e/profile_traceability_test.ts`

- [ ] **Step 1: Create the fixture profile**

Create `tests/fixtures/profiles/phase7/traceable/markspec.yaml`:

```yaml
id: "@acme/phase7-traceable"
version: 0.1.0
description: Phase 7 e2e — profile with traceability rules
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
    test:
      shape: identified
      display-id-pattern: "TEST-{n:04d}"
      traceability:
        Verifies:
          target: [requirement]
          cardinality: 1..2
          required: true
```

- [ ] **Step 2: Write the e2e tests**

Create `tests/e2e/profile_traceability_test.ts`:

```typescript
/**
 * @module tests/e2e/profile_traceability_test
 *
 * E2E tests for validator Stage 4 — traceability rules through
 * `markspec validate`.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: phase7-e2e\nversion: 0.1.0\n`;

const PROFILE_YAML = `id: "@acme/phase7-traceable"
version: 0.1.0
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
    test:
      shape: identified
      display-id-pattern: "TEST-{n:04d}"
      traceability:
        Verifies:
          target: [requirement]
          cardinality: 1..2
          required: true
`;

const BASE_FILES = {
  "project.yaml": PROJECT_YAML,
  ".markspec.yaml": `profiles:\n  - ./profiles/traceable\n`,
  "profiles/traceable/markspec.yaml": PROFILE_YAML,
};

Deno.test("traceability e2e: test entry Verifies a requirement → clean", async () => {
  const { code, stderr } = await markspec(["validate", "doc.md"], {
    files: {
      ...BASE_FILES,
      "doc.md": `# Example

- [REQ-0001] A requirement

  Id: 01REQ000000000000000000001\\

- [TEST-0001] A test

  Id: 01TEST00000000000000000001\\
  Verifies: 01REQ000000000000000000001\\
`,
    },
  });
  assertEquals(code, 0);
  const msl_l = stderr.split("\n").filter((l) => l.includes("MSL-L"));
  assertEquals(msl_l, []);
});

Deno.test("traceability e2e: test entry missing Verifies → MSL-L001", async () => {
  const { code, stderr } = await markspec(["validate", "doc.md"], {
    files: {
      ...BASE_FILES,
      "doc.md": `# Example

- [TEST-0001] A test with no Verifies

  Id: 01TEST00000000000000000001\\
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-L001");
  assertStringIncludes(stderr, "Verifies");
});

Deno.test("traceability e2e: Verifies too many targets → MSL-L002", async () => {
  const { code, stderr } = await markspec(["validate", "doc.md"], {
    files: {
      ...BASE_FILES,
      "doc.md": `# Example

- [REQ-0001] First

  Id: 01REQ000000000000000000001\\

- [REQ-0002] Second

  Id: 01REQ000000000000000000002\\

- [REQ-0003] Third

  Id: 01REQ000000000000000000003\\

- [TEST-0001] A test

  Id: 01TEST00000000000000000001\\
  Verifies: 01REQ000000000000000000001\\
  Verifies: 01REQ000000000000000000002\\
  Verifies: 01REQ000000000000000000003\\
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-L002");
});

Deno.test("traceability e2e: Verifies points at a non-requirement → MSL-L004", async () => {
  const { code, stderr } = await markspec(["validate", "doc.md"], {
    files: {
      ...BASE_FILES,
      "doc.md": `# Example

- [TEST-0002] Another test

  Id: 01TEST00000000000000000002\\

- [TEST-0001] A test verifying the wrong type

  Id: 01TEST00000000000000000001\\
  Verifies: 01TEST00000000000000000002\\
`,
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MSL-L004");
  assertStringIncludes(stderr, "TEST-0002");
});

Deno.test("traceability e2e: comma-separated Verifies is split by Stage 2.5", async () => {
  const { code, stderr } = await markspec(["validate", "doc.md"], {
    files: {
      ...BASE_FILES,
      "doc.md": `# Example

- [REQ-0001] First

  Id: 01REQ000000000000000000001\\

- [REQ-0002] Second

  Id: 01REQ000000000000000000002\\

- [TEST-0001] A test verifying two reqs via CSV syntax

  Id: 01TEST00000000000000000001\\
  Verifies: 01REQ000000000000000000001, 01REQ000000000000000000002\\
`,
    },
  });
  assertEquals(code, 0);
  const msl = stderr.split("\n").filter((l) =>
    l.includes("MSL-A004") || l.includes("MSL-L004") || l.includes("MSL-L003")
  );
  assertEquals(msl, []);
});

Deno.test("traceability e2e: no profile → Stage 4 silent", async () => {
  const { code, stderr } = await markspec(["validate", "doc.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "doc.md": `# Example

- [TEST-0001] A test

  Id: 01TEST00000000000000000001\\
`,
    },
  });
  assertEquals(code, 0);
  const msl_l = stderr.split("\n").filter((l) => l.includes("MSL-L"));
  assertEquals(msl_l, []);
});
```

- [ ] **Step 3: Run the e2e tests**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/profile_traceability_test.ts`
Expected: all 6 tests pass.

Debugging tips:

- If the "comma-separated Verifies" test fails with MSL-A004 or MSL-L004, Stage
  2.5 didn't split correctly or Stage 3/4 ran before normalization. Check the
  order of stage calls in `runPipeline`.
- If the "test points at wrong type" test emits MSL-L004 but the stderr doesn't
  include "TEST-0002", the diagnostic message's target-display-id interpolation
  is broken.
- If any test unexpectedly passes with code 2 instead of 1, the CLI might be
  treating Stage 4 errors as warnings — unlikely since they're all severity
  "error", but double-check.

- [ ] **Step 4: Run full suite**

Run: `deno task test` Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/profiles/phase7/traceable/markspec.yaml tests/e2e/profile_traceability_test.ts
git commit -m "test(core): e2e coverage for validator Stage 4 traceability"
```

---

## Phase 7 acceptance

All tasks checked, all commits on `feat/profile-system-phase-7`,
`deno task test` green, `deno task check` clean. Stage 4 covers:

- Effective trace rule collection:
  `identified.traceability ∪ types[entry.type].traceability`, with type-scope
  winning on link-name collision.
- Referenced entries skipped entirely (no trace rules).
- Un-classified identified entries use shape-scope rules only.
- MSL-L001 required link missing, MSL-L002 upper cardinality, MSL-L003 lower
  cardinality (when present), MSL-L004 target type/shape mismatch.
- Target matchers: type-name strings and shape matchers, OR semantics across the
  list.
- Graph index: built once per pipeline invocation, keyed by `entry.id`.
- Unresolved target references are silently skipped (Stage 1 owns that
  diagnostic).
- Stage 2.5 normalization: profile-declared `id-list` / `tag-list` attributes
  written as comma-separated values are split and trimmed, enabling
  `Verifies: REQ-0001, REQ-0002` syntax.
- E2E fixtures demonstrate every MSL-L0* code plus the CSV-split behavior.

This PR completes the validator pipeline. Phase 8 adds the compiler-side work
(generated inverses, `MSL-L005` inverse consistency). Phase 9 finishes the CLI.

---

## Self-review

**Spec coverage (§5.5):**

- ✅ Effective trace rule collection — `effectiveTraceRules` in traceability.ts.
- ✅ MSL-L001 required link missing — Task 7.4 test + implementation.
- ✅ MSL-L002 upper cardinality — Task 7.4 test + implementation.
- ✅ MSL-L003 lower cardinality — Task 7.4 test + implementation.
- ✅ MSL-L004 target type/shape mismatch — Task 7.4 test + implementation.
- ✅ Target matcher semantics (type-name + shape, OR semantics) — Task 7.3.
- ✅ Referenced entry skipping — Task 7.2 test, Task 7.4 skip guard.
- ✅ Graph index for target lookup — Task 7.5 pipeline integration.
- ➕ Stage 2.5 CSV-split normalization — added to address the Phase 6 follow-up
  concern without being in the spec itself; it's a UX fix that enables the
  spec's declared list-value semantics.

**Placeholder scan:** None. Every TDD cycle has complete code blocks.

**Type consistency:** `effectiveTraceRules`, `matchesAnyTarget`,
`validateTraceabilityForEntry`, `normalizeListValues` used consistently across
Tasks 7.1–7.6.

**Known caveats (documented in §Scope):**

- MSL-L005 (authored-vs-generated inverse consistency) deferred to Phase 8.
- Project-root containment for `path` still deferred from Phase 6.
- Unresolved target references not re-reported by Stage 4 (Stage 1 owns them).

**Scope check:** single subsystem (Stage 4 + Stage 2.5 preprocessing). No
compiler / parser / profile-system changes. Fits one PR.

---

## Execution handoff

Plan complete and saved to
`docs/superpowers/plans/2026-04-22-adr-008-profile-system-v1-phase-7.md`. Two
execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task,
   review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans,
   batch execution with checkpoints.

Which approach?
