/**
 * @module formatter
 *
 * Markdown formatter and ULID assigner. Handles write-back operations:
 * ULID stamping, indentation normalization, trailing backslash enforcement,
 * and requirement block insertion.
 */

import { extname } from "@std/path";
import { ulid as defaultUlid } from "@std/ulid";
import { stringify as stringifyYaml } from "@std/yaml";
import type {
  Attribute,
  Diagnostic,
  DocumentAttributes,
  Entry,
} from "../model/mod.ts";
import {
  attributeSpec,
  CSV_SPLITTABLE_TYPES,
  IDENTITY_KEY,
} from "../model/mod.ts";
import { MARKDOWN_EXTENSIONS } from "../discovery/mod.ts";
import { ATTR_LINE_RE } from "../parser/attributes.ts";
import { extractFrontMatter } from "../parser/frontmatter.ts";
import { parseMarkdown } from "../parser/markdown.ts";
import { FENCE_RE, walkProseLines } from "../util/fence.ts";
import {
  applyLineEnding,
  detectLineEnding,
  normalizeLineEndings,
} from "../util/line_endings.ts";
import {
  EARS_KEYWORD_RE,
  isSentenceInitial as _isSentenceInitial,
  RFC2119_MODAL_RE,
} from "../util/modals.ts";
import { synthesizedUlid } from "./synth_ulid.ts";
import { buildBodyAst } from "../ast/build.ts";
import { render as renderBodyAst } from "../ast/render.ts";
import { normalizeBodyAst } from "../ast/normalize.ts";
import { astEquivalent } from "../ast/equivalence.ts";
import { formatProseSegments } from "./prose.ts";
import {
  MARKSPEC_MARKDOWN_GLOBAL_CONFIG,
  type ProseFormatter,
} from "./dprint.ts";
import { markdownSemanticallyEquivalent } from "./md_equiv.ts";

/**
 * Decide whether the EARS keyword at `offset` in `line` is at sentence
 * start (return value true). Delegates to the shared implementation in
 * `core/util/modals.ts`; re-exported here for backward compatibility with
 * existing callers and tests that import from `formatter/mod.ts`.
 */
export function isSentenceInitial(line: string, offset: number): boolean {
  return _isSentenceInitial(line, offset);
}

/**
 * Normalise modal keywords to canonical case in body prose (§3.4.1):
 *
 *   - RFC 2119 (`SHALL`, `SHOULD`, `MAY`, `MUST`, optionally `… NOT`) —
 *     always lowercased.
 *   - EARS (`When`, `While`, `Where`, `Unless`) — lowercased mid-sentence,
 *     preserved sentence-initial.
 *
 * The pass skips:
 *
 *   - Fenced code blocks (between paired ``` or ~~~ markers) — code is
 *     verbatim per round-trip invariants (spec §5.1).
 *   - Lines indented by four or more spaces (or a tab) — conservatively
 *     captures indented code blocks and attribute trailers, both of which
 *     are not prose.
 *
 * @remarks Not called by `format()` as of SP3 Task 5 — body modal
 * normalization moved to `normalizeBodyAst` in the AST pass (spec-correct
 * verbatim-boundary handling). Retained as an exported symbol because
 * `mod_test.ts` tests it directly and `core/ast/normalize.ts` documents
 * the intentional duplication until a follow-up collapses the two. Do NOT
 * delete — external callers may depend on this export.
 */
export function normalizeModalKeywords(markdown: string): string {
  const lines = markdown.split("\n");
  walkProseLines(markdown, (line, i) => {
    // Indented-code / attribute-trailer lines aren't prose either.
    if (/^( {4}|\t)/.test(line)) return;
    let normalized = line.replace(RFC2119_MODAL_RE, (m) => m.toLowerCase());
    normalized = normalized.replace(
      EARS_KEYWORD_RE,
      (m, _g1: string, offset: number) =>
        isSentenceInitial(normalized, offset) ? m : m.toLowerCase(),
    );
    lines[i] = normalized;
  });
  return lines.join("\n");
}

/**
 * Canonical front-matter key order per ADR-007. Core keys first, then
 * `metadata` (reserved free-form map), then `extra` (allowlisted ecosystem
 * keys / profile keys) are emitted verbatim at the end.
 */
const FRONT_MATTER_CORE_ORDER: readonly string[] = [
  "document-id",
  "document-type",
  "labels",
  "deprecated",
  "external-id",
  "supersedes",
  "references",
];

