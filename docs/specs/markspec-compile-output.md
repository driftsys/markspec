# MarkSpec — Compile Output & Registry Protocol

Status: Draft (Prompt 7 of the next-gen refactor — Stage 2)\
Date: 2026-05-17\
Scope: the `/api/` output of `markspec compile` — the **shared, publishable**
artifact; its on-disk shape, size behavior, federation, and schema versioning\
Builds on: core-data-model (Prompt 1 — entry/Item model §1, AST §2, generated
inverses §1.6, round-trip §5), profile-schema (Prompt 2 — `markspec-schema:`
§8.2), listing-directives (Prompt 2 — references §3, component Id schemes §5),
toolchain-distribution (Prompt 3 — core-schema version on `--version`/handshake
§3); ADR-001/002/003/004, ADR-006 (property model), ADR-011 (ingestion / SBOM),
ADR-012 (diagnostic codes)

This is **one of four sibling Prompt-7 specs**
([markspec-lockfile.md](markspec-lockfile.md),
[markspec-background-indexing.md](markspec-background-indexing.md),
[markspec-external-sync-model.md](markspec-external-sync-model.md)). They are
deliberately **not unified** — see §1.2. This spec freezes the compile-output
format and the registry protocol; it does not specify the local index (that is
the indexing spec — different durability, local-only) or the lockfile (different
audience, different cadence).

---

## 0. Terminology

