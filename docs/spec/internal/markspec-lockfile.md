# MarkSpec — Lockfile

Status: Draft (Prompt 7 of the next-gen refactor — Stage 2)\
Date: 2026-05-17\
Scope: `markspec.lock` — pinning **trace audits** to reproducibility across
upstream change, not binaries\
Builds on: core-data-model (Prompt 1 — Reference shape §1.2/§1.5, generated
inverses §1.6, value types §1.8), profile-schema (Prompt 2 — profile version /
`markspec-schema:` §8.1/§8.2, specifier ranges), listing-directives (Prompt 2 —
references §3, component Id schemes §5); ADR-002 (Reference entries, value
types), ADR-006 (`build.*` / `sync.*` properties), ADR-008 (profile
distribution), ADR-011 (ingestion), ADR-012 (diagnostic codes)

One of four sibling Prompt-7 specs
([compile-output](markspec-compile-output.md),
[background-indexing](markspec-background-indexing.md),
[external-sync-model](markspec-external-sync-model.md)). **Not unified with
them** (compile-output §1.2 restates why). This spec freezes the lockfile
format, update mechanics, vendoring, conflict resolution, and security model.

---

## 0. Terminology

| Term                          | Meaning in this spec                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **lockfile**                  | `markspec.lock` at the project root — the committed record that makes trace audits reproducible.                                         |
| **upstream**                  | An external resolvable the project depends on: a Reference entry's cited work, a profile, a federated registry (compile-output §5).      |
| **resolved version**          | The concrete version a fuzzy upstream reference resolved to at lock time (e.g. `ISO-26262-6` → `:ed-2`, a profile range → an exact tag). |
| **content hash**              | A digest of the resolved upstream's canonical bytes, recorded so a later run can detect upstream drift.                                  |
| **generated-attribute cache** | The lockfile's record of computed inverse edges (core-data-model §1.6) so a trace audit reproduces without recompiling the world.        |
| **CI mode**                   | `markspec lock --check` (or any command with `--locked`) — read-only, fails instead of writing.                                          |

---

## 1. What the lockfile is for (and is not)

The lockfile pins **trace audits to reproducibility**, not binaries to builds.
Git already makes first-party content reproducible; `deno
compile` already pins
the toolchain (toolchain-distribution §3). The lockfile exists so a question
like

> _"What version of ISO 26262 did `REQ-107` cite on 2026-03-15, and has the
> cited clause changed since?"_

is **answerable and reproducible** months later, across upstream republication.
That regulator/auditor question is the feature; every mechanism below serves it.

It is therefore **a registry-protocol consumer, not a dependency manager.**
`Cargo.lock` pins binaries to make builds reproducible; `markspec.lock` pins
_references_ to make **trace audits** reproducible. The distinction drives every
decision here.

**Why a separate spec (anti-unification).** The lockfile is committed to git,
changes only on upstream change (slow cadence), and its security posture is
_integrity_ (hashes). The compile output is archival/published (different
audience), the index is disposable per-keystroke (different durability), the
sync log is append-only audit (different security). See compile-output §1.2.

## 2. Location & format

`markspec.lock` at the project root (beside `project.yaml` / `.markspec.yaml`;
same discovery as the profile loader, profile-schema §2.2). Committed to git.

### 2.1 Options analysis — TOML vs JSON

| Option            | Rejected / chosen because                                                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JSON              | **Rejected.** A lockfile is human-reviewed in PRs (an upstream-version bump is a reviewable security event). JSON's no-comments, brace-heavy, diff-noisy form is poor for that. (The _compile output_ is JSON because it is machine-consumed, not reviewed — different audience, compile-output §1.2.) |
| YAML              | **Rejected.** Significant-whitespace + type-coercion footguns in a security-relevant, machine-written file. profile-schema manifests are YAML because authored by humans; the lockfile is tool-written, human-_read_.                                                                                  |
| **TOML (chosen)** | Tool-written, human-reviewed: TOML diffs cleanly per table, supports comments (a generated header explaining "do not hand-edit; run `markspec lock`"), is unambiguous to emit deterministically, and is `dprint`-formattable (AGENTS.md). Matches the `Cargo.lock` precedent the §1 framing invokes.   |

The lockfile is **deterministic**: tables and keys in a fixed order,
byte-identical for identical resolution (core-data-model §5.3 ethos), so a no-op
`markspec lock` produces a zero diff.

### 2.2 Content

