# Partition-Once Validator Refactor (#771 PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ~11 scattered `isUpstreamEntry` emit-loop guards with one
named partition concept (`emittableEntries` in `core/model`), computed once per
entry-set generation in the two orchestrators (`validate`, `runPipeline`), so a
future validation stage cannot silently re-introduce the #765 class of leak
(diagnostics emitted against read-only upstream entries). Plus the two
consistency crumbs from #771: an MSL-R083 target-side upstream exemption
(matching #765's MSL-L004 fix) and `computeCoverage` using the shared predicate.

**Architecture:** `emittableEntries(entries)` lives in `core/model` beside
`isUpstreamEntry` (every guard site already imports from model — no new edges).
Orchestrators compute `emittable` from the input generation and `finalEmittable`
from the post-classification generation; emit-only helpers receive the emittable
list (guards deleted), resolution-map builders keep the full list.
`classifyEntriesStage` keeps its pass-through branch by design (a domain rule —
upstream `type` comes from its own compile; filtering its input would drop
upstream from `finalEntries` or reorder first-wins ties). `validateTypl` keeps
its own boundary filter (typl-inert upstream is that subsystem's contract) but
expresses it via the shared helper.

**Tech Stack:** Deno/TypeScript, `@std/assert`, colocated `_test.ts`.

## Global Constraints

- `core/mod.ts` is the library boundary; dependency flow model ← validator ←
  compiler ← reporter, no cycles.
- Zero warnings from `deno check` / `deno lint` / `deno test`.
- Behavior-preserving except the one intended change (MSL-R083 no longer fires
  when the trace TARGET is an upstream entry). Diagnostic emission order must
  not change: iterating a filtered array preserves the relative order the
  guarded loops produced.
- OUT OF SCOPE: `traceability.ts:202`'s MSL-L004 target-side guard (different
  mechanism — filters upstream _targets_, stays as-is); LSP navigability guards
  (`definition.ts`, `code_lens.ts` — centralized in #787); the LSP
  `WorkspaceIndex.getTypeRegistry()` building from all entries (pre-existing,
  separate concern).
- One squashed commit at PR time (intermediate task commits squashed in the
  final task).

---

### Task 1: `emittableEntries` in core/model (+ type-guard `isUpstreamEntry`)

**Files:**

- Modify: `packages/markspec/core/model/mod.ts` (beside `isUpstreamEntry`)
- Test: `packages/markspec/core/model/mod_test.ts` (or the model test file that
  already covers `isUpstreamEntry` — check with
  `grep -rln "isUpstreamEntry" packages/markspec/core/model/`)
- Modify: `packages/markspec/core/mod.ts` (barrel export)

**Interfaces:**

- Consumes: existing `Entry`, `EntryOrigin`, `isUpstreamEntry`.
- Produces: `emittableEntries(entries: readonly Entry[]): readonly Entry[]` —
  Tasks 2–6 call exactly this. Also narrows `isUpstreamEntry` into a type
  predicate:
  `isUpstreamEntry(entry: Entry): entry is Entry & { origin:
  Extract<EntryOrigin, { kind: "upstream" }> }`
  — Task 6 (reporter) relies on the narrowing to read `entry.origin.upstreamId`
  after the check.

- [ ] **Step 1: Read the current `isUpstreamEntry` + write the failing test**

Read `packages/markspec/core/model/mod.ts` around `isUpstreamEntry` first (its
exact current signature and the `EntryOrigin` union). Then add to the model test
file:

```typescript
Deno.test("emittableEntries: filters upstream, keeps project + corpus, preserves order", () => {
  const mk = (displayId: string, origin?: Entry["origin"]): Entry =>
    ({
      shape: "Authored",
      displayId,
      title: "t",
      body: "",
      rawAttributes: [],
      location: { file: "/p/a.md", line: 1, column: 1 },
      ...(origin ? { origin } : {}),
      // deno-lint-ignore no-explicit-any
    }) as any;
  const project = mk("STK_0001");
  const corpus = mk("STD_0001", {
    kind: "profile",
    profileId: "p",
    profileVersion: "1.0.0",
  });
  const upstream = mk("SYS_0001", {
    kind: "upstream",
    upstreamId: "prod",
    version: "v1",
  });
  const result = emittableEntries([upstream, project, corpus]);
  assertEquals(result.map((e) => e.displayId), ["STK_0001", "STD_0001"]);
});
```

(Adjust the `mk` fixture to whatever minimal-Entry helper the model test file
already uses — copy its existing pattern if one exists rather than the `as any`
cast.)

- [ ] **Step 2: Run to verify it fails** —
      `deno test packages/markspec/core/model/` → FAIL (no export).

- [ ] **Step 3: Implement**

In `core/model/mod.ts`, next to `isUpstreamEntry`:

```typescript
/**
 * The emit-side of the federated-upstream validation partition (#771;
 * ADR-031 design §4.7). Upstream entries are read-only graph citizens:
 * they stay in every RESOLUTION map (so project links targeting them
 * resolve) but no validation stage may EMIT diagnostics against them.
 * Validators loop over this filtered list; resolution-map builders keep
 * the full input list. Adding a new validation stage? Iterate the
 * emittable list — never the raw entry set.
 */
export function emittableEntries(
  entries: readonly Entry[],
): readonly Entry[] {
  return entries.filter((entry) => !isUpstreamEntry(entry));
}
```

And narrow `isUpstreamEntry` to a type predicate (keep its body unchanged):

```typescript
export function isUpstreamEntry(
  entry: Entry,
): entry is Entry & { origin: Extract<EntryOrigin, { kind: "upstream" }> } {
```

Add `emittableEntries` to the `core/mod.ts` barrel next to the existing
`isUpstreamEntry` export.

- [ ] **Step 4: Run to verify pass** — `deno test packages/markspec/core/model/`
      and `deno check packages/markspec/core/mod.ts` → PASS.

- [ ] **Step 5: Commit** —
      `git commit -m "refactor(core): add emittableEntries partition helper"`

---

### Task 2: Acceptance anchor — comprehensive upstream-silence pipeline test

This is the #765-class regression net: one upstream entry violating a rule from
EVERY emit stage must produce ZERO diagnostics through `runPipeline`, while
remaining a live resolution target. Write it BEFORE touching the pipeline (it
must pass both before and after the refactor — it pins the partition, not the
implementation).

**Files:**

- Test: `packages/markspec/core/validator/pipeline_test.ts` (append; follow the
  file's existing fixture style — read it first)

**Interfaces:**

- Consumes: `runPipeline`, existing test fixtures/helpers in that file.

- [ ] **Step 1: Read `pipeline_test.ts`'s existing upstream fixtures** (grep
      `upstream` in it — slice 4 added some) and append a test shaped like:

```typescript
Deno.test("pipeline: upstream entry violating every emit stage stays silent but resolves", () => {
  // Upstream entry engineered to trip, if it were emittable:
  // - Stage 1  checkStructural: missing Id (MSL-R003/I003)
  // - Stage 1  checkStructural: unknown attribute (MSL-R010)
  // - Stage 1.5 validateCoreTypeAttribute: bad Type (MSL-T020)
  // - Stage 1.5 validateModalKeywords: uppercase SHALL (MSL-M060)
  // - Stage 1.6 trace_types: Satisfies target of wrong core type
  // - Stage 1.7 discipline: unknown Discipline kind (MSL-T025)
  // - Stage 4  traceability: unresolvable Satisfies (MSL-L006/T014)
  // (exact fixture shape: copy the file's existing upstream-entry builder)
  const upstream: Entry = {
    ...makeEntry("UP_9999", { /* per the file's helper */ }),
    origin: { kind: "upstream", upstreamId: "prod", version: "v1" },
  };
  const project = makeEntry("STK_0001", {
    attributes: [{ key: "Satisfies", value: "UP_9999" }],
  });
  const result = runPipeline([upstream, project], profileFixture);
  // Zero diagnostics attributed to the upstream entry:
  const atUpstream = result.diagnostics.filter(
    (d) =>
      d.message.includes("UP_9999") &&
      d.location?.file === upstream.location.file,
  );
  assertEquals(atUpstream, []);
  // ...and the project entry's link to it resolves (no MSL-L006/T014):
  assertEquals(
    result.diagnostics.filter((d) =>
      d.code === "MSL-L006" || d.code === "MSL-T014"
    ),
    [],
  );
});
```

The exact fixture construction MUST reuse the file's existing entry/profile
builders — do not invent a parallel fixture system. If an equivalent
upstream-silence test already exists from slice 4, EXTEND it to cover the stages
listed above instead of duplicating.

- [ ] **Step 2: Run to verify it passes on the CURRENT code** —
      `deno test packages/markspec/core/validator/pipeline_test.ts` → PASS (the
      guards exist today; this test is the net that must stay green through
      Tasks 3–5).

- [ ] **Step 3: Commit** —
      `git commit -m "test(core): pin upstream validation-exemption across all pipeline stages"`

---

### Task 3: Partition the orchestrators (`validate`, `runPipeline`)

**Files:**

- Modify: `packages/markspec/core/validator/mod.ts` (`validate`,
  `checkStructural`, `checkReferences` — guards at lines 98/469/489)
- Modify: `packages/markspec/core/validator/pipeline.ts` (guards at
  115/159/175/198)
- Modify: `packages/markspec/core/validator/discipline.ts` (guard at 140)
- Modify: `packages/markspec/core/typl/validator.ts` (filter at 53)

**Interfaces:**

- Consumes: Task 1's `emittableEntries` (model import — every file already
  imports from `../model/mod.ts` / `../model/mod.ts` respectively).
- Produces: private signature changes only —
  `checkStructural(emittable, diagnostics)`,
  `checkReferences(emittable, all, diagnostics)`. `validateDiscipline`'s public
  signature is UNCHANGED (first param becomes the emittable list at the call
  site; its internal guard is deleted).

- [ ] **Step 1: `validator/mod.ts`**

```typescript
export function validate(entries: readonly Entry[]): ValidateResult {
  const diagnostics: Diagnostic[] = [];

  // Partition once (#771): upstream entries are read-only graph citizens
  // (ADR-031 §4.7) — emit loops below iterate `emittable`; resolution
  // maps (checkReferences) still index the full `entries` list so links
  // TO an upstream entry keep resolving.
  const emittable = emittableEntries(entries);

  checkStructural(emittable, diagnostics);
  checkReferences(emittable, entries, diagnostics);

  const typlResult = validateTypl(entries);
  diagnostics.push(...typlResult.diagnostics);

  const valid = !diagnostics.some((d) => d.severity === "error");
  return { diagnostics, valid };
}
```

`checkStructural(emittable: readonly Entry[], diagnostics: Diagnostic[])`:
delete the `if (isUpstreamEntry(entry)) continue;` and its 4-line comment;
rename the parameter to `emittable` and note in its doc line that the caller
pre-filtered (upstream never enters the duplicate maps — same as before, they
were built inside the guarded loop).

`checkReferences(emittable: readonly Entry[], all: readonly Entry[],
diagnostics: Diagnostic[])`:
the `byDisplayId`/`byId` maps build from `all`; the two emit loops (Supersedes
at ~469, References at ~489) iterate `emittable` with their guards deleted. Keep
the comments explaining refs TO upstream still resolve, now pointing at the
`all`-built maps.

Drop the now-unused `isUpstreamEntry` import from `validator/mod.ts`; add
`emittableEntries`.

- [ ] **Step 2: `pipeline.ts`**

At the top of `runPipeline`, after `const diagnostics: Diagnostic[] = [];`:

```typescript
// Partition once (#771): emit loops iterate `emittable` /
// `finalEmittable`; resolution maps build from the full lists so
// upstream entries stay live link targets (ADR-031 §4.7). A new
// stage added here must loop over the emittable list.
const emittable = emittableEntries(entries);
```

- Stage 1.5 loop: `for (const entry of emittable) {` — guard + its comment
  deleted (keep one line:
  `// Emit loops iterate the emittable partition —
  see the top of runPipeline.`
  on the stage comment).
- Stage 1.6: `validateTraceTargetTypes(emittable, entries)` (Task 4 changes the
  signature — do Tasks 3+4 in one type-check cycle, or reorder the calls; they
  land in the same commit series so either order compiles by Task 4's Step 3).
- Stage 1.7: `entriesByDisplayId` still builds from `entries` (resolution); call
  becomes
  `validateDiscipline(emittable, entriesByDisplayId,
  disciplineRegistry)`.
- Stage 2 (`classifyEntriesStage`) and Stage 2.5 (`normalizeListValues`):
  UNCHANGED — add a one-line comment at Stage 2:
  `// classifyEntriesStage
  handles upstream itself (pass-through, never re-classified) — it is a
  transform, not an emit loop; see types.ts.`
- After Stage 2.5, before Stage 2.4's loop... note Stage 2.4 currently runs
  BEFORE 2.5 in source order — keep source order exactly; insert after the Stage
  2 block:

```typescript
// Post-classification generation: Stage 2 produced new Entry objects,
// so re-derive the emit partition for the stages below.
const finalEmittable = emittableEntries(finalEntries);
```

Wait — Stage 2.5 REASSIGNS `finalEntries` (normalizeListValues map), so compute
`finalEmittable` AFTER the Stage 2.5 block, and change Stage 2.4's loop... Stage
2.4 runs before 2.5 in the current source. Precisely:

- Stage 2.4 loop (`inferTypeFromLateStageChain`, guard at 159): iterate
  `emittableEntries(finalEntries)` is wasteful twice; instead MOVE the
  `finalEmittable` computation between Stage 2 and Stage 2.4, then have Stage
  2.5 re-derive: Stage 2.5 maps `finalEntries` and normalization preserves
  `origin`, so recompute once more after it. That is two filters; simpler and
  correct: compute `let finalEmittable =
    emittableEntries(finalEntries);`
  after Stage 2, and after the Stage 2.5 reassignment add
  `finalEmittable = emittableEntries(finalEntries);`.
- Stage 3 loop (guard at 175): `for (const entry of finalEmittable) {`.
- Stage 4: `graph`/`byDisplayId` maps still build from `finalEntries` (comment
  already says "never filtered" — keep it); emit loop (guard at 198):
  `for (const entry of finalEmittable) {`.

- [ ] **Step 3: `discipline.ts`** — delete the guard at 140 + its comment;
      update the doc comment:
      `@param entries Emittable entries to walk (the
      caller passes the #771 partition — upstream entries are exempt
      emitters); entriesByDisplayId still covers the full set for channel-4
      derivation.`
      Drop the unused `isUpstreamEntry` import.

- [ ] **Step 4: `typl/validator.ts`** — replace
      `entries.filter((entry) => !isUpstreamEntry(entry))` with
      `emittableEntries(entries)`; swap the import; trim the doc-comment
      sentence "this mirrors the validation exemption every other per-entry
      validator stage applies via `isUpstreamEntry`" to "this is the same #771
      `emittableEntries` partition the validator orchestrators apply".

- [ ] **Step 5: Verify** —
      `deno check packages/markspec/core/mod.ts && deno lint packages/markspec/core/ && deno test packages/markspec/core/`
      → all PASS including Task 2's anchor test (Task 4 must land first if the
      Stage 1.6 call-signature change was taken here — see Task 4 Step 3 note;
      run the full check after both).

- [ ] **Step 6: Commit** —
      `git commit -m "refactor(core): partition emit loops once in validate and runPipeline"`

---

### Task 4: `trace_types.ts` — partition signature + R083 target-side exemption

**Files:**

- Modify: `packages/markspec/core/validator/trace_types.ts`
- Test: `packages/markspec/core/validator/trace_types_test.ts` (read first;
  follow existing fixture style — check the filename actually used:
  `ls packages/markspec/core/validator/*test*`)

**Interfaces:**

- Consumes: Task 1's `emittableEntries` concept (via caller), existing
  `isUpstreamEntry` (target-side checks).
- Produces:
  `validateTraceTargetTypes(emittable: readonly Entry[], all:
  readonly Entry[]): readonly Diagnostic[]`
  — pipeline (Task 3 Stage 1.6) calls it with `(emittable, entries)`.

- [ ] **Step 1: Write the failing target-side test**

An upstream target that DOES resolve to an incompatible core type must not fire
MSL-R083 (the #765 MSL-L004 class, target side). First read
`type_resolution.ts`'s `resolvedCoreType` to build a fixture whose inferred core
type is real but incompatible (e.g. an upstream entry whose `Type:` raw
attribute or display-ID shape resolves to a core type outside the rule's allowed
set — copy whatever incompatible-type fixture the existing R083 tests use and
add `origin: { kind: "upstream", ... }` to the TARGET).

```typescript
Deno.test("R083: upstream target with incompatible inferred type is exempt", () => {
  // source: project entry with e.g. `Verified-by: UP_TARGET` (pick the
  // relation the existing R083 tests use); target: same fixture the
  // existing R083-fires test uses, PLUS upstream origin.
  const diags = validateTraceTargetTypes([source], [source, upstreamTarget]);
  assertEquals(diags.filter((d) => d.code === "MSL-R083"), []);
});
```

Also add the mirror assertion to an existing R083-fires test to pin that a
NON-upstream target still fires (should already exist — verify, don't
duplicate).

- [ ] **Step 2: Run to verify the new test fails** (R083 fires today when the
      inferred type resolves) — if it does NOT fail because `resolvedCoreType`
      returns undefined for the fixture, adjust the fixture until the pre-fix
      code fires R083; the exemption must be observable.

- [ ] **Step 3: Implement**

```typescript
export function validateTraceTargetTypes(
  emittable: readonly Entry[],
  all: readonly Entry[],
): readonly Diagnostic[] {
  const byDisplayId = new Map<string, Entry>();
  const byId = new Map<string, Entry>();
  for (const e of all) {
    if (!byDisplayId.has(e.displayId)) byDisplayId.set(e.displayId, e);
    if (e.id && !byId.has(e.id)) byId.set(e.id, e);
  }

  const diagnostics: Diagnostic[] = [];

  for (const entry of emittable) {
    // (guard at old line 130 deleted)
```

In BOTH R083 loops (the `TRACE_RULES` loop and the polymorphic `Caused-by`
loop), after `if (!resolved) continue;` add:

```typescript
// Target-side exemption (#771, matching #765's MSL-L004 fix): an
// upstream target's type comes from a foreign vocabulary — never
// judge core-type compatibility against it.
if (isUpstreamEntry(resolved)) continue;
```

MSL-R084 (shape) and MSL-R081/R082 (retired/draft target) are deliberately NOT
exempted — shape and Deprecated/DRAFT are core authored facts, not profile
vocabulary; a retired upstream target is a real signal.

Update the pipeline call site (Task 3 Stage 1.6) to
`validateTraceTargetTypes(emittable, entries)` and this module's doc comment.
Keep the `isUpstreamEntry` import (now target-side only).

- [ ] **Step 4: Verify** — `deno test packages/markspec/core/validator/` → PASS
      (new test + Task 2 anchor + existing R083 suite).

- [ ] **Step 5: Commit** —
      `git commit -m "refactor(core): trace_types takes the emit partition; exempt upstream R083 targets"`

---

### Task 5: `classifyEntriesStage` comment (no behavior change)

**Files:**

- Modify: `packages/markspec/core/validator/types.ts` (comment at ~263 only)

- [ ] **Step 1:** Replace the guard's comment first sentence with:
      `//
      Deliberately NOT the #771 emittableEntries partition: this stage is a
      TRANSFORM, not an emit loop — upstream entries must pass through into
      the output (they stay in finalEntries as resolution targets, in
      original order for first-entry-wins ties), and their type comes from
      their OWN compile (design §4.5/D6) — the consumer never re-classifies.`
      Keep the code identical.

- [ ] **Step 2: Commit** —
      `git commit -m "docs(core): document why classifyEntriesStage keeps its upstream branch"`

---

### Task 6: `computeCoverage` shared predicate

**Files:**

- Modify: `packages/markspec/core/reporter/mod.ts` (~line 226)

**Interfaces:**

- Consumes: Task 1's type-guard `isUpstreamEntry` (narrowing gives
  `entry.origin.upstreamId`).

- [ ] **Step 1:** Read the surrounding `computeCoverage` block, then change

```typescript
const isReferenceLeaf = origin?.kind === "upstream" &&
  !(dependencyUpstreamIds?.has(origin.upstreamId) ?? false);
```

to use the shared predicate (exact local variable names per the surrounding code
— if the block destructures `origin` from the entry, switch the check to the
entry):

```typescript
const isReferenceLeaf = isUpstreamEntry(entry) &&
  !(dependencyUpstreamIds?.has(entry.origin.upstreamId) ?? false);
```

Add `isUpstreamEntry` to the reporter's model import.

- [ ] **Step 2: Verify** —
      `deno test packages/markspec/core/reporter/ && deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/report_test.ts`
      → PASS.

- [ ] **Step 3: Commit** —
      `git commit -m "refactor(core): computeCoverage uses shared isUpstreamEntry predicate"`

---

### Task 7: Docs — ADR-031 D4 partition sentence

**Files:**

- Modify: `docs/architecture/adr-031-federated-upstream-resolution.md` (§D4: the
  sentence "`isUpstreamEntry` gates the validator and lint loops"; the as-built
  inventory)

- [ ] **Step 1:** Change the D4 sentence to:
      `` `emittableEntries`
      (`core/model`) partitions the validators' emit side once per run —
      upstream entries never enter an emit loop but stay in every resolution
      map (#771); `isUpstreamEntry` remains the target-side and reporter
      predicate. ``
      In the as-built list, extend the `core/model/mod.ts` parenthetical with
      `` `emittableEntries` ``.

- [ ] **Step 2:**
      `dprint fmt docs/architecture/adr-031-federated-upstream-resolution.md`

- [ ] **Step 3: Commit** —
      `git commit -m "docs(docs): record emittableEntries partition in ADR-031"`

---

### Task 8: Garden, full build, squash, PR

- [ ] **Step 1:** Run the `sdd-gardening` skill — this plan moves to
      `docs/archive/plans/`; ADR-031 edit is the durable record. `docs/wip/`
      must hold nothing from this story.
- [ ] **Step 2:** `just fmt && just build && deno fmt --check && dprint check` →
      all pass. Also
      `grep -rn "isUpstreamEntry" packages/markspec/core
      --include="*.ts" | grep -v _test`
      and confirm the survivors are exactly: model (definition),
      `emittableEntries` body, `types.ts` transform branch, `trace_types.ts`
      target-side, `traceability.ts` target-side (L004), `typl` via helper
      (gone), reporter predicate, corpus.ts if any (pre-existing). Any other
      emit-side survivor is a missed site.
- [ ] **Step 3:** Squash: `git reset --soft origin/main` (re-fetch first; if
      main moved, REBASE first — #797 taught that ADR-031 attracts concurrent
      edits), commit `-F` a message file titled
      `refactor(core): partition upstream-exempt entries once in the validator (#771)`
      with `Part of #771.` — NOT `Closes` (the polish PR 3 remains).
- [ ] **Step 4:** Push (`-u`, ≥300s timeout — pre-push runs just check),
      `gh
      pr create --body-file …`.
- [ ] **Step 5:** Run `/review` on the PR; post findings as a PR comment.