/**
 * Canonical trailer ordering per spec §3.3.2 (six-group rule).
 *
 * Groups, top → bottom:
 *   1. Identity & classification — `Id`, `Type`, `Source`, `Origin`.
 *   2. Reference-shape navigation — `Reference-document`, `Reference-url`.
 *   3. Trace upstream relations — authored trace edges (`Part-of`,
 *      `Derived-from`, `Satisfies`, …).
 *   4. Type-specific data — payload attributes per concrete type
 *      (`Schema-language`, `License`, `Manufacturer`, …).
 *   5. Universal trailing — `References`, `External-id`, `Labels`,
 *      `Supersedes`, `Deprecated`.
 *   6. Profile-declared / unknown attributes — preserved in source order
 *      at the bottom (§3.3.6: fmt never deletes a key it doesn't own).
 *
 * Generated-origin attributes (`Superseded-by`, every inverse from ADR-003
 * §Part 3) are stripped from this list; the formatter rejects them with
 * MSL-A030 when found in source (current code keeps `Superseded-by:` to
 * round-trip historical fixtures — that hardening lands in a later slice).
 */
const CANONICAL_ORDER: readonly string[] = [
  // Group 1 — identity & classification
  "Id",
  "Type",
  "Source",
  "Origin",
  // Group 2 — reference-shape navigation
  "Reference-document",
  "Reference-url",
  // Group 3 — trace upstream (authored relations)
  "Part-of",
  "Derived-from",
  "Satisfies",
  "Verifies",
  "Tests",
  "Realizes",
  "Provides",
  "Requires",
  "Depends-on",
  "Caused-by",
  "Mitigated-by",
  "Allocated-to",
  "Affects",
  // Group 4 — type-specific data
  "Schema-language",
  "License",
  "Build-manifest",
  "Package-manager",
  "Manufacturer",
  "Part-number",
  "Datasheet",
  "Bus-protocol",
  "Connector-type",
  "Voltage-level",
  "Signal-direction",
  "Symbol",
  "Language",
  "Footprint",
  "Value",
  "Aliases",
  "See-also",
  // Group 5 — universal trailing
  "References",
  "External-id",
  "Labels",
  "Supersedes",
  "Superseded-by",
  "Deprecated",
  // Group 6 — profile-declared / unknown keys are appended in source order
  // after this list by sortAttributes().
];

/**
 * Post-pass: route each entry's body through the canonical body-AST
 * (the load-bearing §5.2 emission path — SP3 Task 5 cutover).
 *
 * Called on the post-collapse `lines` array (after attribute-block
 * splicing and `collapseBlankLines`). The body modal-keyword §3.4.1
 * pass is NO LONGER applied as a pre-parse whole-body string pass; it
 * is now AST-native via `normalizeBodyAst` here (more spec-correct:
 * the AST pass respects §2.5 verbatim boundaries and per-node
 * sentence-initial context that the whole-body string pass could get
 * wrong inside Code/Math blocks). Re-parses the lines to get entries
 * with correct post-collapse line numbers, then for each entry:
 *
 *   1. Takes `entry.body` — the body string from the parser
 *      (indent-stripped, trimmed, attrs split off).
 *   2. Builds the body AST, applies `normalizeBodyAst` (the §3.4.1 /
 *      §5.2 canonicalization pass), and emits via `render`.
 *   3. Guards the emit with the formal §5 `astEquivalent` relation:
 *      `render`-ing the emitted body and re-building must be AST-equal
 *      to the canonical AST. If not, this is an SP3 residual — keep
 *      the original body lines untouched and raise a LOUD diagnostic
 *      (MSL-F900). This branch is RETAINED for safety; over the
 *      idempotence corpus and real project docs it never fires.
 *   4. Reconstructs the body segment in `lines` from the emitted
 *      string, preserving the leading/trailing blank-line delimiters
 *      that separate the body from the title and attr block.
 *
 * When `proseFormat` (ADR-029) is supplied, the AST-canonical body is
 * further polished by the whole-document Markdown formatter (dprint),
 * gated by CommonMark-semantic equivalence — NOT the strict ADR-015
 * relation above, which is byte-verbatim on inline markup and would
 * reject every legitimate re-wrap. A rejected polish keeps the
 * AST-canonical body and raises an info diagnostic (MSL-F012) naming
 * the entry.
 *
 * Returns `true` when any entry body was rewritten (so `format()` can
 * keep `changed` accurate for `--check` mode); `false` when every body
 * was already §5.2-canonical.
 *
 * `Entry.body` stays `string`; no other module is affected.
 * `normalizeBodyAst` is FORMATTER-ONLY — the validate/parse path must
 * never call it.
 */
