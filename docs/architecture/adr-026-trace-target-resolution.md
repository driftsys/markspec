# ADR-026: Trace-target resolution — display-ID source, ULID ledger

## Status

Accepted (2026-06-06). Implements issue
[#593](https://github.com/driftsys/markspec/issues/593) across PRs #599 (#602)
(#604) (#605). Refines [ADR-009](adr-009-core-profile-boundary.md) (the
core/profile boundary) and extends
[ADR-022](adr-022-lockfile-and-external-sync.md) (the lockfile) with a per-edge
identity ledger.

## Context

A trace-relation value (`Satisfies:`, `Derived-from:`, `Realizes:`, `Tests:`,
`Depends-on:`, `Part-of:`, `Allocated-to:`, `Provides:`, `Requires:`,
`Generated-from:`, …) historically accepted **only** a 26-char ULID or a
scheme-qualified URI. A human-readable display ID such as
`Satisfies: SYS_BRK_0042` was rejected at the value-format gate (MSL-A004)
before any graph resolution. Authors had to hand-copy opaque ULIDs into every
cross-reference — the primary cross-reference ergonomics pain reported
downstream (the SEED profile's XREQ/FREQ/CREQ chains).

Two structural facts shaped the resolution:

1. **The validator and compiler resolved opposite forms.** The validator's
   Stage-4 graph is keyed by **ULID** (`entry.id`); the compiler graph is keyed
   by **display ID** (`extractLinks` → `to: makeDisplayId(authoredValue)`,
   `entries` keyed by `displayId`). A ULID in `Satisfies:` did not resolve in
   the compiler graph; a display ID did not resolve in the validator graph.

2. **No existence check existed for profile relations — in either form.** Only
   the baked-in `Supersedes`/`References` relations reported a "not found"
   diagnostic. A `Satisfies:` pointing at a valid-but-nonexistent ULID was
   silently accepted.

A display ID is **human-readable but renameable**; a ULID is **opaque but
stable**. Cross-references in source want the former; durable identity tracking
wants the latter. The two needs pull in opposite directions, and a single
representation cannot serve both.

## Decision

**Split the two needs across two artifacts, bridged by one resolution rule and
one write-back command.**

1. **Source carries display IDs (the canonical authored form).** A trace value
   is recognised by a permissive slug shape (`DISPLAY_ID_RE`, derived from the
   parser's slug grammar) — **existence is the gate, not format**. The unified
   regex is centralised in `core/model/` and shared by parser and validator.

2. **One dual-resolution rule unifies both layers.** A trace target resolves as
   `byDisplayId.get(v) ?? byId.get(v)` — display ID first, ULID second — in the
   validator, the compiler, and the lock-edge extractor. A value that resolves
   to neither index is reported as **`MSL-L006` (warning)** — a net-new
   existence check that also begins catching dangling ULIDs.

3. **The lockfile is the stable ULID identity ledger.** `markspec lock` records
   every local trace edge as a `[[edge]]` table —
   `{ source-ulid, relation, target-ulid?, authored-target }` — pinning each
   edge by the target's stable ULID alongside the display ID exactly as authored
   at lock time. The authored token is the one datum a recompile cannot
   reconstruct after a rename, so it is **identity provenance, not a second copy
   of the graph** (the `generated-cache.edges-hash` remains the sole integrity
   digest). `lock` never edits source.

4. **`markspec fmt` is the sole source write-back.** When run inside a project
   it **canonicalises** a ULID trace value to the target's current display ID,
   and **heals** a stale reference — a display ID that no longer resolves but
   whose ledger edge (keyed on the source's stable ULID) carries a `target-ulid`
   that does resolve — by rewriting it to the target's current display ID.
   File-local `fmt` (no project root) skips this. The index-aware rewrite lives
   in a dedicated `core/refs/` module composed **around** the pure
   `core/formatter` (neither imports the other — the WASM-migration purity guard
   holds).

5. **Editor/agent surfaces present display IDs.** LSP ID-reference completion
   inserts display IDs; the MCP read tools present trace targets as display IDs.
   Authors and agents never see raw ULIDs in cross-references.

```
         SOURCE (.md)                        LOCKFILE (markspec.lock)
human-readable display IDs   ── lock ──►   stable ULID ledger per edge
     Satisfies: SYS_BRK_0042  resolve d→u   [[edge]] { source-ulid, relation,
           ▲                                          target-ulid, authored-target }
           │ fmt write-back (resolve u→d)
           │  • ULID → display ID            (canonicalise)
           │  • stale display ID → ULID(ledger) → current display ID  (heal)
```

## Consequences

- **Readable source, recoverable renames.** A renamed target's old display ID is
  always recoverable through the ledger's stable ULID; `fmt` heals references
  mechanically.
- **Severity asymmetry (intentional).** Unresolved profile-relation targets are
  a **warning** (`MSL-L006`, gentler for downstream projects carrying dangling
  refs), while `Supersedes`/`References` unresolved targets remain **errors**
  (`MSL-T012`/`MSL-T005`).
- **The §8.3 per-relation existence T-family stays deferred under
  [ADR-012](adr-012-diagnostic-code-scheme.md).** `language.md` §8.3 catalogues
  `MSL-T001`/`T004`/`T006`–`T011` per-relation existence checks, but those slots
  collide with the implemented type-classification codes `MSL-T001`–`T004`. A
  single free `MSL-L006` warning ships now; the eventual catalogue migration
  maps it.
- **Project-aware `fmt` cost.** Building the resolution index parses the whole
  project — heavier than file-local `fmt`, incurred only when a project root
  exists. Acceptable; optimise later if profiling warrants.
- **Relaxing `id`/`id-list` generically** means a non-link `id` attribute (if a
  profile declares one) loses format strictness with no existence net.
  Acceptable per the issue's "relax the value type" framing.
- **Known gap (debt #606):** `fmt` skips multi-line (`\`-continued) trace
  values. Trace id-lists are canonically one value per line, so this is a corner
  case.

## Alternatives considered

- **Canonicalise display IDs → ULIDs at `fmt`.** Rejected: re-introduces the
  unreadable-reference problem. We canonicalise the _other_ direction.
- **Introduce a `display:` / `slug:` resolving URI scheme.** Rejected: the bare
  display ID is what authors want; a scheme is needless surface area.
- **Format-only relaxation, no existence check.** Rejected: typos would pass
  silently — strictly worse than before.
- **Profile-pattern-driven format gate.** Rejected: more code; existence is a
  stronger and simpler guarantee than prefix shape.
- **Split write-back — healing in `lock --update`, canonicalisation in `fmt`.**
  Rejected: two source-editing commands. `fmt` is already the project- and
  lock-aware normalizer, so it owns all source rewrites; `lock` only maintains
  the ledger.
- **Extend `generated-cache` instead of a new `[[edge]]` table.** Rejected: the
  generated-cache is a single summary digest; per-edge identity rows are a list
  with different cardinality and purpose. A dedicated `[[edge]]` array-of-tables
  matches the lockfile's existing `[[upstream.*]]`/`[[bound-entry]]` convention
  and keeps the integrity digest byte-stable.
