# MarkSpec — E2E Test Strategy

Status: Draft (Prompt 3 of the next-gen refactor)\
Date: 2026-05-16\
Scope: The end-to-end test architecture — three latency-gated rings, fixture
organization, snapshot determinism, the LSP/MCP replay format, the CI matrix,
and per-ring coverage targets\
Builds on: [markspec-core-data-model.md](markspec-core-data-model.md) (Prompt 1
output — §3.1 determinism contract, §5 round-trip invariants, §5.5 round-trip
test obligations explicitly addressed to "Prompt 3 e2e"),
[markspec-toolchain-distribution.md](markspec-toolchain-distribution.md) (Prompt
3 companion — the binary and install surfaces Ring 3 exercises),
[markspec-profile-schema.md](markspec-profile-schema.md) (Prompt 2),
[markspec-listing-directives.md](markspec-listing-directives.md) (Prompt 2),
AGENTS.md §Test conventions

This spec freezes the **test ring model**, **fixture layout on disk**, the
**snapshot determinism rules**, the **LSP/MCP request-replay format**, the **CI
matrix**, and **coverage targets per ring**. It does not implement tests
(Prompt-3 constraint — specs only); the implementation lands when the toolchain
is refactored against the nextgen model.

It is the companion of
[markspec-toolchain-distribution.md](markspec-toolchain-distribution.md): Ring 3
drives the `install` commands and the LSP/MCP entrypoints that spec defines.
Cross-references are flagged inline.

---

## 0. Terminology

| Term                      | Meaning in this spec                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **ring**                  | A test tier defined by a latency budget and a trigger cadence (§2). Rings 1–3.                                                    |
| **golden parse**          | A fixture whose expected parse/format output is committed and asserted byte-for-byte (Ring 1).                                    |
| **corpus**                | A realistic multi-file project tree fixture exercised through the CLI (Ring 2).                                                   |
| **replay**                | A recorded JSON-RPC transcript of an LSP or MCP session, re-driven against the server and asserted modulo normalization (Ring 3). |
| **normalization**         | The deterministic scrub applied to output before snapshot comparison (§5.2).                                                      |
| **blackbox**              | A test that touches only the CLI binary via `Deno.Command`, importing nothing from `packages/` (AGENTS.md §E2E tests).            |
| **round-trip obligation** | One of the five test obligations core-data-model §5.5 hands to Prompt 3.                                                          |

---

## 1. Scope and relationship to existing conventions

AGENTS.md §Test conventions already fixes two layers: **unit tests** (colocated
`<module>_test.ts`, importing the module directly) and **e2e tests** (blackbox
in `tests/e2e/`, CLI-only via the `markspec()` helper, `assertSnapshot` for
prose). This spec does **not** replace them — the three rings **organize**
existing and future tests by latency and cadence so the right tests run at the
right time. A given test file belongs to exactly one ring (§3).

The current suite (`tests/e2e/*_test.ts` — 30+ files including
`ast_equivalence_test.ts`, `format_test.ts`, `validate_test.ts`, `mcp_test.ts`,
`lsp_*_test.ts`, plus colocated unit tests) is the starting population §3 maps
into rings. No test is deleted by this spec; some are reclassified and the slow
ones move off the per-commit path.

Out of scope: unit-test design (covered by AGENTS.md), the toolchain install
mechanics themselves (Prompt 3 companion), and Stage-2 concerns (perf
benchmarking, fuzzing) — Open Question 5.

---

## 2. The three rings

