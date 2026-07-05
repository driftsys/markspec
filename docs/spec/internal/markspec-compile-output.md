# MarkSpec — Compile Output & Registry Protocol

> **Retired.** The normative schema for the compile output (`/api/` directory
> layout, manifest, entry records, edges, privacy, versioning) has moved to
> [markspec-core-data-model.md — Annex C](markspec-core-data-model.md#annex-c--serialized-form-compile-output).
>
> This file is kept for historical reference only. Its rationale (§1),
> size-analysis (§2), options analysis (§3), federation protocol (§5), and open
> questions (§8) remain below unchanged.

---

Status: **Retired** (Prompt 7 of the next-gen refactor — Stage 2)\
Date: 2026-05-17\
Superseded by:
[markspec-core-data-model.md Annex C](markspec-core-data-model.md#annex-c--serialized-form-compile-output)\
Scope: historical rationale and options analysis only

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
contract — elegant for six months, a corner for years.

### 1.3 In / out of scope

In scope (historical): the `/api/` directory shape, the manifest schema,
entry-record serialization, size behavior, federation, schema versioning.

Normative schema: see
[markspec-core-data-model.md Annex C](markspec-core-data-model.md#annex-c--serialized-form-compile-output).

---

## 2. Size analysis — the real constraint is parse cost

The crossover where JSON stops being comfortable is not raw byte size; it is
**parse cost on the consuming end**.

| Project size | Entries | Approx. compiled JSON | Whole-blob parse (cold, JS `JSON.parse`) | Verdict                     |
| ------------ | ------- | --------------------- | ---------------------------------------- | --------------------------- |
| small        | 100     | ~0.3–1 MB             | < 20 ms                                  | JSON-only is fine.          |
| medium       | 10 000  | ~30–80 MB             | ~0.5–1.5 s                               | JSON-only is uncomfortable. |
| large        | 100 000 | ~300–800 MB           | ~6–15 s + multi-GB peak heap             | JSON-only is unusable.      |

The conclusion: **split the manifest from the entries** — small manifest always
parsed, plus individually addressable entry records.

---

## 3. Options analysis — output format

| Option                         | Parse-cost behavior               | Chosen / rejected                                                        |
| ------------------------------ | --------------------------------- | ------------------------------------------------------------------------ |
| JSON-only                      | Whole blob parsed for one entry   | **Rejected past small.** Kept as degenerate case (< 1k entries).         |
| JSON manifest + NDJSON entries | Manifest O(1); entries streamable | **Chosen (core).** No dependency, diff-able, greppable.                  |
| JSON manifest + SQLite         | Indexed point queries             | **Rejected as canonical**; adopted as optional mirror (`--with-sqlite`). |
| JSON manifest + Parquet        | Columnar analytics                | **Rejected.** Wrong query pattern for point-read access.                 |

---

## 5. Cross-project federation via the registry protocol

> **Superseded.** The live registry-fetch model described in this section was
> never built. The shipped model is lock-mediated: upstreams are pinned in
> `markspec.lock` and hydrated offline from a local snapshot cache — see ADR-031
> and
> [core-data-model.md — Annex C](markspec-core-data-model.md#annex-c--serialized-form-compile-output).

`manifest.federation` lists upstream registries. Resolution walks each federated
manifest's `entries.idx` (O(1) per upstream). A federated upstream on a
different `markspecSchemaVersion` is a hard resolution error unless the consumer
opts into a documented compatibility window.

Federation is **read-only and acyclic**. The registry protocol is just these
static files + these resolution rules — no server, no API surface beyond "serve
the `api/` directory".

---

## 8. Open questions

1. **Federation cycle / error diagnostic codes.** §5 needs registry diagnostics
   (cycle, schema-skew, unreachable upstream). Which ADR-012 category?
2. **Body AST inline vs by-reference in the entry record.** Default to inline
   (self-contained, larger) or by-reference (smaller, another file to fetch)?
3. **Analytics consumer.** If a fleet-level analytics consumer becomes
   first-class, is a Parquet export warranted alongside NDJSON?
4. **Federation auth for non-public upstreams.** §5 assumes world-readable
   `api/`. A private upstream needs an auth story.
5. **`entries.idx` format.** JSON map vs fixed-width binary vs sorted text.
