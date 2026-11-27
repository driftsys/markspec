/**
 * @module parser/markdown
 *
 * CommonMark + MarkSpec extension parser. Walks the mdast AST to detect
 * `- [DISPLAY_ID] Title` entry blocks and extract structured attributes.
 */

import type { Definition, List, ListItem, Paragraph, Text } from "mdast";
import type { Attribute, Diagnostic, Entry, EntryShape } from "../model/mod.ts";
import {
  CORE_RELATIONS,
  IDENTITY_KEY,
  LOCK_EXTRA_INVERSE_KEYS,
  makeDisplayId,
  shapeFromIdValue,
} from "../model/mod.ts";
import {
  ATTR_LINE_RE,
  collateAttributes,
  findTrailerStart,
  isIndented,
  isTrailerUnderProse,
  leadingColumns,
  parseAttributes,
  RECOGNIZED_TRAILER_KEYS,
  splitBodyAndAttributes,
  trimLayoutEnd,
} from "./attributes.ts";
import { extractBodyTokens } from "./body_tokens.ts";
import { isMarkspecDirectiveComment } from "./directives.ts";
import { processor } from "./remark.ts";
import { buildBodyAstWithTree } from "../ast/build.ts";
import { parseCodeRegions } from "./code_regions.ts";
import { normalizeLineEndings } from "../util/line_endings.ts";
import type { LineMap } from "./line_map.ts";
import { translateEntryLocations } from "./translate.ts";
import { assembleTyplTypes } from "../typl/mod.ts";

/** Keys of the core trace relations, for the MSL-P020 warning. */
const TRACE_RELATION_KEYS: ReadonlySet<string> = new Set([
  ...CORE_RELATIONS.map((r) => r.attr),
  ...LOCK_EXTRA_INVERSE_KEYS,
]);

/** A trailer key that MSL-P022 accepts. */
const TRAILER_KEY_RE = /^[A-Za-z][A-Za-z0-9-]*$/;

/** Split a line at its first colon into the text before and after it. */
const COLON_SPLIT_RE = /^([^:]+):\s*(.*)$/;

/**
 * Read a trimmed body line as a suspected trailer line: a line with a colon
 * whose text before the colon could be a trailer key, possibly a malformed
 * one (`below:`, `Key :`, `snake_key: x`, `Verified by: x`). Returns the
 * key (trimmed) and the value (trimmed), or `undefined` for a line that is
 * prose: no colon, or text before the colon that a trailer key never holds.
 */