Latency is the organizing axis (Prompt-3 Context: "E2E tests in three rings,
gated by latency … they catch different classes of regression"):

| Ring  | Class                           | Budget (whole ring) | Trigger                                     | Catches                                                                                  |
| ----- | ------------------------------- | ------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **1** | Golden parse / format / lint    | < 5 s               | every commit (pre-commit hook + every push) | Parser / formatter / lint regressions; round-trip invariant breaks (core-data-model §5). |
| **2** | Scenario — full CLI pipeline    | < 90 s              | every PR (and every push to a PR branch)    | Cross-subcommand regressions; profile / listing behavior; compile→export→report.         |
| **3** | Integration — LSP/MCP + install | < 15 min            | nightly + pre-release                       | Protocol regressions; editor/client config-write; install idempotence.                   |

Each ring is a strict superset trigger of the one below in _cadence_ (Ring 1
runs whenever Ring 2 does; Ring 2 whenever Ring 3 does) but **not** in content —
they exercise different surfaces and a green Ring 1 says nothing about Ring 3.

### 2.1 Ring 1 — golden parse / format / lint

Pure, in-process, microsecond-to-millisecond assertions. Input fixture → parse →
AST / formatted output / diagnostic set, asserted byte-for-byte against a
committed golden. No subprocess, no filesystem beyond reading the fixture. This
is where core-data-model §3.1 (idempotence, totality, bytewise reproducibility)
and §5 (round-trip invariants) are enforced. `ast_equivalence_test.ts` is the
seed of this ring.

### 2.2 Ring 2 — scenario (full CLI pipeline)

Blackbox, subprocess, seconds. Drives the actual binary via the `markspec()`
helper (AGENTS.md §E2E) against realistic multi-file corpora: `fmt`, `lint`,
`compile`, `export`, `report`, `book build`, `profile`, the listing directives.
Asserts exit code, stdout/stderr split (clig.dev), and normalized snapshots. The
bulk of today's `tests/e2e/*_test.ts` is Ring 2.

### 2.3 Ring 3 — integration (LSP / MCP / install)

Subprocess, stateful protocol sessions, minutes. Replays recorded JSON-RPC
transcripts (§6) against `markspec lsp` / `markspec mcp`, and exercises
`markspec lsp install` / `markspec mcp install`
([markspec-toolchain-distribution.md §4/§5](markspec-toolchain-distribution.md))
against throwaway config fixtures, asserting the managed-block contract
(§toolchain 6) including idempotent re-run. `lsp_*_test.ts` / `mcp_test.ts` are
the seed.

### 2.4 Options analysis — ring count

| Alternative                                    | Rejected because                                                                                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three rings, latency-gated (**chosen**)        | Matches the Prompt-3 Context exactly; each ring has a distinct failure class and a cadence proportional to its cost. The fast ring stays a per-commit gate.                                           |
| Flat suite (`deno test` everything every time) | The current state. The LSP/MCP replay and install tests are minutes-long; running them per commit makes the inner loop unusable, so they rot or get skipped.                                          |
| Two rings (fast unit + slow everything)        | Collapses Ring 2 and Ring 3; a 90 s scenario suite and a 15 min integration suite have different cadences (PR vs nightly). Merging them either slows every PR or delays scenario feedback to nightly. |
| Four+ rings (add a perf ring now)              | Perf/fuzz is Stage 2 (Open Question 5). Adding an empty ring now is speculative structure (YAGNI).                                                                                                    |

---

## 3. Mapping the current suite into rings

| Current file(s)                                                                                | Ring | Rationale                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| Colocated `core/**/*_test.ts` (parser, formatter, validator)                                   | 1    | In-process, sub-ms; the unit layer AGENTS.md defines, run as the fast gate.                                               |
| `tests/e2e/ast_equivalence_test.ts`                                                            | 1    | Round-trip / equivalence assertions — core-data-model §5 territory.                                                       |
| `tests/e2e/format_test.ts`, `validate_test.ts`                                                 | 1+2  | The pure golden cases → Ring 1; the multi-file / project-context cases → Ring 2 (split by whether they spawn the binary). |
| `tests/e2e/{compile,export,report,book_build,create,insert,next_id,hook,config,query}_test.ts` | 2    | Blackbox full-pipeline scenarios.                                                                                         |
| `tests/e2e/profile_*_test.ts`                                                                  | 2    | Profile chain / merge / traceability via the CLI — scenario level.                                                        |
| `tests/e2e/help_test.ts`                                                                       | 2    | Snapshot of `--help`; cheap but blackbox (spawns binary).                                                                 |
| `tests/e2e/lsp_*_test.ts`, `lsp_helpers.ts`                                                    | 3    | Stateful LSP sessions — minutes, protocol surface.                                                                        |
| `tests/e2e/mcp_test.ts`                                                                        | 3    | Stateful MCP session — Ring 3.                                                                                            |
| (new) install fixtures driving `lsp/mcp install`                                               | 3    | Config-write contract ([toolchain §6](markspec-toolchain-distribution.md)).                                               |

The split of `format_test.ts` / `validate_test.ts` is the only reclassification
that splits a file: pure input→output goldens move to a Ring-1 in-process
harness; cases that need a project root / profile resolution stay Ring-2
blackbox. The split criterion is mechanical — _does the case spawn the binary or
need the filesystem?_ If no → Ring 1.

### 3.1 Round-trip obligations → rings (core-data-model §5.5)

core-data-model §5.5 hands Prompt 3 five obligations. Their ring placement:

| §5.5 obligation                                                               | Ring | Form                                                                        |
| ----------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------- |
| 1. Idempotence over every body-block type, caption type, shape×type combo     | 1    | Golden corpus; assert `fmt(x) == fmt(fmt(x))` byte-identical.               |
| 2. Stability under attribute reordering (random valid shuffles → same output) | 1    | Property-style: shuffle trailer order, assert canonical output equal.       |
| 3. Stability under repeatable-value form mixing (CSV vs multi-line → same)    | 1    | Paired fixtures, same expected golden.                                      |
| 4. ULID stability for `Origin: synthesized` across runs and platforms         | 1+3  | Ring 1: same input → same derived ULID. Ring 3 (nightly matrix): across OS. |
| 5. Lossless preservation of unknown trailer keys when no profile loaded       | 1    | Core-only-mode golden; assert unknown keys survive verbatim (§5.4).         |

Obligation 4's cross-platform half is the one assertion that needs the Ring-3
nightly OS matrix (§7); the rest are Ring 1 and gate every commit.

---

## 4. Fixture organization on disk

Extends the existing `tests/fixtures/` (today: `glossary.md`,
`requirement-block.md`, `traceability-matrix.md`, `in-code-*.{rs,kt}`,
`profiles/`). New top-level layout, one concern per fixture, deterministic:

```text
tests/fixtures/
├── golden/                 ← Ring 1: input + expected output pairs
│   ├── parse/<name>.md            and  <name>.ast.json
│   ├── format/<name>.in.md        and  <name>.out.md
│   ├── lint/<name>.md             and  <name>.diag.json
│   └── roundtrip/<name>.md        (idempotence / §5.5 obligations 1–3,5)
├── corpora/                ← Ring 2: realistic multi-file project trees
│   ├── minimal/                   (default profile, a few entries)
│   ├── aspice-slice/              (stacked ASPICE profile, profile-schema §9.1)
│   └── iso-26262-slice/           (stacked ISO 26262, profile-schema §9.2)
├── replay/                 ← Ring 3: recorded JSON-RPC transcripts
│   ├── lsp/<scenario>.jsonl
│   └── mcp/<scenario>.jsonl
└── install/                ← Ring 3: throwaway editor/client config seeds
    ├── neovim/  zed/  claude-desktop/  cursor/   (before/after pairs)
```

Rules:

- **One concern per fixture.** A `format` golden tests one canonical-form rule,
  not a grab-bag. A reviewer reading the diff sees exactly what changed.
- **Corpora are realistic.** `aspice-slice` / `iso-26262-slice` are thin slices
  of `demo-aeb-*` shaped to the worked examples in
  [markspec-profile-schema.md §9](markspec-profile-schema.md) — they double as
  the Prompt-4 example project's backing data (cross-cutting; Prompt 4 cites
  them).