function emitBodyViaAst(
  lines: string[],
  file: string,
  diagnostics: Diagnostic[],
  cachedEntries: Entry[] | undefined,
  proseFormat: ProseFormatter | undefined,
): boolean {
  // When the caller supplies pre-parsed entries whose line numbers are still
  // valid in `lines` (i.e., no line-count-changing operations occurred before
  // this call), skip the re-parse entirely — the common hot path for files
  // that are already in canonical form. When the caller passes undefined the
  // re-parse is performed as before.
  let entries: Entry[];
  if (cachedEntries !== undefined) {
    entries = cachedEntries;
  } else {
    // Diagnostics from this re-parse are intentionally discarded: the
    // input is already canonical (post-collapse) output.
    ({ entries } = parseMarkdown(lines.join("\n"), { file }));
  }
  if (entries.length === 0) return false;

  let bodyChanged = false;

  // Process bottom-to-top so splices don't shift earlier entry positions.
  const sorted = [...entries].sort((a, b) => b.location.line - a.location.line);

  for (const entry of sorted) {
    if (!entry.body.trim()) continue; // empty or whitespace-only body

    const indent = (entry.location.column - 1) + 2; // marker column (0-based) + 2 spaces = list-item continuation indent
    const indentStr = " ".repeat(indent);
    const titleLineIdx = entry.location.line - 1; // 0-based

    // Locate the body segment in `lines` — between the title line and
    // the attr block start (or item end when there is no attr block).
    const range = findAttributeBlockRange(lines, entry.location.line, indent);
    const bodyStart = titleLineIdx + 1;
    const bodyEnd = range
      ? range.start
      : findItemEnd(lines, titleLineIdx, indent);

    if (bodyEnd <= bodyStart) continue; // no body lines to replace

    // Route the body through the canonical AST: build → normalize
    // (§3.4.1 / §5.2) → render. The §5 equivalence relation guards the
    // emit; `render`+`build` is the inverse on canonical input for
    // every body shape under the equivalence gate.
    const ast0 = buildBodyAst(entry.body);
    const canonical = normalizeBodyAst(ast0);
    const emittedBody = renderBodyAst(canonical);

    if (!astEquivalent(buildBodyAst(emittedBody), canonical)) {
      // SP3 residual. The build/render inverse is not yet total over
      // every valid Markdown body construct; for a body where the
      // emitted form does not re-build AST-equivalent to the canonical
      // AST we cannot guarantee a lossless §5.2 re-emission. Keep the
      // original body lines EXACTLY as-is — zero corruption, zero
      // spurious rewrites — and raise a LOUD diagnostic so the residual
      // is visible (it never fires over the idempotence corpus or real
      // project docs). This safe-fallback branch is RETAINED by design;
      // only its criterion changed (byte-identity → astEquivalent) and
      // it now diagnoses instead of silently degrading.
      diagnostics.push({
        code: "MSL-F900",
        severity: "error",
        message: `${entry.displayId}: body not AST-equivalent after ` +
          `canonicalization (SP3 residual — formatter kept the ` +
          `original body)`,
        location: entry.location,
      });
      continue;
    }

    // ADR-029: polish the canonical body with the whole-document
    // Markdown formatter. Gated by CommonMark-semantic equivalence —
    // NOT the strict ADR-015 relation, which is byte-verbatim on
    // inline markup and would reject every legitimate re-wrap. On
    // rejection keep the AST-canonical body and say so (info).
    let finalBody = emittedBody;
    if (proseFormat !== undefined) {
      // The body is formatted DEDENTED and re-indented afterwards, so the
      // width budget must shrink by the indent — otherwise a wrap point
      // landing near 80 columns dedented exceeds 80 re-indented, and an
      // external whole-file dprint view (which sees the indent) re-wraps
      // it: a formatter ping-pong. Floor of 20 keeps a pathological indent
      // from degenerating into one-word-per-line output.
      let polished: string | undefined;
      try {
        polished = proseFormat(emittedBody, {
          lineWidth: Math.max(
            20,
            MARKSPEC_MARKDOWN_GLOBAL_CONFIG.lineWidth - indent,
          ),
        }).replace(/\n$/, "");
      } catch {
        // The dprint WASM formatter can throw on a pathological body.
        // Treat a throw exactly like a rejected rewrite: keep the
        // canonical body and report the fallback (never crash the run).
        diagnostics.push({
          code: "MSL-F012",
          severity: "info",
          message: `${entry.displayId}: Markdown pass errored — kept ` +
            `the canonical body`,
          location: entry.location,
        });
      }
      if (polished !== undefined && polished !== emittedBody) {
        if (markdownSemanticallyEquivalent(emittedBody, polished)) {
          finalBody = polished;
        } else {
          diagnostics.push({
            code: "MSL-F012",
            severity: "info",
            message: `${entry.displayId}: Markdown pass produced a ` +
              `non-equivalent body — kept the canonical body`,
            location: entry.location,
          });
        }
      }
    }

    // The emitted body is the §5.2-canonical body and re-builds
    // AST-equivalent to the canonical AST. Splice it back into the
    // document — the AST is the load-bearing emission path.
    // Reconstruct the body segment: re-add the continuation indent to
    // each non-blank line, preserving the blank-line delimiters that
    // separate the body from the title and attr block.
    const rawSegment = lines.slice(bodyStart, bodyEnd);
    // Preserve the blank delimiter lines at the start/end of the segment.
    const leadBlanks: string[] = [];
    const trailBlanks: string[] = [];
    let si = 0;
    while (si < rawSegment.length && rawSegment[si].trim() === "") {
      leadBlanks.push(rawSegment[si++]);
    }
    let ei = rawSegment.length - 1;
    while (ei >= si && rawSegment[ei].trim() === "") {
      trailBlanks.unshift(rawSegment[ei--]);
    }
    const emittedLines = finalBody.split("\n").map((l) =>
      l ? `${indentStr}${l}` : l
    );
    const newSegment = [...leadBlanks, ...emittedLines, ...trailBlanks];
    // `changed` accuracy: only flag a body rewrite when the spliced
    // segment actually differs from the original lines (a §5.2-canonical
    // body splices back byte-identically — a pure no-op).
    if (
      newSegment.length !== rawSegment.length ||
      newSegment.some((l, i) => l !== rawSegment[i])
    ) {
      bodyChanged = true;
    }
    lines.splice(bodyStart, bodyEnd - bodyStart, ...newSegment);
  }

  return bodyChanged;
}

