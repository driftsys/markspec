/**
 * @module tests/e2e/ast_fidelity
 *
 * SP3 — Formatting Fidelity success oracle (pure; no `Deno.*`).
 *
 * Owns: the data-driven corpus, the per-sample classifier, and the
 * deterministic catalogue renderer.
 *
 * The relation lives in `core/ast/equivalence.ts` (`astEquivalent`,
 * SP3-ratified, production-consumed by the formatter guard). This
 * classifier measures the SP3 build/render/FORMAT contract: a sample is
 * `OK` when the formatter canonicalizes it idempotently and that
 * canonical body is `astEquivalent` to `normalizeBodyAst(buildBodyAst(s))`
 * (Formalization A). Re-exported here so existing callers
 * (`ast_fidelity_test.ts`) keep working without import changes.
 *
 * Import-boundary note: `core/mod.ts` is the library boundary, but it does
 * not export `buildBodyAst` / `normalizeBodyAst`. This harness imports them
 * from the internal `core/ast/build.ts` / `core/ast/normalize.ts` paths —
 * an intentional, design-mandated exception (SP1 design §4.3 names
 * `buildBodyAst` explicitly; `normalizeBodyAst` is pure SP3 Task-2 code),
 * with precedent: `tests/e2e/ast_equivalence_test.ts` already imports
 * `render` from the internal `core/ast/render.ts` path.
 */

import {
  astEquivalent,
  type BodyBlock,
  format,
  parseFile,
} from "../../packages/markspec/core/mod.ts";
import { buildBodyAst } from "../../packages/markspec/core/ast/build.ts";
import { normalizeBodyAst } from "../../packages/markspec/core/ast/normalize.ts";

export { astEquivalent };

/** A single corpus sample. `markdown` is the bare entry-body text. */
export interface CorpusSample {
  readonly name: string;
  readonly markdown: string;
}

/**
 * Fidelity class for a sample under the SP3 build/render/FORMAT contract.
 *
 *   - `OK` — the formatter canonicalizes the sample idempotently AND its
 *     canonical body is `astEquivalent` to
 *     `normalizeBodyAst(buildBodyAst(s))` (Formalization A).
 *   - `UNOWNED` — a §2.4.1-excluded construct kept verbatim as
 *     `Unknown(raw)` (the model does not own it; faithfully preserved).
 *   - `RESIDUAL` — neither: the SP3 contract does not hold. The SP3 spec
 *     mandates zero of these; a non-zero count is a surface-to-owner
 *     finding, never silently accepted.
 */
export type FidelityClass = "OK" | "UNOWNED" | "RESIDUAL";

/** One classified matrix row. */
export interface MatrixRow {
  readonly name: string;
  readonly cls: FidelityClass;
  /** `format` is idempotent on the wrapped entry. */
  readonly formatIdempotent: boolean;
  /**
   * `astEquivalent(buildBodyAst(cf), normalizeBodyAst(buildBodyAst(s)))`
   * where `cf` is the formatter-canonical body.
   */
  readonly roundtrips: boolean;
  /** Stable, single-line encoding of the input→canonical-body delta. */
  readonly delta: string;
}

/** The full matrix: ordered rows + per-class counts + headline number. */
export interface Matrix {
  readonly rows: readonly MatrixRow[];
  readonly counts: Readonly<Record<FidelityClass, number>>;
  /** Headline surface = RESIDUAL. */
  readonly surface: number;
}

/**
 * The corpus — every body construct the MarkSpec spec permits
 * (docs/specs/markspec-core-data-model.md §2.4–2.6) plus §2.4.1 excluded
 * constructs and edge cases. Data-driven and extendable: SP2/SP3 append
 * cases as they surface. Order is FIXED (catalogue determinism).
 */
