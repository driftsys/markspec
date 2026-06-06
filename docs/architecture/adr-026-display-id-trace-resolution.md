# ADR-026: Display-ID Resolution for Trace Relations

## Status

Accepted (2026-06-06). Shipped in epic #593 across four PRs (validator, lock
ULID ledger, `fmt` write-back, LSP/MCP guarantees).

## Context

Profile-declared trace relations (`Satisfies:`, `Derived-from:`, `Realizes:`,
`Tests:`, `Depends-on:`, `Part-of:`, `Allocated-to:`, `Provides:`, `Requires:`,
…) previously accepted only a 26-char ULID or a scheme-qualified URI as a value.
A human-readable display ID — the natural authoring form in tools like the SEED
profile (`@ampere/seed`, XREQ/FREQ/CREQ chains) — was rejected at the
value-format gate (`MSL-A004`) before any graph resolution could occur.

Two deeper problems were uncovered during investigation:

1. **No existence check existed for profile relations.** The validator's Stage-4
   traceability pass (`core/validator/traceability.ts`) walked link values with
   `graph.get(v)` keyed by ULID and silently `continue`d on a miss — a
   `Satisfies:` pointing at a valid-but-nonexistent ULID was accepted without
   warning. This was true for both ULID-valued and display-ID-valued links.

2. **The validator and compiler resolved opposite forms.** The Stage-4 validator
   graph was keyed by ULID (`pipeline.ts`); the compiler graph was keyed by
   display ID (`core/compiler/mod.ts`, `extractLinks` →
   `to: makeDisplayId(authoredValue)`). A ULID in `Satisfies:` did not resolve
   in the compiler; a display ID did not resolve in the validator. Authors using
   display IDs could not get type-checking from either layer.

The dual-lookup precedent already existed for the baked-in universal relations:
`byDisplayId.get(t) ?? byId.get(t)` for `Supersedes` (MSL-T012) and `References`
(MSL-T005) in `core/validator/mod.ts`. Profile trace relations never reached it
because the format gate rejected their values first.

## Decision

### D1 — Unresolved trace target is a warning (MSL-L006)

An unresolved profile-relation target (a value that resolves to no entry by
display ID or ULID) is reported as `MSL-L006`, severity `warning` (non-blocking,
`check` exits 2). Scheme-qualified URIs are exempt — they are intentionally
external references. This is net-new behaviour: previously, dangling targets
were silently accepted.

The severity asymmetry is intentional: `Supersedes`/`References` unresolved
targets are errors (`MSL-T012`/`MSL-T005`), while profile-relation targets are
warnings. This gentler stance accommodates downstream projects that carry
dangling references during incremental migration.

### D2 — Canonical authored form in source is the display ID

The display ID is the canonical value for trace-relation attributes in source.
`markspec fmt` canonicalises ULID-valued trace attributes to the target's
current display ID. Display IDs are never rewritten to ULID.

### D3 — Value-format gate is permissive; existence is the gate

The `id` and `id-list` value types (`core/validator/value_types.ts`) accept a
26-char ULID, a scheme-qualified URI, or a display-ID-shaped slug
(`DISPLAY_ID_RE`, defined in `core/model/mod.ts`). Format rejection (`MSL-A004`)
no longer fires for a well-formed display ID. The existence check (`MSL-L006`)
is the real gate — it catches typos the format check could not.

`DISPLAY_ID_RE` is `/^[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?$/`, mirroring the
parser's slug grammar (`core/parser/markdown.ts`). One regex, one definition —
shared between parser and validator.

### D4 — The lockfile is a stable ULID ledger

`markspec lock` resolves and persists, per trace edge, the **stable ULID** of
both the source and target alongside the verbatim authored target token at lock
time. This is a new `[[edge]]` array-of-tables in `markspec.lock` — additive,
separate from the existing `[generated-cache]` integrity digest, and identity
provenance rather than a second copy of the graph.

`LockEdge` (`core/lock/model.ts`):

```typescript
interface LockEdge {
  readonly sourceUlid: string;       // stable ULID of the source entry
  readonly relation: string;         // e.g. "Satisfies"
  readonly targetUlid?: string;      // stable ULID of target; absent if unresolved
  readonly authoredTarget: string;   // display ID (or ULID) as authored at lock time
}
```