- **Deterministic content.** No timestamps, no random ULIDs in committed
  fixtures except where the test _is_ ULID assignment (then
  `Origin:
  synthesized` so the ULID is derivable, core-data-model §3.5).
- `docs/examples/` stays excluded from formatters (CLAUDE.md); fixtures are
  separate and may be intentionally non-canonical as _inputs_.

---

## 5. Snapshot strategy

### 5.1 Determinism source of truth

Snapshots are sound only because the tool is deterministic. The contract is
core-data-model §3.1 (idempotence, total function, bytewise reproducibility
across macOS/Linux/Windows/Deno/Node/WASM) and §5.3. A snapshot test asserts
that contract; if a snapshot is flaky, the defect is in the tool's determinism
(core-data-model §3.1 "If two implementations could disagree, the rule is
under-specified and is a defect"), not in the test — the test is doing its job.

### 5.2 Normalization

Before comparison, output is normalized so the snapshot captures _meaning_, not
incidental environment:

| Normalized                    | Rule                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Absolute paths                | Rewrite the temp working dir to `<TMP>`; project root to `<ROOT>`. (The `markspec()` helper already temp-dirs.)                                                                                  |
| Non-synthesized ULIDs         | Redact random Authored ULIDs to `<ULID:n>` (stable per-snapshot ordinal). `Origin: synthesized` ULIDs are **not** redacted — they are deterministic and _are_ the assertion (§3.1 obligation 4). |
| Timestamps / durations / PIDs | Redact to `<TIME>` / `<PID>` (only ever appear in diagnostics/progress on stderr, never in data output).                                                                                         |
| Map / object key order        | Emit with keys sorted; the compiler's JSON output is already deterministic (core-data-model §5.3) — sorting is belt-and-braces against serializer drift.                                         |
| Trailing whitespace / EOL     | Normalize to `\n`; assert no trailing whitespace (it is itself a formatter rule, core-data-model §3.3.5).                                                                                        |

Normalization is **diff-friendly**: one logical record per line, stable field
order, so a snapshot delta reads as a minimal unified diff (the same property
the toolchain spec wants for config writes —
[toolchain §6.5](markspec-toolchain-distribution.md)).

### 5.3 Update discipline

`.snap` files are committed and CI-verified (AGENTS.md §CI).
`deno test … --
--update` regenerates them; the diff is reviewed and committed
consciously (AGENTS.md §E2E "Snapshot assertions"). A snapshot change in a PR is
a reviewable artifact — an unexplained `.snap` delta is a review red flag, not a
rubber stamp.

### 5.4 Options analysis — snapshot scope

| Alternative                                           | Rejected because                                                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Normalized snapshots, determinism-backed (**chosen**) | Captures full output cheaply; soundness rests on the §3.1 contract the tool already owes. Diff-friendly normalization keeps reviews honest.   |
| Field-level assertions only (no snapshots)            | Verbose, under-asserts (the fields nobody thought to check regress silently). AGENTS.md already mandates `assertSnapshot` for prose surfaces. |
| Snapshot raw output, no normalization                 | Every temp path / random ULID makes every run differ — snapshots become untestable or get `--update`-spammed until meaningless.               |

---

## 6. LSP / MCP request-replay format

### 6.1 Transcript format

Ring 3 records and replays **newline-delimited JSON** (`.jsonl`), one JSON-RPC
message per line, prefixed with a direction marker:

```text
→ {"jsonrpc":"2.0","id":1,"method":"initialize","params":{…}}
← {"jsonrpc":"2.0","id":1,"result":{"capabilities":{…},"serverInfo":{…}}}
→ {"jsonrpc":"2.0","method":"textDocument/didOpen","params":{…}}
← {"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{…}}
```

- `→` = client→server (driven by the harness). `←` = server→client (expected,
  asserted modulo §5.2 normalization).
- Requests are matched by `id`; notifications by `(method, params)` after
  normalization. Server→client ordering is asserted per-`id`; unordered
  notifications (e.g. `publishDiagnostics`) are matched as a set within a settle
  window.
- Paths/URIs in params are written relative to a `<ROOT>` token at record time
  so the transcript is portable (same normalization as §5.2).
- The replayed binary is the **bundled binary**
  ([toolchain §2](markspec-toolchain-distribution.md)) invoked as `markspec lsp`
  / `markspec mcp` — Ring 3 tests the shipped artifact, not an in-process
  server, so it catches the entrypoint wiring `main.ts` does.

### 6.2 Recording

A `--record` mode on the replay harness captures a live session into a
transcript; the author trims it to the scenario, reviews it, and commits it
(same discipline as `.snap`, §5.3). Re-recording after an intentional protocol
change is a reviewed diff.

### 6.3 Options analysis — replay format

| Alternative                                     | Rejected because                                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Direction-tagged JSON-RPC `.jsonl` (**chosen**) | It _is_ the wire format — minimal translation, trivially diffable line-by-line, recordable from a real session, language-agnostic. |
| Structured scenario DSL (custom YAML steps)     | A second grammar to learn and maintain that must be kept faithful to JSON-RPC; drifts from what the editor actually sends.         |
| Full binary session capture (pcap-style)        | Opaque, unreviewable, non-portable across platforms; defeats the "reviewable artifact" property every other ring upholds.          |
| Assert only final state (no transcript)         | Misses ordering / intermediate-notification regressions — exactly the protocol class Ring 3 exists to catch.                       |

---

## 7. CI matrix

| Job       | Rings | Trigger                                            | Budget   | Platform(s)                                                                       |
| --------- | ----- | -------------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `fast`    | 1     | every push (all branches), pre-commit hook locally | < 5 s    | Linux (CI), host (local)                                                          |
| `pr`      | 1 + 2 | every pull request / PR push                       | < 95 s   | Linux                                                                             |
| `nightly` | 1+2+3 | scheduled nightly + pre-release tag                | < 17 min | Linux **and** macOS **and** Windows (the §3.1 obligation-4 cross-platform matrix) |

- The existing single CI invocation
  (`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi`,
  AGENTS.md §CI) becomes the **`pr`** job. `fast` is a filtered subset (Ring-1
  tagged tests only). `nightly` adds Ring 3 and the OS matrix.
- Test→ring tagging mechanism: a ring tag in the test name or a per-directory
  convention (`tests/e2e/` Ring 2/3 by file per §3; Ring 1 = colocated unit +
  the in-process golden harness). The exact tag syntax is an implementation
  detail (Open Question 2).
- `nightly` is the **only** job that needs `--allow-run` for the install
  fixtures and the LSP/MCP subprocess replay at scale; `pr` already has it for
  the blackbox helper.
- A red `nightly` blocks a release tag, not the merge that triggered the nightly
  — Ring 3 regressions are release gates, not PR gates (latency budget
  rationale, §2).

### 7.1 Options analysis — matrix

| Alternative                           | Rejected because                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| fast/pr/nightly as above (**chosen**) | Cadence matches cost (§2); cross-platform only where an obligation demands it (§3.1 ob.4), keeping nightly affordable.                                 |
| Run the OS matrix on every PR         | 3× the PR CI minutes for a guarantee only obligation-4 needs; the determinism contract (§5.1) makes single-platform PR runs sound for everything else. |
| No nightly; everything on PR          | Pushes Ring 3 (15 min) onto every PR — the inner-loop-killing failure §2.4 rejects.                                                                    |

---

## 8. Coverage targets per ring

Coverage is defined by **surface enumeration**, not a line-percentage number (a
line target rewards trivial tests; surface enumeration rewards the cases that
regress):

| Ring | Target (must be exhaustive over the named surface)                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 100% of the five core-data-model §5.5 round-trip obligations; every body-block type (10, core-data-model §2.4); every caption type (6, core-data-model §2.6); every shape × abstract-type combination (core-data-model §1.1); every `MSL-` lint code in core-data-model §4 has at least one positive and one negative golden.                                                                                                                  |
| 2    | Every implemented CLI subcommand (CLAUDE.md table) with at least one happy-path and one error-path scenario; every listing directive ([markspec-listing-directives.md §6](markspec-listing-directives.md)); a stacked-profile corpus exercising [markspec-profile-schema.md §5](markspec-profile-schema.md) merge cases (a)–(d).                                                                                                               |
| 3    | Every LSP capability the server advertises (`lsp/server.ts` `InitializeResult.capabilities` — diagnostics, completion, hover, definition, references, document/workspace symbols, rename, folding, highlights, code actions); every MCP tool and resource (`mcp/server.ts`); every first-class install adapter ([markspec-toolchain-distribution.md §4.2/§5.2](markspec-toolchain-distribution.md)) including idempotent re-run and `--print`. |

A new core lint code, body block, LSP capability, MCP tool, or install adapter
is **not done** until its ring's enumeration includes it — this is the
regression-proofing contract, enforced by review, not a coverage gate that can
be gamed.

### 8.1 Options analysis — coverage definition

| Alternative                             | Rejected because                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Surface enumeration (**chosen**)        | Ties "covered" to the actual contract surfaces (lint codes, capabilities, subcommands); a gap is visible and reviewable.    |
| Line-coverage percentage gate           | Rewards exercising lines, not asserting behavior; a 90% line target passes with no assertion on the output that matters.    |
| No explicit target ("write good tests") | Unfalsifiable; the regression classes the rings exist to catch slip through because nobody owns "is the surface complete?". |

---

## 9. Open questions

Capped at five (Prompt-3 constraint).

1. **Ring-1 in-process harness vs blackbox.** §3 splits `format_test.ts` into a
   Ring-1 in-process harness (imports `core/`) and Ring-2 blackbox. AGENTS.md
   §E2E says e2e imports _nothing_ from source. Is the Ring-1 golden harness a
   _unit_-layer construct (colocated, allowed to import `core/`) rather than an
   e2e one — i.e. does Ring 1 live under `core/**` not `tests/e2e/`?
2. **Ring tagging mechanism.** §7 defers the concrete tag syntax (test-name
   prefix? `Deno.test` metadata? directory convention?). Which, and does it need
   to survive `deno test` filtering portably to Node?
3. **Corpora vs the Prompt-4 example project.** §4 says `aspice-slice` doubles
   as Prompt 4's example project. If they diverge (docs need pedagogy, tests
   need edge cases), do they fork, or does the example project stay a strict
   superset the corpora subset?
