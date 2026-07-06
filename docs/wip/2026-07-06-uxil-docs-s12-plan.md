# S12 (#730) — uxil docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Document what the uxil epic (#717) actually shipped: a new ADR-034 for
uxil, a rewritten ADR-019 folding in the typl namespacing tier, an expanded uxil
spec chapter, and a new uxil guide chapter.

**Architecture:** Docs-only story, no code changes. Two ADRs written directly
(need one coherent cross-epic narrative); the spec chapter and guide chapter
delegated to two parallel content-generation agents, each given the relevant
`core/uxil/*.ts` source plus the analogous typl chapter as a structural
template; a final fact-check pass across all four documents before the PR.

**Tech Stack:** Markdown (dprint-formatted), no code/tests — this repo's
`docs/architecture/`, `docs/spec/language/`, `docs/guide/` conventions.

## Global Constraints

- Run `just fmt` (dprint) after every file edit; `dprint check` must pass before
  each commit.
- No `Id:` handwriting, no code changes — this is out of scope per the design
  doc's "Out of scope" section.
- Every new cross-reference (ADR ↔ spec ↔ guide) must resolve to a real
  anchor/file — verified manually in Task 6.
- Guide chapter must NOT mention the payload bridge (design Decision 2).
- Commit message scope: `docs` (git-std allowed scopes include `docs`).

---

### Task 1: New ADR-034 — uxil: UX Interaction DSL

**Files:**

- Create: `docs/architecture/adr-034-uxil-interaction-dsl.md`

**Content spec** (mirror `docs/architecture/adr-019-typl-type-dsl.md`'s section
structure: Status / Context / Decision / Consequences / Alternatives considered
/ Implementation status / See also):

