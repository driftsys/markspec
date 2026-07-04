# Design: typl published/namespaced tier (S5, #723)

Status: working memory (spec, approved in session). Date: 2026-07-04.

Inputs: story #723; epic #717 §C.1; uxil design record (`fasttrack` repo,
`docs/wip/superpowers/specs/2026-07-03-ux-interaction-contracts-design.md`, §5
base resolution, §9.2 typl namespacing); ADR-019 (typl); merged S4 engine
`core/decl/resolve.ts` (#722); `core/typl/` as of `92e3cad` (v0.10.3).

## Problem

typl has one flat global `$Name` namespace: every declaration of a name must
agree corpus-wide (TYPL-002 kind mismatch, TYPL-003 shape mismatch — pairwise
consistency). There is no way to declare a symbol once with an owner and cite it
elsewhere, and no namespacing. The uxil epic needs the shared published-symbol
model (`$powertrain.brake.pedal_position`) and the same base-resolution rules
uxil uses.

## Goal

Add a **published** tier beside the unchanged entry-local tier:

- Published symbol = `$` + dotted path, **≥ 2 segments**, declared **exactly
  once corpus-wide**, citable from any entry.
- Entry-local plain `$Name` behavior unchanged (regression-proof).
- Retire the flat-global pairwise-consistency model (TYPL-002/003) in favor of
  single-declaration ownership.

## Non-goals

- No URI apparatus for typl (`/`, `:key`, `@state`, `!verb` are uxil; design
  record §9.2: "does not backport"). typl uses dots only.
- No `CORE_SCHEMA_VERSION` bump (Decision 1).
- No LSP changes (separate follow-up story, Decision 8).
- No table-caption base (rides S6 #724, the typl table surface).
- No migration tooling (project policy, pre-1.0).

## Decisions

### 1. No `CORE_SCHEMA_VERSION` bump

The story's compat gate listed a bump; investigation shows it is precautionary,
not load-bearing, and it is **dropped**:

- Nothing gates on the constant — it appears only in display strings (CLI
  `--version`, LSP/MCP `serverInfo`).
- The `typeRegistry` is a `Map` on the in-memory `CompileResult`;
  `JSON.stringify` already serializes it as `{}`, so changing its internal
  semantics changes zero output bytes.
- No RIDL emitter exists yet.

**Caveat (recorded, deferred):** when S11 (payload bridge) or a future RIDL
emitter needs published symbols in the wire format, the registry must gain a
real serialization — the schema conversation returns then.

The other two compat-gate bullets stay: dotted paths are recognized only in
code-span/declaration context, and TYPL-002/003 are deprecated, not deleted.
Release note required.

### 2. Dots are the tier discriminator

- `$name` (no dots) → entry-local. Untouched.
- `$a.b`, `$a.b.c` (≥ 1 dot, so ≥ 2 segments) → published.
- Consequence, stated as a rule: **a published symbol cannot be a bare name** —
  publication forces namespace ownership. `$vehicle_speed` cannot be published
  as-is; it must live under a namespace (`$s29.cluster.vehicle_speed`).

### 3. Spelling: explicit `: namespace` clause creates bases

A **namespace declaration** mirrors uxil's `: kind` clause:

```markdown
`$powertrain.brake : namespace`
```

`namespace` joins the closed kind vocabulary (KINDS). No shape may follow it
(malformed → TYPL-006).

Rejected alternative — inferring a base from a bare container bullet
(`` `$powertrain.brake` `` with nested children): a bare dotted span is
indistinguishable from a citation, and the normative rule (record §5) is "only
declarations create bases; citations never do." The clause makes the distinction
syntactic.

### 4. Relative refs: `$.` prefix, sigil kept

```markdown
- `$powertrain.brake : namespace` — brake subsystem signals
  - `$.pedal_position : signal float[0..100]` — pedal travel
  - `$.line_pressure : signal float[0..250]` — hydraulic pressure

  Latency budgets apply to `$.pedal_position`.
```

- `isAbsolute(ref)` = the character after `$` is an identifier char.
- `join("powertrain.brake", "$.pedal_position")` =
  `$powertrain.brake.pedal_position`.
- Relative forms are legal in declarations and citations, resolved via
  `core/decl/resolveRef` (innermost base wins).
- **No half-absolute forms** (no `$/x`): a ref is `$a.b…` (absolute) or `$.x`
  (relative), nothing between — the same one-ref-one-meaning property as uxil.

**Sigil-vs-scheme rationale (why typl keeps `$` in relative form while uxil
drops `ux:`):** `ux:` is an RFC 3986 _scheme_ — presence means absolute;
relative URIs are scheme-less by definition (`/play`, `.dialog`). `$` is a
_sigil_ — part of the token, marking "typl symbol" regardless of addressing.
Practically, a bare `.pedal_position` bullet would be textually the same shape
as uxil's child-surface bullet (`.confirm_dialog`); the sigil lets a recognizer
classify a code span at its first character (`$…` → typl; `ux:` / `/` / `.…` →
uxil).

### 5. Scoping: S4 engine, instantiated for typl

Base sources, innermost wins (record §5, minus the table source which rides S6):

1. enclosing nested-bullet `: namespace` declaration — scopes its subtree only;
2. the entry's **root** namespace declaration (top-level `: namespace`) — scopes
   the whole entry body;
3. otherwise → diagnostic (relative refs are illegal without a base).

Root rule: **at most one** top-level namespace declaration per entry; a second
is an error. Zero is fine — that is every existing typl entry. This is a
deliberate instantiation deviation from the S4 engine's rule 5 ("exactly one"),
which was written for uxil where every declaring entry has a root;
`checkSingleRoot` is applied only when a root exists or a relative ref demands
one.

Cross-entry citations are **absolute only** — relative forms never leave the
declaring entry (record §6 corollary: every ref in non-declaring prose is
absolute).

### 6. Citation machinery is in scope

typl today has no citation validation at all (TYPL-005 covers typedef refs
inside shapes only). "Citable from any entry" requires:

- a **citation recognizer** for code spans that carry a published ref without a
  declaration clause (`` `$powertrain.brake.pedal_position` ``,
  `` `$.pedal_position` ``);
- resolution of relative citations through the base engine;
- validation: a citation of an **undeclared** published symbol is a diagnostic
  (else declared-once is unverifiable).

Free-prose `$foo.bar` (outside code spans) keeps the old tokenization —
`ENTITY_REF_RE` / body-token extraction unchanged; no new prose-lint surface
(compat gate bullet 1).

Entry-local citation checking stays out of scope (unchanged behavior — plain
`$Name` mentions are not validated today and remain so).

### 7. Diagnostics

New codes (TYPL-001…008 exist):

| Code     | Severity | Condition                                                 |
| -------- | -------- | --------------------------------------------------------- |
| TYPL-009 | error    | duplicate published declaration (declared-once violation) |
| TYPL-010 | error    | relative ref with no base in scope                        |
| TYPL-011 | error    | citation of an undeclared published symbol                |
| TYPL-012 | error    | multiple root namespace declarations in one entry         |

Deprecated, never emitted, kept resolvable (code union + catalogue, marked
deprecated): **TYPL-002, TYPL-003**. Semantic note for the release note: two
entries declaring the same plain `$Name` with identical shapes were one symbol
under the flat model; after S5 they are two unrelated entry-local symbols. No
check outcome changes (the retirement is a pure relaxation).

TYPL-001 (duplicate in same entry) applies to published declarations too,
unchanged.

### 8. Registry and ownership boundaries

- Published leaf bindings join `TypeRegistry.bindings` keyed by the full
  absolute `$dotted.name` — same structure, new key shapes; no registry shape
  change (supports Decision 1).
- **Namespace declarations are scaffolding, not symbols**: they are not subject
  to corpus-wide declared-once, so a namespace may serve as root in more than
  one entry (a large contract split across entries). Only leaf bindings are
  declared-once.
- Core places no restriction on **which entries** may declare published symbols
  — core has no type vocabulary (ADR-009). The record's "contract entries only"
  (ICD/SWI) is a profile rule, enforced profile-side later.

### 9. Follow-up story: typl-LSP alignment (filed separately)

The LSP is built on the flat-global assumption (`$Name` hover and completions
read the corpus registry across entries). After S5 that misrepresents
entry-local semantics, and dotted tokens need hover/ completion support.
Deliberately **not** folded into S5 — filed as its own small story when the S5
PR lands.

## Open questions (watchlist, not blockers)

- **Namespace/leaf overlap:** v1 imposes no exclusion — `$a.b` may exist as a
  published leaf while `$a.b : namespace` anchors children elsewhere; and
  `$a.b.c` may be published with `$a.b` never declared (no dangling-parent rule
  for typl, unlike uxil). Revisit if it confuses in practice.
- Registry serialization for downstream emitters (Decision 1 caveat) — lands
  with S11 or the first emitter.

## Acceptance (from #723, restated post-decisions)

1. Published dotted symbols: declared-once diagnostic on duplicate (TYPL-009);
   citable from other entries — absolute, and relative-under-base within the
   declaring entry.
2. Entry-local plain `$Name` behavior unchanged (regression suite).
3. Free-prose `$foo.bar` tokenization unchanged (compat regression test; no new
   MSL-Q findings on existing corpora).
4. Release note; **no** schema bump; TYPL-002/003 deprecated-not- deleted.