```toml
# @generated by `markspec lock` — do not hand-edit. Run `markspec lock`.
schema = 1 # lockfile format version (§7), distinct from markspec-schema

[meta]
markspec-schema = 1 # core-schema the project resolved against (profile-schema §8.2)
locked-at = "2026-03-15T09:00:00Z"

[[upstream.reference]] # one per distinct cited Reference (listing-directives §3)
slug = "ISO-26262-6"
id = "urn:iso:std:iso:26262:-6:ed-2" # the RESOLVED concrete URI
resolved = "ed-2"
hash = "sha256:…" # canonical-bytes digest (§5)
source = "https://www.iso.org/standard/68383.html" # where it was fetched/verified
component-scheme = "urn" # listing-directives §5 classification, if any

[[upstream.profile]] # profiles are upstreams too (profile-schema §8.1, ADR-008 §2)
id = "@org/aspice"
specifier = "npm:@org/aspice@^1.2" # the fuzzy specifier from .markspec.yaml
resolved = "1.2.4" # the exact version it locked to
hash = "sha256:…"

[[upstream.registry]] # federated registries (compile-output §5)
id = "urn:markspec:project:upstream-platform"
api = "https://…/api/"
resolved-manifest-hash = "sha256:…"
markspec-schema = 1

[[edge]] # §3.1 — ULID identity ledger, one per local trace edge (issue #593)
source-ulid = "01J…SRC" # stable ULID of the edge's source entry
relation = "Satisfies"
target-ulid = "01J…TGT" # stable ULID of the resolved target; omitted when unresolved
authored-target = "SYS_BRK_0042" # the display ID (or ULID) as authored at lock time

[generated-cache] # §3 — generated inverse-edge cache
edges-hash = "sha256:…" # digest of edges.ndjson (compile-output §4.6) at lock time
```

`Reference` `Id:` values are URIs (core-data-model §1.2); `resolved` captures
the version segment a fuzzy citation pinned to. Component-typed References
additionally record the `listing-directives §5` scheme
(`pkg`/`mfg`/`gtin`/`cpe`/`urn:system`/`urn:tool`) so an SBOM-style audit
("which `pkg:cargo/serde` version was cited") is answerable.

## 3. Generated-attribute cache

Generated inverses (`Verified-by`, `Superseded-by`, every ADR-003 §Part 3
inverse — core-data-model §1.6) are never committed to source (`MSL-A030`,
core-data-model §4.4). But a _trace audit_ needs them, and recomputing the full
graph to answer one historical question is expensive. The lockfile records the
**hash** of the generated edge set (compile-output `edges.ndjson` §4.6) at lock
time — not the edges themselves (that would duplicate the compile output,
violating anti-unification). A reproduction step recompiles, hashes, and
compares: identical hash ⇒ the trace graph is bit-for-bit the one the audit saw.
The cache is _integrity metadata_, not a second copy of the graph.

### 3.1 Edge identity ledger

Each local trace edge is recorded as an `[[edge]]` row carrying the **stable
ULID** of its source and (when resolved) its target, alongside the **authored
target token** — the display ID exactly as written in source at lock time. This
is the _identity ledger_ `markspec fmt` uses to heal a stale cross-reference: if
a target's display ID is renamed, the source's `target-ulid` still resolves, and
`fmt` rewrites the stale token to the target's current display ID.

The ledger is **not** a second copy of the graph (cf. §3). The authored token is
the one datum a recompile cannot reconstruct after a rename — it is identity
provenance, not derivable state. The `generated-cache.edges-hash` remains the
sole integrity digest ("did the graph change"); the ledger answers a different
question ("what stable identity did this edge point at last time"). An
unresolved target omits `target-ulid` and is also surfaced by `MSL-L006` at
`markspec check`. `markspec lock` writes the ledger; `markspec fmt` reads it and
is the only command that edits source.

## 4. Update mechanics

| Command                         | Behavior                                                                                                                                                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `markspec lock`                 | Resolve every upstream, write/refresh `markspec.lock`. Idempotent: re-running with no upstream change is a zero diff.                                                                                                                                                        |
| `markspec lock --check`         | **CI mode.** Resolve, compare to the committed lockfile, **write nothing**; exit non-zero on any drift (new/changed/removed upstream, hash mismatch).                                                                                                                        |
| `markspec lock --update[=<id>]` | Re-resolve all (or one) upstreams to current latest within the specifier range; the explicit "I am intentionally moving the pin" verb.                                                                                                                                       |
| `markspec fmt`                  | **Reads** the lockfile edge ledger (§3.1) to **heal stale trace references** (target display ID renamed → rewrite to current name) and surfaces stale-pin warnings; **never writes** the lockfile. Locking is not a formatting concern (AGENTS.md formatters/linters split). |
| `markspec compile` / `lsp`      | Read the lockfile to pin federated resolution (compile-output §5); never write it.                                                                                                                                                                                           |

Only `markspec lock` (and `--update`) mutate the file. This mirrors the
`Cargo.lock` discipline: the build reads it, one explicit command writes it.

## 5. Security

- **Hash verification.** Every resolved upstream records a `sha256:` digest of
  its canonical bytes. On every `lock`/`compile`, MarkSpec re-fetches (or reads
  the vendor mirror, §6) and re-hashes.
- **Mismatch = warn locally, refuse in CI.** A hash mismatch (upstream content
  changed under a pinned version — a tampering or silent-republish signal) is a
  **warning** in interactive use (the author may legitimately `--update`) and a
  **hard refusal** (exit non-zero, no proceed) under `--check`/`--locked` CI
  mode. A regulator's reproducibility guarantee is void if a pinned upstream can
  change unnoticed.
