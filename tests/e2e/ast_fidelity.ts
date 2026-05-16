/**
 * @module tests/e2e/ast_fidelity
 *
 * SP1 — Formatting Fidelity characterization util (pure; no `Deno.*`).
 *
 * Owns: the data-driven corpus, the PROVISIONAL `astEquivalent` relation,
 * the per-sample classifier, and the deterministic catalogue renderer.
 *
 * `astEquivalent` is SP1-local and provisional. SP3 ratifies/hardens it as
 * the formal spec §5 contract relation. Do NOT import it into production
 * code.
 *
 * Import-boundary note: `core/mod.ts` is the library boundary, but it does
 * not export `buildBodyAst`. This characterization harness imports it from
 * the internal `core/ast/build.ts` path — an intentional, design-mandated
 * exception (SP1 design §4.3 names `buildBodyAst` explicitly), with
 * precedent: `tests/e2e/ast_equivalence_test.ts` already imports `render`
 * from the internal `core/ast/render.ts` path.
 */

import {
  type BodyBlock,
  format,
  parseFile,
  render,
} from "../../packages/markspec/core/mod.ts";
import { buildBodyAst } from "../../packages/markspec/core/ast/build.ts";

/** A single corpus sample. `markdown` is the bare entry-body text. */
export interface CorpusSample {
  readonly name: string;
  readonly markdown: string;
}

/** Fidelity class for a sample (SP1 design §4.3). */
export type FidelityClass =
  | "OK"
  | "NORMALIZE"
  | "LOSS"
  | "UNOWNED"
  | "UNREPRESENTABLE";

/** One classified matrix row. */
export interface MatrixRow {
  readonly name: string;
  readonly cls: FidelityClass;
  /** `render(buildBodyAst(s)) === s`. */
  readonly rEqualsS: boolean;
  /** `render(buildBodyAst(r)) === r`. */
  readonly idempotent: boolean;
  /** Approach-C signal: `render(ast0)` equals formatter's canonical body. */
  readonly strFmtAgrees: boolean;
  /** Stable, single-line encoding of the input→render delta. */
  readonly delta: string;
}

/** The full matrix: ordered rows + per-class counts + headline number. */
export interface Matrix {
  readonly rows: readonly MatrixRow[];
  readonly counts: Readonly<Record<FidelityClass, number>>;
  /** Headline surface = LOSS + UNREPRESENTABLE. */
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
] as const;

// Stub exports — implemented in later tasks.

/**
 * PROVISIONAL structural equivalence of two `BodyBlock[]` (SP1 design
 * §4.3/§4.6). Recursively deletes every `range` key (the only
 * `SourceRange`-typed field name in the §2.4–2.6 taxonomy — see
 * `core/ast/nodes.ts`) then compares the remaining structure for deep
 * equality. Every other field (kind, text, canonical, raw, lang, alt,
 * path, tex, ordered, spread, admonition, keyword, position, marker
 * arrays in order, …) is compared exactly. Array order is significant.
 *
 * SP3 ratifies/hardens this as the formal §5 contract relation. Until
 * then it is deliberately strict: in the build→render→build harness
 * pipeline there is no formatter pass, so permitted §5.2 case
 * normalizations never occur between ast0 and ast1, and over-counting
 * LOSS is the safe direction for a lower-bound measurement.
 */
export function astEquivalent(
  a: readonly BodyBlock[],
  b: readonly BodyBlock[],
): boolean {
  return deepEqualIgnoringRanges(a, b);
}

