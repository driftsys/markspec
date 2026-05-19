# MarkSpec — Stage-1 User Documentation Spec

Status: Draft (Prompt 4 of the next-gen refactor)\
Date: 2026-05-17\
Scope: The **specification for the Stage-1 documentation site** — its structure,
the quickstart contract, the example-project contract, per-audience reading
paths, and the doc-as-code CI constraints. **Not the documentation itself.**\
Builds on: [markspec-core-data-model.md](markspec-core-data-model.md) (Prompt
1), [markspec-profile-schema.md](markspec-profile-schema.md) +
[markspec-listing-directives.md](markspec-listing-directives.md) (Prompt 2),
[markspec-toolchain-distribution.md](markspec-toolchain-distribution.md) +
[markspec-e2e-test-strategy.md](markspec-e2e-test-strategy.md) (Prompt 3),
ADR-001 (Markdown format), ADR-003 (information & traceability model — §Part 8
standards alignment), ADR-004 (authoring model)

This spec freezes **what the Stage-1 docs site must contain and how it is built,
tested, and released** so a small team of architects and developers can run
spec-driven development on a greenfield project after a 15-minute quickstart. It
is the build target for the documentation-authoring work; it contains **no
actual documentation prose** (Prompt-4 constraint: "the spec for the docs site,
not the docs themselves").

It is the terminal Stage-1 spec: Prompts 1–3 froze the model, the profile/
listing layer, and the toolchain/test strategy; this spec freezes how all of
that is taught. Where it needs a surface detail (an install command, a profile
manifest key, a directive grammar) it **cites the owning spec** rather than
restating it (Prompt-4 constraint).

---

## 0. Terminology

| Term                | Meaning in this spec                                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **docs site**       | The published Stage-1 user guide — an extension of the existing `docs/guide` mdBook (`docs/guide/book.toml`).                                                                                                                          |
| **chapter**         | One top-level entry in the guide's `SUMMARY.md`.                                                                                                                                                                                       |
| **example project** | The in-repo tree the docs teach from. It **is** the e2e Ring-2 corpus at the path the e2e spec fixes — `tests/fixtures/corpora/aspice-slice/` ([markspec-e2e-test-strategy.md §4](markspec-e2e-test-strategy.md)) — not a second copy. |
| **doc-as-code**     | The constraint that every code block, CLI invocation, and cross-reference in the docs is verified in CI (§6).                                                                                                                          |
| **audience**        | One of the three reader personas: architect, developer, compliance lead (§5).                                                                                                                                                          |
| **owning spec**     | The Prompt 1–3 spec that is normative for a surface the docs describe; the docs cite it, never restate it.                                                                                                                             |

---

## 1. Scope and boundaries

In scope: the docs site's information architecture, the quickstart contract, the
example-project contract, reading paths, and the doc-as-code CI gates.

Out of scope (and their owners):

- **The documentation prose itself** — written against this spec in the
  documentation-authoring work; not in this file (Prompt-4 constraint).
- **Surface details** — install commands
  ([markspec-toolchain-distribution.md §4–§6](markspec-toolchain-distribution.md)),
  profile manifest keys
  ([markspec-profile-schema.md](markspec-profile-schema.md)), directive grammars
  ([markspec-listing-directives.md](markspec-listing-directives.md)), the data
  model ([markspec-core-data-model.md](markspec-core-data-model.md)). The docs
  **cite** these; this spec does not duplicate them.
- **The book rendering pipeline internals** — `book/` module, mdBook config,
  theming (CLAUDE.md; existing `docs/guide/book.toml`). This spec fixes the
  site's _structure and SUMMARY_, not the renderer.
- **Stage-2 docs** — migration guide content, prose-quality lint docs. §2
  reserves a Migration placeholder chapter; its content is Stage 2.
- **ADR / internal-engineering docs** — `docs/architecture/`, `docs/product/`
  stay internal (CLAUDE.md "Docs layout"); the user docs never require reading
  an ADR to use the tool (Prompt-4 Context).

---

## 2. Documentation site structure

### 2.1 Decision — extend the existing `docs/guide` mdBook

The Stage-1 docs site is the existing `docs/guide` book (`docs/guide/book.toml`,
title "MarkSpec User Guide", builds to `_site/guide`), restructured. Its
`SUMMARY.md` becomes the eight-chapter Stage-1 structure (Prompt-4 §1):

| # | Chapter              | Audience (primary) | Purpose                                                                    | Owning specs cited                                                    |
| - | -------------------- | ------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1 | **Quickstart**       | all                | 15-minute end-to-end first run (§3).                                       | toolchain-distribution §4/§6; core-data-model §1                      |
| 2 | **Concepts**         | all                | Reference: shapes, types, listings, profiles. The mental model, skimmable. | core-data-model §1; profile-schema §1/§3; listing-directives §1       |
| 3 | **Authoring guide**  | architect          | How to structure a project's requirements / architecture.                  | core-data-model §1–§2; profile-schema §3/§9                           |
| 4 | **CLI guide**        | developer          | Every subcommand, in-code specs, the `insert→fmt→lint` loop.               | CLAUDE.md CLI table; core-data-model §3/§4; toolchain-distribution §3 |
| 5 | **Profile guide**    | compliance lead    | Stacking profiles; ASPICE / ISO 26262 mapping.                             | profile-schema §3/§5/§7/§9; ADR-003 §Part 8                           |
| 6 | **Examples gallery** | all                | Tour of the in-repo example project (§4); "clone and modify on day one".   | this spec §4; e2e-test-strategy §4                                    |
| 7 | **FAQ**              | all                | The questions a team trial actually asks; short answers linking deeper.    | all                                                                   |
| 8 | **Migration guide**  | (Stage 2)          | Placeholder chapter; stub + "Stage 2" banner. Content deferred.            | (Stage 2)                                                             |

### 2.2 Mapping the current four chapters

The existing guide (`Getting started`, `Configuration`, `Commands`,
`Editor integration`) folds in — nothing is deleted, content is relocated:

| Current chapter    | Disposition                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Getting started    | Becomes / is absorbed by **Quickstart** (§3), rewritten to the 15-minute contract.                 |
| Configuration      | Splits: project config → **CLI guide**; profile config → **Profile guide** (cites profile-schema). |
| Commands           | Becomes **CLI guide**, regenerated against current `--help` (§6 doc-as-code).                      |
| Editor integration | Folds into **Quickstart** (install step) + **CLI guide**, citing toolchain-distribution §4/§5.     |

### 2.3 Options analysis — site home

| Alternative                                          | Rejected because                                                                                                                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extend the existing `docs/guide` mdBook (**chosen**) | Reuses the working publish pipeline (`book.toml` → `_site/guide`); one user-facing guide surface; nothing to reconcile. Matches CLAUDE.md "Docs layout".                                                                    |
| New standalone docs site (separate generator)        | Discards a working pipeline and creates two guide surfaces a reader could land on. No benefit the mdBook restructure does not already give.                                                                                 |
| Fold the docs into the `docs/spec` language book     | The spec book is the normative _language_ reference (different audience, different lifecycle — CLAUDE.md). Mixing a teaching guide into a normative spec produces the page "nobody reads" the Prompt-4 Context warns about. |

### 2.4 Options analysis — three audiences, three docs

The Prompt-4 Context is explicit: "Three audiences, three docs, no mixing." §2.1
gives architects, developers, and compliance leads each a dedicated chapter
(Authoring / CLI / Profile). Concepts + Quickstart + Examples + FAQ are shared
on-ramps. Rejected: a single linear guide serving all three — produces the
unread page; rejected: three separate _books_ — fragments search and
cross-linking, and the shared on-ramps would be duplicated three times.

---

## 3. Quickstart specification

The Quickstart chapter is a single linear path with a **hard 15-minute total
budget** (Prompt-4 §2). This spec fixes the _contract_ of each step (what it
must achieve, its time budget, the owning spec it cites); it does **not** write
the prose.

| Step | Action                                                                        | Budget | Owning spec / contract                                                                             |
| ---- | ----------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| 1    | Install the binary — **single command**                                       | 2 min  | toolchain-distribution §2 (single binary), §4/§6 (install surface). One copy-paste line.           |
| 2    | `markspec` project init — **single command** (scaffold `project.yaml` + dirs) | 1 min  | profile-schema §2.2 discovery; CLAUDE.md project-context rule. One command, no prompts in non-TTY. |
| 3    | Author one Specification, one Component, one Reference (paste three blocks)   | 5 min  | core-data-model §1.1 (the two-layer model), Annex B worked examples B.1/B.3/B.2.                   |
| 4    | `markspec fmt` — see ULIDs stamped, canonical form applied                    | 2 min  | core-data-model §3 (canonical form), §3.5 (Id assignment).                                         |
| 5    | `markspec lint` — see it pass (then break a ref, see it fail)                 | 2 min  | core-data-model §4 (lint codes); show one `MSL-R080`.                                              |
| 6    | `markspec book build` — render and open the HTML                              | 2 min  | existing `book/` pipeline; `docs/guide/book.toml` analogue.                                        |
| 7    | View output — the rendered entry blocks + traceability                        | 1 min  | (visual payoff; no new surface)                                                                    |

Constraints on the Quickstart chapter:

- **Two single commands maximum** for install + init (Prompt-4 §2). Anything
  multi-step is a quickstart failure.
- Every command in the chapter is a tested code block (§6) and every flag is
  verified against current `--help` (§6).
- The three authored blocks in step 3 are exactly three entries from the example
  project (§4) — the quickstart teaches from the same bytes CI tests.
- Total wall-clock ≤ 15 min for a reader who has never seen MarkSpec. If the
  step budgets sum over 15, the chapter is out of spec.

---

## 4. Example project specification

### 4.1 Decision — the example project is the e2e Ring-2 corpus

The example project is **not a new directory**. It is the e2e Ring-2 corpus at
the path the merged e2e spec fixes — `tests/fixtures/corpora/aspice-slice/`
([markspec-e2e-test-strategy.md §4](markspec-e2e-test-strategy.md)). Single
source of truth: the files the docs teach from are the exact files CI runs the
pipeline against. The Examples-gallery chapter (§2.1 #6) tours that tree and
documents how a reader copies it out of the repo to modify it "on day one"
(Prompt-4 Context).

> **Consistency note.** e2e-test-strategy §4 (merged) already states the corpora
> "double as the Prompt-4 example project's backing data" and fixes their path
> under `tests/fixtures/corpora/`. That spec is authoritative for the location;
> this spec defers to it rather than introducing a second `examples/` copy that
> would need syncing. One physical directory, two consumers (CI corpus + docs
> example).

### 4.2 Contract — what the example project must contain

A thin slice of an automotive emergency-braking project (Prompt-4 §3 — "slice of
demo-aeb-vehicle, or simpler if needed"; kept in-repo and minimal):

- **All four abstract types exercised** (core-data-model §1.3): at least one
  `Specification` (a requirement), one `Component` (a project crate), one `Unit`
  (an in-code function), and the abstract `Item`/Reference path via a cited
  standard.
- **Default profile + one stacked profile** — the bundled default
  (profile-schema §7) plus the minimal ASPICE slice from
  [markspec-profile-schema.md §9.1](markspec-profile-schema.md), activated via
  `.markspec.yaml`.
- **The three listing documents** — `glossary.md`, `components.md`,
  `references.md`, each exercising its directive
  ([markspec-listing-directives.md §3/§4/§5](markspec-listing-directives.md)).
- **One in-code spec** — a Rust doc-comment requirement+test pair (AGENTS.md
  §V-model convention; `tests/fixtures/in-code-rust.rs` is the seed), proving
  the source-extraction path.
- **Deterministic** — no timestamps, `Origin: synthesized` where an ID must be
  stable (core-data-model §3.5), so it round-trips in Ring 1/2
  (e2e-test-strategy §4 fixture rules).

### 4.3 Options analysis — example-project location

| Alternative                                                        | Rejected because                                                                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The e2e Ring-2 corpus _is_ the example, no second dir (**chosen**) | One source of truth; doc-as-code is automatic (the docs' example is literally CI's corpus); consistent with the already-merged e2e-test-strategy §4 which fixes the path.        |
| A new `examples/aeb-slice/` copy of the corpus                     | A second in-repo directory that must be kept byte-identical to `tests/fixtures/corpora/aspice-slice/`; the sync obligation is exactly the rot doc-as-code (§6) exists to kill.   |
| Separate `demo-aeb-vehicle` repo the docs link to                  | No such repo exists; creating one adds a second versioned artifact and a cross-repo sync obligation, and would contradict e2e-test-strategy §4. Heavier than a team trial needs. |
| Reuse `docs/examples/`                                             | `docs/examples/` is a render _showcase_, formatter-excluded (CLAUDE.md) — wrong shape for a clonable, CI-tested, formatter-clean project.                                        |

---

## 5. Per-audience reading paths

One table, surfaced in the docs' landing page (Prompt-4 §4 — "Per-audience
reading paths"):

| Audience            | Goal                                              | Path (chapters in order)                                          | Deep-link targets                                                  |
| ------------------- | ------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Architect**       | Structure a project's requirements / architecture | Quickstart → Concepts → **Authoring guide** → Examples gallery    | core-data-model §1–§2; profile-schema §3/§9                        |
| **Developer**       | Author in-code specs, run the CLI                 | Quickstart → **CLI guide** → Examples gallery (in-code spec)      | CLAUDE.md CLI table; toolchain-distribution §3; AGENTS.md §V-model |
| **Compliance lead** | Show ASPICE / ISO 26262 satisfaction              | Concepts → **Profile guide** → Examples gallery (stacked profile) | profile-schema §5/§7/§9; ADR-003 §Part 8 standards-alignment table |

No reader is asked to read an ADR to _use_ the tool (Prompt-4 Context); deep
links into ADRs are "why it works this way" appendices, never on the critical
path.

---

## 6. Doc-as-code constraints

The Prompt-4 Context is explicit: "The docs are part of the product. They ship
in the same release, are versioned together, fail CI together if a code example
doesn't compile. Treat them as code." Normative:

| Constraint                            | Mechanism                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every code block is tested in CI      | The example project **is** the e2e Ring-2 corpus (§4); every shell / MarkSpec block in Quickstart / CLI guide / Authoring guide is an extracted, executed scenario in [markspec-e2e-test-strategy.md §2/§3](markspec-e2e-test-strategy.md) (Ring 2, every PR). A doc command that no longer works fails CI. |
| Every CLI invocation matches `--help` | Each documented flag/subcommand is checked against the binary's current help output — the existing `tests/e2e/help_test.ts` snapshot (e2e-test-strategy §3) is extended to assert the docs' invocations are a subset of real help. Drift = red CI.                                                          |
| Every cross-reference is link-checked | A CI link-checker resolves intra-site links and citations to the owning specs; a dangling `[…](…)` or a cite to a moved section fails the build (mirrors the spec cross-reference discipline used across Prompts 1–3).                                                                                      |
| Docs versioned + released with binary | The guide builds in the same pipeline and is tagged with the same release + core-schema version (toolchain-distribution §3.1); a docs build break blocks the release like any other CI gate.                                                                                                                |
| Single source of truth for examples   | No code sample is hand-copied into prose if it can be transcluded/extracted from `tests/fixtures/corpora/aspice-slice/` (§4). Hand-copied snippets rot; extracted ones fail CI when they break.                                                                                                             |

### 6.1 Options analysis — code-block testing

| Alternative                                        | Rejected because                                                                                                                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extract-and-run, example = e2e corpus (**chosen**) | The strongest guarantee at near-zero extra cost — the corpus already runs in Ring 2 (e2e-test-strategy §2); the docs just point at it. Doc rot becomes a test failure, not a support ticket (Prompt-4 Context). |
| Trust-and-review (humans check examples in PR)     | The exact failure mode the Prompt-4 Context rejects ("fail CI together if a code example doesn't compile"); review misses drift between a doc and a moved flag.                                                 |
| Doctest-style runner independent of the e2e corpus | A second corpus to maintain that drifts from the e2e one; contradicts the single-source-of-truth the merged e2e spec §4 establishes.                                                                            |

---

## 7. Open questions

Capped at five (Prompt-4 constraint).

1. **Quickstart `init` command.** §3 step 2 assumes a single project-init
   command. The CLAUDE.md CLI table has no `markspec init`; project context is a
   hand-authored `project.yaml`. Does Stage 1 add a `markspec init` (a
   toolchain-distribution / Prompt-3 follow-up), or does the quickstart ship a
   copy-paste `project.yaml` + `.markspec.yaml` as "one step"?
2. **Code-block extraction mechanism.** §6 mandates extracted, executed blocks
   but not the mechanism (fenced-block transclusion à la mdBook `{{#include}}`,
   a custom preprocessor, or doctest harness). Which, and does it run inside the
   existing `book/` pipeline or the e2e harness?
3. **Example-project size.** §4 says "thin slice … minimal". The lower bound
   (enough to exercise four abstract types + a stacked profile + three listings
   - one in-code spec) is fixed; the upper bound (how much AEB domain realism
     before it stops being a quickstart aid) is not. Who owns that ceiling?
4. **`docs/guide` chapter-file granularity.** §2 fixes eight chapters; mdBook
   `SUMMARY.md` supports nested sub-chapters. Is each audience guide one file or
   a sub-tree, and does that change the link-check / extraction surface (§6)?
5. **Versioned docs hosting.** §6 ties docs to the release version, but the
   hosting model (latest-only vs per-version docs site) is unspecified — Stage-1
   simplicity vs the compliance lead's need to read the docs for the exact
   version they are audited against. Stage 1 or Stage 2?

---

## Annex — Cross-reference summary

| Section here       | Source                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2 Site structure  | `docs/guide/book.toml` + `SUMMARY.md`; CLAUDE.md §Docs layout; Prompt-4 §1                                                                                                                                                      |
| §3 Quickstart      | [markspec-toolchain-distribution.md §2/§4/§6](markspec-toolchain-distribution.md); core-data-model §1/§3/§4, Annex B                                                                                                            |
| §4 Example project | [markspec-e2e-test-strategy.md §4](markspec-e2e-test-strategy.md); [markspec-profile-schema.md §9.1](markspec-profile-schema.md); [markspec-listing-directives.md §3/§4/§5](markspec-listing-directives.md); AGENTS.md §V-model |
| §5 Reading paths   | core-data-model §1–§2; [markspec-profile-schema.md §5/§9](markspec-profile-schema.md); ADR-003 §Part 8                                                                                                                          |
| §6 Doc-as-code     | Prompt-4 Context; [markspec-e2e-test-strategy.md §2/§3](markspec-e2e-test-strategy.md); [markspec-toolchain-distribution.md §3.1](markspec-toolchain-distribution.md)                                                           |