- **No secrets in the lockfile.** Auth needed to _fetch_ a private upstream
  lives in the environment/connector, never in `markspec.lock` (it is committed
  and world-readable in the repo). The lockfile records _what_ and _its hash_,
  never _how to authenticate_ (parity with compile-output §6 and sync spec §6).
- **Privacy.** The lockfile records upstream identities and hashes only — no
  entry bodies, no `sync.*` data, no PII. It is safe to commit and to include in
  an audit package.

## 6. Vendoring

**Status: Deferred post-1.0.** `markspec lock --vendor` is not implemented in
the v1.0 cycle. The design below is retained for reference; revisit when a
concrete archival-project consumer asks for it.

`markspec lock --vendor` mirrors every resolved upstream's canonical bytes into
`.markspec/vendor/<scheme>/<id>/` and records the mirror path in the lockfile.
Rationale: a regulator audit years later must not depend on `iso.org` still
serving the same bytes. With a vendor mirror, the hash check (§5) runs against
the local copy and the audit is self-contained and offline-reproducible.
`.markspec/vendor/` is git-committed for true archival projects, or
git-ignored + rebuilt from the lockfile for projects that trust upstream
availability (project choice; the lockfile is the source of truth either way).

## 7. Versioning & compatibility

- The lockfile carries its **own** `schema` integer (the lockfile _format_
  version), distinct from `markspec-schema` (the core-data-model contract). They
  version independently: the lockfile layout can evolve without a core-schema
  bump and vice-versa.
- `markspec lock` written by a newer format `schema` is read by an older binary
  as a **hard error** (not a silent best-effort) — a lockfile half-understood is
  worse than none for a reproducibility guarantee.
- **Pre-1.0:** the lockfile _format_ may change without a migration path
  (project decision, 2026-05-17 — no migration/back-compat tooling until 1.0).
  This is consistent and low-cost because the lockfile is **regenerable**:
  `rm markspec.lock && markspec lock --update` rebuilds it from
  `.markspec.yaml` + the references in source. A format bump's "migration" is
  one re-lock; no `markspec migrate` is needed. The cross-version-read guarantee
  binds at 1.0.

## 8. Resolved decisions

1. **Reference version resolution: pin exactly, do not auto-discover.** Lock
   records what the author cited (`urn:iso:…:ed-2` → `ed-2`) and hashes the
   bytes when `Reference-url:` supplies a fetch URL. Discovery is registry
   territory (compile-output §5), out of scope.
2. **Hash canonicalization: defer per-scheme rules, ship raw `sha256:`.** The
   HTTP re-render false-positive case is a known limitation documented in
   CHANGELOG. Per-scheme canonicalizers (PDF text-extract, HTML DOM normalize,
   purl tarball) ship as separate ADRs post-MVP.
3. **Vendor mirror default: deferred post-1.0** (see §6 above).
4. **Edge-hash coupling: canonical edge model, not file bytes.** Sorted
   `(source, relation, target, provenance)` quad list, RFC-8785-style canonical
   JSON, sha256 of canonical serialization. Decouples lockfile from
   compile-output NDJSON format.
5. **Profile `extends:` chain: each tier its own row.** Every tier in the
   `extends:` chain becomes an `[[upstream.profile]]` row with an `extends`
   field referencing its parent. Verbose but auditable per-tier diffs.

## 9. Diagnostic codes

The lockfile family is `MSL-L###`. See ADR-012 for the full catalogue.

| Sub-range | Concern                   |
| --------- | ------------------------- |
| L0xx      | Lockfile parse + schema   |
| L1xx      | Upstream resolution       |
| L2xx      | Drift (locked vs current) |

## 10. CLI surface

| Command                         | Behaviour                                                                 |
| ------------------------------- | ------------------------------------------------------------------------- |
| `markspec lock`                 | Resolve, write/refresh `markspec.lock`. Idempotent.                       |
| `markspec lock --check`         | CI: resolve, compare to committed lockfile, never write. Exit 1 on drift. |
| `markspec lock --update[=<id>]` | Force re-resolve all upstreams, or one by id/slug.                        |
| `markspec compile --frozen`     | Require lockfile, fail on drift before compiling.                         |
| `markspec fmt`                  | Reads lockfile (stale-pin warning); never writes.                         |

## Annex — Cross-reference summary

| Section | Source                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------ |
| §1      | Prompt-7 Context (audit-reproducibility framing); compile-output §1.2 (anti-unification)         |
| §2.2    | core-data-model §1.2 / §1.5 / §1.8; listing-directives §3 / §5; profile-schema §8.1 / ADR-008 §2 |
| §3      | core-data-model §1.6 / §4.4 (`MSL-A030`); ADR-003 §Part 3; compile-output §4.6                   |
| §4      | AGENTS.md (formatters/linters split); `Cargo.lock` precedent                                     |
| §5/§6   | ADR-006 (`build.*` provenance); compile-output §6; sync spec §6                                  |
| §7      | profile-schema §8.2; project decision (no migration until 1.0)                                   |
