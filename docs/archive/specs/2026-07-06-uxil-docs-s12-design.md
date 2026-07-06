# S12 (#730) — uxil ADR + ADR-019 namespacing update + guide chapter

Story #730 of epic #717 (v0.11.0). Last remaining story: documents what the uxil
epic actually shipped (S1–S10 merged; S11 deferred/parked). No code changes —
docs only.

## Goal

Per the issue:

- A new ADR for uxil (sibling of ADR-019): reference grammar, closed
  vocabularies + extension criteria, base resolution, alternatives.
- Update ADR-019 for the typl published/namespaced tier + TYPL-002/003
  retirement.
- A guide chapter: authoring uxil declarations, `ux:` refs, typl namespacing
  interplay. (Payload bridge excluded — see Decisions.)

## Source of truth

No access to the epic's original external design doc ("seed repo",
`docs/wip/superpowers/specs/2026-07-03-ux-interaction-contracts-design.md`).
Written entirely from what shipped: `core/uxil/*.ts` (ground truth for
grammar/vocab/registry/projection shapes), the archived per-story specs/plans in
`docs/archive/{specs,plans}/2026-07-0{5,6}-uxil-*.md`, and epic issue/PR history
(#717, #719–#730, #786, #790, #796, #801, #803, #808, #810).

## Decisions

1. **Execution: hybrid.** Both ADRs written directly (need one coherent
   narrative across the whole epic's arc); the spec chapter and guide chapter
   delegated to two parallel subagents, each given the relevant `core/uxil/`
   source plus the analogous typl chapter as a structural template. A final
   fact-check pass across all four documents before opening the PR (mirrors
   #758's precedent).
2. **Guide chapter omits the payload bridge entirely.** S11 (#729) shipped no
   code — only a parked design. Documenting a feature that doesn't exist would
   read as vaporware. The new ADR-034 covers the deferral (see below); the guide
   chapter covers only what's actually usable today.
3. **New ADR is ADR-034** (next number after ADR-033), titled "uxil: UX
   Interaction DSL", mirroring ADR-019's structure (Context / Decision /
   Consequences / Alternatives considered / Implementation status).
4. **ADR-019 gets a real rewrite, not another addendum.** The S5/S6 addenda
   already bolted onto ADR-019 explicitly say "the complete namespacing
   rewrite... is story #730" — so this story folds that content into the primary
   Decision/Consequences/Implementation-status sections. The historical "table
   surface reverses an earlier rejected alternative" note is preserved (trimmed)
   in Alternatives considered, since losing that reasoning would be a real
   information loss.
5. **Epic #717's checklist gets checked off** for the 10 merged stories, since
   S12 is the last item and the checklist has been stale (all boxes unchecked
   despite merges) for the whole epic's life. One-line GitHub edit, done at the
   end alongside the PR.

## Deliverables

### 1. `docs/architecture/adr-034-uxil-interaction-dsl.md` (new)

- **Context**: automotive HMI teams have a deployed
  `screenId/elementId[:itemKey]` identity convention (shared by UI Automator /
  Compose / Espresso selectors and OTel-aligned analytics) but nothing
  _declares_ which ids exist or what each element affords.
- **Decision**:
  - `ux:` URI reference grammar, scheme-optional (wire-compatible bare form).
  - Three declaration forms: root (`` `ux:surface : kind @state, …` ``), element
    bullet (`` `/element : verb[, verb…] [: {key}] [@state, …] [-> nav]` `` + a
    trailing prose event dictionary), child-surface bullet
    (`` `.path @state` ``).
  - Two closed, core-owned vocabularies (ADR-009: extension is a markspec
    release decision, not a profile concern): 3 kinds (`screen`/`panel`/`agent`,
    each with navigable/stateful/visual semantics) and 11 verbs (`activate`,
    `toggle`, `select`, `adjust`, `input`, `scroll`, `drag`, `navigate`,
    `dismiss`, `ask`, `observe`, with requiresNavTarget/exclusive semantics).
  - Base resolution reuses the shared `core/decl/resolve.ts` engine
    (innermost-base-wins); uxil's child-surface joins are always relative (no
    absolute internal form), simpler than typl's absolute/relative duality.
  - Corpus `UxRegistry` (keyed by absolute surface path, duplicates NOT
    collapsed — surfaced via UXIL-015) + deterministic `projectUxRegistry`
    machine projection (sorted surfaces/elements/states, JSON-serialisable).
  - 26-code `UXIL-0xx` diagnostic family.
  - Profile-gated activation: `declares: ux-surface` on a type; absent →
    uxil-looking content stays inert/opaque (Tier-1 stability guarantee, #719).
  - LSP hover / completion / go-to-declaration (S10 #728).
- **Consequences**: standalone `core/uxil/` module (mirrors `core/typl/`
  module-for-module). **No `Entry` model change** — unlike typl's `Entry.types`
  field, uxil declarations are parsed fresh from code spans/bullets on every
  `assembleUxSurface` call, never persisted on the entry. Worth flagging
  explicitly as a deliberate asymmetry from typl.
- **Alternatives considered**:
  - Reuse typl's DSL for uxil — rejected: different concern (typed data
    identifiers vs. UI/HMI interaction surfaces), different vocabulary shape
    (kind+verb+state vs. kind+shape).
  - Add uxil declarations as an `Entry` field (typl's approach) — rejected: no
    consumer needs entry-level typed access to a surface tree yet: the
    registry/projection built at compile time is sufficient, and staying off the
    Entry model avoids a schema bump.
- **Deferred**: S11 payload bridge (#729, parked 2026-07-06). Settled syntax: an
  optional `$dotted.name` clause inside the element code span (e.g.
  `` `/favorite_toggle : toggle : {track_id} $media.favorite_event` ``). Revisit
  when: a concrete downstream surface needs a published-typl payload beyond its
  verb's canonical shape; the log-validator/codegen/analytics consumer lands;
  canonical verb payload shapes get implemented.
- **See also**: ADR-019 (sibling), ADR-009 (core/profile boundary — governs the
  closed-vocabulary extension stance), spec chapter, guide chapter.

### 2. `docs/architecture/adr-019-typl-type-dsl.md` (rewrite)

- Decision: add `namespace` as a 10th kind (scaffolding, no shape, exempt from
  declared-once); document the published tier inline (dotted `$a.b` names
  declared exactly once corpus-wide, `: namespace` base clause, `$.` relative
  refs resolved via `core/decl/resolve.ts`); add the table surface as a 4th
  Markdown surface (fence/bullet/inline/table, all parsing to the same Schema
  AST).
- Consequences: 12 diagnostic codes (not 8) — TYPL-009..012 added.
- Implementation status: formally retire TYPL-002/003 (deprecated, never emitted
  — cross-entry consistency no longer applies to entry-local plain names under
  the published tier).
- Alternatives considered: keep the trimmed historical note that the table
  surface addendum _reverses_ the original "GFM bindings table... rejected"
  alternative, and why (GFM `\|` escape + ADR-029's whole-doc dprint pass
  resolved the two blockers that motivated the original rejection).
- Fold S5/S6 addenda content into the sections above; keep a short pointer
  instead of the full bolted-on addendum text.

### 3. `docs/spec/language/uxil.md` (expand from 77-line stub)

Full chapter mirroring `docs/spec/language/typl.md`'s structure:

- Reference grammar (`ux:` URI form, scheme-optional wire form)
- Declaration forms: root / element / child-surface (exact grammar strings
  above)
- Closed vocabularies: kinds table (navigable/stateful/visual), verbs table
  (requiresNavTarget/exclusive)
- Base resolution (innermost-wins, always-relative child joins)
- Corpus registry (`UxRegistry`/`SurfaceRecord` shape)
- Machine projection (`UxProjection`/`ProjectedSurface`/`ProjectedElement`
  shape, with a worked JSON example)
- Activation (existing section — kept verbatim, just drop the "lands with S12"
  forward-reference note since S12 IS this chapter)
- Diagnostic catalogue (existing section — kept, 26 codes)
- See also: ADR-034, guide chapter

Delegated to a subagent with
`core/uxil/{ast,vocab,grammar,registry,
projection,diagnostics}.ts` plus
`docs/spec/language/typl.md` as the structural template.

### 4. `docs/guide/uxil.md` (new)

Mirrors `docs/guide/typl.md`'s tutorial structure:

- When do I use uxil?
- Declaring a root surface
- Declaring elements (verbs, key templates, states, nav targets)
- Declaring child surfaces (nesting)
- Activation (`declares: ux-surface`) — brief, links to spec for full profile
  YAML
- Editor support (hover / completion / go-to-declaration, S10 #728)
- Common diagnostics and fixes (a handful of the most common UXIL codes,
  mirroring typl's "Common diagnostics and fixes" section style)
- uxil + typl interplay — short section: siblings on the same
  declaration-surface machinery; if a surface's element event carries a typed
  payload today, declare it separately as a typl binding in the same entry and
  reference it from prose (no formal join yet — see ADR-034's Deferred section)
- **No payload-bridge section** (Decision 2)
- See also: ADR-034, spec chapter

Delegated to a subagent in parallel with the spec chapter, given the same source
files plus `docs/guide/typl.md` as template.

### 5. Wiring

- `docs/guide/SUMMARY.md`: add `- [uxil](uxil.md)` under "Authoring", after the
  typl entry.
- Epic #717: check off the 10 merged story boxes (S1–S10); leave S11's box
  unchecked with a note it's parked (not done, not blocking); S12's box checked
  once this PR merges (follow-up, not part of this PR — can't self-check the box
  for the PR that isn't merged yet).

## Out of scope

- Any code change. This story is docs-only.
- Documenting the payload bridge as a working feature (see Decision 2).
- Touching `docs/wip/2026-07-05-uxil-diagnostics-s9-design.md`-style
  already-archived per-story specs beyond what's needed for source material —
  they stay as historical record.

## Verification

- `just fmt` (dprint) + `dprint check` on the four Markdown files.
- Manual link check: every new cross-reference (ADR ↔ spec ↔ guide) resolves to
  a real anchor/file.
- `markspec` itself has no build/test surface for prose-only ADR/guide/spec
  content — no `just check` regression risk beyond formatting.