- **Status**: Accepted, dated 2026-07-06. "Shipped in epic #717 across ten
  stories (#719–#728); story #729 (S11, payload bridge) deferred/parked."
- **Context**: automotive HMI teams have a deployed
  `screenId/elementId[:itemKey]` identity convention (shared by UI Automator /
  Compose / Espresso selectors and OTel-aligned analytics) but nothing
  _declares_ which ids exist or what each element affords — so specs, tests,
  journeys, and telemetry cannot be validated against the UI surface. typl
  proved the declaration+registry+diagnostics pattern; uxil is its sibling for
  UI/HMI surfaces.
- **Decision** — cover each of these as its own subsection:
  1. **Reference grammar**: a `ux:` URI reference, scheme-optional (a bare
     `media.home/play` wire form parses identically to `ux:media.home/play`
     except for the `hasScheme` flag — wire-compatibility contract). Grammar
     module: `core/uxil/grammar.ts` (`parseUxRef`).
  2. **Three declaration forms** (`core/uxil/ast.ts`):
     - Root: `` `ux:surface : kind @state, state, …` `` — exactly one per
       declaring entry (enforced at assembly time).
     - Element bullet:
       `` `/element : verb[, verb…] [: {key}] [@state, …] [-> nav-ref]` `` plus
       a trailing prose event dictionary (the paragraph text after the leading
       code span).
     - Child-surface bullet: `` `.path @state` `` — nested bullets are its
       elements.
  3. **Two closed, core-owned vocabularies** (`core/uxil/vocab.ts` — extension
     is a markspec release decision per ADR-009, not a profile concern):
     - 3 kinds: `screen` (navigable, stateful, visual), `panel` (not navigable,
       not stateful, visual), `agent` (not navigable, stateful, not visual).
     - 11 verbs: `activate`, `toggle`, `select`, `adjust`, `input`, `scroll`,
       `drag`, `dismiss`, `ask` (none require a nav target, none exclusive);
       `navigate` (requires a `-> target`); `observe` (exclusive — cannot
       combine with other verbs on the same element).
  4. **Base resolution**: reuses the shared, DSL-agnostic `core/decl/resolve.ts`
     engine (innermost-base-wins) that also backs typl's published tier. uxil's
     child-surface joins are always relative — there is no absolute internal
     path form — simpler than typl's absolute/relative duality.
  5. **Corpus registry + machine projection**: `buildUxRegistry` (
     `core/uxil/registry.ts`) indexes every declared surface by absolute path;
     duplicates are NOT collapsed (surfaced via UXIL-015). `projectUxRegistry`
     (`core/uxil/projection.ts`) produces a deterministic, JSON-serialisable
     `UxProjection` (surfaces sorted by id, elements sorted by name, states
     sorted, verbs kept in declaration order).
  6. **Diagnostics**: the 26-code `UXIL-0xx` family
     (`core/uxil/
     diagnostics.ts`), documented in full in the spec chapter
     (Task 3) — do not repeat the catalogue table in the ADR, just note the
     count and link to the spec chapter.
  7. **Activation**: profile-gated via `declares: ux-surface` on a type. Absent
     from the active profile chain → uxil-looking content stays inert and
     opaque, drawing no diagnostics (the Tier-1 stability guarantee, S1 #719).
  8. **LSP**: hover, completion, go-to-declaration over the registry (S10 #728).
- **Consequences**:
  - New standalone module `core/uxil/` mirroring `core/typl/` module-for-module
    (`ast.ts`, `lexer.ts`, `grammar.ts`, `recognize.ts`, `diagnostics.ts`,
    `surfaces.ts`, `assemble.ts`, `registry.ts`, `citations.ts`, `validator.ts`,
    `projection.ts`, `mod.ts`).
  - **No `Entry` model change.** Call this out explicitly as a deliberate
    contrast with typl (which added `Entry.types`): uxil declarations are parsed
    fresh from code spans/bullets on every `assembleUxSurface` call, never
    persisted on the `Entry`. No `CORE_SCHEMA_VERSION` bump.
  - `core/validator/uxil_family.ts` wires the diagnostics family into
    `check`/`compile`/LSP, gated on the same `declares: ux-surface` profile
    designation.
- **Alternatives considered**:
  - _Reuse typl's DSL for uxil_ — rejected: different concern (typed data
    identifiers vs. UI/HMI interaction surfaces) and a different vocabulary
    shape (kind+verb+state vs. kind+shape) that doesn't map cleanly onto typl's
    grammar.
  - _Add uxil declarations as an `Entry` field_ (typl's approach) — rejected: no
    consumer needs entry-level typed access to a surface tree; the corpus
    registry/projection built at compile/LSP time is sufficient, and staying off
    the `Entry` model avoids a schema bump.
- **Deferred**: S11 payload bridge (#729, parked 2026-07-06). State plainly that
  zero code was written. Settled syntax (if/when built): an optional
  `$dotted.name` clause inside the element code span, e.g.
  `` `/favorite_toggle : toggle : {track_id} $media.favorite_event` ``. List the
  three revisit triggers verbatim from #729's parking rationale: (1) a concrete
  downstream surface needs a published-typl payload beyond its verb's canonical
  shape; (2) the log-validator/codegen/analytics-manifest consumer lands; (3)
  canonical verb payload shapes (a `payload` column on `VerbInfo`) get
  implemented.
- **Implementation status**: list all ten shipped stories with their PR numbers
  (S1 #719/PR#734, S2 #720/PR#736, S3 #721/PR#738, S4 #722/PR#737, S5
  #723/PR#749, S6 #724/PR#772, S7 #725/PR#779, S8 #726/PR#803, S9 #727/PR#808,
  S10 #728/PR#810) plus "S11 (#729) deferred — no PR."
- **See also**:
  `[ADR-019 — typl: Type Specification DSL](adr-019-typl-type-dsl.md)`,
  `[ADR-009 — Core / Profile Boundary](adr-009-core-profile-boundary.md)`,
  `[Language reference: uxil](../spec/language/uxil.md)`,
  `[Guide: Using uxil in your entries](../guide/uxil.md)`.

- [ ] **Step 1: Write `docs/architecture/adr-034-uxil-interaction-dsl.md`**
      covering every bullet in the content spec above, in ADR-019's section
      order and prose style (short paragraphs, code spans for identifiers,
      tables for the kind/verb vocabularies).

- [ ] **Step 2: Format and check**

  Run:
  `just fmt && dprint check docs/architecture/adr-034-uxil-interaction-dsl.md`
  Expected: no diff from `just fmt`; `dprint check` exits 0.

- [ ] **Step 3: Commit**

  ```bash
  git add docs/architecture/adr-034-uxil-interaction-dsl.md
  git commit -m "docs(docs): add ADR-034 uxil interaction DSL"
  ```

---

### Task 2: Rewrite ADR-019 to fold in the published tier + table surface

**Files:**

- Modify: `docs/architecture/adr-019-typl-type-dsl.md`

**Content spec** (read the current file first — it already has the S5/S6 addenda
bolted on at the bottom; this task folds that content into the primary sections
and removes the now-redundant addenda):

- **Decision** section: after the existing binding/typedef statement forms, add:
  - `namespace` as a 10th kind keyword — scaffolding, not a symbol; carries no
    shape; declares a base path for relative references; exempt from
    declared-once (the same namespace may serve as root in more than one entry,
    e.g. a contract split across files).
  - The published tier: a dotted `$a.b.c` binding (≥2 segments) is a corpus-wide
    symbol declared exactly once and citable from any entry (contrast with a
    bare `$Name`, which stays entry-local — two entries each declaring `$Speed`
    are independent symbols). A `: namespace` declaration establishes the base a
    relative `$.name` reference resolves against (innermost enclosing namespace
    wins, falling back to the entry's root namespace) via the shared
    `core/decl/resolve.ts` engine. An entry may have at most one root namespace.
  - The table surface as a 4th Markdown surface alongside fence/bullet/ inline:
    a GFM table row `$name | kind shape | description` is one binding; the row
    recognizer reconstructs a `$name : kind shape` source string that the same
    `parseTyplBlock` parses. A shape containing `|` must escape each pipe as
    `\|`. A `Table:` caption may carry a published base that scopes the table's
    relative rows.
- **Consequences**: update "8 new diagnostic codes `TYPL-001..008`" to "12
  diagnostic codes `TYPL-001..012`" and list what TYPL-009..012 mean (duplicate
  published declaration / relative ref with no base / citation of undeclared
  published symbol / multiple root namespaces).
- **Alternatives considered**: add one paragraph, keeping the historical
  reversal narrative: the original "GFM bindings table … rejected" entry is
  **reversed** by the table surface — two things changed since the original
  2026-05-25 decision: a shape carrying `|` is now authored with the standard
  GFM `\|` escape (the cell un-escapes before typl parses it), and ADR-029's
  whole-document dprint pass now preserves table line structure. The table is
  offered as an _additional_ surface, not the primary one.
- **Implementation status**: change "All eight implementation slices are merged"
  to note the four Markdown surfaces (fence, bullet, inline, table) and both
  tiers (entry-local, published); explicitly state "TYPL-002/003 are retired —
  deprecated, never emitted. Under the published tier, two entries declaring the
  same plain `$Name` are independent entry-local symbols, so there is no
  cross-entry consistency rule for plain names; corpus-wide agreement is
  enforced only for published (dotted) symbols via TYPL-009."
- **Remove**: the two "## Addendum: published tier (#723, ...)" and "##
  Addendum: table surface (#724, ...)" sections entirely — their content is now
  folded into Decision/Consequences/Alternatives/Implementation status above. Do
  not leave a dangling "See addendum" pointer.
- **See also**: no change needed (already links to spec + guide chapters, which
  Tasks 3–4 update).

- [ ] **Step 1: Read the current file** to confirm exact section boundaries
      before editing (headings may have shifted since the design doc was
      written).

  Run: `sed -n '1,120p' docs/architecture/adr-019-typl-type-dsl.md`

- [ ] **Step 2: Rewrite the Decision, Consequences, Alternatives considered, and
      Implementation status sections** per the content spec above, then delete
      both `## Addendum: ...` sections.

- [ ] **Step 3: Format and check**

  Run: `just fmt && dprint check docs/architecture/adr-019-typl-type-dsl.md`
  Expected: no diff from `just fmt`; `dprint check` exits 0.

- [ ] **Step 4: Commit**

  ```bash
  git add docs/architecture/adr-019-typl-type-dsl.md
  git commit -m "docs(docs): fold typl namespacing + table surface into ADR-019"
  ```

---

### Task 3 + Task 4: Delegate the spec chapter and guide chapter (parallel)

These two tasks are independent of each other and of Tasks 1–2 (they read
`core/uxil/*.ts` directly, not the ADRs) — dispatch both `Agent` calls in a
single message so they run concurrently.

#### Task 3: Expand `docs/spec/language/uxil.md`

**Files:**

- Modify: `docs/spec/language/uxil.md` (currently a 77-line stub with only
  "Activation" and "Diagnostic catalogue" sections — keep both verbatim except
  dropping the "lands with the uxil ADR (S12, #730)" forward-reference sentence,
  since this chapter IS that landing).

**Agent prompt** (dispatch via the `Agent` tool,
`subagent_type: general-purpose`, `run_in_background: false` so both results are
in hand before Task 6):

> Expand `docs/spec/language/uxil.md` in
> `/Users/sebastientasson/Workspace/driftsys/markspec/.worktrees/730-uxil-docs`
> from its current 77-line stub (keep its existing "Activation" and "Diagnostic
> catalogue" sections verbatim, but delete the sentence "The full chapter —
> reference grammar, declaration forms, base resolution, registry, and machine
> projection — lands with the uxil ADR (S12, #730)" from the top status callout,
> since this edit IS that chapter landing) into a full language-reference
> chapter, structurally mirroring `docs/spec/language/typl.md` in this same repo
> (read it first for the house style: statement-form code blocks, then a
> closed-vocabulary table, then worked Markdown examples, then a "See also"
> footer).
>
> Read these files for ground truth before writing — do not invent grammar or
> field names, use exactly what's there: `packages/markspec/core/uxil/ast.ts`,
> `packages/markspec/core/uxil/
> vocab.ts`,
> `packages/markspec/core/uxil/grammar.ts` (top doc comment for the reference
> grammar contract), `packages/markspec/core/uxil/
> registry.ts`,
> `packages/markspec/core/uxil/projection.ts`.
>
> Add these new sections, in this order, between the existing intro paragraph
> and the existing "Activation" section:
>
> 1. **Reference grammar** — the `ux:` URI form is scheme-optional: a bare wire
>    form like `media.home/play` parses identically to `ux:media.home/play`,
>    differing only in the `hasScheme` flag on the parsed `UxRef`. Show the
>    grammar shape from `ast.ts`'s `UxRef` interface (surface path segments,
>    optional state, optional element, optional key, optional verb).
> 2. **Declaration forms** — three forms, each with a worked example:
>    - Root: `` `ux:surface : kind @state, state, …` `` — exactly one per
>      declaring entry.
>    - Element bullet:
>      `` `/element : verb[, verb…] [: {key}] [@state, …] [-> nav-ref]` `` plus
>      the trailing prose after the code span as its event dictionary.
>    - Child-surface bullet: `` `.path @state` `` — its nested bullets are its
>      elements.
> 3. **Closed vocabularies** — two tables, from `vocab.ts`'s `UX_KINDS` and
>    `UX_VERBS` maps exactly:
>    - Kinds: `screen` (navigable, stateful, visual), `panel` (not navigable,
>      not stateful, visual), `agent` (not navigable, stateful, not visual).
>    - Verbs: `activate`, `toggle`, `select`, `adjust`, `input`, `scroll`,
>      `drag`, `dismiss`, `ask` (none require a nav target, none exclusive);
>      `navigate` (requires `-> target`); `observe` (exclusive — cannot combine
>      with other verbs on one element).
> 4. **Base resolution** — child-surface paths resolve against the nearest
>    enclosing ancestor surface, innermost wins, via the shared
>    `core/decl/resolve.ts` engine (same engine typl's published tier uses).
>    Unlike typl, every uxil internal join is relative — there is no absolute
>    internal path form.
> 5. **Corpus registry** — describe `UxRegistry` (`registry.ts`): keyed by
>    absolute surface path, each path maps to ALL declarations found (collisions
>    NOT collapsed — surfaced as UXIL-015). Show the `SurfaceRecord` fields
>    (path, kind, states, owningEntryDisplayId, owningEntryFile, elements,
>    location).
> 6. **Machine projection** — describe `projectUxRegistry` (`projection.ts`):
>    deterministic, JSON-serialisable `UxProjection` — surfaces sorted by id,
>    elements sorted by name, states sorted, verbs kept in declaration order.
>    Show one small worked JSON example of a `UxProjection` for a two-element
>    screen surface (make up realistic but simple content, e.g. a `media.home`
>    screen with a `play` element).
>
> At the very end, add a "## See also" section linking to
> `[ADR-034 — uxil: UX Interaction DSL](../../architecture/adr-034-uxil-interaction-dsl.md)`
> and `[Guide: Using uxil in your entries](../../guide/uxil.md)` (mirror the
> exact relative-path depth typl.md's own "See also" section uses).
>
> After writing, run `just fmt && dprint check docs/spec/language/uxil.md` from
> the repo root and fix any reported issues. Report back the final line count
> and section list.

- [ ] **Step 1: Dispatch the agent** with the prompt above.

- [ ] **Step 2: Read the resulting file** to confirm it matches the content spec
      (all 6 new sections present, existing Activation/Diagnostic catalogue
      sections intact, forward-reference sentence removed).

  Run: `grep -n "^## " docs/spec/language/uxil.md` Expected sections in order:
  Reference grammar (or similar heading), Declaration forms, Closed vocabularies
  (or similar), Base resolution, Corpus registry (or similar), Machine
  projection (or similar), Activation, Diagnostic catalogue, See also.

- [ ] **Step 3: Format and check** (repeat even though the agent should have
      done this — verify independently)

  Run: `just fmt && dprint check docs/spec/language/uxil.md` Expected: no diff;
  exits 0.

- [ ] **Step 4: Commit**

  ```bash
  git add docs/spec/language/uxil.md
  git commit -m "docs(docs): expand uxil language reference chapter"
  ```

#### Task 4: New `docs/guide/uxil.md`

**Files:**

- Create: `docs/guide/uxil.md`
- Modify: `docs/guide/SUMMARY.md` (add the new chapter — folded into this task
  since it's a one-line addition the new file needs to be reachable from the
  book)

**Agent prompt** (dispatch via the `Agent` tool,
`subagent_type:
general-purpose`, `run_in_background: false`, in the same
message as Task 3's dispatch so they run in parallel):

> Create `docs/guide/uxil.md` in
> `/Users/sebastientasson/Workspace/driftsys/markspec/.worktrees/730-uxil-docs`,
> a new user-facing guide chapter, structurally mirroring `docs/guide/typl.md`
> in this same repo (read it first for the house style: "When do I use X?"
> opener, worked Markdown examples with entry blocks, "Common patterns" section,
> "Editor support" section, "Common diagnostics and fixes" section with
> cause/fix pairs, "See also" footer).
>
> Read these files for ground truth before writing — do not invent grammar,
> field names, or diagnostic codes, use exactly what's there:
> `packages/markspec/core/uxil/ast.ts`,
> `packages/markspec/core/uxil/
> vocab.ts`,
> `packages/markspec/core/uxil/diagnostics.ts` (for the UXIL code list — the
> code list is also fully catalogued in `docs/spec/language/uxil.md`'s existing
> "Diagnostic catalogue" table, which you should read too),
> `docs/spec/internal/markspec-prose-analysis.md`'s uxil section for the
> profile-activation YAML shape (`declares: ux-surface` on a type).
>
> Sections, in this order:
>
> 1. **When do I use uxil?** — declaring typed UI/HMI surfaces (screens, panels,
>    always-on agents) and their interactions, so specs/tests/
>    journeys/telemetry can be validated against what the UI surface actually
>    affords. Contrast with typl: typl types `$Name` data identifiers; uxil
>    types UI surfaces and their interactions.
> 2. **Activation** — brief: a profile must designate a type with
>    `declares: ux-surface` before uxil content is more than opaque prose; show
>    a short YAML snippet (mirror the shape already documented in
>    `docs/spec/language/uxil.md`'s "Activation" section — read it first and
>    keep the guide's version shorter, linking to the spec chapter for the full
>    rules).
> 3. **Declaring a root surface** — one worked example: a contract entry
>    declaring `` `ux:media.home : screen @loading, ready` ``.
> 4. **Declaring elements** — worked examples covering: a plain verb
>    (`` `/play : activate` `` with its trailing prose event dictionary), a verb
>    with a key template (`` `/track : select : {track_id}` ``), an element with
>    states (`` `/play : activate @enabled, disabled` ``), a `navigate` element
>    with a target (`` `/settings : navigate -> ux:media.settings` ``).
> 5. **Declaring child surfaces** — one worked example: a nested `.confirm`
>    child surface under a root, with its own elements.
> 6. **Editor support** — hover shows the declaration card (kind, verb set,
>    states, owning entry); completion after `ux:` offers known surface paths;
>    go-to-declaration jumps from a citation to its declaration. Requires the
>    `markspec lsp` server (same framing as typl.md's Editor support section).
> 7. **Common diagnostics and fixes** — pick 4-5 of the most common/likely ones
>    from the diagnostic catalogue (e.g. UXIL-010 unknown verb, UXIL-018
>    citation of an undeclared surface, UXIL-023 declaration outside the
>    declaring entry type, UXIL-014 observe combined with other verbs) — same
>    cause/fix format as typl.md's equivalent section, each with a realistic
>    message string and a one-line fix.
> 8. **uxil and typl together** — short section: they are siblings on the same
>    shared declaration-surface machinery (`core/decl/`), so an entry can freely
>    mix a uxil surface declaration with typl bindings. If an element's event
>    carries data worth typing, declare it as a separate typl binding in the
>    same entry today and reference it from the event dictionary prose — there
>    is no formal payload join yet (link to ADR-034's "Deferred" section for
>    why). **Do not describe or preview any `$dotted.name` payload-clause
>    syntax** — that syntax was designed but never shipped; mentioning it here
>    would read as a working feature.
>
> At the end, add "## See also" linking to
> `[ADR-034 — uxil: UX Interaction DSL](../architecture/adr-034-uxil-interaction-dsl.md)`
> and `[Language reference: uxil](../spec/language/uxil.md)` (mirror typl.md's
> own "See also" relative-path depth).
>
> Then edit `docs/guide/SUMMARY.md` in the same repo: under the "# Authoring"
> heading, add a new line `- [Type declarations (typl)](typl.md)` → keep as-is,
> and add immediately after it: `- [Interaction surfaces (uxil)](uxil.md)`.
>
> After writing, run
> `just fmt && dprint check docs/guide/uxil.md
> docs/guide/SUMMARY.md` from the
> repo root and fix any reported issues. Report back the final line count and
> section list, and confirm the payload bridge is NOT mentioned anywhere in the
> file (grep for `payload` and `$media` / `$dotted` — expect zero matches).

- [ ] **Step 1: Dispatch the agent** with the prompt above (same message as Task
      3's dispatch, for concurrency).

- [ ] **Step 2: Read the resulting files** to confirm content spec + the
      no-payload-bridge constraint.

  Run:
  `grep -n "^## " docs/guide/uxil.md && grep -in "payload" docs/guide/uxil.md; cat docs/guide/SUMMARY.md`
  Expected: 8 sections in the order above; the `grep -in "payload"` command
  finds nothing (exit code 1); `SUMMARY.md` shows the new uxil.md line under "#
  Authoring", right after typl.md.

- [ ] **Step 3: Format and check**

  Run: `just fmt && dprint check docs/guide/uxil.md docs/guide/SUMMARY.md`
  Expected: no diff; exits 0.

- [ ] **Step 4: Commit**

  ```bash
  git add docs/guide/uxil.md docs/guide/SUMMARY.md
  git commit -m "docs(docs): add uxil guide chapter"
  ```

---

### Task 5: Fact-check pass across all four documents

**Files:** (read-only verification, no new files)

- `docs/architecture/adr-034-uxil-interaction-dsl.md`
- `docs/architecture/adr-019-typl-type-dsl.md`
- `docs/spec/language/uxil.md`
- `docs/guide/uxil.md`

- [ ] **Step 1: Cross-link check** — every internal Markdown link resolves.

  Run:
  ```bash
  for f in docs/architecture/adr-034-uxil-interaction-dsl.md \
           docs/architecture/adr-019-typl-type-dsl.md \
           docs/spec/language/uxil.md docs/guide/uxil.md; do
    echo "=== $f ==="
    grep -oE '\]\([^)]+\.md[^)]*\)' "$f"
  done
  ```
  For each `](path)` printed, resolve it relative to the file's directory and
  confirm the target file exists (`ls <resolved-path>`).

- [ ] **Step 2: Vocabulary fact-check** — grep the shipped source for the exact
      kind/verb/diagnostic-code lists used across all four documents and confirm
      no drift.

  Run:
  ```bash
  grep -A20 "UX_KINDS" packages/markspec/core/uxil/vocab.ts
  grep -A20 "UX_VERBS" packages/markspec/core/uxil/vocab.ts
  grep -c "^| UXIL-" docs/spec/language/uxil.md
  ```
  Expected: 3 kinds, 11 verbs (matching what's written everywhere), 26 UXIL-0xx
  table rows.

- [ ] **Step 3: Confirm no payload-bridge leakage into the guide chapter**

  Run:
  `grep -in "payload\|dotted.name\|media.favorite_event" docs/guide/uxil.md`
  Expected: no output (exit code 1).

- [ ] **Step 4: Confirm ADR-019's addenda are gone, not just duplicated**

  Run: `grep -n "^## Addendum" docs/architecture/adr-019-typl-type-dsl.md`
  Expected: no output (exit code 1).

- [ ] **Step 5: Full repo format check**

  Run: `just fmt && dprint check` Expected: no diff; exits 0.

- [ ] **Step 6: Fix any issues found in Steps 1–5 inline**, re-run the affected
      check, then commit if any fixes were needed.

  ```bash
  git add -A
  git commit -m "docs(docs): fact-check fixes across uxil docs set" --allow-empty
  ```
  (Use `--allow-empty` only if Step 6 found nothing to fix and you still want a
  marker commit noting the pass completed clean — otherwise omit `--allow-empty`
  and just commit the real fixes.)

---

### Task 6: Push, open PR, update epic checklist

**Files:** none (process step)

- [ ] **Step 1: Push the branch**

  Run: `git push -u origin story/730-uxil-docs` Expected: pre-push `just check`
  runs (docs-only change, but the hook runs the full suite regardless) — give it
  a 300s+ timeout per this project's known pre-push cost. Expected: green, then
  the branch pushes.

- [ ] **Step 2: Open the PR**

  ```bash
  gh pr create --title "docs(uxil): ADR-034 + ADR-019 rewrite + uxil guide/spec chapters (#730)" \
    --body "Closes #730.

  ## What
  - New ADR-034 documenting uxil's shipped grammar, vocabularies, base
    resolution, registry, and machine projection.
  - ADR-019 rewritten to fold in the typl published/namespaced tier and
    table surface as first-class sections (was two bolted-on addenda);
    TYPL-002/003 formally retired.
  - Full uxil language-reference chapter (was a 77-line diagnostics-only
    stub).
  - New uxil guide chapter, wired into docs/guide/SUMMARY.md.

  ## Why
  S12 is the uxil epic's (#717) last story — it documents what actually
  shipped across S1-S10. S11 (payload bridge, #729) was deferred/parked
  with zero code; ADR-034's Deferred section records the settled-but-unbuilt
  design, and the guide chapter deliberately omits it.

  ## Notes
  No code changes. Docs-only."
  ```

- [ ] **Step 3: Wait for the PR to merge** (report the PR URL and stop for user
      confirmation before Step 4 — merging is a shared-state action).

- [ ] **Step 4: Once merged, update epic #717's checklist**

  Fetch the current body, check the ten merged story boxes (`- [ ] #719` →
  `- [x] #719`, and so on through `#728`), add "(parked)" after `#729`'s line
  without checking it, and check `#730`'s box now that its PR merged.

  ```bash
  gh issue view 717 --json body -q .body > /tmp/issue717_body.md
  python3 - <<'PYEOF'
  ```

with open('/tmp/issue717_body.md') as f: body = f.read() for n in range(719,
729): body = body.replace(f"- [ ] #{n}", f"- [x] #{n}") body = body.replace( "-
[ ] #729 — S11 · payload bridge (uxil element → typl shape, registry join)", "-
[ ] #729 — S11 · payload bridge (uxil element → typl shape, registry join) —
**deferred/parked**", ) body = body.replace("- [ ] #730", "- [x] #730") with
open('/tmp/issue717_body_new.md', 'w') as f: f.write(body) PYEOF diff
/tmp/issue717_body.md /tmp/issue717_body_new.md gh issue edit 717 --body-file
/tmp/issue717_body_new.md rm -f /tmp/issue717_body.md /tmp/issue717_body_new.md

````
Verify the `diff` output before running `gh issue edit` — confirm exactly
ten `- [ ]` → `- [x]` flips for #719–#728, one annotation for #729, and
one flip for #730, nothing else changed.

- [ ] **Step 5: Garden `docs/wip/`** — move this plan and the design doc to
`docs/archive/{plans,specs}/` per this repo's working-memory-lifecycle
convention, matching S9/S10's precedent (`docs/archive/plans/
2026-07-06-uxil-lsp-s10-plan.md`, `docs/archive/specs/
2026-07-06-uxil-lsp-s10-design.md`).

```bash
mkdir -p docs/archive/plans docs/archive/specs
git mv docs/wip/2026-07-06-uxil-docs-s12-plan.md docs/archive/plans/
git mv docs/wip/2026-07-06-uxil-docs-s12-design.md docs/archive/specs/
git commit -m "docs(docs): garden S12 uxil docs working memory to archive"
git push
````

## Self-Review Notes

- **Spec coverage**: every Deliverable in the design doc (ADR-034, ADR-019
  rewrite, spec chapter, guide chapter, SUMMARY.md wiring, epic checklist) maps
  to a task above (Tasks 1, 2, 3, 4, 4, 6 respectively).
- **Placeholder scan**: no TBD/TODO; every task states exact file paths, exact
  section content, exact commands.
- **Type consistency**: file/module names
  (`core/uxil/{ast,vocab,grammar,
  registry,projection,diagnostics}.ts`,
  `UxRegistry`, `SurfaceRecord`, `UxProjection`, `ProjectedSurface`,
  `ProjectedElement`) are used identically across Tasks 1, 3, and 5 — verified
  against the actual source read during design.
