# Whole-document Markdown formatting in `markspec fmt` — design

- **Date:** 2026-07-02
- **Status:** approved in brainstorming, pending implementation plan
- **Relates to:** issue #649 (subsumed), ADR-014/015 (body-AST fallback +
  equivalence contract), ADR-027 (composite `check` gate / MSL-F010)

## Problem

`markspec fmt` today formats only entry-block mechanics: ULID stamping, trailer
indentation, trailing backslashes, modal-keyword case. All surrounding Markdown
— overview chapters, context prose, headings, tables, lists — passes through
verbatim. Authors reasonably expect `markspec fmt` to be _the_ formatter for
MarkSpec documents; today a second tool (dprint) is required for the prose, and
tables are silently skipped (#649).

dprint is **not** embedded in the binary today; it is only a dev tool for this
repository's own source tree.

## Decision summary

`markspec fmt` formats the entire Markdown document, not just entry blocks.

| Decision                | Choice                                                                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default vs opt-in       | **Default-on.** `markspec fmt` becomes the one formatter for MarkSpec documents. No flag, no config switch.                                                                                                                                  |
| Style configurability   | **Fixed, zero config.** One canonical MarkSpec style baked in.                                                                                                                                                                               |
| File scope              | **Markdown files only** (`MARKDOWN_EXTENSIONS`). Source-file doc comments stay read-only for `fmt`; their layout belongs to the host language's formatter.                                                                                   |
| Mechanism               | **Embed dprint-markdown WASM** via the `@dprint/formatter` npm host + `@dprint/markdown` plugin asset. Node-compatible, deterministic, lazily imported on the `fmt` code path only, bundled into the compiled binary (Typst-WASM precedent). |
| Entry-block coexistence | **Approach B — segmented, bodies included** (see below).                                                                                                                                                                                     |

`remark-stringify` was considered as a native printer (already a dependency) and
rejected: it cannot hard-wrap prose at a line width, which is the signature
behaviour wanted. Whole-file dprint (approach C) was rejected because dprint is
not entry-aware — it would wrap >80-char title lines and fight the entry
grammar, degrading per-file unpredictably. Prose-only segmentation (approach A)
was rejected as incomplete — it leaves entry bodies ragged and #649 unfixed.

## Pipeline (approach B)

`format()` in `core/formatter` gains a Markdown pass:

1. Parse the file (as today) → entries with title-line, body, and trailer
   extents.
2. Extract YAML front matter (existing `extractFrontMatter`) and hold it aside;
   after formatting, reattach it unchanged in its original position at the top
   of the file — dprint never sees it.
3. Split the document into alternating segments: prose / entry-block / prose / …
4. **Prose segments** → dprint-markdown with the fixed style.
5. **Entry blocks**: the title line and the trailer are never given to dprint.
   The body is dedented (−2 columns), formatted by dprint, re-indented (+2), and
   gated: `astEquivalent(buildBodyAst(original), buildBodyAst(formatted))`. On
   mismatch the body falls back to its original text.
6. Rejoin segments; the existing entry passes (ULID stamping, trailer indent,
   backslashes, modal case) run as today.

**Idempotency is a hard requirement:** `format(format(x)) === format(x)`.
MSL-F010 depends on it.

## Fixed style

Baked in, mirroring this repository's own `dprint.json`:

| Setting             | Value                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lineWidth`         | `80`                                                                                                                                                                   |
| `textWrap`          | `always` (canonical re-wrap; plugin default `maintain` rejected)                                                                                                       |
| `emphasisKind`      | `underscores` (`_emphasis_`)                                                                                                                                           |
| `strongKind`        | `asterisks` (`**strong**`)                                                                                                                                             |
| `unorderedListKind` | `dashes` (`- item`)                                                                                                                                                    |
| newline kind        | **follow the file's detected line ending** (existing `detectLineEnding`/`applyLineEnding`; deliberate deviation from `newLineKind: lf` to avoid CRLF churn on Windows) |

**`lineWidth` is a soft target, not a hard cap.** Constructs that cannot be
broken are allowed to exceed 80 columns and are never split:

- **table rows** — GFM rows are single-line by grammar; dprint aligns columns
  and lets wide tables overflow;
- **links and references** — URLs, link destinations, reference definitions
  (`[label]: url`), and display-ID tokens are placed on their own line when
  needed but never broken mid-token;
- **inline code spans** that exceed the width.

Only plain prose re-wraps. This matches dprint's native behaviour; it is
recorded here as a contract (with tests) so it cannot silently regress.

Because the real dprint plugin runs, its escape-hatch comments
(`<!-- dprint-ignore -->`, `<!-- dprint-ignore-start/end -->`) work unchanged as
a per-block opt-out.

## Safety and fallback ladder

Never make a file worse; never block on the new pass.

- **Body gate trips** → that entry keeps its original body; the rest of the file
  still formats. An advisory `info` diagnostic names the entry so the fallback
  is visible, not silent.
- **File-level parse errors** → the Markdown pass is skipped for the whole file
  (`output === input`, matching existing formatter behaviour).
- **Prose segments** have no semantic model to gate against; dprint's round-trip
  fidelity is trusted there. Fenced code inside prose is verbatim under dprint's
  own rules.

## Blast radius

- `fmt --check` and the MSL-F010 drift gate in `check` start flagging prose
  drift. Existing projects need a **one-time `markspec fmt`** to converge —
  acceptable pre-1.0 (no-migration policy), goes in release notes.
- Files that must never be reformatted use the existing `project.yaml`
  `exclude:` mechanism (e.g. this repo's `docs/examples/`). No new escape hatch.
- This repository keeps the external dprint CLI for its own dev tree
  (JSON/YAML/TOML, non-project Markdown). Same engine + same style values → the
  two cannot disagree on `.md` files.
- Binary grows by the markdown plugin's WASM (~1–2 MB) — negligible next to
  embedded Typst; lazy-loaded so `check`/`lsp` startup is unaffected.

## Risks and mitigations

Ranked by severity. Items 1 and 6 are de-risking spikes that MUST be the first
tasks of the implementation plan.

1. **Body gate vs re-wrap tension.** Re-wrapping moves softbreak positions
   inside paragraphs. If `astEquivalent` treats softbreaks as significant, every
   re-wrapped body falls back and body formatting silently does nothing. _Spike:
   verify `normalizeBodyAst`/`astEquivalent` treat softbreak repositioning as
   equivalent; if not, loosening the gate is an ADR-015 contract change to be
   decided explicitly._
2. **Idempotency across segmentation.** `format(format(x)) === format(x)` now
   depends on the re-parse finding identical entry boundaries after dprint
   touched surrounding prose. A non-idempotent file makes MSL-F010 drift
   forever. _Mitigation: idempotency property test over the entire fixture
   corpus is a merge gate._
3. **Dedent/re-indent totality.** Lazy continuation lines, hard tabs, and
   indentation-sensitive body constructs can defeat a naive −2/+2 shift. The
   gate contains the damage but frequent fallback degrades to approach A
   silently. _Mitigation: the advisory diagnostic makes fallbacks countable;
   measure fallback rate on real corpora before release._
4. **Plugin version = canonical form.** A future `@dprint/markdown` bump can
   change output → project-wide drift for every user. _Mitigation: pin the exact
   plugin version; treat bumps like core-schema bumps (release notes + expected
   churn)._
5. **One-time churn side effects.** Git blame noise (add the reformat commit to
   `.git-blame-ignore-revs`), conflicts with in-flight PRs, and
   semantic-line-break authoring style is permanently lost under
   `textWrap: always`. _Mitigation: release notes state all three._
6. **Packaging verification.** `@dprint/formatter` + WASM must work inside the
   `deno compile` binary and on Node (core boundary rule). _Spike: smoke-test
   the embedded plugin in a compiled binary before building on top._
7. **Cross-segment ignore ranges.** `<!-- dprint-ignore-start/end -->` pairs
   that span an entry block do not work (segments format independently).
   _Mitigation: document the limitation._
8. **Parser extent bugs gain write-path blast radius.** Pre-existing extent bugs
   (e.g. #649's colon-in-table-cell note) now sit on a write path. _Mitigation:
   the gate contains it; fix the known parser bug early._

## Testing

- **Unit** (colocated with `core/formatter`): segmentation correctness; body
  dedent → format → re-indent round-trip; equivalence-gate fallback path;
  idempotency property over the fixture corpus.
- **E2E** (`tests/e2e/format_test.ts`, blackbox): #649's
  misaligned-table-in-body fixture gets aligned; ragged intro-chapter prose
  wraps at 80; long trailer attribute values untouched; CRLF file stays CRLF;
  `fmt --check` exit code reflects prose drift; a wide table and a long
  URL/reference line remain single-line beyond 80 columns (soft-limit contract).

## Documentation

- `docs/guide/cli.md` — `fmt` section describes whole-document scope.
- Entry-authoring / write-loop skills — "format before commit" wording.
- **ADR-029 — whole-document Markdown formatting**: records the embed-dprint
  decision, the fixed style, the body gate, and the rejected alternatives.
- Closes #649.

## Alternatives considered

1. **Delegate to external dprint (document it)** — keeps `fmt` entry-only;
   rejected: violates "one binary, one formatter" expectation and leaves
   consumer projects needing a second tool + config.
2. **Native table/prose printer** — full control, no WASM; rejected: large
   sustained effort to match dprint quality (YAGNI).
3. **Approach A / C variants** — see Decision summary.