function suspectTrailerLine(
  trimmed: string,
): { key: string; value: string } | undefined {
  const colonMatch = COLON_SPLIT_RE.exec(trimmed);
  if (!colonMatch) return undefined;
  const key = colonMatch[1].trim();
  // A colon inside prose ("modes are: fast") or a Markdown table row
  // ("| Fast | latency: 200ms |") is body content, not a malformed
  // trailer (#648). A pipe always means a table cell; the checks below
  // handle Markdown punctuation, internal whitespace, and the other
  // punctuation.
  if (key.includes("|")) return undefined;
  // Markdown punctuation before the colon (`**Rationale:**`,
  // `[link](http://…)`, `` `mode:fast` ``, `<mailto:…>`) means inline
  // Markdown in prose. A trailer key never holds it.
  if (/[*[\]()<>`]/.test(key)) return undefined;
  // A typo of a recognized trailer key (`Verified by`, `Verified.by`,
  // `Verified,by`, `Satisfies"`) must still fire MSL-P022, so the trace
  // link is not silently dropped (#697). Detect it by turning whitespace
  // and the punctuation `.`, `/`, `,`, `'`, `"` into hyphens, trimming
  // hyphens at both ends, and checking the recognized key vocabulary.
  const typoOfKnownKey = RECOGNIZED_TRAILER_KEYS.has(normalizeSuspectKey(key));
  // A time (`10:30`), an abbreviation (`e.g.:`), a version (`v2.0:`) or a
  // word pair (`and/or:`) is prose. The 80-column wrap of the formatter
  // can put one at the start of the last body line. A trailer key starts
  // with a letter and never holds `.`, `/`, `,`, `'` or `"`, so the line
  // is prose unless the key is a typo of a known key. Lowercase and
  // underscored keys are suspects.
  if ((!/^[A-Za-z]/.test(key) || /[./,'"]/.test(key)) && !typoOfKnownKey) {
    return undefined;
  }
  if (/\s/.test(key) && !typoOfKnownKey) return undefined;
  return { key, value: colonMatch[2].trim() };
}

/**
 * Normalize a suspected trailer key for the typo checks (#697): turn
 * whitespace and the punctuation `.`, `/`, `,`, `'`, `"` into hyphens, and
 * trim hyphens at both ends. `Verified by` becomes `Verified-by`.
 */
function normalizeSuspectKey(key: string): string {
  return key.replace(/[\s./,'"]+/g, "-").replace(/^-+|-+$/g, "");
}

/** An `Id:`-like line: the key `id` in any case, with any spacing before
 * the colon (the rule of `findIdLikeIndex`). */
const ID_LIKE_LINE_RE = /^id\s*:/i;

/** The key of a valid `Key: Value` line, or `undefined`. */
function validTrailerKey(trimmed: string): string | undefined {
  return ATTR_LINE_RE.test(trimmed)
    ? /^([A-Z][A-Za-z-]*):/.exec(trimmed)?.[1]
    : undefined;
}

/**
 * `true` when the suspected trailer line `bodyLines[index]`, whose key is
 * `key`, is body text, so MSL-P021 and MSL-P022 do not apply to it (#1034).
 * `bodyLines` are body lines with the list-item indent removed;
 * `hasTrailer` is `true` when the entry has a trailer below the body.
 *
 * The run is the line and the non-blank suspected trailer lines (valid or
 * not) directly above and below it. The line is reported, so this returns
 * `false`, when:
 *
 * - its key, normalized as for the #697 typo check and compared
 *   case-sensitively, is `Id` or a core trace-relation key (the MSL-P020
 *   key set): a malformed identity or trace link is never silently prose;
 * - a line of the run is indented by 4 or more columns (an indented block);
 * - a line of the run is an `Id:` or `Id:`-like line (`id:`, `Id :`): the
 *   author meant a trailer, as in the Id run rule of `findTrailerStart`;
 * - the run starts the body or follows a blank line, it is the final block
 *   of the entry (no trailer and no other content below it), and every
 *   valid key of the run is a recognized trailer key: the trailer
 *   paragraph rule of `findTrailerStart` (#916, #927).
 *
 * Otherwise the line is body text: the run is directly under a non-blank
 * line that is not a suspected trailer line (prose, a heading, a list item,
 * a closing fence), or it is a body paragraph that the parser never reads
 * as the trailer (it is not the final block, or it has a key such as
 * `Note:` that is not recognized).
 */
function isBodyTextLine(
  bodyLines: readonly string[],
  index: number,
  key: string,
  hasTrailer: boolean,
): boolean {
  const normalized = normalizeSuspectKey(key);
  if (normalized === IDENTITY_KEY || TRACE_RELATION_KEYS.has(normalized)) {
    return false;
  }
  const inRun = (j: number): boolean => {
    const trimmed = bodyLines[j].trim();
    return trimmed !== "" &&
      (isMarkspecDirectiveComment(trimmed) ||
        suspectTrailerLine(trimmed) !== undefined);
  };
  let start = index;
  while (start > 0 && inRun(start - 1)) start--;
  let end = index + 1;
  while (end < bodyLines.length && inRun(end)) end++;
  const run = bodyLines.slice(start, end);
  if (run.some((line) => isIndented(line))) return false;
  if (run.some((line) => ID_LIKE_LINE_RE.test(line.trim()))) return false;
  // Directly under a non-blank line that is not in the run: body text.
  if (start > 0 && bodyLines[start - 1].trim() !== "") return true;
  const final = !hasTrailer &&
    bodyLines.slice(end).every((line) => line.trim() === "");
  if (!final) return true;
  return !run.every((line) => {
    const valid = validTrailerKey(line.trim());
    return valid === undefined || RECOGNIZED_TRAILER_KEYS.has(valid);
  });
}

/** Options for {@linkcode parseMarkdown}. */
export interface ParseMarkdownOptions {
  /** File path used in source locations. */
  readonly file?: string;
  /**
   * Is this a references document? If undefined, auto-detect from file path.
   * When true, `[slug]` items without an `Id:` attribute are still admitted
   * as referenced-entry candidates (the validator flags the missing `Id:`).
   */
  readonly isReferencesDoc?: boolean;
  /**
   * When supplied, every `SourceLocation` emitted by this parse — on
   * entries, on `bodyAst` ranges, on `bodyTokens` — is translated through
   * this map before being returned. Used by `parseSource` to convert
   * doc-comment-buffer coordinates to file coordinates. See ADR-016
   * Decision 6.
   */
  readonly lineMap?: LineMap;
  /**
   * Keep a title-only list item as an Authored entry with an empty body,
   * as a references document does for referenced entries. Internal: used
   * by the `.feature` header reader, whose body can come from the Gherkin
   * description. Default `false`: a title-only item in Markdown is dropped.
   */
  readonly allowTitleOnly?: boolean;
}

/**
 * Slug pattern for referenced-entry display IDs.
 *
 * Pandoc/BibTeX cite-key convention, restricted to a portable character set
 * (`.`, `/`, `_`, `-` accepted inside; must start with a letter and end
 * with an alphanumeric).
 */
const SLUG_RE = /^[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?$/;

/**
 * Match `[...]` at the start of a list item paragraph. Captures:
 * [1] = display ID, [2] = title.
 *
 * The title group is `[\s\S]*` (not `.*`) so a title that soft-wraps onto
 * a second physical line is still captured — remark keeps a soft-wrapped
 * paragraph as one text node with an embedded `\n`, which `.` would not
 * cross, leaving the entry silently undetected (#686). {@linkcode collapseTitle}
 * then folds the wrapped title back to a single logical line.
 */
const ENTRY_START_RE = /^\[([^\]]+)\]\s*([\s\S]*)$/;

/** Match `[]` at the start — empty brackets. */
const EMPTY_BRACKET_RE = /^\[\]\s*(.*)$/;

/** Match `[` at the start without a closing `]` on the same logical content — unterminated. */
const UNTERMINATED_BRACKET_RE = /^\[[^\]]*$/;

/**
 * Fold a title that may span multiple soft-wrapped physical lines (one
 * Markdown paragraph) into a single logical line: every run of whitespace
 * — including the embedded newlines remark preserves inside the paragraph
 * text node — collapses to a single space, matching how a soft-wrapped
 * line renders (#686).
 */
function collapseTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Find the `Id:` attribute on an entry. Returns undefined when absent. If
 * more than one `Id:` is present, returns the first — the validator flags
 * this as MSL-R003.
 */
function findIdentityAttribute(
  attributes: readonly Attribute[],
): Attribute | undefined {
  for (const attr of attributes) {
    if (attr.key === IDENTITY_KEY) return attr;
  }
  return undefined;
}

/** Result returned by {@linkcode parseMarkdown}. */
export interface ParseMarkdownResult {
  /** Parsed entries found in the Markdown source. */
  readonly entries: Entry[];
  /** Parse-level diagnostics (e.g., deprecation warnings). */
  readonly diagnostics: Diagnostic[];
}

/**
 * Parse a Markdown string and return all MarkSpec entries found.
 *
 * Walks the mdast AST to detect `- [DISPLAY_ID] Title` list items with
 * indented body content. Extracts display ID, title, body, and trailing
 * attribute blocks. Entry shape (identified or referenced) is decided by
 * the `Id:` attribute's value format.
 *
 * @param markdown - Markdown source text
 * @param options - Parse options (file path for source locations)
 * @returns Parsed entries and any parse-level diagnostics
 */
export function parseMarkdown(
  markdown: string,
  options?: ParseMarkdownOptions,
): ParseMarkdownResult {
  const file = options?.file ?? "<unknown>";
  const isReferencesDoc = detectReferencesDocument(
    file,
    options?.isReferencesDoc,
  );
  const tree = processor.parse(markdown);
  const entries: Entry[] = [];
  const diagnostics: Diagnostic[] = [];

  // Pre-split once so every extractBodyContent call shares the same array
  // instead of re-splitting for each list item (O(N×L) → O(N+L)).
  const markdownLines = markdown.split("\n");

  // Collect link definition identifiers for shortcut reference exclusion.
  const definitions = new Set(
    tree.children
      .filter((n): n is Definition => n.type === "definition")
      .map((n) => n.identifier),
  );

  for (const node of tree.children) {
    if (node.type !== "list") continue;
    const list = node as List;

    // Ordered lists never contain entry blocks.
    if (list.ordered) continue;

    for (const item of list.children) {
      const entry = extractEntry(
        item,
        markdownLines,
        file,
        definitions,
        isReferencesDoc,
        diagnostics,
        !!options?.lineMap,
        options?.allowTitleOnly === true,
      );
      if (entry) entries.push(entry);
    }
  }

  const lineMap = options?.lineMap;
  if (!lineMap) return { entries, diagnostics };
  return {
    entries: translateEntryLocations(entries, lineMap),
    diagnostics: translateDiagnosticLocations(diagnostics, lineMap),
  };
}

/**
 * Translate parse-diagnostic locations from wrapped-buffer coordinates to
 * source-file coordinates (doc-comment parsing). A location the map cannot
 * translate is kept as-is.
 */
function translateDiagnosticLocations(
  diagnostics: readonly Diagnostic[],
  lineMap: LineMap,
): Diagnostic[] {
  return diagnostics.map((d) => {
    if (!d.location) return d;
    const mapped = lineMap.translate(d.location.line, d.location.column);
    return mapped ? { ...d, location: { ...d.location, ...mapped } } : d;
  });
}

/**
 * Resolve whether this is a references document.
 *
 * The caller (`parseFile` in `parser/mod.ts`) always passes an explicit
 * value computed via the canonical `isReferencesDocument` helper, so the
 * auto-detection fallback is never needed here.
 */
function detectReferencesDocument(
  _file: string,
  explicit: boolean | undefined,
): boolean {
  return explicit ?? false;
}

/**
 * Attempt to extract a MarkSpec entry from a list item.
 * Returns undefined if the list item is not an entry block.
 * Diagnostics (e.g., deprecation warnings) are pushed into the accumulator.
 */
function extractEntry(
  item: ListItem,
  markdownLines: string[],
  file: string,
  definitions: Set<string>,
  isReferencesDoc: boolean,
  diagnostics: Diagnostic[],
  hasLineMap = false,
  allowTitleOnly = false,
  skipNestedScan = false,
): Entry | undefined {
  // Task list items (remark-gfm sets checked to true/false) are not entries.
  if (item.checked != null) return undefined;

  // An entry block must have children (body content).
  // The first child must be a paragraph starting with `[DISPLAY_ID]`.
  if (!item.children.length) return undefined;

  const firstChild = item.children[0];
  if (firstChild.type !== "paragraph") return undefined;

  const paragraph = firstChild as Paragraph;
  if (!paragraph.children.length) return undefined;

  const firstInline = paragraph.children[0];

  // Inline link: [text](url) — not an entry.
  if (firstInline.type === "link") return undefined;

  let displayId: string | undefined;
  let title: string | undefined;

  if (firstInline.type === "text") {
    // remark may parse `[ID] Title` as a single text node
    const textValue = (firstInline as Text).value;
    const match = ENTRY_START_RE.exec(textValue);
    if (match) {
      displayId = match[1];
      title = collapseTitle(match[2]);
    } else if (EMPTY_BRACKET_RE.test(textValue)) {
      // MSL-P001: bracketed content is empty — `- [] Title`
      const entryLine = item.position?.start.line ?? 1;
      diagnostics.push({
        code: "MSL-P001",
        severity: "error",
        message:
          "list item starts with `[]` but the bracketed content is empty " +
          "(spec section 4.1)",
        location: { file, line: entryLine, column: 1 },
      });
      return undefined;
    } else if (UNTERMINATED_BRACKET_RE.test(textValue)) {
      // MSL-P003: display-ID brackets unterminated (missing `]`)
      const entryLine = item.position?.start.line ?? 1;
      diagnostics.push({
        code: "MSL-P003",
        severity: "error",
        message:
          "display-ID brackets unterminated -- missing `]` before end of " +
          "title line (spec section 4.1)",
        location: { file, line: entryLine, column: 1 },
      });
      return undefined;
    }
  }

  // Try linkReference pattern: remark sometimes parses [ID] as a linkReference
  if (!displayId && firstInline.type === "linkReference") {
    const ref = firstInline as unknown as {
      type: string;
      referenceType?: string;
      label?: string;
      identifier?: string;
      children: Array<{ type: string; value: string }>;
    };

    // Full [text][ref] and collapsed [text][] references are links, not entries.
    if (ref.referenceType === "full" || ref.referenceType === "collapsed") {
      return undefined;
    }

    // Shortcut [text] with a matching definition is a resolved link, not an entry.
    if (ref.referenceType === "shortcut" && ref.identifier != null) {
      if (definitions.has(ref.identifier)) return undefined;
    }

    displayId = ref.label ?? ref.children?.[0]?.value;
    // Title comes from subsequent text nodes in the paragraph
    if (displayId && paragraph.children.length > 1) {
      const rest = paragraph.children.slice(1);
      title = collapseTitle(
        rest
          .filter((n): n is Text => n.type === "text")
          .map((n) => n.value)
          .join(""),
      );
    }
  }

  if (!displayId) return undefined;

  // Strip optional leading `@` on referenced-entry display IDs for Pandoc
  // citation compatibility. Canonical slug never contains `@`.
  if (displayId.startsWith("@")) displayId = displayId.slice(1);

  // MSL-I005: Display ID is empty (after `@` stripping).
  if (displayId.length === 0) {
    const entryLine = item.position?.start.line ?? 1;
    diagnostics.push({
      code: "MSL-I005",
      severity: "error",
      message: "display ID is empty (spec section 4.2)",
      location: { file, line: entryLine, column: 1 },
    });
    return undefined;
  }

  // MSL-P002: title text missing after `]`. The title capture is empty
  // and was not populated from subsequent nodes (linkReference path sets
  // title from rest nodes).
  if (title !== undefined && title.length === 0) {
    const entryLine = item.position?.start.line ?? 1;
    diagnostics.push({
      code: "MSL-P002",
      severity: "error",
      message:
        `${displayId}: title line missing title text after ']' (spec section 4.1)`,
      location: { file, line: entryLine, column: 1 },
    });
    // Continue parsing — entry is still structurally valid for downstream
    // validation (MSL-P010 also fires from the validator for empty titles).
  }

  // Extract body content and attributes.
  // A nested entry-shaped item is not an entry (MSL-P024). Its lines are
  // outside this entry, so its trailer is never read as this entry's.
  // `skipNestedScan` is set only by `findNestedEntryItems` when it probes
  // whether an item is entry-shaped. The probe must not scan again, because
  // each level would then probe all deeper levels (exponential in depth).
  let nested = skipNestedScan ? [] : findNestedEntryItems(
    item,
    markdownLines,
    file,
    definitions,
    isReferencesDoc,
  );
  // A parent trailer written below a nested item counts only when the
  // parent has no trailer of its own above the first nested item.
  if (nested.length > 0 && !hasTrailerAbove(item, markdownLines, nested[0])) {
    nested = findNestedEntryItems(
      item,
      markdownLines,
      file,
      definitions,
      isReferencesDoc,
      itemContentIndent(item),
      true,
    );
  }
  // A list that holds a nested entry is transparent to the trailer search:
  // its remaining text stays in the body, but it does not end the content,
  // so a trailer above it stays the entry's own.
  const transparent = item.children.filter((child) =>
    child.type === "list" && child.position !== undefined &&
    nested.some((range) =>
      range.line >= child.position!.start.line &&
      range.line <= child.position!.end.line
    )
  ).map((child) => ({
    start: child.position!.start.line,
    end: child.position!.end.line,
  }));
  const { text: bodyContent, fileLines: contentFileLines } = extractBodyContent(
    item,
    markdownLines,
    nested,
    transparent,
  );
  const [rawBody, attrLines] = splitBodyAndAttributes(bodyContent);
  const body = rawBody.trimStart();
  const attributes = parseAttributes(attrLines);
  const { blocks: bodyAst, tree: mdastTree } = buildBodyAstWithTree(body);

  const entryLine = item.position?.start.line ?? 1;

  for (const range of nested) {
    diagnostics.push({
      code: "MSL-P024",
      severity: "warning",
      message: `${displayId}: a nested entry is not supported; the list ` +
        `item at line ${range.line} is not an entry and its text is not ` +
        `part of this entry, move it to the top level (spec section 4.1)`,
      location: { file, line: range.line, column: range.column },
    });
  }

  // MSL-P025: an indented `Key: Value` block with an `Id:` line, followed by
  // more content in the same list item (#985). The trailer must be the last
  // block, so the block was not read as the trailer and the entry has no
  // `Id:` attribute (it may have a later trailer without one). Markdown files
  // only: `parseSource` (source.ts) discards the parse diagnostics of a
  // source doc comment (`hasLineMap`), so P025 would never be shown there.
  const afterTrailer = !hasLineMap && nested.length === 0 &&
      !attributes.some((a) => a.key === IDENTITY_KEY)
    ? findContentAfterTrailer(item, markdownLines)
    : undefined;
  if (afterTrailer !== undefined) {
    diagnostics.push({
      code: "MSL-P025",
      severity: "warning",
      message: `${displayId}: content after the trailer at line ` +
        `${afterTrailer.line}; the trailer must be the last block of the ` +
        `entry, so its attributes, including Id:, are not read; move the ` +
        `content above the trailer (spec section 4.1)`,
      location: { file, line: afterTrailer.line, column: afterTrailer.column },
    });
  }

  // MSL-P020: a body line that would carry identity or a trace link.
  // Only `Id:` and the core trace relation keys count. Other recognized
  // keys (`Rationale:`, `Labels:`, `Type:`) and any other capitalized
  // lead-in (`Note:`, `Example:`) start ordinary body prose: such a line
  // keeps its text in the body, and `markspec fmt` cannot change it, so
  // an error there could never be cleared (#654, #916).
  //
  // - Error: an `Id:` or trace-relation line with other content after it
  //   (body content or the trailer block). The trailer is not at the final
  //   position, so the identity or the link is lost. A trailing run that
  //   holds an `Id:` line is always the trailer (findTrailerStart), so an
  //   `Id:` line never reaches the warning case below.
  // - Warning: a trace-relation line in the trailing run of `Key: Value`
  //   lines of an entry with no trailer. The run was not accepted as the
  //   trailer (no blank line above it, or a key outside the core set), so
  //   the line is body text and does not create a trace link.
  // MSL-P025 already names the cause of a misplaced trailer.
  if (body.length > 0 && afterTrailer === undefined) {
    const bodyLines = body.split("\n");
    const fencedLines =
      parseCodeRegions(normalizeLineEndings(body), mdastTree).fencedLines;
    // Start of the trailing run of `Key: Value` lines (blank lines skipped
    // at the end only).
    let tailStart = bodyLines.length;
    while (tailStart > 0 && bodyLines[tailStart - 1].trim() === "") {
      tailStart--;
    }
    while (
      tailStart > 0 && !fencedLines.has(tailStart - 1) &&
      ATTR_LINE_RE.test(bodyLines[tailStart - 1].trim())
    ) tailStart--;
    let warned = false;
    for (let i = 0; i < bodyLines.length; i++) {
      // Reuse the LF-normalized body tree: examples cannot be misplaced trailers.
      if (fencedLines.has(i)) continue;
      const trimmed = bodyLines[i].trim();
      if (!ATTR_LINE_RE.test(trimmed)) continue;
      const key = trimmed.match(/^([A-Z][A-Za-z-]*):/)?.[1];
      if (key === undefined) continue;
      if (key !== IDENTITY_KEY && !TRACE_RELATION_KEYS.has(key)) continue;
      if (i < tailStart || attrLines.length > 0) {
        diagnostics.push({
          code: "MSL-P020",
          severity: "error",
          message:
            `${displayId}: trailers block is not the final indented code ` +
            `block of the entry -- content appears after trailer-like ` +
            `lines (spec section 4.1)`,
          location: { file, line: entryLine, column: 1 },
        });
        break; // One diagnostic per entry is sufficient
      }
      if (!warned) {
        warned = true;
        diagnostics.push({
          code: "MSL-P020",
          severity: "warning",
          message: `${displayId}: '${key}:' line is read as body ` +
            `text, not as a trailer; to make it a trace link, put the ` +
            `trailer in an indented block after a blank line ` +
            `(spec section 4.1)`,
          location: { file, line: entryLine, column: 1 },
        });
      }
    }
  }

  // MSL-P020 (warning): the trailer is an `Id:` run directly under prose,
  // with no blank line above it. It is still read as the trailer, so the entry keeps its
  // identity, but it is not in the canonical layout (#916).
  if (isTrailerUnderProse(bodyContent.split("\n"))) {
    diagnostics.push({
      code: "MSL-P020",
      severity: "warning",
      message: `${displayId}: trailers block is not separated from the ` +
        `body by a blank line; run 'markspec fmt' to ` +
        `move it to the canonical layout (spec section 4.1)`,
      location: { file, line: entryLine, column: 1 },
    });
  }

  // MSL-P021 / MSL-P022: validate trailer lines for syntax correctness.
  // The trailer block is the final indented code block. Lines within it
  // should all match `Key: Value` syntax. We check both the parsed
  // attrLines AND the trailing body lines that might be in a code block
  // but failed ATTR_LINE_RE (thus stayed in the body).

  // P021/P022 point at the offending trailer line itself, not the title, so
  // editors underline the bad line and quick fixes can target it directly.
  // `bodyContent` starts at the second list-item child's line and has only
  // trailing blank lines trimmed, so content index `i` sits on file line
  // `contentStartLine + i`. The column is the line's first non-blank char.
  const contentStartLine = item.children[1]?.position?.start.line ??
    entryLine + 1;
  const trailerLineLocation = (contentIndex: number) => {
    const line = contentFileLines[contentIndex] ??
      contentStartLine + contentIndex;
    const firstNonBlank = (markdownLines[line - 1] ?? "").search(/\S/);
    return { file, line, column: firstNonBlank >= 0 ? firstNonBlank + 1 : 1 };
  };
  // MSL-P023: a trailer with a line indented less than 4 columns past the
  // list-item content (git style) is accepted but not canonical in
  // Markdown. Every trailer line is checked, tab-aware, so a block whose
  // later lines are not indented is reported too: `markspec fmt` rewrites
  // it. The warning points at the trailer's first line. The legacy
  // trailing-backslash form has its own deprecation warning, so it is
  // skipped. A run directly under prose is reported as MSL-P020 above, so
  // at most one of the two warnings fires for a block.
  const contentLines = bodyContent.split("\n");
  if (
    attrLines.length > 0 &&
    !attrLines.some((line) => line.trimEnd().endsWith("\\")) &&
    !isTrailerUnderProse(contentLines)
  ) {
    const trailerIndex = findTrailerStart(contentLines);
    const indent = itemContentIndent(item);
    let notIndented = false;
    let hasContinuation = false;
    for (let i = trailerIndex; i < contentLines.length; i++) {
      const rawLine = markdownLines[trailerLineLocation(i).line - 1] ?? "";
      if (rawLine.trim() === "") continue;
      if (leadingColumns(rawLine) - indent < 4) notIndented = true;
      if (!ATTR_LINE_RE.test(rawLine.trim())) hasContinuation = true;
    }
    if (notIndented) {
      // fmt and the quick fix leave a trailer with a continuation line
      // (MSL-P021) unchanged, so the hint to run fmt applies only without
      // one.
      const hint = hasContinuation
        ? "fix the MSL-P021 continuation line by hand, then indent the trailer"
        : "run `markspec fmt` to indent the trailer";
      diagnostics.push({
        code: "MSL-P023",
        severity: "warning",
        message: `${displayId}: a trailer line is not indented; ${hint} ` +
          "(spec section 1.3)",
        location: trailerLineLocation(trailerIndex),
      });
    }
  }

  // `attrLines` is the contiguous, blank-free tail of `bodyContent`.
  const attrContentStart = bodyContent.split("\n").length - attrLines.length;

  // File line of each parsed attribute. `parseAttributes` keeps one
  // attribute per trailer line and skips blank and empty-valued lines.
  const attributeLines: number[] = [];
  for (const [attrIndex, rawLine] of attrLines.entries()) {
    if (parseAttributes([rawLine]).length === 1) {
      attributeLines.push(
        trailerLineLocation(attrContentStart + attrIndex).line,
      );
    }
  }

  // Check lines that DID end up in attrLines but might have key issues
  for (const [attrIndex, rawLine] of attrLines.entries()) {
    const trailerLocation = trailerLineLocation(attrContentStart + attrIndex);
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (!ATTR_LINE_RE.test(trimmed)) {
      const colonMatch = COLON_SPLIT_RE.exec(trimmed);
      if (colonMatch) {
        const key = colonMatch[1].trim();
        if (!TRAILER_KEY_RE.test(key)) {
          diagnostics.push({
            code: "MSL-P022",
            severity: "error",
            message: `${displayId}: trailer key '${key}' contains characters ` +
              `outside [A-Za-z][A-Za-z0-9-]* (spec section 4.1)`,
            location: trailerLocation,
          });
        } else {
          diagnostics.push({
            code: "MSL-P021",
            severity: "error",
            message: `${displayId}: trailer line does not match 'Key: Value' ` +
              `syntax (spec section 4.1): "${trimmed}"`,
            location: trailerLocation,
          });
        }
      } else {
        diagnostics.push({
          code: "MSL-P021",
          severity: "error",
          message: `${displayId}: trailer line does not match 'Key: Value' ` +
            `syntax (spec section 4.1): "${trimmed}"`,
          location: trailerLocation,
        });
      }
    }
  }

  // Also scan trailing body lines for suspected misplaced trailers.
  // If the body's last non-empty lines look like they belong to an
  // indented code block with colon-separated content that has invalid
  // keys, emit P022. Lines without colons that appear in what looks
  // like a trailer block emit P021. A line that the parser keeps in the
  // body as text (see `isBodyTextLine`) is not reported (#1034).
  if (body.length > 0) {
    const bodyLines = body.split("\n");
    // Walk backward from the end of the body to find lines in a trailing
    // code-block-like region that have colons (suspected trailers).
    for (let i = bodyLines.length - 1; i >= 0; i--) {
      const trimmed = bodyLines[i].trim();
      if (!trimmed) continue; // skip trailing blanks
      const trailerLocation = trailerLineLocation(i);
      // A `<!-- markspec:* -->` directive comment is legitimate body
      // content (spec §2.4.1), not a trailer line — skip it so its
      // `<!--markspec` colon-prefix is never mistaken for a malformed
      // trailer key. `continue` (not `break`) keeps scanning earlier lines,
      // so a genuine leaked-trailer typo sitting above a directive comment
      // still fires MSL-P022 (#687, preserves #697).
      if (isMarkspecDirectiveComment(trimmed)) continue;
      const suspect = suspectTrailerLine(trimmed);
      if (suspect === undefined) break; // stop at a prose line
      if (ATTR_LINE_RE.test(trimmed)) {
        // Valid attr line in body → already caught by P020
        continue;
      }
      const { key, value } = suspect;
      const keyIsValid = TRAILER_KEY_RE.test(key);
      if (keyIsValid && value.length > 0) break;
      // The parser keeps the line in the body as text (#1034).
      if (isBodyTextLine(bodyLines, i, key, attrLines.length > 0)) break;
      if (!keyIsValid) {
        diagnostics.push({
          code: "MSL-P022",
          severity: "error",
          message: `${displayId}: trailer key '${key}' contains characters ` +
            `outside [A-Za-z][A-Za-z0-9-]* (spec section 4.1)`,
          location: trailerLocation,
        });
      } else {
        diagnostics.push({
          code: "MSL-P021",
          severity: "error",
          message: `${displayId}: trailer line does not match 'Key: Value' ` +
            `syntax (spec section 4.1): "${trimmed}"`,
          location: trailerLocation,
        });
      }
      break; // one diagnostic per trailing suspect line is sufficient
    }
  }

  // Detect legacy paragraph + trailing-backslash attribute form and warn.
  if (
    attributes.length > 0 &&
    attrLines.some((line) => line.trimEnd().endsWith("\\"))
  ) {
    const entryLine = item.position?.start.line ?? 1;
    diagnostics.push({
      code: "MSL-DEPRECATED-ATTR-001",
      severity: "warning",
      message:
        "legacy attribute block (paragraph with trailing `\\`) is deprecated; " +
        "run `markspec format` to convert to the canonical indented code block",
      location: { file, line: entryLine, column: 1 },
    });
  }

  // Discriminate shape by the `Id:` attribute's value format.
  let shape: EntryShape | undefined;
  let id: string | undefined;

  const identityAttr = findIdentityAttribute(attributes);
  if (identityAttr) {
    id = identityAttr.value;
    shape = shapeFromIdValue(identityAttr.value);
    if (shape === undefined) {
      // `Id:` is neither a ULID nor a scheme-qualified URI. Accept as an
      // identified entry so the validator can surface MSL-R004; missing
      // shape on a parsed entry is not useful downstream.
      shape = "Authored";
    }
  } else {
    // No `Id:`. Fall back on display-ID shape + document context to decide
    // whether to admit the entry at all.
    if (isReferencesDoc && SLUG_RE.test(displayId)) {
      shape = "Reference";
    } else {
      // No identity attribute and no references-doc context — admit as
      // identified so the validator can surface the missing-`Id:` error.
      shape = "Authored";
    }
  }

  // Inferred type from display-ID prefix — left to the profile layer. For
  // now the core records no type; downstream profile-aware code populates
  // this field when a profile is loaded.
  const type: string | undefined = undefined;

  // MSL-P030: Authored entry has no body block (title + trailers only).
  // For Reference shape, body is optional (ADR-002 section Part 3). For Authored,
  // the body is required. We also emit P030 when the body is empty (all
  // content was consumed as attributes).
  if (shape === "Authored" && body.trim().length === 0) {
    diagnostics.push({
      code: "MSL-P030",
      severity: "error",
      message:
        `${displayId}: Authored entry has no body block -- entries must ` +
        `have body content between title and trailers (spec section 4.1)`,
      location: { file, line: entryLine, column: 1 },
    });
  }

  // Body requirement: identified entries require a body; referenced entries
  // may omit it. If there's only one child (the title paragraph), admit
  // only referenced entries.
  if (shape !== "Reference" && item.children.length < 2 && !allowTitleOnly) {
    return undefined;
  }

  // Source location
  const line = item.position?.start.line ?? 1;
  const column = item.position?.start.column ?? 1;

  const entryLocation = { file, line, column };

  // Inline-construct tokens (ADR-016). Reuses the already-built bodyAst to
  // avoid a redundant mdast parse.
  //
  // bodyStartLine: use the mdast position of the second child (the body
  // paragraph) — the actual buffer line where the body starts. CommonMark
  // loose lists have a blank line between title and body, so the body is at
  // (entry_line + 2), not (entry_line + 1).
  //
  // columnOffset: body text has been stripped of the list-item content
  // indent (itemContentIndent: 2 for `- [ID]`, 4 for `-   [ID]`), so each
  // token column is bumped by that width. For a source
  // doc comment, wrapAsListItem writes `- ` and a 2-space indent on every
  // non-title line, so the width is 2 there.
  const bodyIndent = itemContentIndent(item);
  const bodyStartLine = item.children[1]?.position?.start.line ?? (line + 1);
  const endLine = item.position?.end.line;
  const bodyTokens = extractBodyTokens(
    body,
    bodyAst,
    {
      file,
      line: bodyStartLine,
      column: 1,
    },
    bodyIndent,
    mdastTree,
  );
  // The body skips the lines of nested entries, so a line counted from the
  // body start is an index into `contentFileLines`, after the blank lines
  // that `trimStart` removed from the front of the body.
  const trimmedLines = rawBody.slice(0, rawBody.length - body.length)
    .split("\n").length - 1;
  const toFileLine = (line: number): number =>
    nested.length === 0 ? line : contentFileLines[
      line - bodyStartLine + trimmedLines
    ] ?? line;
  const fileBodyTokens: typeof bodyTokens = nested.length === 0
    ? bodyTokens
    : bodyTokens.map((token) => ({
      ...token,
      location: { ...token.location, line: toFileLine(token.location.line) },
    })) as typeof bodyTokens;

  // Extract + resolve typl declarations from all three surfaces (#723):
  // published names resolve to absolute dotted form at parse time, so
  // Entry.types carries absolute names only. See typl/assemble.ts.
  const typl = assembleTyplTypes(bodyAst, bodyTokens, file, bodyStartLine);
  diagnostics.push(
    ...(nested.length === 0
      ? typl.diagnostics
      : typl.diagnostics.map((d) =>
        d.location
          ? {
            ...d,
            location: { ...d.location, line: toFileLine(d.location.line) },
          }
          : d
      )),
  );
  const types = typl.types;

  return {
    displayId: makeDisplayId(displayId),
    title: title ?? "",
    body,
    bodyAst,
    rawAttributes: attributes,
    typedAttributes: collateAttributes(attributes),
    id,
    type,
    shape,
    location: entryLocation,
    bodyStartLine,
    ...(endLine !== undefined ? { endLine } : {}),
    ...(nested.length > 0
      ? {
        nestedEntryLines: mergeRanges([
          ...nested.map(({ start, end }) => ({ start, end })),
          ...transparent,
        ]),
      }
      : {}),
    ...(afterTrailer !== undefined
      ? { contentAfterTrailerLine: afterTrailer.line }
      : {}),
    ...(attributeLines.length > 0 ? { attributeLines } : {}),
    source: { kind: "markdown" },
    properties: { file: { path: file, line, column } },
    bodyTokens: fileBodyTokens,
    ...(types ? { types } : {}),
  };
}

/**
 * The first content after a trailer-shaped indented code block among the
 * children of `item` (#985), or `undefined`. A block is trailer-shaped when
 * every line is a `Key: Value` line and one line is an `Id:` line. Fenced
 * code blocks are examples and never count. The last child is never such a
 * block: it would be the trailer. Returns the 1-based line and column of the
 * first child after the last such block.
 */
function findContentAfterTrailer(
  item: ListItem,
  markdownLines: readonly string[],
): { line: number; column: number } | undefined {
  const children = item.children;
  for (let i = children.length - 2; i >= 1; i--) {
    const child = children[i];
    if (child.type !== "code" || child.position === undefined) continue;
    const opener = markdownLines[child.position.start.line - 1]?.trimStart();
    if (opener === undefined || /^(```|~~~)/.test(opener)) continue;
    const lines = child.value.split("\n").map((l) => l.trim()).filter((l) =>
      l !== ""
    );
    if (lines.length === 0) continue;
    if (!lines.every((l) => ATTR_LINE_RE.test(l))) continue;
    if (!lines.some((l) => l.startsWith(`${IDENTITY_KEY}:`))) continue;
    const next = children[i + 1].position;
    if (next === undefined) return undefined;
    return { line: next.start.line, column: next.start.column };
  }
  return undefined;
}

/**
 * Width of the continuation indent of a list item: the 0-based column where
 * its title paragraph starts. That is the marker column plus the marker
 * width plus the spaces after the marker, so `- [ID]` gives 2 and
 * `-   [ID]` gives 4 (ordered lists never hold entries; see
 * `parseMarkdown`). Falls back to the marker column plus 2 when the title
 * has no position.
 */
function itemContentIndent(item: ListItem): number {
  const title = item.children[0]?.position?.start.column;
  if (title !== undefined) return title - 1;
  return (item.position?.start.column ?? 1) - 1 + 2;
}

/** Sort line ranges and merge those that overlap or touch. */
function mergeRanges(
  ranges: readonly { start: number; end: number }[],
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && r.start <= last.end + 1) {
      out[out.length - 1] = {
        start: last.start,
        end: Math.max(last.end, r.end),
      };
    } else out.push({ ...r });
  }
  return out;
}

/** The lines of one nested entry-shaped list item (1-based, inclusive). */
interface NestedEntryRange {
  readonly start: number;
  readonly end: number;
  /** 1-based column of the nested entry's list marker. */
  readonly column: number;
  /** 1-based line of the nested entry's title, where MSL-P024 is reported.
   * Differs from `start` when a plain list item wraps the nested entry. */
  readonly line: number;
}

/** `true` when every non-blank line of `text` is a `Key: Value` line. */
function isKeyValueText(text: string): boolean {
  const rows = text.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  return rows.length > 0 && rows.every((l) => ATTR_LINE_RE.test(l));
}

/**
 * `true` when the content of `item` above its first nested entry holds a
 * trailer of the entry's own.
 */
function hasTrailerAbove(
  item: ListItem,
  lines: string[],
  firstNested: NestedEntryRange,
): boolean {
  const startLine = item.children[1]?.position?.start.line;
  if (startLine === undefined || startLine >= firstNested.start) return false;
  const indent = itemContentIndent(item);
  const indentStr = " ".repeat(indent);
  const above = lines.slice(startLine - 1, firstNested.start - 1).map((l) =>
    l.startsWith(indentStr) ? l.slice(indent) : l
  );
  while (above.length > 0 && above.at(-1)!.trim() === "") above.pop();
  return findTrailerStart(above) < above.length;
}

/** Marker-only text of a list item's first line: `-`, `*`, `+`, `1.`, `1)`. */
const MARKER_ONLY_RE = /^\s*(?:[-*+]|\d{1,9}[.)])\s*$/;

/**
 * Every outermost list item nested in `item`, at any depth, that is itself
 * entry-shaped: bullet or ordered, with a display ID title that
 * {@linkcode extractEntry} accepts (body content or a trailer, so a title-only
 * item is not entry-shaped). An item inside such an item is part of it.
 *
 * The range of an entry-shaped item is its own list item, from the mdast
 * position. With `parentTrailerBelow`, one exception applies: a paragraph of
 * `Key: Value` lines at the end of the item, written at the enclosing entry's
 * canonical trailer indent (its content indent plus 4) and not at the item's
 * own content indent, is that entry's trailer, and the range stops above it.
 *
 * A plain list item that holds the nested entry is kept, with its other
 * content, as body of `item`. It is removed too only when nothing but its
 * marker would be left, because that marker would otherwise end the content
 * and cut the entry's trailer off.
 */
function findNestedEntryItems(
  item: ListItem,
  lines: string[],
  file: string,
  definitions: Set<string>,
  isReferencesDoc: boolean,
  entryIndent = itemContentIndent(item),
  parentTrailerBelow = false,
  wrap = true,
): NestedEntryRange[] {
  const found: NestedEntryRange[] = [];
  for (const child of item.children) {
    if (child.type !== "list") continue;
    for (const nestedItem of (child as List).children) {
      const position = nestedItem.position;
      if (
        position &&
        extractEntry(
          nestedItem,
          lines,
          file,
          definitions,
          isReferencesDoc,
          [],
          false,
          false,
          true,
        )
      ) {
        const last = nestedItem.children.at(-1);
        let end = position.end.line;
        if (
          parentTrailerBelow &&
          last?.type === "paragraph" && nestedItem.children.length > 1 &&
          last.position &&
          last.position.start.column - 1 === entryIndent + 4 &&
          last.position.start.column - 1 !== itemContentIndent(nestedItem) &&
          isKeyValueText(
            lines.slice(last.position.start.line - 1, last.position.end.line)
              .join("\n"),
          )
        ) end = last.position.start.line - 1;
        found.push({
          start: position.start.line,
          end,
          column: position.start.column,
          line: position.start.line,
        });
      } else {
        const inner = findNestedEntryItems(
          nestedItem,
          lines,
          file,
          definitions,
          isReferencesDoc,
          entryIndent,
          parentTrailerBelow,
          false,
        );
        // The wrapper's marker line goes with the first nested entry only
        // when the wrapper holds nothing else: its first line is a bare
        // marker, it has only lists, and every item of those lists is a
        // nested entry. Otherwise only the nested entries are removed.
        const items = nestedItem.children.flatMap((c) =>
          c.type === "list" ? (c as List).children : []
        );
        const onlyNestedEntries = position !== undefined &&
          MARKER_ONLY_RE.test(lines[position.start.line - 1] ?? "") &&
          nestedItem.children.every((c) => c.type === "list") &&
          inner.length === items.length &&
          items.every((it) =>
            inner.some((r) => r.line === it.position?.start.line)
          );
        found.push(
          ...(wrap && onlyNestedEntries
            ? inner.map((range, i) =>
              i === 0 ? { ...range, start: position.start.line } : range
            )
            : inner),
        );
      }
    }
  }
  return found;
}

/**
 * Extract body content from a list item's children (excluding the first paragraph
 * which contains the display ID and title).
 *
 * Reconstructs the text content from the source markdown using position info.
 * Accepts a pre-split lines array to avoid redundant splits across entries.
 */
function extractBodyContent(
  item: ListItem,
  lines: string[],
  nested: readonly NestedEntryRange[] = [],
  transparent: readonly { start: number; end: number }[] = [],
): { text: string; fileLines: number[] } {
  const children = item.children.slice(1); // Skip title paragraph
  if (!children.length) return { text: "", fileLines: [] };

  // Get the range from the second child's start to the last child's end
  const startLine = children[0].position?.start.line;
  const endLine = children[children.length - 1].position?.end.line;

  if (!startLine || !endLine) return { text: "", fileLines: [] };

  const indent = itemContentIndent(item);
  const indentStr = " ".repeat(indent);

  // Extract the raw lines and strip the list item continuation indent. The
  // lines of a nested entry-shaped item (MSL-P024) are not part of this
  // entry: its trailer is never read as this entry's.
  const stripped: string[] = [];
  const fileLines: number[] = [];
  for (let n = startLine; n <= endLine; n++) {
    if (nested.some((range) => n >= range.start && n <= range.end)) continue;
    const line = lines[n - 1];
    stripped.push(line.startsWith(indentStr) ? line.slice(indent) : line);
    fileLines.push(n);
  }

  // Trailer detection skips the transparent lists. A trailer found above
  // them is moved below their text, so that the trailer is the last block
  // and the text stays in the body.
  if (transparent.length > 0) {
    const isTransparent = (n: number) =>
      transparent.some((r) => n >= r.start && n <= r.end);
    const kept = stripped.map((_, i) => i).filter((i) =>
      !isTransparent(fileLines[i])
    );
    const at = findTrailerStart(kept.map((i) => stripped[i]));
    if (at < kept.length) {
      const trailerIdx = kept.slice(at);
      const first = trailerIdx[0];
      const inTrailer = new Set(trailerIdx);
      const order = [
        ...stripped.map((_, i) => i).filter((i) =>
          i < first && !inTrailer.has(i)
        ),
        ...stripped.map((_, i) => i).filter((i) =>
          i > first && !inTrailer.has(i)
        ),
      ];
      const text = [
        ...order.map((i) => stripped[i]),
        "",
        ...trailerIdx.map((i) => stripped[i]),
      ];
      const files = [
        ...order.map((i) => fileLines[i]),
        fileLines[first] - 1,
        ...trailerIdx.map((i) => fileLines[i]),
      ];
      return { text: trimLayoutEnd(text.join("\n")), fileLines: files };
    }
  }

  // Keep the first line's own indent: it marks an indented trailer in a
  // body-less entry, and `markspec fmt` sees the same text (#916).
  return { text: trimLayoutEnd(stripped.join("\n")), fileLines };
}