export const CORPUS: readonly CorpusSample[] = [
  // ── §2.4 blocks ──────────────────────────────────────────────────────
  {
    name: "paragraph-plain",
    markdown: "The sensor driver shall debounce raw inputs.",
  },
  {
    name: "paragraph-multiline",
    markdown: "The sensor driver shall debounce raw inputs\nbefore processing.",
  },
  {
    name: "list-unordered-tight",
    markdown: "- check plausibility\n- validate range",
  },
  { name: "list-ordered-tight", markdown: "1. first step\n2. second step" },
  { name: "list-unordered-loose", markdown: "- a\n\n- b\n\n- c" },
  {
    name: "list-nested",
    markdown: "- outer one\n  - inner a\n  - inner b\n- outer two",
  },
  { name: "table-simple", markdown: "| A | B |\n|---|---|\n| 1 | 2 |" },
  {
    name: "table-padded",
    markdown: "| Name    | Value |\n|---------|-------|\n| foo     | 42    |",
  },
  {
    name: "table-sep-wider",
    markdown:
      "| Col A         | Col B |\n| ------------- | ----- |\n| x             | y     |",
  },
  { name: "figure-image", markdown: "![system diagram](docs/arch.svg)" },
  { name: "code-tagged", markdown: "```rust\nfn main() {}\n```" },
  { name: "code-untagged", markdown: "```\nverbatim content here\n```" },
  {
    name: "feature-gherkin",
    markdown:
      "```gherkin\nFeature: braking\n  Scenario: emergency stop\n    Given speed exceeds 30 km/h\n```",
  },
  { name: "math-block", markdown: "$$\nE = mc^2\n$$" },
  {
    name: "definition-list-single",
    markdown: "ASIL\n: Automotive Safety Integrity Level",
  },
  {
    name: "definition-list-multi",
    markdown: "Term A\n: definition A\n\nTerm B\n: definition B",
  },
  {
    name: "note-NOTE",
    markdown: "> [!NOTE]\n> This is an informational note.",
  },
  {
    name: "note-TIP",
    markdown: "> [!TIP]\n> Consider using the default configuration.",
  },
  {
    name: "note-IMPORTANT",
    markdown: "> [!IMPORTANT]\n> This setting affects safety behaviour.",
  },
  {
    name: "note-WARNING",
    markdown:
      "> [!WARNING]\n> Failure to debounce may lead to spurious activation.",
  },
  {
    name: "note-CAUTION",
    markdown: "> [!CAUTION]\n> Modifying this value requires re-validation.",
  },
  { name: "note-multiline", markdown: "> [!WARNING]\n> line one\n> line two" },
  { name: "note-interior-blank", markdown: "> [!NOTE]\n> a\n>\n> c" },
  { name: "blockquote-plain", markdown: "> An external citation excerpt." },
  { name: "blockquote-multiline", markdown: "> line one\n> line two" },
  { name: "blockquote-interior-blank", markdown: "> a\n>\n> b" },
  { name: "caption-figure", markdown: "Figure: System context diagram" },
  { name: "caption-table", markdown: "Table: Sensor plausibility bounds" },
  // ── §2.5 inline ──────────────────────────────────────────────────────
  { name: "inline-emphasis", markdown: "The driver _shall_ debounce inputs." },
  { name: "inline-strong", markdown: "The driver **must** debounce inputs." },
  {
    name: "inline-combined",
    markdown: "The driver **_must always_** debounce.",
  },
  {
    name: "inline-code",
    markdown: "Call `debounce(input)` before processing.",
  },
  {
    name: "inline-link",
    markdown: "See [the spec](docs/specs/x.md) for detail.",
  },
  {
    name: "inline-refstyle-link",
    markdown: "See [the spec][s] for detail.\n\n[s]: docs/specs/x.md",
  },
  {
    name: "inline-autolink",
    markdown: "Reference: <https://example.com/spec>.",
  },
  { name: "inline-hardbreak-spaces", markdown: "line one  \nline two" },
  { name: "inline-hardbreak-backslash", markdown: "line one\\\nline two" },
  {
    name: "inline-entity-pascal",
    markdown: "The $BrakeController shall arm the actuator.",
  },
  {
    name: "inline-entity-camel",
    markdown: "The $brakePedal signal shall be sampled.",
  },
  {
    name: "inline-entity-screaming",
    markdown: "The $ASIL_LEVEL constant gates the path.",
  },
  {
    name: "inline-modal-rfc2119",
    markdown: "The system shall validate and must reject invalid values.",
  },
  {
    name: "inline-modal-ears",
    markdown: "When speed exceeds the limit the system shall warn.",
  },
  // ── §2.4.1 excluded constructs (expect UNOWNED / diagnostic; never destroyed) ──
  { name: "excluded-heading", markdown: "# Not allowed in a body" },
  { name: "excluded-thematic-break", markdown: "before\n\n---\n\nafter" },
  { name: "excluded-task-list", markdown: "- [ ] todo item\n- [x] done item" },
  { name: "excluded-raw-html", markdown: "<div>raw block html</div>" },
  // ── Edge cases ───────────────────────────────────────────────────────
  { name: "edge-blank-line-runs", markdown: "para one\n\n\n\npara two" },
  { name: "edge-crlf", markdown: "line one\r\nline two" },
  { name: "edge-tabs", markdown: "col1\tcol2 with a tab" },
  {
    name: "edge-leading-trailing-ws",
    markdown: "   leading and trailing spaces   ",
  },
  {
    name: "edge-mixed-blocks",
    markdown:
      "Intro prose.\n\n- a\n- b\n\n```rust\nfn x() {}\n```\n\n> [!NOTE]\n> done.",
  },
  {
    name: "edge-paragraph-then-table",
    markdown:
      "See the table below.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nEnd of table.",
  },
  // ── SP2: inline markup inside every prose-bearing node kind ───────────
  {
    name: "inline-in-list-item",
    markdown: "- The driver _shall_ debounce **inputs**.\n- Plain item.",
  },
  {
    name: "inline-in-note",
    markdown: "> [!NOTE]\n> See _the spec_ and the [guide](docs/g.md).",
  },
  {
    name: "inline-in-blockquote",
    markdown: "> An excerpt with _emphasis_ and a [link](docs/x.md).",
  },
  {
    name: "inline-in-table-cell",
    markdown: "| A | B |\n|---|---|\n| _x_ | **y** |",
  },
  {
    name: "inline-in-deflist",
    markdown: "ASIL\n: _Automotive_ Safety **Integrity** Level",
  },
  {
    name: "link-ref-definition-standalone",
    markdown: "See [the spec][s].\n\n[s]: docs/specs/x.md",
  },
] as const;