/** Options for {@linkcode format}. */
export interface FormatOptions {
  /** File path for diagnostic messages. */
  readonly file?: string;
  /** ULID generator override (for testing). */
  readonly generateUlid?: () => string;
  /**
   * Override the "today" date used by the Discipline-frozen: stamper.
   * Returned value must be a `YYYY-MM-DD` string in UTC. Default: today.
   * Injectable for deterministic tests.
   */
  readonly today?: () => string;
  /**
   * Whole-document Markdown formatter (ADR-029). When supplied, prose
   * segments outside entry blocks and each entry body are routed
   * through it (dprint-markdown), gated by CommonMark-semantic
   * equivalence. When absent, format() is entry-only — the exact
   * pre-ADR-029 behaviour. The entry-body polish passes a per-call
   * `lineWidth` reduced by the body indent (see `emitBodyViaAst`);
   * one-arg formatter callbacks simply ignore it.
   */
  readonly formatMarkdownProse?: ProseFormatter;
}

/** Result of a format operation. */
export interface FormatResult {
  /** The formatted Markdown text. */
  readonly output: string;
  /** Diagnostics emitted during formatting (e.g., ULID assignments). */
  readonly diagnostics: readonly Diagnostic[];
  /** Whether any changes were made. */
  readonly changed: boolean;
}

/**
 * UTC `YYYY-MM-DD` for today. Used as the default for the
 * Discipline-frozen: stamper.
 */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * If `value` is a bare discipline kind (no `@`), return
 * `<kind> @ <today>`. Otherwise return the value unchanged. Used by
 * `format()` to auto-stamp `Discipline-frozen:` lines per ADR-017 Slice 3.
 *
 * The bare-kind regex deliberately matches the same shape the validator
 * accepts in {@linkcode parseFrozenValue}; anything that doesn't match
 * (e.g. uppercase kinds, already-dated forms) is left alone — the
 * validator handles malformed values via MSL-T026.
 */