4. **Replay settle window.** §6.1 matches unordered notifications "within a
   settle window". What defines the window — a fixed timeout (flaky under CI
   load) or a quiescence signal from the server (needs a protocol affordance)?
5. **Stage-2 rings.** Perf/throughput and fuzz/property testing are excluded
   (§1, §2.4). When Stage 2 adds them, are they Ring 4 / Ring 5, or a separate
   non-ring track triggered independently of this cadence model?

---

## Annex — Cross-reference summary

| Section here     | Source                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 Conventions   | AGENTS.md §Test conventions; existing `tests/e2e/`                                                                                                                                  |
| §2 Three rings   | Prompt-3 Context; core-data-model §3.1/§5                                                                                                                                           |
| §3 Suite mapping | `tests/e2e/*`; core-data-model §5.5 (round-trip obligations addressed to Prompt 3)                                                                                                  |
| §4 Fixtures      | `tests/fixtures/`; [markspec-profile-schema.md §9](markspec-profile-schema.md); CLAUDE.md (`docs/examples/` exclusion)                                                              |
| §5 Snapshots     | core-data-model §3.1/§5.3; AGENTS.md §E2E "Snapshot assertions" / §CI                                                                                                               |
| §6 Replay format | `lsp/server.ts`, `mcp/server.ts`; [markspec-toolchain-distribution.md §2](markspec-toolchain-distribution.md)                                                                       |
| §7 CI matrix     | AGENTS.md §CI; core-data-model §5.3 (cross-platform); [markspec-toolchain-distribution.md §3.4](markspec-toolchain-distribution.md)                                                 |
| §8 Coverage      | CLAUDE.md §CLI subcommands; core-data-model §2.4/§2.6/§4/§5.5; `lsp/server.ts`; `mcp/server.ts`; [markspec-toolchain-distribution.md §4.2/§5.2](markspec-toolchain-distribution.md) |
