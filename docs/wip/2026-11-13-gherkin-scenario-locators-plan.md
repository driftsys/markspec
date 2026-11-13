# Scenario Locators and Criterion-Level Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `Verifies` or `Satisfies` value address one scenario of its
target (`Verifies: REQ_BRK_0010 [Brake at 20 m]`), keep that locator in the
compiled graph, and report coverage per criterion in `markspec report coverage`.

**Architecture:** One shared bracket-aware value splitter in `core/refs/`
replaces the four ad-hoc splits. `RelationDef` gains a `locator` facet, so the
compiler, validator, lockfile and `fmt` read one list. A minimal scenario index
(scenario names only, from fenced `gherkin` / `feature` blocks) fills a subset
of the `Entry.criteria` facet that the later Gherkin-AST slice replaces with a
full parse. `Link` gains `locator` and `locatorResolved`; the reporter derives
criterion states from those links.

**Tech Stack:** Deno / TypeScript, `@std/assert`, `@std/testing/snapshot`,
existing `core/` modules. No new dependency (`@cucumber/gherkin` arrives in the
Gherkin-AST slice).

**Spec:** `docs/wip/2026-11-13-gherkin-model-design.md` — §10 (locators), §11
(captured model, edge shape), §12 (coverage), §13 (validation). Epic #915
"Decisions". Closes the locator half of #924.

## Open decisions (recommended option in bold)

1. **Source of criteria in this slice.** (a) **A minimal line scanner over
   `FeatureNode.source` that collects `Scenario:`, `Scenario Outline:`,
   `Example:` and `Scenario Template:` names (English keywords only).** (b) Pull
   the `@cucumber/gherkin` AST forward into this slice. (c) Locators stay free
   text until the AST slice. Recommendation (a): it is about 40 lines, has no
   dependency, and the AST slice swaps its body without changing
   `Entry.criteria`. Non-English blocks yield no criteria until then (a locator
   to them raises the unresolved warning, which is the truthful result).
2. **Where criteria live.** (a) **`Entry.criteria?: readonly Criterion[]` with
   the subset `{ form: "scenario", name, addressable, location }`** (D12, no
   `CORE_SCHEMA_VERSION` bump). (b) A private index inside the compiler.
   Recommendation (a): the reporter, LSP and JSON consumers read one record, and
   the AST slice only adds fields.
3. **Which entries get criteria.** (a) **Entries whose resolved core ancestor is
   Requirement or Contract (D1); others keep none.** (b) Every entry with a
   block. Recommendation (a), using the existing ancestor walk
   (`core/model/type_hierarchy.ts`). An unclassified entry gets no criteria.
4. **Diagnostic codes** (ADR-012 phased scheme; current `language.md` §8 stays
   authoritative, so codes extend existing families):
   - **`MSL-L007` warning** — locator on `Verifies` / `Satisfies` matches no
     addressable criterion of a resolved criteria-bearing target.
   - **`MSL-L008` warning** — locator on a relation that does not accept one
     (every relation except `References`, `Derived-from`, `Verifies`,
     `Satisfies`).
   - **`MSL-B060` warning** — duplicate normalized scenario name in one entry
     (second and later occurrences).
   - **`MSL-B061` info** — scenario with an empty name.
   - Criterion-with-no-verifier gets **no diagnostic in this slice**; it is
     visible in the report only. Alternative: `MSL-T015` warning in `check`.
     Recommendation: defer, because the strict / lightweight profile flag
     (§12.2) is not designed yet and a warning per criterion is noisy on
     adoption.
5. **Lockfile.** (a) **Use the shared splitter in `core/lock/resolve.ts` and add
   an optional `locator` to `LockEdge` (TOML key `locator`, sort key
   `(sourceUlid, relation, authoredTarget, locator)`).** (b) Defer the field.
   Recommendation (a): without it a `Satisfies` locator would leak words into
   `authored-target`; the `edges-hash` change happens once either way (§10.4).
6. **Report shape.** (a) **Add a `criteria` section to the existing `coverage`
   report in md, json and csv, emitted only when at least one entry has
   criteria.** (b) A new report kind `criteria`. Recommendation (a): entry-level
   numbers stay byte-identical for projects without feature blocks, so existing
   snapshots do not move.

## Scope boundary