function stampDisciplineFrozen(value: string, today: string): string {
  if (/^[a-z][a-z0-9-]*\s*$/.test(value)) {
    return `${value.trim()} @ ${today}`;
  }
  return value;
}

/**
 * Format a Markdown string — normalize attribute blocks,
 * fix indentation, enforce canonical ordering.
 *
 * @param markdown - Markdown source text
 * @param options - Format options
 * @returns Format result with output text and diagnostics
 */
export function format(
  markdown: string,
  options?: FormatOptions,
): FormatResult {
  const file = options?.file ?? "<unknown>";

  // Detect the source file's line-ending convention up front so we can
  // restore it on write-back. The rest of the formatter operates on a
  // pure-LF buffer; any `\r` characters from a CRLF (or legacy Mac CR)
  // source would otherwise leak into trailers and AST nodes.
  const sourceLineEnding = detectLineEnding(markdown);
  const normalisedMarkdown = sourceLineEnding === "lf"
    ? markdown
    : normalizeLineEndings(markdown);

  // Extract any YAML front matter first so entries are parsed against the
  // body only (front-matter `---` could be confused with horizontal rules).
  const fm = extractFrontMatter(normalisedMarkdown, { file });
  const rawBody = fm.hadFrontMatter ? fm.markdown : normalisedMarkdown;
  // The §3.4.1 modal-keyword pass is NO LONGER a pre-parse whole-body
  // string pass. It is AST-native in `emitBodyViaAst` via
  // `normalizeBodyAst` (more spec-correct: respects §2.5 verbatim
  // boundaries and per-node sentence-initial context). `normalizeModalKeywords`
  // stays exported/defined for other callers/tests but is not invoked here.
  const body = rawBody;
  const { entries } = parseMarkdown(body, { file });
  const diagnostics: Diagnostic[] = [...fm.diagnostics];

  // ADR-029: the whole-document Markdown pass is Markdown-only. Gate on the
  // file extension HERE so the invariant has one home — a caller that wires
  // formatMarkdownProse without its own guard (e.g. a future write tool, or
  // formatSource forwarding options with a source-file label) cannot silently
  // reflow a source file's doc comment as Markdown. The CommonMark-semantic
  // gate cannot catch that class, so it must be prevented, not detected. The
  // CLI/LSP call-site guards remain as defense-in-depth.
  const isMarkdownFile = MARKDOWN_EXTENSIONS.has(extname(file).toLowerCase());
  const proseFormat = isMarkdownFile ? options?.formatMarkdownProse : undefined;
  if (entries.length === 0 && !fm.hadFrontMatter && proseFormat === undefined) {
    // No entries and no front matter — nothing to format. Returning the
    // original `markdown` preserves the source's exact byte sequence,
    // including its line-ending convention.
    return { output: markdown, diagnostics, changed: false };
  }

  const lines = body.split("\n");
  let changed = false;

  // Process bottom-to-top so line splicing doesn't shift earlier entries.
  const sorted = [...entries].sort((a, b) => b.location.line - a.location.line);

  const genUlid = options?.generateUlid ?? defaultUlid;

  for (const entry of sorted) {
    const indent = (entry.location.column - 1) + 2;
    let attrs = [...entry.rawAttributes];

    // Title-line bullet canonicalisation per spec §3.2: rewrite `*`
    // or `+` to `-`. The list-item position from the parser is the
    // line carrying the bullet marker; we only touch the marker
    // character itself, leaving the rest of the title alone.
    const titleLineIdx = entry.location.line - 1;
    if (titleLineIdx >= 0 && titleLineIdx < lines.length) {
      const titleLine = lines[titleLineIdx];
      const markerCol = entry.location.column - 1;
      const markerChar = titleLine.charAt(markerCol);
      if (markerChar === "*" || markerChar === "+") {
        lines[titleLineIdx] = titleLine.slice(0, markerCol) +
          "-" + titleLine.slice(markerCol + 1);
        changed = true;
      }
    }

    // Assign a bare ULID `Id:` to identified entries that carry no
    // identity yet. Referenced entries are left alone — their `Id:` is a
    // URI that must be author-provided.
    //
    // For `Origin: synthesized` entries (spec §3.5), derive the ULID
    // deterministically from `Source:` so re-running `fmt` on the same
    // input reproduces the same identity. Falls back to fresh random
    // when `Source:` is missing — synthesizing without a source pointer
    // makes no sense, but the formatter never fails a stamp.
    const hasIdentity = attrs.some((a) => a.key === IDENTITY_KEY);
    if (!hasIdentity && entry.shape === "Authored") {
      const origin = attrs.find((a) => a.key === "Origin")?.value.trim();
      const source = attrs.find((a) => a.key === "Source")?.value.trim();
      const newId = origin === "synthesized" && source && source.length > 0
        ? synthesizedUlid(source)
        : genUlid();
      attrs = [{ key: IDENTITY_KEY, value: newId }, ...attrs];
      diagnostics.push({
        code: "MSL-F001",
        severity: "info",
        message: `assigned Id: ${newId} to ${entry.displayId}`,
        location: entry.location,
      });
    }

    // Discipline-frozen: date stamping (ADR-017 Slice 3). Walk attrs;
    // if any Discipline-frozen: value is a bare kind, rewrite it with
    // today's UTC date. Idempotent on already-dated values.
    const todayFn = options?.today ?? todayUtc;
    const todayStr = todayFn();
    let stampedCount = 0;
    attrs = attrs.map((a) => {
      if (a.key !== "Discipline-frozen") return a;
      const newValue = stampDisciplineFrozen(a.value, todayStr);
      if (newValue !== a.value) {
        stampedCount++;
        return { key: a.key, value: newValue };
      }
      return a;
    });
    if (stampedCount > 0) {
      diagnostics.push({
        code: "MSL-F001",
        severity: "info",
        message:
          `stamped Discipline-frozen: with ${todayStr} on ${entry.displayId}`,
        location: entry.location,
      });
      changed = true;
    }

    if (attrs.length === 0) continue;

    const normalized = sortAttributes(expandCsvValues(attrs));
    const range = findAttributeBlockRange(lines, entry.location.line, indent);

    if (range) {
      // Replace existing attribute block.
      const newBlock = renderAttributeBlock(normalized, indent);
      const oldBlock = lines.slice(range.start, range.end).join("\n");

      if (newBlock !== oldBlock) {
        lines.splice(
          range.start,
          range.end - range.start,
          ...newBlock.split("\n"),
        );
        changed = true;
      }
    } else {
      // No attribute block — insert one after the entry body.
      const insertLine = findEntryBodyEnd(lines, entry, indent);
      const newBlock = renderAttributeBlock(normalized, indent);
      lines.splice(insertLine, 0, "", ...newBlock.split("\n"));
      changed = true;
    }
  }

  // Spec §3.4.3 / §5.2 — collapse consecutive blank lines to one.
  // Runs after entry-block splicing so the in-progress line indices
  // stay aligned with parser-reported positions. Operates inside
  // fenced code regions only outside-code; verbatim regions keep
  // their blank-line counts.
  const collapsedLines = collapseBlankLines(lines);
  if (collapsedLines.length !== lines.length) changed = true;

  // SP3 §5.2-via-AST cutover: route each entry's body through the
  // canonical AST — build → normalizeBodyAst (§3.4.1 / §5.2) → render,
  // guarded by the formal §5 `astEquivalent` relation. This is the
  // load-bearing body-emission path AND the body modal-keyword pass
  // (the pre-parse whole-body string pass was removed above). It
  // returns whether any body was rewritten so `changed` stays accurate
  // for `--check`.
  //
  // D6 optimization: when neither attribute-block splicing nor blank-line
  // collapse altered any line positions, the first-parse entry line numbers
  // are still valid in `collapsedLines` — pass the cached entries so
  // emitBodyViaAst skips its re-parse (the hot path for already-formatted
  // files). When `changed` is true, any splicing or collapse may have
  // shifted positions, so pass undefined to trigger the normal re-parse.
  if (
    emitBodyViaAst(
      collapsedLines,
      file,
      diagnostics,
      changed ? undefined : entries,
      proseFormat,
    )
  ) changed = true;

  // ADR-029 whole-document Markdown pass: prose segments outside entry
  // blocks through dprint, gated per segment. Entry bodies were already
  // polished inside emitBodyViaAst. Re-parse for fresh extents when any
  // earlier pass changed line positions.
  let proseLines = collapsedLines;
  if (proseFormat !== undefined) {
    const proseEntries = changed
      ? parseMarkdown(collapsedLines.join("\n"), { file }).entries
      : entries;
    const extents = proseEntries.map((e) => {
      const start = e.location.line - 1;
      const entryIndent = (e.location.column - 1) + 2;
      return { start, end: findItemEnd(collapsedLines, start, entryIndent) };
    });
    const prose = formatProseSegments(collapsedLines, extents, proseFormat);
    if (prose.changed) changed = true;
    for (const lineIdx of prose.fallbackStarts) {
      diagnostics.push({
        code: "MSL-F012",
        severity: "info",
        message:
          "Markdown pass produced non-equivalent output for this prose " +
          "segment — kept the original text",
        location: { file, line: lineIdx + 1, column: 1 },
      });
    }
    proseLines = prose.lines;
  }

  const formattedBody = proseLines.join("\n");

  if (fm.hadFrontMatter) {
    const canonicalFm = renderFrontMatter(fm.attributes);
    const outputLf = canonicalFm + formattedBody;
    if (outputLf !== normalisedMarkdown) changed = true;
    const output = applyLineEnding(outputLf, sourceLineEnding);
    return { output, diagnostics, changed };
  }

  const output = applyLineEnding(formattedBody, sourceLineEnding);
  return { output, diagnostics, changed };
}