TOML shape in `markspec.lock`:

```toml
[[edge]]
source-ulid = "01J…SRC"
relation = "Satisfies"
target-ulid = "01J…TGT" # omitted when target unresolved
authored-target = "SYS_BRK_0042"
```

`lock --check` round-trips the ledger deterministically (edges sorted by
`(sourceUlid, relation, authoredTarget)`). The existing `edges-hash` /
`edges-count` integrity metadata is unchanged — the ledger is identity
provenance, not a graph-drift signal.

### D5 — All source write-back lives in `fmt`

`markspec fmt` is the single source-editing command. `markspec lock` resolves
and persists the ULID ledger but never edits `.md` files. `fmt` reads the
lockfile's edge ledger to heal renamed references.

### D6 — `core/refs/` purity boundary

`core/formatter` stays pure (file-local; a WASM-migration candidate). The
project-aware rewrite is a separate pure module, `core/refs/` (`mod.ts` +
`mod_test.ts`), that the `fmt` CLI composes around the pure formatter.

Dependency constraints:

- `core/refs` imports only `core/model` types (`ULID_RE`, `DISPLAY_ID_RE`,
  `CORE_RELATIONS`, `LOCK_EXTRA_INVERSE_KEYS`) and the `LockEdge` type from
  `core/lock`.
- `core/refs` does **not** import `core/formatter`.
- `core/formatter` does **not** import `core/refs`.
- The CLI (`cli/commands/fmt.ts`) composes the two: `format(content)` first,
  then `canonicalizeRefs(formatted, entries, refIndex, ledger)`.

`core/refs` exports: `buildRefIndex(entries)`,
`canonicalizeRefs(content,
entries, index, ledger)`, `TRACE_ATTRIBUTE_KEYS`,
`RefIndex`.

### D7 — LSP and MCP surface display IDs, never ULIDs

The LSP ID-reference completion (`lsp/completions.ts`, `buildIdReferenceItems`)
already emits `label: entry.displayId` with no `insertText` override — the
editor inserts the display ID. The MCP read tools (`entry_show`, `entry_list`,
`entry_neighborhood`, `entry_context`) render via the compiler graph, which is
display-ID-keyed. Both surfaces are pinned by regression tests (PR4).

## Unifying mechanism: dual resolution

All resolution passes use the same two-index pattern:

```
target = byUlid.get(v) ?? byDisplayId.get(v)
```

This unified both the validator (Stage 4, `pipeline.ts` + `traceability.ts`) and
the lock ledger resolver (`core/lock/resolve.ts`, `extractEdgeLedger`). The
compiler graph was already display-ID-keyed and required no change.

## `fmt` canonicalisation / rename-healing rules

For each trace-attribute value token `v` in a file:

1. `v` is a ULID that resolves in the index → replace with the current display
   ID (canonicalise, D2).
2. `v` is a display ID that resolves in the index → leave as-is (already
   current).
3. `v` is a display ID that does not resolve, but the lock ledger has edge
   `(sourceUlid, relation, authoredTarget = v)` whose `targetUlid` resolves →
   the target was renamed; rewrite to the target's current display ID (heal).
4. Otherwise → leave as-is. `MSL-L006` warns at `check` time.

File-local `fmt` (no project root) skips rules 1–4 entirely. Rule 3 keys on the
source entry's stable `sourceUlid` so a renamed source is also handled.