// Stub exports — implemented in later tasks.

/** Fixed ULID for deterministic wrapping (matches ast_equivalence_test.ts). */
const FIXED_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

/** True when every block is an `unknown` node carrying verbatim `raw`. */
function allUnknownVerbatim(blocks: readonly BodyBlock[]): boolean {
  return blocks.length > 0 &&
    blocks.every((b) => b.kind === "unknown" && typeof b.raw === "string");
}

/** Stable, single-line, human-readable input→canonical-body delta. */
function encodeDelta(s: string, r: string): string {
  if (r === s) return "—";
  // JSON-escape (handles \n, \r, \t, quotes deterministically), keep it on
  // one line. Truncate very long values stably so the catalogue diff stays
  // small while remaining a faithful signal.
  const cap = (x: string) => {
    const j = JSON.stringify(x);
    return j.length > 160 ? `${j.slice(0, 157)}...` : j;
  };
  return `${cap(s)} → ${cap(r)}`;
}

/** Result of formatter-canonicalizing a wrapped sample. */
interface FormatterCanonical {
  /** The formatter-canonical entry body (`undefined` if it does not parse). */
  readonly canonicalBody: string | undefined;
  /** `format(format(doc)).output === format(doc).output`. */
  readonly idempotent: boolean;
}

/**
 * Run the SP3 build/render/FORMAT machinery on a sample: wrap `s` in a
 * minimal entry with a fixed ULID, `format()` the document, check that a
 * second `format()` is a no-op (idempotence on the wrapped entry), then
 * re-parse the formatted document and return the resulting `entry.body`
 * as the formatter-canonical body `cf`.
 */
async function formatterCanonical(
  sample: string,
): Promise<FormatterCanonical> {
  const indented = sample.split("\n").join("\n  ");
  const doc =
    `- [TST_FM_0001] Fidelity probe\n\n  ${indented}\n\n      Id: ${FIXED_ULID}\n`;
  const once = format(doc, { file: "fidelity.md" }).output;
  const twice = format(once, { file: "fidelity.md" }).output;
  const idempotent = twice === once;
  const parsed = await parseFile(once, { file: "fidelity.md" });
  if (parsed.entries.length === 0) {
    return { canonicalBody: undefined, idempotent };
  }
  return { canonicalBody: parsed.entries[0].body, idempotent };
}

/**
 * Classify one sample under the SP3 build/render/FORMAT contract
 * (Formalization A; SP3 Task 7).
 *
 *   - `UNOWNED` if `allUnknownVerbatim(buildBodyAst(s))` — an excluded
 *     construct preserved verbatim (predicate unchanged from SP1).
 *   - else `OK` if (a) `format` is idempotent on the wrapped entry AND
 *     (b) `astEquivalent(buildBodyAst(cf), normalizeBodyAst(buildBodyAst(s)))`
 *     where `cf` is the formatter-canonical body.
 *   - else `RESIDUAL`.
 */