/**
 * Render {@linkcode DocumentAttributes} as a canonical YAML front matter
 * block. Keys are emitted in canonical order (core → metadata → extra);
 * an `extra` subtree is flattened to top-level keys per ADR-007
 * allowlist conventions.
 */
function renderFrontMatter(attrs: DocumentAttributes): string {
  const ordered: Record<string, unknown> = {};
  const a = attrs as Record<string, unknown>;

  for (const key of FRONT_MATTER_CORE_ORDER) {
    if (a[key] !== undefined) ordered[key] = a[key];
  }
  if (a.metadata !== undefined) ordered.metadata = a.metadata;
  if (a.extra && typeof a.extra === "object") {
    for (const [key, value] of Object.entries(a.extra)) {
      ordered[key] = value;
    }
  }

  if (Object.keys(ordered).length === 0) {
    return "---\n---\n\n";
  }

  const yaml = stringifyYaml(ordered).trimEnd();
  return `---\n${yaml}\n---\n\n`;
}

/**
 * Collapse consecutive blank lines to a single blank line per spec
 * §3.4.3 (caption boundary) / §5.2 (general body rule). Fenced code
 * regions are preserved verbatim — blank-line counts inside fenced
 * blocks are author intent, not noise.
 */
function collapseBlankLines(lines: readonly string[]): string[] {
  const out: string[] = [];
  let inFence = false;
  let prevBlank = false;
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      out.push(line);
      inFence = !inFence;
      prevBlank = false;
      continue;
    }
    if (inFence) {
      out.push(line);
      prevBlank = false;
      continue;
    }
    const isBlank = line.trim() === "";
    if (isBlank && prevBlank) continue;
    out.push(line);
    prevBlank = isBlank;
  }
  return out;
}