/** Deep structural equality with every `range` key elided at any depth. */
function deepEqualIgnoringRanges(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualIgnoringRanges(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).filter((k) => k !== "range").sort();
    const bk = Object.keys(bo).filter((k) => k !== "range").sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) {
      if (ak[i] !== bk[i]) return false;
    }
    for (const k of ak) {
      if (!deepEqualIgnoringRanges(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}

/** Fixed ULID for deterministic wrapping (matches ast_equivalence_test.ts). */
const FIXED_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

/** True when every block is an `unknown` node carrying verbatim `raw`. */
function allUnknownVerbatim(blocks: readonly BodyBlock[]): boolean {
  return blocks.length > 0 &&
    blocks.every((b) => b.kind === "unknown" && typeof b.raw === "string");
}

/** Stable, single-line, human-readable input→render delta. */
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

/**
 * Approach-C signal (§4.3 step 5; not the classifier): does
 * `render(buildBodyAst(s))` equal the formatter's canonical body for `s`?
 * Wrap `s` in a minimal entry with a fixed ULID, `format()`, re-parse, and
 * compare to the resulting `entry.body`.
 */
async function strFmtAgrees(
  sample: string,
  renderedAst0: string,
): Promise<boolean> {
  const indented = sample.split("\n").join("\n  ");
  const doc =
    `- [TST_FM_0001] Fidelity probe\n\n  ${indented}\n\n      Id: ${FIXED_ULID}\n`;
  const formatted = format(doc, { file: "fidelity.md" }).output;
  const parsed = await parseFile(formatted, { file: "fidelity.md" });
  if (parsed.entries.length === 0) return false;
  return parsed.entries[0].body === renderedAst0;
}

/** Classify one sample (Task 3). */
export async function classifySample(
  sample: CorpusSample,
): Promise<MatrixRow> {
  const s = sample.markdown;
  const ast0 = buildBodyAst(s);
  const r = render(ast0);
  const ast1 = buildBodyAst(r);

  const rEqualsS = r === s;
  const idempotent = render(ast1) === r;
  const equivalent = astEquivalent(ast0, ast1);

  let cls: FidelityClass;
  if (rEqualsS) {
    cls = "OK";
  } else if (allUnknownVerbatim(ast0)) {
    // Spec §5.4: a construct the model does not own, kept verbatim as
    // Unknown(raw). Acceptable.
    cls = "UNOWNED";
  } else if (equivalent) {
    // §5.2: representation differs, meaning preserved → SP3 territory.
    cls = "NORMALIZE";
  } else if (ast0.some((b) => b.kind === "unknown")) {
    // Spec-permitted prose partially collapsed into an Unknown/raw
    // fallback — residual SP3 must close or spec-record.
    cls = "UNREPRESENTABLE";
  } else {
    // §5.1: the AST itself changed/lost information → SP2 territory.
    cls = "LOSS";
  }

  return {
    name: sample.name,
    cls,
    rEqualsS,
    idempotent,
    strFmtAgrees: await strFmtAgrees(s, r),
    delta: encodeDelta(s, r),
  };
}

/** Run the full matrix over `CORPUS` (Task 3). */
export async function runMatrix(): Promise<Matrix> {
  const rows: MatrixRow[] = [];
  for (const sample of CORPUS) {
    rows.push(await classifySample(sample));
  }
  const counts: Record<FidelityClass, number> = {
    OK: 0,
    NORMALIZE: 0,
    LOSS: 0,
    UNOWNED: 0,
    UNREPRESENTABLE: 0,
  };
  for (const row of rows) counts[row.cls]++;
  return {
    rows,
    counts,
    surface: counts.LOSS + counts.UNREPRESENTABLE,
  };
}

/** Order classes appear in the summary block (stable). */
const CLASS_ORDER: readonly FidelityClass[] = [
  "OK",
  "NORMALIZE",
  "LOSS",
  "UNOWNED",
  "UNREPRESENTABLE",
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
    "SP1 characterization of the canonical body-AST build/render surface",
  );
  lines.push(
    "(`buildBodyAst` → `render` → `buildBodyAst`). Measurement only — no",
  );
  lines.push(
    "production behaviour depends on this file. See the SP1 design:",
  );
  lines.push(
    "`docs/superpowers/specs/2026-05-16-formatting-fidelity-epic-design.md` §4.",
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const c of CLASS_ORDER) {
    lines.push(`- ${c}: ${matrix.counts[c]}`);
  }
  lines.push("");
  lines.push(
    `Headline: surface = LOSS + UNREPRESENTABLE = ${matrix.surface} of ${matrix.rows.length} corpus samples.`,
  );
  lines.push("");
  lines.push("## Matrix");
  lines.push("");
  lines.push(
    "| Construct | Class | r==s | idempotent | str-fmt agrees | delta |",
  );
  lines.push(
    "| --------- | ----- | ---- | ---------- | -------------- | ----- |",
  );
  for (const row of matrix.rows) {
    lines.push(
      `| ${row.name} | ${row.cls} | ${row.rEqualsS ? "yes" : "no"} | ` +
        `${row.idempotent ? "yes" : "no"} | ` +
        `${row.strFmtAgrees ? "yes" : "no"} | ${cell(row.delta)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

// Re-export the core primitives the harness/generator compose, so callers
// import them from one place.
export { buildBodyAst, format, parseFile, render };
export type { BodyBlock };