In: shared splitter; `RelationDef.locator`; locator parse, normalization and
resolution; `Link.locator` / `Link.locatorResolved` in compile and JSON / NDJSON
export, including generated inverses; `MSL-L007`, `MSL-L008`, `MSL-B060`,
`MSL-B061`; lockfile `locator`; `fmt` CSV split and target canonicalisation that
leave the locator untouched; criterion-level coverage; spec and guide docs; fix
of the `relations.md` locator sentence (#924).

Out (later slices): Gherkin AST, steps, preconditions, procedures, item-form
criteria, Case B `.feature` entries, strict / lightweight flag, a no-verifier
diagnostic, LSP rename of scenario names, LSP hover or completion of locators,
non-English keywords.

## Global Constraints

- Locator grammar (§10.1): `value = target [ 1*WSP locator ]`,
  `locator = "[" 1*locator-char "]"`,
  `locator-char = "\]" / "\\" / any char
  except "]" and "\"`. Brackets do not
  nest. A comma inside a locator does not split.
- Normalization (§10.3): unescape (locator only), Unicode NFC, trim, collapse
  each whitespace run to one space. Comparison is exact and case-sensitive.
- An unresolved locator keeps the edge to the target (§10.3). MSL-L006 checks
  the target only.
- `Link.to` is the target only. Absent `locator` means whole-entry.
- A locator on `Satisfies` has no effect on verification coverage (§12.1).
- Entry-level coverage output is unchanged (§12.1).
- Core stays Node-compatible: no `Deno.*` in `core/`.
- Plain literal English in code comments, docs and commits.

## Review Focus

1. A locator containing a comma in a CSV value (`Verifies: A [x, y], B`) —
   expect two links, `A` with locator `x, y`. Test in Task 1 and Task 4.
2. A locator on a Reference target (`Satisfies: ISO-26262-6 [§4.3]`) — free
   text, no `MSL-L007`. Test in Task 5.
3. A locator whose target does not resolve — only `MSL-L006`, never `MSL-L007`.
   Test in Task 5.
4. Scenario names that differ only in inner whitespace or NFC form — they match.
   Test in Task 2.
5. A `- [ID]`-looking or `Scenario:`-looking line inside a non-feature fence or
   inside a doc string (`"""`) of a feature block — not a scenario. Test in
   Task 2.

---

## File structure

| File                                                    | Responsibility                                            |
| ------------------------------------------------------- | --------------------------------------------------------- |
| `packages/markspec/core/refs/split.ts` (new)            | `splitTraceValues`, `parseTraceValue`, `normalizeLocator` |
| `packages/markspec/core/model/relations.ts`             | `locator?: "free" \| "criterion"` facet                   |
| `packages/markspec/core/model/mod.ts`                   | `Criterion` type, `Entry.criteria`, `Link` fields         |
| `packages/markspec/core/criteria/scenarios.ts` (new)    | minimal scenario-name scanner + `buildCriteria`           |
| `packages/markspec/core/compiler/mod.ts`                | links with locators, criteria attach, resolution          |
| `packages/markspec/core/compiler/inverses.ts`           | copy locator fields to inverses                           |
| `packages/markspec/core/validator/locators.ts` (new)    | `MSL-L007`, `MSL-L008`, `MSL-B060`, `MSL-B061`            |
| `packages/markspec/core/lock/{model,resolve}.ts`        | `LockEdge.locator`, shared split                          |
| `packages/markspec/core/refs/mod.ts`, `core/formatter/` | token split skips locators                                |
| `packages/markspec/core/reporter/mod.ts`                | criterion coverage section                                |
| `tests/e2e/locator_coverage_test.ts` (new)              | blackbox acceptance                                       |

### Task 0: Acceptance test (ATDD, red)

**Files:** Create `tests/e2e/locator_coverage_test.ts`, fixture inline.

- [ ] **Step 1:** Write a project fixture (`project.yaml`, `.markspec.yaml` with
      a profile declaring `REQ_` → Requirement and `TST_` → Test) holding the
      design's `REQ_BRK_0010` (two scenarios `Brake at 20 m`,
      `No braking beyond
  40 m`) and `TST_BRK_0012` with
      `Verifies: REQ_BRK_0010 [Brake at 20 m]`, plus `TST_BRK_0013` with
      `Verifies: REQ_BRK_0010 [Brake at 30 m]`. Tests:
  - `compile json keeps the locator`: link `from TST_BRK_0012`,
    `to
    REQ_BRK_0010`, `locator "Brake at 20 m"`, `locatorResolved true`.
  - `check warns on an unresolved locator`: stderr contains `MSL-L007` and
    `Brake at 30 m`; exit code 2 (warnings only).
  - `report coverage json has criteria`: `criteria.entries[0]` equals
    `{ displayId: "REQ_BRK_0010", state: "partial", verified: 1, total: 2, … }`.