/**
 * Expand CSV values on repeatable-type attributes into one entry per value
 * per ADR-002 §2.6. `id-list` / `tag-list` / `external-id` accept CSV input
 * but must round-trip as multi-line output; `citation` is left alone
 * because locators may contain commas.
 */
export function expandCsvValues(attrs: Attribute[]): Attribute[] {
  const result: Attribute[] = [];
  for (const attr of attrs) {
    const spec = attributeSpec(attr.key);
    if (
      spec && CSV_SPLITTABLE_TYPES.has(spec.type) && attr.value.includes(",")
    ) {
      const values = attr.value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const value of values) {
        result.push({ key: attr.key, value });
      }
    } else {
      result.push(attr);
    }
  }
  return result;
}

/**
 * Canonicalise a trailer key to TitleCase-Hyphenated per spec §3.3.4.
 * First character of the key uppercase, every other character
 * lowercase; hyphens preserved. Examples (from the spec):
 *
 *   `Id`, `Derived-from`, `Reference-url`, `Bus-protocol`.
 *
 * Inputs like `ID`, `BUS-PROTOCOL`, `reference-URL`, `Derived-From`
 * all canonicalise to the spec form regardless of casing in source.
 */
export function canonicalizeKey(key: string): string {
  if (key.length === 0) return key;
  return key[0].toUpperCase() + key.slice(1).toLowerCase();
}