export async function classifySample(
  sample: CorpusSample,
): Promise<MatrixRow> {
  const s = sample.markdown;
  const ast0 = buildBodyAst(s);

  const { canonicalBody: cf, idempotent: formatIdempotent } =
    await formatterCanonical(s);

  // (b): the formatter-canonical body's AST must be equivalent to the
  // §5.2-normalized AST of the input. `astEquivalent` is the production
  // relation from `core/ast/equivalence.ts` (no local copy).
  const roundtrips = cf !== undefined &&
    astEquivalent(buildBodyAst(cf), normalizeBodyAst(ast0));

  let cls: FidelityClass;
  if (allUnknownVerbatim(ast0)) {
    // Spec §5.4: a construct the model does not own, kept verbatim as
    // Unknown(raw). Acceptable.
    cls = "UNOWNED";
  } else if (formatIdempotent && roundtrips) {
    // SP3 Formalization A: the formatter canonicalizes idempotently and
    // the canonical body is AST-equivalent to the normalized input.
    cls = "OK";
  } else {
    // The build/render/FORMAT contract does not hold. The SP3 spec
    // mandates zero of these — a surface-to-owner finding.
    cls = "RESIDUAL";
  }

  return {
    name: sample.name,
    cls,
    formatIdempotent,
    roundtrips,
    delta: encodeDelta(s, cf ?? s),
  };
}

/** Run the full matrix over `CORPUS` (SP3 build/render/format contract). */
export async function runMatrix(): Promise<Matrix> {
  const rows: MatrixRow[] = [];
  for (const sample of CORPUS) {
    rows.push(await classifySample(sample));
  }
  const counts: Record<FidelityClass, number> = {
    OK: 0,
    UNOWNED: 0,
    RESIDUAL: 0,
  };
  for (const row of rows) counts[row.cls]++;
  return {
    rows,
    counts,
    surface: counts.RESIDUAL,
  };
}

/** Order classes appear in the summary block (stable). */
const CLASS_ORDER: readonly FidelityClass[] = [
  "OK",
  "UNOWNED",
  "RESIDUAL",
];

/**
 * Make a string safe to drop into a single GFM table cell wrapped in an
 * inline-code span: no newlines (delta is already single-line), pipes
 * escaped, backticks neutralised. Wrapping in backticks also exempts the
 * content from markdownlint `no-bare-urls` / `no-inline-html`.
 * Backslashes are escaped first (correct-by-construction).
 */
function cell(value: string): string {
  const safe = value
    // Escape backslashes first so the count before any `|` is always odd
    // (2n+1) after the pipe-escape below — the table cell can never split,
    // independent of input. (Was relying on the JSON-stringified-input
    // invariant; this makes it correct by construction. CodeQL
    // js/incomplete-string-escaping.)
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "ʼ") // U+02BC — keeps the cell a valid single code span
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
  return value === "—" ? "—" : `\`${safe}\``;
}

/**
 * Render the deterministic, markdownlint-clean catalogue. The owning file
 * `docs/product/ast-fidelity-matrix.md` is dprint-excluded (see
 * `dprint.json`), so this exact byte sequence is the committed artifact and
 * the staleness gate compares against it verbatim.
 */
export function renderCatalogue(matrix: Matrix): string {
  const lines: string[] = [];
  lines.push("# AST Fidelity Matrix");
  lines.push("");
  lines.push(
    "<!-- Generated by scripts/gen_ast_fidelity_matrix.ts — do not edit by hand. -->",
  );
  lines.push("");
  lines.push(
    "SP3 characterization of the canonical body-AST build/render/format",
  );
  lines.push(
    "contract. The equivalence relation lives in `core/ast/equivalence.ts`",
  );
  lines.push(
    "(`astEquivalent`, production-consumed by the formatter guard); this",
  );
  lines.push(
    "classifier measures the SP3 build/render/format contract. See the",
  );
  lines.push(
    "epic design: `docs/superpowers/specs/2026-05-16-formatting-fidelity-epic-design.md` §4.",
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const c of CLASS_ORDER) {
    lines.push(`- ${c}: ${matrix.counts[c]}`);
  }
  lines.push("");
  lines.push(
    `Headline: surface = RESIDUAL = ${matrix.surface} of ${matrix.rows.length} corpus samples.`,
  );
  lines.push("");
  lines.push("## Matrix");
  lines.push("");
  lines.push(
    "| Construct | Class | format-idempotent | roundtrips | delta |",
  );
  lines.push(
    "| --------- | ----- | ----------------- | ---------- | ----- |",
  );
  for (const row of matrix.rows) {
    lines.push(
      `| ${row.name} | ${row.cls} | ` +
        `${row.formatIdempotent ? "yes" : "no"} | ` +
        `${row.roundtrips ? "yes" : "no"} | ${cell(row.delta)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

// Re-export the core primitives the harness/generator compose, so callers
// import them from one place.
export { buildBodyAst, format, parseFile };
export type { BodyBlock };