| Term                        | Meaning in this spec                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **compile output**          | The artifact `markspec compile` writes — the project's entries + traceability graph in a consumable form.                                      |
| **`/api/` layout**          | The on-disk directory the compile output is published as (manifest + addressable entries), servable as static files.                           |
| **manifest**                | The small, always-JSON root document: schema version, counts, project identity, the index of where entries live, federation links.             |
| **entry record**            | One compiled entry: its resolved attributes, resolved `Type:`, generated inverse edges, and `properties` (ADR-006).                            |
| **registry protocol**       | The contract by which one project's `/api/` output is consumed by another (cross-project federation) — manifest shape + resolution rules (§5). |
| **`markspecSchemaVersion`** | The integer core-schema contract version at the manifest root (= the binary's core-schema, toolchain-distribution §3; profile-schema §8.2).    |

---

## 1. Scope, audience, and why this is its own spec

### 1.1 What the compile output is for

The compile output is the **shared** artifact: it is what a CI job publishes,
what a downstream project federates against, what a regulator or an auditor is
handed, what a traceability-matrix renderer consumes. Its defining properties
are **portability** (static files, no server required), **durability** (it is an
archival record), and a **stable, versioned schema** (consumers outside this
repo depend on it).

### 1.2 Why it is a separate spec (the anti-unification constraint)

The Prompt-7 brief is explicit: do **not** unify the four artifacts. The compile
output, the lockfile, the local index, and the sync log have different
audiences, cadences, durability, and security postures:

| Artifact                       | Audience                                 | Cadence             | Durability        | Security posture                  |
| ------------------------------ | ---------------------------------------- | ------------------- | ----------------- | --------------------------------- |
| **Compile output** (this spec) | downstream projects, auditors, renderers | per CI build        | archival          | published — must not leak secrets |
| Lockfile                       | the project + CI                         | per upstream change | committed to git  | integrity (hashes)                |
| Local index                    | the local toolchain                      | per keystroke       | disposable        | local-only, never published       |
| Sync log                       | the project + audit                      | per sync            | append-only audit | may contain external-system data  |

Unifying them couples a per-keystroke disposable cache to an archival published
contract — elegant for six months, a corner for years. Each sibling spec
restates this table from its own side.

### 1.3 In / out of scope

In scope: the `/api/` directory shape, the manifest schema, entry-record
serialization, size behavior, federation, schema versioning and forward-compat
rules.

Out of scope: the local index (indexing spec); the lockfile (lockfile spec);
rendering the output to HTML/PDF (Prompt 3/4 — this is the data the renderer
consumes); ingestion of foreign formats into entries (ADR-011); the
`markspec migrate` tool — **there is none** before 1.0 (project decision: no
migration / backward-compat tooling until 1.0; §7 forward-compat is a post-1.0
guarantee, §7.3).

---

## 2. Size analysis — the real constraint is parse cost

The crossover where JSON stops being comfortable is not raw byte size; it is
**parse cost on the consuming end**: every consumer that wants one entry must
parse the whole blob.

| Project size | Entries                                                                          | Approx. compiled JSON                                                                     | Whole-blob parse (cold, JS `JSON.parse`)                                                                           | Verdict                                                                          |
| ------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| small        | 100                                                                              | ~0.3–1 MB                                                                                 | < 20 ms                                                                                                            | JSON-only is fine; nothing to optimize.                                          |
| medium       | 10 000                                                                           | ~30–80 MB                                                                                 | ~0.5–1.5 s                                                                                                         | JSON-only is uncomfortable: every LSP/CI/render reparses the blob.               |
| large        | 100 000                                                                          | ~300–800 MB                                                                               | ~6–15 s + multi-GB peak heap                                                                                       | JSON-only is unusable: parse cost dominates, heap blows on 32-bit/CI containers. |
| worst case   | 100 000 entries, deep `Derived-from` fan-in, every entry with generated inverses | graph edges ≈ O(entries × avg-degree); a single hub entry's reverse-edge list can be 10⁴⁺ | The hub-entry reverse-edge list is the pathological object; it must not force a full re-serialize of the manifest. |                                                                                  |

The conclusion is **not** "abandon JSON". It is **split the manifest from the
entries**: a small manifest a consumer always parses, plus **individually
addressable** entry records a consumer parses only the ones it needs.

---

## 3. Options analysis — output format

| Option                                                                               | Parse-cost behavior                                                                                                                      | Rejected / chosen because                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1. JSON-only (current `serializeCompileResult`)**                                  | Whole blob parsed for one entry; O(N) for any read.                                                                                      | **Rejected past small.** Fine ≤ ~1k entries; the medium/large rows of §2 make it the bottleneck for every LSP, CI, and renderer. Kept as the small-project degenerate case (§4.4).                                                                                                                     |
| **2. JSON manifest + NDJSON entries**                                                | Manifest O(1); entries streamable line-by-line; one entry = seek + one line parse with a byte offset.                                    | **Chosen (core).** No dependency, diff-able, greppable, append-friendly, every language streams it. Byte-offset index in the manifest gives O(1) single-entry read. Matches AGENTS.md "deterministic, grep/diff-friendly".                                                                             |
| **3. JSON manifest + SQLite entries**                                                | Indexed point queries; no parse of unrelated entries.                                                                                    | **Rejected as the published format**; **adopted as an optional mirror** (§4.3). SQLite is a binary that does not diff, is awkward in static hosting / git, and duplicates the **local** index's job (indexing spec). Good as an opt-in consumer convenience, wrong as the canonical archival artifact. |
| **4. JSON manifest + Parquet entries**                                               | Columnar, excellent for analytic scans over all entries.                                                                                 | **Rejected.** Optimizes the wrong query (full-column analytics) for the dominant access pattern (resolve one entry / one subtree). Adds a heavyweight columnar dependency to every consumer for a use case a report tool can derive. Revisit only if analytics becomes a first-class consumer (§8 OQ). |
| **5. Hybrid: JSON manifest + NDJSON entries + optional SQLite mirror (recommended)** | Manifest O(1); NDJSON O(1)-per-entry via offset index; SQLite mirror for consumers that want indexed queries without building their own. | **Chosen.** Option 2 is the canonical, always-emitted core; the SQLite mirror (§4.3) is `--with-sqlite`, derived and verifiable, never the source of truth. Numbers, not vibes: §2's parse-cost table is the justification — manifest stays < 100 KB at every size; per-entry read is constant.        |

**Recommendation: option 5.** Canonical = JSON manifest + NDJSON entries (option
2); `--with-sqlite` adds a derived read-mirror (option 3) for consumers that
prefer SQL. JSON-only (option 1) is auto-selected for small projects (§4.4)
because below ~1k entries the split is pure overhead.

---

## 4. The `/api/` layout

### 4.1 Directory shape

```text
api/
├── manifest.json            # always JSON, always small (§4.2)
├── entries.ndjson           # one entry record per line (§4.5)
├── entries.idx              # byte-offset index: displayId/Id → (offset,length)
├── edges.ndjson             # generated inverse edges, one per line (§4.6)
└── entries.sqlite           # OPTIONAL mirror, only with --with-sqlite (§4.3)
```

Everything under `api/` is static-servable (GitHub/GitLab Pages, an S3 bucket, a
file path). No server, no runtime. The directory is the protocol.

### 4.2 Manifest (`manifest.json`)

Always JSON, always small (target < 100 KB at 100k entries — it holds no entry
bodies):

```jsonc
{
  "markspecSchemaVersion": 1,          // core-schema integer (toolchain §3; profile-schema §8.2)
  "generator": { "release": "0.6.0", "coreSchema": 1 },
  "project": { "name": "...", "root": "urn:markspec:project:<id>" },
  "counts": { "entries": 10234, "edges": 48120, "byType": { "Requirement": 900, ... } },
  "entries": { "format": "ndjson", "file": "entries.ndjson", "index": "entries.idx" },
  "edges": { "format": "ndjson", "file": "edges.ndjson" },
  "sqliteMirror": null,                // or "entries.sqlite" when --with-sqlite
  "federation": [ /* §5 */ ],
  "reserved": {}                       // reserved namespace (§7.2)
}
```

Determinism: byte-identical for identical input (core-data-model §5.3 ethos;
AGENTS.md deterministic artifacts). No timestamps or run metadata in the
manifest unless `--with-run-metadata` is passed (CLAUDE.md "Deterministic output
… No timestamps … unless explicitly requested").

### 4.3 Optional SQLite mirror

`markspec compile --with-sqlite` additionally writes `entries.sqlite`: a
read-only mirror of `entries.ndjson` + `edges.ndjson` with indexes on
`displayId`, `Id`, `Type`, and edge endpoints. It is **derived** — the manifest
records its content hash so a consumer can verify it matches the NDJSON, and the
NDJSON is always authoritative. This deliberately **reuses the schema philosophy
of, but is not, the local index** (indexing spec): the mirror is published and
archival; the local `index.db` is disposable and never published. They do not
share a file.

### 4.4 Small-project degenerate form

Below a threshold (default 1000 entries, `--split-threshold`), `compile` emits a
single `compiled.json` (the option-1 shape) **and** a manifest that points at it
(`"entries": { "format": "inline", "file":
"compiled.json" }`). Consumers branch
on `entries.format`. Rationale: the split's per-file overhead is not worth it
below the §2 small row; the manifest indirection keeps consumers uniform.

### 4.5 Entry record (one NDJSON line)

Each line is one JSON object: the resolved entry — `Id`, `displayId`, resolved
`Type` (core-data-model §1.3), shape, title, authored attributes, body AST
reference or inline (configurable), `properties` (ADR-006
`file.*`/`git.*`/`source.*` — **never** `sync.*` here, §6 privacy), and its
**authored** outbound relations. Lossless for unknown keys (core-data-model
§5.4). Generated inverses are **not** inlined on the entry — they live in
`edges.ndjson` (§4.6) so a hub entry's 10⁴ reverse edges (the §2 worst case)
never bloat the entry record or force a manifest re-serialize.

### 4.6 Edges (`edges.ndjson`)

One line per generated inverse edge (`Superseded-by`, `Verified-by`, every
ADR-003 §Part 3 inverse — core-data-model §1.6). Separating edges from entries
makes the worst-case hub entry O(1) to read and lets a consumer that only needs
forward trace skip the edge file entirely. Edges are generated, never authored
(core-data-model §4.4 `MSL-A030`), and never round-trip to source.

---

## 5. Cross-project federation via the registry protocol

A ULID/URI is globally unique "across the project and its imported registries"
(core-data-model §1.3). Federation is how project B resolves a cross-reference
whose target lives in project A's published `/api/`.

- **`manifest.federation`** lists upstream registries:
  `{ "id": "<urn:markspec:project:...>", "api": "<url-or-path to their api/>", "markspecSchemaVersion": 1, "pin": "<lockfile ref>" }`.
- Resolution: a reference target not found locally is resolved against each
  federated manifest's `entries.idx` (O(1) per upstream), nearest pin first.
  **The lockfile (lockfile spec) pins which upstream version** — this spec
  defines the protocol shape; the lockfile defines reproducibility of _which_
  version (cross-ref: lockfile spec §1, §4).
- A federated upstream on a different `markspecSchemaVersion` is a **hard**
  resolution error unless the consumer opts into a documented compatibility
  window (§7) — versions are a public contract (toolchain-distribution §3 skew
  detection, same discipline).
- Federation is **read-only and acyclic**: a manifest may not list a cycle of
  registries (detected, `MSL-?` registry diagnostic — ADR-012 catalogue; exact
  code §8 OQ). One-directional like the trace graph itself (AGENTS.md
  "Dependency flow is strictly one-directional").

The registry protocol is _just these static files + these resolution rules_.
There is no registry server, no API surface beyond "serve the `api/` directory".
This keeps federation a property of the artifact, not a new product (the same
restraint the sync spec applies to connectors).

## 6. Privacy

- `entries.ndjson` carries `file.*`/`git.*`/`source.*` properties (ADR-006) —
  repository-internal but **not secret**. `git.contributors` is the one
  PII-adjacent field; it is included only with `--with-contributors` (default
  off) because a published `/api/` is world-readable.
- `sync.*` properties (external-system state — ADR-006 §1) are **never** in the
  compile output. They belong to the local sync model (sync spec) and may carry
  external-system identifiers; publishing them would leak the integration
  surface. This is a hard exclusion, enforced at serialization.
- No credentials, tokens, or `.markspec/sync/**` content ever enter `api/`
  (cross-ref: sync spec §6, lockfile spec §6).

## 7. Versioning & forward compatibility

### 7.1 Mechanism

`markspecSchemaVersion` (manifest root) is the integer core-schema contract
version (toolchain-distribution §3.1; profile-schema §8.2 — one shared axis). A
consumer reads it first and refuses a major it does not implement.

### 7.2 Additive-only & reserved namespaces

Within one `markspecSchemaVersion`, changes are **additive-only**: new manifest
keys, new entry fields, new edge kinds may appear; existing keys never change
meaning or type and are never removed. Consumers MUST ignore unknown keys
(forward-compat). The manifest `reserved` object and any key prefixed `x-` are
reserved for experimental/extension data and carry no compatibility guarantee.

### 7.3 The compatibility guarantee is post-1.0

**Pre-1.0 there is no cross-version compatibility guarantee and no migration
tooling** (project decision, 2026-05-17). A `markspecSchemaVersion` bump before
1.0 may break consumers; the only "upgrade path" is **recompile from source** —
which is free here, because the compile output is a _derived_ artifact
(regenerated by `markspec
compile`, never hand-edited). The additive-only rule
(§7.2) and any old→new consumer migration become a binding guarantee **at 1.0**.
This is why the no-migration-tooling decision is consistent with this spec: the
artifact is disposable-and-regenerable, so it needs no migrator.

## 8. Open questions

Capped at five.

1. **Federation cycle / error diagnostic codes.** §5 needs registry diagnostics
   (cycle, schema-skew, unreachable upstream). Which ADR-012 category — a new
   `MSL-?` registry letter, or reuse `MSL-R` (trace)?
2. **Body AST inline vs by-reference in the entry record.** §4.5 leaves `body`
   configurable. Default to inline (self-contained record, larger) or
   by-reference to a separate body store (smaller record, another file to
   fetch)? Numbers needed at the 100k row.
3. **Analytics consumer.** Option 4 (Parquet) was rejected for the point-read
   pattern. If a fleet-level analytics consumer becomes first-class, is a
   Parquet _export_ (alongside, not replacing, NDJSON) warranted, or is that a
   report-tool concern?
4. **Federation auth for non-public upstreams.** §5 assumes a world-readable
   `api/`. A private upstream needs an auth story; is that in scope here or
   strictly a hosting concern (like the sync spec keeps auth in connectors)?
5. **`entries.idx` format.** A JSON map vs a fixed-width binary offset table vs
   a sorted text file. Trade memory vs parse vs diffability; which is canonical?

## Annex — Cross-reference summary

| Section | Source                                                                                    |
| ------- | ----------------------------------------------------------------------------------------- |
| §1.2    | Prompt-7 anti-unification constraint; sibling specs (lockfile / indexing / sync) §1       |
| §2 size | core-data-model §1 (entry/Item), §1.6 (inverses); empirical parse-cost reasoning          |
| §4.5/6  | core-data-model §1.3 / §1.6 / §5.4; ADR-006 (`file/git/source/sync` properties)           |
| §5      | core-data-model §1.3 ("imported registries"); ADR-011 (ingestion); lockfile spec §1/§4    |
| §6      | ADR-006 §1; sync spec §6; lockfile spec §6                                                |
| §7      | toolchain-distribution §3; profile-schema §8.2; project decision (no migration until 1.0) |