/**
 * Sort attributes to canonical trailer order per spec §3.3.2 and
 * re-case each key per spec §3.3.4.
 *
 * Known core keys appear in their {@linkcode CANONICAL_ORDER} slot
 * (lookup is case-insensitive via {@linkcode canonicalizeKey}).
 * Unknown / profile-declared keys (group 6) are appended at the end
 * in source order — `fmt` never deletes a key it doesn't own
 * (§3.3.6). Every emitted attribute carries the canonical key form.
 */
export function sortAttributes(
  attributes: Attribute[],
): Attribute[] {
  const known: (Attribute[] | undefined)[] = new Array(CANONICAL_ORDER.length);
  const unknown: Attribute[] = [];

  for (const attr of attributes) {
    const canonical = canonicalizeKey(attr.key);
    const recased: Attribute = canonical === attr.key
      ? attr
      : { ...attr, key: canonical };
    const idx = CANONICAL_ORDER.indexOf(canonical);
    if (idx >= 0) {
      // Preserve duplicates — keep all occurrences of the same key.
      if (!known[idx]) known[idx] = [];
      known[idx]!.push(recased);
    } else {
      unknown.push(recased);
    }
  }

  const result: Attribute[] = [];
  for (let i = 0; i < known.length; i++) {
    if (known[i] != null) {
      result.push(...known[i]!);
    }
  }
  result.push(...unknown);
  return result;
}

/**
 * Render attributes as an indented code block.
 * Each line is `Key: Value` at (indent + 4) absolute columns;
 * no trailing line-continuation characters.
 *
 * @param attributes - The attributes to render, in canonical order.
 * @param indent - Body indent for the entry (2 for list-wrapped entries,
 *   0 for entries inside source-file doc comments).
 */
export function renderAttributeBlock(
  attributes: Attribute[],
  indent: number,
): string {
  const prefix = " ".repeat(indent + 4);
  return attributes
    .map((attr) => `${prefix}${attr.key}: ${attr.value}`)
    .join("\n");
}

/**
 * Find the 0-based line index where a list item's content ends.
 * Exported for the ADR-029 prose pass (entry-extent computation).
 * Scans forward from the entry start, stopping at: a sibling list item
 * (`- ` at the entry's marker column), a line with less indent, or EOF.
 */
export function findItemEnd(
  lines: readonly string[],
  startIdx: number,
  indent: number,
): number {
  const indentStr = " ".repeat(indent);
  // The marker column is indent - 2 (e.g., indent 2 → marker at column 0).
  const markerPrefix = " ".repeat(Math.max(0, indent - 2)) + "- ";

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    // Sibling list item at same level
    if (line.startsWith(markerPrefix)) return i;
    // Line with less indent than continuation
    if (!line.startsWith(indentStr)) return i;
  }
  return lines.length;
}

/**
 * Find the 0-based line range [start, end) of the attribute block
 * for an entry starting at the given line.
 *
 * Scans forward from the entry start to find the list item boundary,
 * then walks backwards to find the contiguous trailing attribute block.
 */
export function findAttributeBlockRange(
  lines: readonly string[],
  entryStartLine: number,
  indent: number,
): { start: number; end: number } | undefined {
  const startIdx = entryStartLine - 1;
  const itemEnd = findItemEnd(lines, startIdx, indent);

  // Walk backwards from itemEnd, skip trailing blank lines.
  let scanEnd = itemEnd;
  while (scanEnd > startIdx && lines[scanEnd - 1].trim() === "") {
    scanEnd--;
  }

  if (scanEnd <= startIdx) return undefined;

  // Walk backwards collecting attribute lines.
  let attrStart = scanEnd;
  for (let i = scanEnd - 1; i > startIdx; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "") break;
    if (ATTR_LINE_RE.test(trimmed)) {
      attrStart = i;
    } else {
      break;
    }
  }

  if (attrStart >= scanEnd) return undefined;

  return { start: attrStart, end: scanEnd };
}

/**
 * Find the 0-based line index where a new attribute block should be inserted
 * (after the last non-blank body line of the entry).
 */
function findEntryBodyEnd(
  lines: readonly string[],
  entry: Entry,
  indent: number,
): number {
  const startIdx = entry.location.line - 1;
  const itemEnd = findItemEnd(lines, startIdx, indent);

  let insertAt = itemEnd;
  while (insertAt > startIdx && lines[insertAt - 1].trim() === "") {
    insertAt--;
  }

  return insertAt;
}