Multi-line continuation (`\`-terminated trace lines) is conservatively left
untouched; recorded as debt. Trace id-lists are canonically one-value-per-line,
so this is an edge case.

## Relationship to ADR-012 (diagnostic code scheme)

`language.md` §8.3 catalogues a per-relation existence family: `MSL-T001`
(Satisfies=error), `MSL-T004` (Derived-from), `MSL-T006`–`T011`. Those codes
**collide** with the implemented type-classification codes `MSL-T001`–`T004` in
`core/validator/types.ts`. Resolving that collision requires the full ADR-012
catalogue migration.

This epic deliberately used the clean slot `MSL-L006` (`L005` was already taken
by inverse-consistency), emitting a warning rather than the aspirational
per-relation error severity. When the ADR-012 migration reconciles §8.3, it
should map `MSL-L006` to the eventual per-relation T-family codes.

## Relationship to ADR-022 (lockfile)

The `[[edge]]` ledger is additive and does not change the lockfile's integrity
semantics. Specifically:

- `generated-cache.edges-hash` and `edges-count` are **unchanged**.
- `checkDrift` (MSL-L212, display-ID hash) is **unchanged**.
- Old lockfiles without `[[edge]]` tables parse without error (`edges: []`
  default in the parser).
- `markspec lock` writes the ledger; `markspec fmt` reads it and is the only
  command that edits source (ADR-022 §4 "mechanics" column).

## Consequences

- **`markspec check`** now reports `MSL-L006` (warning) when a profile
  trace-relation target resolves to no entry. This is net-new diagnostic
  behaviour — projects with dangling trace references will start seeing
  warnings.
- **`markspec fmt`** in project-aware mode (project root present) may rewrite
  `.md` files: ULID-valued trace attributes become display IDs; stale
  (renamed-target) display IDs are healed if the ledger covers them. File-local
  `fmt` (no project root) is unchanged.
- **`markspec lock`** now writes the `[[edge]]` ledger. Lockfile byte output
  changes for projects with trace edges; `lock --check` will show drift the
  first time `lock` runs after upgrading.
- **Non-link `id`/`id-list` attributes** (a profile declaring, e.g., a custom
  `Source-id:` attribute of type `id`) lose format strictness — a display ID
  shape now passes the format gate with no existence check at `check` time. This
  is accepted per the issue's "relax the value type" framing.
- **No migration required.** Pre-1.0; the format-gate relaxation is
  backward-compatible (previously invalid values become valid).

## Alternatives considered

- **Canonicalise display IDs → ULIDs at `fmt`** — rejected (D2): re-introduces
  the unreadable-reference problem; authors writing `Satisfies: SYS_BRK_0042`
  would see their intent rewritten to an opaque ULID.
- **Introduce a `display:` / `slug:` resolving URI scheme** — rejected: the bare
  display ID is what authors want; a scheme qualifier is needless surface area.
- **Format-only relaxation with no existence check** — rejected (D1/D3): typos
  would pass silently; a purely permissive gate is strictly worse than today.
- **Profile-pattern-driven format gate** — rejected (D3): more code to maintain;
  existence is a stronger and simpler guarantee than prefix shape.
- **Split write-back: healing in `lock --update`, canonicalisation in `fmt`** —
  rejected (D5): two source-editing commands create confusion about which
  command to run after a rename. `fmt` is already the write-back normalizer and
  is project-and-lock-aware, so it owns all source rewrites.

## References

- Issue #593 — Resolve display IDs in trace relation values, not only ULIDs
- [ADR-012](./adr-012-diagnostic-code-scheme.md) — MSL-L006 maps to the deferred
  §8.3 T-family; this ADR governs the reconciliation.
- [ADR-022](./adr-022-lockfile-and-external-sync.md) — lockfile format;
  `[[edge]]` is additive; integrity digest unchanged.
- [ADR-024](./adr-024-interface-as-contract.md) — `Provides`/`Requires` trace
  keys are included in `TRACE_ATTRIBUTE_KEYS` (canonicalised by `fmt`).
- [ADR-025](./adr-025-counter-less-display-id-pattern.md) — `DISPLAY_ID_RE` in
  `core/model/mod.ts` is shared between this ADR's value-type gate and the
  counter-less pattern classifier.
- As-built: `core/model/mod.ts` (`DISPLAY_ID_RE`),
  `core/validator/value_types.ts`, `core/validator/traceability.ts` +
  `pipeline.ts`, `core/lock/model.ts` (`LockEdge`), `core/lock/resolve.ts`
  (`extractEdgeLedger`), `core/lock/serializer.ts` + `parser.ts`,
  `core/refs/mod.ts` (`buildRefIndex`, `canonicalizeRefs`),
  `cli/commands/fmt.ts`.
