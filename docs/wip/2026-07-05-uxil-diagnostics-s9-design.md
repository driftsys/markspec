# S9 — `UXIL-0xx` diagnostics family (design)

Story: [#727](https://github.com/driftsys/markspec/issues/727) · Epic:
[#717](https://github.com/driftsys/markspec/issues/717) §B · Depends on: S8
(#726, merged `048fad9`) and the paragraph-relative column fix (#781, merged
`2ea6c29`).

## Context

S7/S8 co-developed most of the family: `UXIL-001`–`008` (parser, span/bullet-
relative positions) and `UXIL-009`–`022` (compiler semantics). But
`validateUxil` is deliberately unwired — the uxil barrel keeps the module out of
`core/mod.ts` "until S9/S10 wire the compiler/LSP into the CLI and editor
surfaces". S9 owns:

1. **File-anchoring** — `UxilDiagnostic` carries a position but no file; grammar
   diagnostics are span/bullet-relative (#781 made their columns
   paragraph-relative precisely so S9 can compose them with the bullet's file
   range).
2. **Wiring** into `runPipeline` (→ `markspec check`) and the LSP
   (`WorkspaceIndex.validateAll`).
3. **The type gate** — S7: declarations live "inside the profile-designated
   contract entry type". No profile mechanism exists yet. Without a gate, wiring
   `validateUxil` would fire spurious `UXIL-011` on any entry with an innocent
   `` `.gitignore` ``-style code-span bullet.
4. **Missing codes** — declaration outside the declaring entry type; relative
   ref without base; plus two vocab flags S8 shipped but never enforces
   (`visual`, `requiresNavTarget`).
5. **Catalogue registration** (ADR-012 scheme; typl precedent:
   `docs/spec/language/typl.md#diagnostic-catalogue`) with LSP `codeDescription`
   targets reserved.

## Decisions (settled with the user, 2026-07-05)

| # | Decision                  | Choice                                                                                                                                                                                                                                     |
| - | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 | Type gate                 | New type-level profile field `declares: ux-surface`. No designation anywhere in the chain → family fully inert (S1 opaqueness preserved).                                                                                                  |
| 2 | Relative ref without base | Reserve `UXIL-024` + map `decl/resolve`'s `no-base-in-scope` reason to it at the resolution site, keeping S8's cascade suppression. Structurally unreachable until the uxil table surface lands; covered by a direct unit test until then. |
| 3 | Unenforced vocab flags    | Enforce both: `observe` on a non-visual kind (`UXIL-025`) and `navigate` without a `->` target (`UXIL-026`).                                                                                                                               |
| 4 | `codeDescription` URLs    | Spec-chapter anchors: `https://markspec.dev/spec/uxil#uxil-0xx`. S9 ships a minimal `docs/spec/language/uxil.md`; S12 fleshes it out.                                                                                                      |

## Design

### 1. Profile field: `declares: ux-surface`

Type-level scalar in the profile manifest, parsed in `core/profile/manifest.ts`,
merged like `discipline:`, exposed on `EffectiveProfile`:

```yaml
types:
  ux-contract:
    extends: Contract
    display-id-pattern: "UXI_{n:4d}"
    declares: ux-surface
```

- Closed vocabulary: `ux-surface` only. An unknown value is a profile-load
  diagnostic (existing `PROFILE-TYPE-*` family), not a silent ignore.
- The field is per-type; no inheritance across profile types (a child profile
  re-declaring the type merges per existing type-merge rules).
- Helper `uxilDeclaringTypes(profile): ReadonlySet<string>` returns the
  designated type names; empty set (or `profile === null`) means the whole
  family is inert.
- No `CORE_SCHEMA_VERSION` bump: optional profile field, `Entry` untouched (same
  reasoning as ADR-030).

### 2. Family orchestrator: `core/validator/uxil_family.ts`

```ts
export function validateUxilFamily(
  entries: readonly Entry[],
  profile: EffectiveProfile | null,
): readonly Diagnostic[];
```

Lives in `validator/` (not `uxil/`) so the `pipeline → family →
classifyEntry`
imports stay one-directional — `uxil/` must not import from `validator/`.

Behavior, in order:

1. `declaring = uxilDeclaringTypes(profile)`; empty → `[]` (inert).
2. Partition out upstream entries (`emittableEntries`, #771) — uxil is
   upstream-inert, mirroring typl.
3. Classify each entry for gating: use `entry.type` when set, else
   `classifyEntry(entry, profile)`. This makes the LSP path (which never runs
   pipeline Stage 2) gate identically to `check`.
4. Declaring entries → S8's `validateUxil` (Pass 1 structural/vocabulary, Pass 2
   corpus/registry). The registry is built from declaring entries only.
5. Citations (Pass 3) run over **all** non-upstream entries — journeys, tests,
   and specs cite `ux:` refs from any entry type. `validateUxil` gains an
   options parameter (`citationEntries`) so the declaring set and the citing set
   can differ; default preserves S8 behavior.
6. Outside-type check (`UXIL-023`): for each non-declaring entry, any
   unambiguous root-declaration span (`ux:… : kind`, via `extractUxRootSpans`)
   fires `UXIL-023` anchored at the span. Element/child bullets (`/`-led,
   `.`-led) in non-declaring entries stay opaque — they are ambiguous with
   ordinary prose code spans, deliberately.
7. Bridge every diagnostic to a core `Diagnostic` with `location.file`.

Wiring (two sites, one function):

- `runPipeline` — after Stage 2 classification,
  `validateUxilFamily(
  classifiedEntries, profile)`. `profile === null` →
  inert. Stage-1 `validate()` stays untouched (it is deliberately profile-blind;
  typl stays there because typl needs no profile).
- LSP `WorkspaceIndex.validateAll(profile)` — same call; the family classifies
  internally.
- `check` gets the family via the pipeline; no CLI flag changes.

### 3. New codes

| Code       | Severity | Trigger                                                                                                                                                                                                                                      |
| ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UXIL-023` | error    | Root declaration span in an entry whose type is not a declaring type.                                                                                                                                                                        |
| `UXIL-024` | error    | Relative reference with no base in scope (`no-base-in-scope` from `core/decl/resolve`). Cascade-suppressed: silent when `UXIL-011` or a root parse error already reported the cause. Reserved — reachable once the uxil table surface lands. |
| `UXIL-025` | error    | Element declaring `observe` on a surface whose kind is not `visual` (today: `agent`).                                                                                                                                                        |
| `UXIL-026` | error    | Element declaring `navigate` without a `-> target` clause (vocab `requiresNavTarget`).                                                                                                                                                       |

`UXIL-025`/`026` are validator Pass-1 checks over the assembled tree, using the
flags already shipped in `vocab.ts`.

### 4. File-anchoring

- Grammar diagnostics stay span/bullet-relative (the parser is file-agnostic).
- `assembleUxSurface` anchors them at collection time — it holds `span.location`
  / `bullet.range` / `entry.bodyStartLine`. Composition per #781: file line =
  origin line + (diag line − 1); column composes with the origin column only on
  diag line 1, else passes through.
- Everything leaving `assembleUxSurface`/`validateUxil` is file-anchored; the
  family attaches `location.file` and emits core `Diagnostic`s.
- S8's validator/assemble tests update to the anchored expectations.

### 5. Catalogue + LSP `codeDescription`

- New minimal `docs/spec/language/uxil.md`: purpose paragraph, the
  `declares: ux-surface` field note, and the diagnostic-catalogue table
  (`UXIL-001`–`026`, severity + one-line description each), mirroring `typl.md`.
  Added to `docs/spec/SUMMARY.md`. S12 (#730) owns the full chapter + ADR.
- `lsp/diagnostics.ts` `toLspDiagnostic`: UXIL codes get
  `codeDescription: { href: "https://markspec.dev/spec/uxil#<code-lower>" }`
  (alongside the existing MSL-Q branch).

### 6. Tests

- **Unit** — gating (no designation → inert, including the `.gitignore`
  false-positive guard; designated → fires; LSP-style unclassified entries gate
  via `classifyEntry`); each new code (023 corpus fixture, 024 direct mapping
  test documented as reserved, 025/026 Pass-1 fixtures); anchoring math per
  surface form (root span, single-line bullet, list-indented bullet,
  double-backtick span).
- **E2E** — `tests/e2e/uxil_check_test.ts` mirroring `typl_published_test.ts`:
  profile fixture declaring a `ux-contract` type; asserts exit codes + code
  strings on stderr for representative codes, and silence for an undesignated
  project containing `ux:`-looking prose.
- **Acceptance mapping (#727)** — every code has template + severity
  (`UXIL_CODES`) and a triggering fixture: 001–008 grammar-level (exists),
  009–022 validator-level (exists, expectations updated), 023/025/026 new, 024
  direct unit test (reserved; corpus-triggerable once the table surface lands).

### 7. Exports & boundary

- `validateUxilFamily` + `uxilDeclaringTypes` exported through `core/mod.ts`
  (the LSP imports only from the barrel).
- The uxil barrel's "not wired" doc comment updates to reflect S9.

## Alternatives considered

- **Thread the profile into Stage-1 `validate()`** (where typl is wired) —
  rejected: `validate()` is deliberately profile-blind; the signature change
  ripples through every caller, and the type gate makes uxil inherently
  profile-aware.
- **External bridge keeping S8's `UxilDiagnostic` API untouched** — rejected:
  assemble already holds each diagnostic's origin range and discards it;
  re-deriving origins outside means parallel bookkeeping for no benefit.
- **Self-activation on root-span presence instead of a profile field** —
  rejected: `UXIL-011` (missing root) can never fire coherently, `UXIL-023` is
  unemittable, and `.`/`/`-led prose bullets risk false positives.
- **Emit `UXIL-024` per unresolvable bullet** — rejected: reintroduces the
  cascade noise S8 deliberately suppressed (one missing root → N+1 diagnostics).
- **Lint-rules URL namespace for `codeDescription`** — rejected: UXIL codes are
  not prose-lint rules; the spec chapter is their durable home.

## Trace

- Satisfies: #727 acceptance (template/severity/fixture per code; catalogue
  registration; `codeDescription` targets reserved).
- Related: ADR-012 (code scheme), ADR-019 (typl as architectural template),
  ADR-009 (core mechanics / profile policy split), #722 (base-resolution rules),
  #771 (upstream partition), S10 #728 (LSP surfaces, parallel), S12 #730
  (docs/ADR).