- [ ] **Step 2:** Run `deno test -A tests/e2e/locator_coverage_test.ts`; expect
      3 FAIL. Commit `test(core): add scenario-locator acceptance tests`.

### Task 1: Shared bracket-aware splitter

**Files:** Create `core/refs/split.ts`, `core/refs/split_test.ts`; export from
`core/mod.ts`.

**Interfaces — Produces:** `splitTraceValues(value: string): string[]`;
`parseTraceValue(raw: string): { target: string; locator?: string; locatorRaw?: string }`
(`locator` normalized, `locatorRaw` as authored between brackets);
`normalizeLocator(text: string): string`.

- [ ] **Step 1: Failing tests** — `splitTraceValues("A [x, y], B")` →
      `["A [x, y]", "B"]`; `splitTraceValues("A [a\\]b], C")` →
      `["A [a\\]b]", "C"]`; `parseTraceValue("REQ_1 [Brake  at 20 m]")` →
      `{ target: "REQ_1", locator: "Brake at 20 m", locatorRaw: "Brake  at 20 m" }`;
      `parseTraceValue("REQ_1 [a\\\\b\\]]").locator === "a\\b]"`;
      `parseTraceValue("REQ_1")` has no `locator`; unterminated `REQ_1 [abc` →
      `{ target: "REQ_1 [abc" }` (whole value, no locator — today's behaviour);
      `parseTraceValue("ISO-26262-6 §4.3")` → `target "ISO-26262-6"` (legacy
      whitespace locator on free relations stays: first token).
- [ ] **Step 2:** Run `deno test packages/markspec/core/refs/split_test.ts`;
      FAIL (module missing).
- [ ] **Step 3:** Implement as a single left-to-right scan with an `inLocator`
      flag and escape handling; `normalizeLocator` =
      `.normalize("NFC").trim()
  .replace(/\s+/g, " ")`.
- [ ] **Step 4:** Run; PASS. Commit
      `feat(core): add bracket-aware trace value
  splitter`.

### Task 2: Minimal scenario index and `Entry.criteria`

**Files:** Create `core/criteria/scenarios.ts` + `_test.ts`; modify
`core/model/mod.ts` (types).

**Interfaces — Produces:**
`interface Criterion { readonly form: "scenario"; readonly name: string; readonly addressable: boolean; readonly location: SourceLocation }`;
`Entry.criteria?: readonly Criterion[]`;
`scanScenarioNames(source: string): { name: string; line: number }[]` (line is
0-based within `source`); `buildCriteria(entry: Entry): readonly Criterion[]`
(walks `entry.bodyAst` `FeatureNode`s in order, maps lines to file lines via the
node `range`, applies `normalizeLocator` to names, marks duplicates and empty
names `addressable: false`).

- [ ] **Step 1: Failing tests** — two scenarios → two names;
      `Scenario
  Outline:` and `Example:` counted; `Background:` and `Rule:`
      not; a `Scenario:` line between `"""` doc-string delimiters ignored;
      leading whitespace and tag lines tolerated; names `"Brake  at 20 m"` and
      `"Brake at 20 m"` in one entry → second has `addressable: false`, and so
      does the first (D13: the name is not addressable); `Scenario:` with no
      name → `name ""`, `addressable false`; two blocks in one entry form one
      scope; a `Scenario:` line in a `` ```text `` fence yields nothing (no
      FeatureNode); location line equals the file line of the `Scenario:`
      keyword.
- [ ] **Step 2:** Run `deno test packages/markspec/core/criteria/`; FAIL.
- [ ] **Step 3:** Implement. Keyword regex:
      `/^\s*(Scenario Outline|Scenario Template|Scenario|Example):\s*(.*)$/`.
      Toggle a doc-string flag on lines whose trim starts with `"""` or
      `` ``` ``.
- [ ] **Step 4:** PASS. Commit
      `feat(core): add minimal scenario index for
  criteria`.

### Task 3: `RelationDef.locator` facet

**Files:** `core/model/relations.ts`, `relations_test.ts`; compiler drops
`LOCATOR_BEARING_ATTRS`.

**Interfaces — Produces:** `RelationDef.locator?: "free" | "criterion"`;
`relationLocatorMode(attr: string): "free" | "criterion" | undefined`.

- [ ] **Step 1: Failing test** —
      `relationLocatorMode("References") ===
  "free"`, `"Derived-from"` free,
      `"Verifies"` and `"Satisfies"` criterion, `"Allocated-to"` undefined.
- [ ] **Step 2:** FAIL. **Step 3:** add the facet to the four rows.
- [ ] **Step 4:** `deno test packages/markspec/core/model/` PASS. Commit
      `feat(core): declare locator support on relation definitions`.

### Task 4: Compiler keeps locators and attaches criteria

**Files:** `core/compiler/mod.ts`, `core/compiler/inverses.ts`,
`core/model/mod.ts` (`Link`), `core/compiler/mod_test.ts`, export code.

**Interfaces — Consumes:** Tasks 1–3. **Produces:** `Link.locator?: string`,
`Link.locatorResolved?: boolean`; compiled entries carry `criteria` per
decision 3.

- [ ] **Step 1: Failing tests** — `Verifies: REQ_BRK_0010 [Brake at 20 m]` →
      link `to REQ_BRK_0010`, `locator "Brake at 20 m"`, `locatorResolved true`;
      unknown name → `locatorResolved false`, edge kept;
      `References: ISO-1 [§4.3]` → `locator "§4.3"`, no `locatorResolved` key;
      `Satisfies: A [x, y], B` → two links; `Allocated-to: SWC_X [foo]` → link
      `to SWC_X`, `locator "foo"`, no `locatorResolved` (L008 comes from Task
      5); generated inverse carries the same `locator` / `locatorResolved`;
      Test-type entry with a feature block has no `criteria`; JSON export
      snapshot includes the fields.
- [ ] **Step 2:** `deno test packages/markspec/core/compiler/`; FAIL.
- [ ] **Step 3:** Replace both branches of `extractLinksFromAttribute` with
      `splitTraceValues` + `parseTraceValue`; set `locatorResolved` in a pass
      after criteria are attached: only when mode is `criterion`, the target
      resolves, and the target has a `criteria` array (possibly empty).
- [ ] **Step 4:** PASS; also `deno test packages/markspec/core/` stays green.
      Commit `feat(core): keep scenario locators on compiled links`.

### Task 5: Diagnostics

**Files:** Create `core/validator/locators.ts` + `_test.ts`; wire into
`core/validator/pipeline.ts` and LSP `WorkspaceIndex.validateAll` through the
same pipeline call.

**Interfaces — Produces:**
`validateLocators(entries: readonly Entry[], links: readonly Link[]): Diagnostic[]`.

- [ ] **Step 1: Failing tests** — `MSL-L007` warning, message
      `TST_BRK_0013: locator 'Brake at 30 m' matches no scenario of REQ_BRK_0010`,
      location at the trailer line; locator on unresolved target → no L007;
      locator on a Reference or criteria-less target → no L007; `MSL-L008` on
      `Allocated-to: SWC_X [foo]`; `MSL-B060` on the second duplicate scenario,
      location at its line; `MSL-B061` info on an empty name; a locator naming a
      duplicate → `MSL-L007` (not addressable).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit
      `feat(core): add locator and scenario-name
  diagnostics`.

### Task 6: Lockfile, `refs` and `fmt` use the shared split

**Files:** `core/lock/model.ts`, `core/lock/resolve.ts`, `core/lock/*_test.ts`,
`core/refs/mod.ts` + test, formatter CSV-split site + test.

- [ ] **Step 1: Failing tests** — lock edge for `Satisfies: STK_1 [AC one]` has
      `authoredTarget "STK_1"`, `locator "AC one"`, serialized
      `locator = "AC one"`; old lockfile without `locator` parses; sort key
      includes locator; `Derived-from: ISO-1 [§4.3 part]` yields one quad,
      target `ISO-1`; `canonicalizeRefs` rewrites `STK_1` in
      `Satisfies: STK_1 [STK_1 case]` only for the target, not inside the
      locator; `fmt` of `Verifies: A [x, y], B` produces two lines
      `Verifies: A [x, y]` and `Verifies: B`, and keeps `[Brake  at 20 m]` as
      authored with one space before `[`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:**
      `deno test
  packages/markspec/core/lock packages/markspec/core/refs
  packages/markspec/core/formatter`
      PASS.
- [ ] **Step 5:** Commit
      `feat(core): apply locator-aware split to lock, refs
  and fmt`.

### Task 7: Criterion-level coverage report

**Files:** `core/reporter/mod.ts`, `mod_test.ts`; snapshot in `tests/e2e/`.

**Interfaces — Produces:** in coverage JSON, an optional key:

```json
"criteria": {
  "total": 2, "verified": 1,
  "entries": [{
    "displayId": "REQ_BRK_0010", "title": "…", "state": "partial",
    "verified": 1, "total": 2,
    "criteria": [
      { "name": "Brake at 20 m", "addressable": true, "verifiedBy": ["TST_BRK_0012"] },
      { "name": "No braking beyond 40 m", "addressable": true, "verifiedBy": [] }
    ]
  }]
}
```

`state` ∈ `"full" | "partial" | "none"` per §12.1. Whole-entry `Verifies: R`
adds the verifier to every criterion of `R`. Only `verifies` links with
`locatorResolved: true` or no locator count; `satisfies` locators never count.
An entry with criteria `[]` uses the whole-entry rule.

Markdown section `## Criteria` (one block per entry):

```text
REQ_BRK_0010  Emergency braking for close obstacles  1/2 criteria verified
  ✓ Brake at 20 m              ← TST_BRK_0012
  ✗ No braking beyond 40 m     ← no verifier
```

CSV adds rows `Criteria total,N` and `Criteria verified,N`.

- [ ] **Step 1: Failing tests** — partial, full via whole-entry verify, none;
      unresolved-locator verifier does not count; `satisfies` locator does not
      count; project without criteria → JSON has no `criteria` key and md / csv
      unchanged (compare to the existing snapshot); `--scope` / `--label`
      filters apply to the criteria section too.
- [ ] **Step 2:** FAIL. **Step 3:** implement
      `computeCriterionCoverage(result,
  entries)` beside `computeCoverage`.
      **Step 4:** PASS, then Task 0 tests PASS.
- [ ] **Step 5:** Commit `feat(core): add criterion-level coverage report`.

### Task 8: Docs (spec + guide) and #924

**Files:** `docs/spec/model/relations.md` ("Reference-target locators" →
"Locators": grammar, relation table §10.2, normalization, the compiled `locator`
/ `locatorResolved` fields — replaces the "preserved verbatim" sentence);
`docs/spec/language/language.md` §8.4 (`MSL-L007`, `MSL-L008`) and the body
family table (`MSL-B060`, `MSL-B061`); `docs/guide/cli.md` (`report coverage`
criteria section, md and json example); `docs/guide/authoring.md` (addressing a
scenario); lockfile spec page (`locator` key);
`docs/architecture/adr-026-display-id-trace-resolution.md` amendment note (§10.4
effects).

- [ ] **Step 1:** Write the docs; every example is a real fixture run through
      `markspec check`.
- [ ] **Step 2:** `just fmt && just build`; PASS. `markspec check docs/` shows
      no new findings.
- [ ] **Step 3:** Commit
      `docs(spec): document scenario locators and criterion
  coverage`.
      Reference `Refs #924` (locator part) in the PR body.

## Alternatives considered

- **Pull `@cucumber/gherkin` into this slice.** Rejected for this slice: larger
  diff, and locators need names only. The AST slice replaces the scanner body
  behind `buildCriteria`.
- **Ordinal or tag locators.** Rejected in the design (§14): unstable or extra
  markup.
- **New report kind `criteria`.** Rejected (decision 6): an extra command for
  data that belongs with coverage.
- **A no-verifier warning now.** Deferred until the strict / lightweight flag is
  designed (decision 4).
- **Keep `LOCATOR_BEARING_ATTRS` in the compiler.** Rejected: four consumers
  would keep diverging (§10.2).

## Trace links

- Implements: design §10, §11 (edge shape), §12.1, §13 (rows 2–5); decisions D6,
  D7, D12, D13.
- Epic: #915, slice "Scenario locators on `Verifies` / `Satisfies` +
  criterion-level coverage report".
- Refs: #924 (locator output claim); ADR-026 (amended); ADR-022 (additive
  lockfile field); ADR-012 (code assignment).
