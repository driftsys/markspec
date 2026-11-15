/**
 * @module lsp/code_actions
 *
 * Code-action builder for Markdown and source files. `.feature` files are
 * routed to `feature_code_actions.ts` by `onCodeAction` in `server.ts`; this
 * module also exports the pure helpers that module reuses. It walks the
 * diagnostics the editor has on a range and emits LSP `CodeAction[]` quick
 * fixes for the ones MarkSpec knows how to mechanically repair.
 *
 * The attribute fixes A011, A012 and A013 edit only lines of the trailer
 * block of the entry the diagnostic belongs to, and offer no action when no
 * line of that block qualifies. They need a parsed Markdown entry, so in a
 * source file, whose text is parsed as Markdown, they offer no action unless
 * the text holds a literal entry block. The A030 and T020 fixes are bounded
 * the same way. In Markdown they use the trailer block of the diagnosed
 * entry. In a source file the caller passes the entries that the source
 * parser extracted from the doc comments; each entry carries the file line of
 * every trailer attribute (`Entry.attributeLines`), so the fix works for
 * `///` comments, `*`-prefixed block comments and block comments with no
 * prefix. When no trailer line of the diagnosed entry qualifies, there is no
 * action: the fixes never scan forward without a bound.
 * The A011, A012 and A013 fixes accept LF or CRLF line endings and a
 * tab-led trailer line, and read a value as the parser reads it: the line is
 * trimmed and one trailing continuation backslash is dropped. When several
 * diagnostics of A012 or A011 name the same key on one entry, the nth
 * diagnostic fixes the nth matching line.
 *
 * Currently handles:
 *
 *   - **MSL-M060** — uppercase modal keyword. Action: lowercase it.
 *   - **MSL-A030** — generated attribute in source. Action: remove
 *     the offending trailer line.
 *   - **MSL-T020** — unknown `Type:` value. Action: replace with the
 *     closest core type, when one is within Levenshtein distance 3.
 *     "Did you mean …" rather than exhaustive suggestions.
 *   - **MSL-A013** — single-cardinality attribute appears more than
 *     once. Action: delete every duplicate trailer line, keeping the
 *     first occurrence. Only lines in the diagnosed entry's trailer
 *     block are considered.
 *   - **MSL-A011** — citation attribute in CSV form. Action: rewrite
 *     the single CSV line as one trailer line per value (the
 *     canonical multi-line form), splitting on top-level commas. The
 *     fix uses the nth line of the diagnosed entry's trailer block
 *     that has the key and two or more values (the first, unless
 *     several diagnostics name the key).
 *   - **MSL-A012** — repeatable attribute with an empty value list.
 *     Action: remove the empty trailer line (the first line of the
 *     diagnosed entry's trailer block that has the key and no values).
 *   - **MSL-P021** — malformed trailer line, only when the line the
 *     diagnostic points at is an empty-valued `Key:` trailer (e.g.
 *     `Satisfies:`). Action: remove the empty trailer line(s) in that
 *     trailer block, matching what `markspec fmt` drops. Other P021
 *     shapes get no fix.
 *   - **MSL-P023** — trailer with a line that is not indented (git style). Action:
 *     re-indent exactly the trailer lines (found by the formatter's shared
 *     trailer detection) to the list-item indent plus 4 columns, the same
 *     layout `markspec fmt` writes.
 *   - **MSL-L010** — lockfile reference entry has no `Reference-url:`.
 *     Action: insert a placeholder `Reference-url:` trailer line.
 *   - **MSL-S002** — sync attribute mapping has `locked: true` but
 *     direction is outbound. Action: remove the `locked: true` line.
 *   - **MSL-S003** — unknown conflict-resolution policy in sync config.
 *     Action: replace the bad value with `manual`.
 *   - **MSL-S010** — locally edited locked attribute. Action: surface
 *     an informational stub (full revert requires connector cache I/O).
 */

import {
  CORE_ABSTRACT_TYPES,
  CORE_CONCRETE_TYPES,
  type Entry,
} from "../core/model/mod.ts";
import {
  findAttributeBlockRange,
  parse,
  parseAttributeLine,
  repeatableAttributeValues,
} from "../core/mod.ts";

/** A subset of the LSP `Diagnostic` interface — just what the
 * code-action walker needs. */
export interface LspDiagnosticLike {
  readonly code: string;
  readonly severity?: number;
  readonly message: string;
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
}

/** A subset of the LSP `TextEdit` interface. */
export interface TextEdit {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly newText: string;
}

/** A subset of the LSP `CodeAction` interface. */
export interface CodeAction {
  readonly title: string;
  readonly kind: string;
  readonly diagnostics?: readonly LspDiagnosticLike[];
  readonly isPreferred?: boolean;
  readonly edit?: { readonly changes?: Record<string, TextEdit[]> };
}

/** Capture the keyword inside `'…'` in an MSL-M060 message. */
const KEYWORD_RE = /modal keyword '([^']+)'/;

/** Capture the attribute key inside `'…'` in an MSL-A030 message. */
export const ATTRIBUTE_KEY_RE = /'([A-Z][A-Za-z-]*)'/;

/** Capture the bad type value inside `'…'` in an MSL-T020 message. */
export const T020_VALUE_RE = /Type: '([^']+)'/;

/** An empty-valued trailer line: `Key:` with nothing after the colon.
 * Same key grammar as the formatter's `removeEmptyTrailerLines`. */
export const EMPTY_TRAILER_RE = /^([A-Z][A-Za-z-]*):\s*$/;

/** Trailer indentation: ≥4 spaces or a tab (a canonical indented code
 * block line). */
const TRAILER_INDENT_RE = /^(?: {4,}|\t)/;

/** All core type names — search target for MSL-T020 "did you mean" fixes. */
const ALL_CORE_TYPES: readonly string[] = [
  ...CORE_ABSTRACT_TYPES,
  ...CORE_CONCRETE_TYPES,
];

/** Max acceptable Levenshtein distance for a type-name suggestion. */
const MAX_SUGGESTION_DISTANCE = 3;

/**
 * Build quick-fix actions for the supplied diagnostics. Returns an
 * empty array when none of the diagnostics has a known fix.
 *
 * `documentText` is optional; it's only needed for fixes that locate
 * a specific line in the source (e.g. MSL-A030 attribute removal).
 * MSL-M060 only invocations may omit it.
 *
 * `sourceEntries` is set for a source file only, and never for Markdown:
 * the entries that the source parser extracted from its doc comments. The
 * A030 and T020 fixes of a source file read their line from these entries,
 * so an empty list gives a source file no A030 or T020 fix. Without
 * `sourceEntries`, the document is Markdown and the fixes read its trailer
 * block.
 */
export function buildCodeActions(
  uri: string,
  diagnostics: readonly LspDiagnosticLike[],
  documentText?: string,
  sourceEntries?: readonly Entry[],
): CodeAction[] {
  const out: CodeAction[] = [];
  // Parsed once, and only when a Markdown fix needs the entries.
  let document: MarkdownDocument | undefined;
  const markdown = (): MarkdownDocument => {
    if (documentText === undefined) throw new Error("no document text");
    let entries: ReturnType<typeof parse> | undefined;
    return document ??= {
      ...splitLines(documentText),
      entries: () => entries ??= parse(documentText),
    };
  };
  // When several A011 or A012 diagnostics name the same key on one entry,
  // the nth diagnostic fixes the nth matching line, so each action has its
  // own line. A diagnostic that arrives alone counts as the first.
  const seenCounts = new Map<string, number>();
  // The slot is keyed by line and key only. In Markdown, A011 (citation
  // keys) and A012 (an empty value list) cannot name the same key, so the
  // code adds nothing; the .feature builder keys its slot by code too,
  // because it also numbers A030 diagnostics.
  const nextIndex = (diag: LspDiagnosticLike): number => {
    const key = ATTRIBUTE_KEY_RE.exec(diag.message)?.[1];
    const slot = `${diag.range.start.line}|${key}`;
    const nth = seenCounts.get(slot) ?? 0;
    seenCounts.set(slot, nth + 1);
    return nth;
  };
  for (const diag of diagnostics) {
    let action: CodeAction | undefined;
    if (diag.code === "MSL-M060") {
      action = buildM060Fix(uri, diag);
    } else if (diag.code === "MSL-S010") {
      action = buildS010Fix(uri, diag);
    } else if (documentText !== undefined) {
      switch (diag.code) {
        case "MSL-A030":
          action = sourceEntries
            ? buildSourceA030Fix(uri, diag, documentText, sourceEntries)
            : buildA030Fix(uri, diag, markdown());
          break;
        case "MSL-T020":
          action = sourceEntries
            ? buildSourceT020Fix(uri, diag, documentText, sourceEntries)
            : buildT020Fix(uri, diag, markdown());
          break;
        case "MSL-A013":
          action = buildA013Fix(uri, diag, markdown());
          break;
        case "MSL-A011":
          action = buildA011Fix(uri, diag, markdown(), nextIndex(diag));
          break;
        case "MSL-A012":
          action = buildA012Fix(uri, diag, markdown(), nextIndex(diag));
          break;
        case "MSL-P021":
          action = buildP021Fix(uri, diag, markdown());
          break;
        case "MSL-P023":
          action = buildP023Fix(uri, diag, markdown());
          break;
        case "MSL-L010":
          action = buildL010Fix(uri, diag, documentText);
          break;
        case "MSL-S002":
          action = buildS002Fix(uri, diag, documentText);
          break;
        case "MSL-S003":
          action = buildS003Fix(uri, diag, documentText);
          break;
      }
    }
    if (action) out.push(action);
  }
  return out;
}

function buildA012Fix(
  uri: string,
  diag: LspDiagnosticLike,
  doc: MarkdownDocument,
  nth: number,
): CodeAction | undefined {
  const attrKey = ATTRIBUTE_KEY_RE.exec(diag.message)?.[1];
  if (attrKey === undefined) return undefined;
  const block = markdownTrailerBlock(doc, diag.range.start.line);
  if (!block) return undefined;
  // Empty by the validator's rule for the attribute's value type.
  const i = findKeyLine(
    doc.lines,
    block.range,
    attrKey,
    markdownKey,
    markdownValue,
    (value) => repeatableAttributeValues(attrKey, value)?.length === 0,
    nth,
  );
  if (i < 0) return undefined;
  return quickFix(uri, diag, `Remove empty '${attrKey}' line`, [
    deleteLines(i, i + 1),
  ]);
}

function buildP021Fix(
  uri: string,
  diag: LspDiagnosticLike,
  doc: MarkdownDocument,
): CodeAction | undefined {
  // The diagnostic points at the offending trailer line. Only the
  // empty-valued `Key:` shape is mechanically fixable — the parser never
  // admits it as a trailer, so MSL-A012 cannot fire for it. For the same
  // reason `markdownTrailerBlock` does not cover that line, so this fix
  // bounds itself to the contiguous indented run around the line.
  const { lines } = doc;
  const target = diag.range.start.line;
  const targetLine = lines[target];
  if (targetLine === undefined || !TRAILER_INDENT_RE.test(targetLine)) {
    return undefined;
  }
  const empty = EMPTY_TRAILER_RE.exec(targetLine.trim());
  if (!empty) return undefined;
  const attrKey = empty[1];
  // Mirror `markspec fmt` (removeEmptyTrailerLines): drop every empty
  // `Key:` line in the contiguous trailer block, and when nothing else
  // remains, the blank line before it too — so no MSL-F010 drift is left.
  const isBlockLine = (i: number) =>
    i >= 0 && i < lines.length && TRAILER_INDENT_RE.test(lines[i]) &&
    lines[i].trim() !== "";
  let blockStart = target;
  while (isBlockLine(blockStart - 1)) blockStart--;
  let blockEnd = target + 1;
  while (isBlockLine(blockEnd)) blockEnd++;
  const emptyLines: number[] = [];
  for (let i = blockStart; i < blockEnd; i++) {
    if (EMPTY_TRAILER_RE.test(lines[i].trim())) emptyLines.push(i);
  }
  const wholeBlock = emptyLines.length === blockEnd - blockStart;
  const edits: TextEdit[] = wholeBlock
    ? [deleteLines(
      blockStart > 0 && lines[blockStart - 1].trim() === ""
        ? blockStart - 1
        : blockStart,
      blockEnd,
    )]
    : emptyLines.map((i) => deleteLines(i, i + 1));
  return quickFix(
    uri,
    diag,
    emptyLines.length > 1
      ? "Remove empty trailer lines"
      : `Remove empty '${attrKey}' line`,
    edits,
  );
}

function buildP023Fix(
  uri: string,
  diag: LspDiagnosticLike,
  doc: MarkdownDocument,
): CodeAction | undefined {
  // The diagnostic points at the first trailer line. The shared block
  // lookup finds the entry that holds it and bounds the block with the
  // formatter's trailer detection (shared with the parser), so a following
  // list item or heading is never touched. Each trailer line gets the
  // list-item indent plus 4 columns, the canonical layout `markspec fmt`
  // writes.
  const target = diag.range.start.line;
  const block = markdownTrailerBlock(doc, target);
  if (!block || target < block.range.start) return undefined;
  const { range, indent } = block;
  const { lines } = doc;
  // A continuation line cannot be re-indented without changing its
  // meaning, and fmt leaves such a trailer as it is (MSL-P021).
  for (let i = range.start; i < range.end; i++) {
    if (!/^[A-Z][A-Za-z-]*:/.test(lines[i].trimStart())) return undefined;
  }
  const prefix = " ".repeat(indent + 4);
  const edits: TextEdit[] = [];
  for (let i = range.start; i < range.end; i++) {
    const lead = lines[i].length - lines[i].trimStart().length;
    if (lines[i].slice(0, lead) === prefix) continue;
    edits.push({
      range: {
        start: { line: i, character: 0 },
        end: { line: i, character: lead },
      },
      newText: prefix,
    });
  }
  if (edits.length === 0) return undefined;
  return quickFix(uri, diag, "Indent trailer block", edits);
}

/**
 * Split a citation attribute value on top-level commas. Commas inside
 * `[…]` are citation locators and do not split; inside a locator, `\]` and
 * `\\` are escapes. Values are trimmed and empty values are dropped.
 */
export function splitCitationValues(raw: string): string[] {
  const values: string[] = [];
  let depth = 0;
  let current = "";
  for (let k = 0; k < raw.length; k++) {
    const ch = raw[k];
    // Inside a locator, `\]` and `\\` are escapes (#915): keep both
    // characters and do not close the locator.
    if (ch === "\\" && depth > 0 && k + 1 < raw.length) {
      current += ch + raw[++k];
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]" && depth > 0) depth--;
    if (ch === "," && depth === 0) {
      values.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values.filter((v) => v.length > 0);
}

function buildA011Fix(
  uri: string,
  diag: LspDiagnosticLike,
  doc: MarkdownDocument,
  nth: number,
): CodeAction | undefined {
  const attrKey = ATTRIBUTE_KEY_RE.exec(diag.message)?.[1];
  if (attrKey === undefined) return undefined;
  const block = markdownTrailerBlock(doc, diag.range.start.line);
  if (!block) return undefined;
  const i = findKeyLine(
    doc.lines,
    block.range,
    attrKey,
    markdownKey,
    markdownValue,
    (value) => splitCitationValues(value).length >= 2,
    nth,
  );
  if (i < 0) return undefined;
  const line = doc.lines[i];
  const indent = line.slice(0, line.length - line.trimStart().length);
  const eol = doc.crlf[i] ? "\r\n" : "\n";
  const newText = splitCitationValues(markdownValue(line) ?? "")
    .map((v) => `${indent}${attrKey}: ${v}${eol}`)
    .join("");
  return {
    title: `Rewrite '${attrKey}' as multi-line`,
    kind: "quickfix",
    diagnostics: [diag],
    isPreferred: true,
    edit: {
      changes: {
        [uri]: [{
          range: {
            start: { line: i, character: 0 },
            end: { line: i + 1, character: 0 },
          },
          newText,
        }],
      },
    },
  };
}

/** Quick fix for MSL-M060: lowercase the modal keyword at the diagnostic range. */
export function buildM060Fix(
  uri: string,
  diag: LspDiagnosticLike,
): CodeAction | undefined {
  const match = KEYWORD_RE.exec(diag.message);
  if (!match) return undefined;
  const keyword = match[1];
  const lowercase = keyword.toLowerCase();
  const startLine = diag.range.start.line;
  const startChar = diag.range.start.character;
  const edit: TextEdit = {
    range: {
      start: { line: startLine, character: startChar },
      end: { line: startLine, character: startChar + keyword.length },
    },
    newText: lowercase,
  };
  return {
    title: `Lowercase '${lowercase}'`,
    kind: "quickfix",
    diagnostics: [diag],
    isPreferred: true,
    edit: { changes: { [uri]: [edit] } },
  };
}

function buildA030Fix(
  uri: string,
  diag: LspDiagnosticLike,
  doc: MarkdownDocument,
): CodeAction | undefined {
  const attrKey = ATTRIBUTE_KEY_RE.exec(diag.message)?.[1];
  if (attrKey === undefined) return undefined;
  const block = markdownTrailerBlock(doc, diag.range.start.line);
  if (!block) return undefined;
  const i = findKeyLine(
    doc.lines,
    block.range,
    attrKey,
    markdownKey,
    markdownValue,
  );
  if (i < 0) return undefined;
  return quickFix(uri, diag, `Remove '${attrKey}' line`, [
    deleteLines(i, i + 1),
  ]);
}

function buildT020Fix(
  uri: string,
  diag: LspDiagnosticLike,
  doc: MarkdownDocument,
): CodeAction | undefined {
  const badValue = T020_VALUE_RE.exec(diag.message)?.[1];
  if (badValue === undefined) return undefined;
  const block = markdownTrailerBlock(doc, diag.range.start.line);
  if (!block) return undefined;
  const i = findKeyLine(
    doc.lines,
    block.range,
    "Type",
    markdownKey,
    markdownValue,
    (value) => value.includes(badValue),
  );
  if (i < 0) return undefined;
  return replaceTypeValue(uri, diag, doc.lines[i], i, badValue);
}

/** The "replace with the closest core type" fix for the `Type:` value
 * `badValue` on line `i`, or `undefined` when no core type is close. */
function replaceTypeValue(
  uri: string,
  diag: LspDiagnosticLike,
  line: string,
  i: number,
  badValue: string,
): CodeAction | undefined {
  const suggestion = closestCoreType(badValue);
  if (!suggestion) return undefined;
  const idx = line.indexOf(badValue, Math.max(0, line.indexOf(":")));
  if (idx < 0) return undefined;
  return {
    title: `Replace with '${suggestion}'`,
    kind: "quickfix",
    diagnostics: [diag],
    isPreferred: true,
    edit: {
      changes: {
        [uri]: [{
          range: {
            start: { line: i, character: idx },
            end: { line: i, character: idx + badValue.length },
          },
          newText: suggestion,
        }],
      },
    },
  };
}

/**
 * The 0-based file line of the first trailer attribute with `key` (and a
 * value that `accept` allows) in the source entry that the diagnostic at the
 * 0-based `line` belongs to: the entry with the last title line at or before
 * `line`. Reads `Entry.attributeLines`, so it never reaches another entry.
 * Returns -1 when no entry holds the line or no attribute qualifies.
 */
function findSourceTrailerLine(
  entries: readonly Entry[],
  line: number,
  key: string,
  accept: (value: string) => boolean = () => true,
): number {
  let owner: Entry | undefined;
  for (const entry of entries) {
    if (entry.location.line - 1 > line) continue;
    if (!owner || entry.location.line > owner.location.line) owner = entry;
  }
  const lines = owner?.attributeLines;
  if (!owner || !lines) return -1;
  const at = owner.rawAttributes.findIndex((attr, n) =>
    attr.key === key && lines[n] !== undefined && accept(attr.value)
  );
  return at < 0 ? -1 : lines[at] - 1;
}

function buildSourceA030Fix(
  uri: string,
  diag: LspDiagnosticLike,
  documentText: string,
  entries: readonly Entry[],
): CodeAction | undefined {
  const attrKey = ATTRIBUTE_KEY_RE.exec(diag.message)?.[1];
  if (attrKey === undefined) return undefined;
  const i = findSourceTrailerLine(entries, diag.range.start.line, attrKey);
  if (i < 0 || i >= splitLines(documentText).lines.length) return undefined;
  return quickFix(uri, diag, `Remove '${attrKey}' line`, [
    deleteLines(i, i + 1),
  ]);
}

function buildSourceT020Fix(
  uri: string,
  diag: LspDiagnosticLike,
  documentText: string,
  entries: readonly Entry[],
): CodeAction | undefined {
  const badValue = T020_VALUE_RE.exec(diag.message)?.[1];
  if (badValue === undefined) return undefined;
  const i = findSourceTrailerLine(
    entries,
    diag.range.start.line,
    "Type",
    (value) => value.includes(badValue),
  );
  const line = splitLines(documentText).lines[i];
  if (i < 0 || line === undefined) return undefined;
  return replaceTypeValue(uri, diag, line, i, badValue);
}

function buildA013Fix(
  uri: string,
  diag: LspDiagnosticLike,
  doc: MarkdownDocument,
): CodeAction | undefined {
  const attrKey = ATTRIBUTE_KEY_RE.exec(diag.message)?.[1];
  if (attrKey === undefined) return undefined;
  // Collect every trailer line of the diagnosed entry's block that
  // defines this attribute. Keep the first; delete the rest.
  const block = markdownTrailerBlock(doc, diag.range.start.line);
  if (!block) return undefined;
  const dupLines: number[] = [];
  for (let i = block.range.start; i < block.range.end; i++) {
    if (markdownKey(doc.lines[i]) === attrKey) dupLines.push(i);
  }
  dupLines.shift();
  if (dupLines.length === 0) return undefined;
  return quickFix(
    uri,
    diag,
    `Remove duplicate '${attrKey}' line(s)`,
    dupLines.map((i) => deleteLines(i, i + 1)),
  );
}

/** A half-open range of line indexes: `start` inclusive, `end` exclusive. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Split `text` into lines without line endings. `crlf[i]` is `true` when
 * line `i` ended with `\r\n`, so a fix can reuse the original ending.
 * The line helpers in this module and in `feature_code_actions.ts` require
 * lines without a trailing `\r`.
 */
export function splitLines(
  text: string,
): { lines: string[]; crlf: boolean[] } {
  const lines: string[] = [];
  const crlf: boolean[] = [];
  for (const raw of text.split("\n")) {
    const hasCr = raw.endsWith("\r");
    lines.push(hasCr ? raw.slice(0, -1) : raw);
    crlf.push(hasCr);
  }
  return { lines, crlf };
}

/**
 * Index of the `nth` (zero-based) line inside `block` whose trailer key is
 * `key` (as read by `keyOf`) and whose value (as read by `valueOf`) satisfies
 * `accept`, or -1. Never looks outside `block`. Shared by the Markdown and
 * the `.feature` fixes, which differ only in how a line is read.
 */
export function findKeyLine(
  lines: readonly string[],
  block: LineRange,
  key: string,
  keyOf: (line: string) => string | undefined,
  valueOf: (line: string) => string | undefined,
  accept: (value: string) => boolean = () => true,
  nth = 0,
): number {
  let seen = 0;
  for (let i = block.start; i < block.end; i++) {
    if (keyOf(lines[i]) !== key) continue;
    if (!accept(valueOf(lines[i]) ?? "")) continue;
    if (seen++ === nth) return i;
  }
  return -1;
}

/**
 * The trailer key of a Markdown line, read as the parser reads an attribute
 * line (`parseAttributeLine`). `undefined` for a line the parser skips: not
 * a `Key:` line (`Labels : x` has a space before the colon), or one with an
 * empty value.
 */
function markdownKey(line: string): string | undefined {
  const parsed = parseAttributeLine(line);
  return parsed?.value ? parsed.key : undefined;
}

/**
 * The value of a Markdown trailer line, read as the parser reads it: the
 * line is trimmed, one trailing continuation backslash is dropped, and the
 * value is trimmed.
 */
function markdownValue(line: string): string | undefined {
  return parseAttributeLine(line)?.value;
}

/** A Markdown document, split into lines and parsed once. */
interface MarkdownDocument {
  /** Lines without line endings. */
  readonly lines: string[];
  /** `true` for each line that ended with `\r\n`. */
  readonly crlf: boolean[];
  /** The parsed entries; the document is parsed on the first call. */
  readonly entries: () => ReturnType<typeof parse>;
}

/** The trailer block of one Markdown entry. */
interface MarkdownTrailerBlock {
  readonly range: LineRange;
  /** 0-based column of the `[` that opens the entry's display ID. */
  readonly indent: number;
}

/**
 * Locate the trailer block of the entry that the diagnostic at the 0-based
 * `line` belongs to: the entry with the last title line at or before `line`.
 * The block is the one the formatter and the parser agree on
 * (`findAttributeBlockRange`), so it never reaches the next entry's title
 * line. A diagnostic on the entry's title line, before the block, is
 * intended: the validator locates A011, A012 and A013 there. Returns
 * `undefined` when no entry holds the line, the entry has no trailer, or the
 * trailer ends before `line`.
 */
function markdownTrailerBlock(
  doc: MarkdownDocument,
  line: number,
): MarkdownTrailerBlock | undefined {
  let owner: ReturnType<typeof parse>[number] | undefined;
  for (const entry of doc.entries()) {
    if (entry.location.line - 1 <= line) {
      if (!owner || entry.location.line > owner.location.line) owner = entry;
    }
  }
  if (!owner) return undefined;
  const indent = doc.lines[owner.location.line - 1].indexOf("[");
  if (indent < 0) return undefined;
  // The same floor `markspec fmt` passes, so a lazy-continuation or
  // tab-led trailer gets the same block as fmt finds.
  const range = findAttributeBlockRange(
    doc.lines,
    owner.location.line,
    indent,
    owner.endLine ?? 0,
  );
  if (!range || line >= range.end) return undefined;
  return { range, indent };
}

/** A TextEdit deleting whole lines `[startLine, endLine)` (0-based),
 * including the trailing newline of the last one. */
export function deleteLines(startLine: number, endLine: number): TextEdit {
  return {
    range: {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 0 },
    },
    newText: "",
  };
}

/** Wrap `edits` on `uri` as a preferred quick fix for `diag`. */
export function quickFix(
  uri: string,
  diag: LspDiagnosticLike,
  title: string,
  edits: TextEdit[],
): CodeAction {
  return {
    title,
    kind: "quickfix",
    diagnostics: [diag],
    isPreferred: true,
    edit: { changes: { [uri]: edits } },
  };
}

/** Return the closest core type name within {@linkcode MAX_SUGGESTION_DISTANCE}
 * Levenshtein distance, or `undefined` when nothing is close enough. */
export function closestCoreType(value: string): string | undefined {
  let best: string | undefined;
  let bestDistance = MAX_SUGGESTION_DISTANCE + 1;
  for (const candidate of ALL_CORE_TYPES) {
    const d = levenshtein(value, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return bestDistance <= MAX_SUGGESTION_DISTANCE ? best : undefined;
}

function buildL010Fix(
  uri: string,
  diag: LspDiagnosticLike,
  documentText: string,
): CodeAction | undefined {
  const lines = documentText.split("\n");
  for (let i = diag.range.start.line; i < lines.length; i++) {
    if (/^\s{4,}Id\s*:/.test(lines[i])) {
      // Insert `Reference-url: <placeholder>` immediately after the
      // matching `Id:` line, with the same 6-space trailer indent the
      // formatter canonicalises to.
      return {
        title: "Add Reference-url: placeholder",
        kind: "quickfix",
        diagnostics: [diag],
        isPreferred: true,
        edit: {
          changes: {
            [uri]: [{
              range: {
                start: { line: i + 1, character: 0 },
                end: { line: i + 1, character: 0 },
              },
              newText:
                "      Reference-url: https://example.invalid/REPLACE-ME\n",
            }],
          },
        },
      };
    }
  }
  return undefined;
}

function buildS002Fix(
  uri: string,
  diag: LspDiagnosticLike,
  documentText: string,
): CodeAction | undefined {
  const lines = documentText.split("\n");
  for (let i = diag.range.start.line; i < lines.length; i++) {
    if (/^\s+locked\s*:\s*true\s*$/.test(lines[i])) {
      return {
        title: "Remove `locked: true`",
        kind: "quickfix",
        diagnostics: [diag],
        isPreferred: true,
        edit: {
          changes: {
            [uri]: [{
              range: {
                start: { line: i, character: 0 },
                end: { line: i + 1, character: 0 },
              },
              newText: "",
            }],
          },
        },
      };
    }
  }
  return undefined;
}

function buildS003Fix(
  uri: string,
  diag: LspDiagnosticLike,
  documentText: string,
): CodeAction | undefined {
  const lines = documentText.split("\n");
  for (let i = diag.range.start.line; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*default\s*:\s*)([\w-]+)\s*$/);
    if (m) {
      return {
        title: "Replace with `manual`",
        kind: "quickfix",
        diagnostics: [diag],
        isPreferred: true,
        edit: {
          changes: {
            [uri]: [{
              range: {
                start: { line: i, character: m[1].length },
                end: { line: i, character: m[1].length + m[2].length },
              },
              newText: "manual",
            }],
          },
        },
      };
    }
  }
  return undefined;
}

/** Informational stub action for MSL-S010 (see the comment in the body). */
export function buildS010Fix(
  _uri: string,
  diag: LspDiagnosticLike,
): CodeAction | undefined {
  // The "revert to upstream value" action requires reading the per-system
  // cache file under .markspec/sync/<system>/cache/, which is connector
  // territory. MVP returns an informational stub — selecting it surfaces
  // the workflow note; full implementation lands when a connector ADR
  // provides cache I/O.
  return {
    title: "Revert to upstream value (cached) — requires connector",
    kind: "quickfix",
    diagnostics: [diag],
    isPreferred: false,
    edit: { changes: {} },
  };
}

/** Iterative O(n·m) Levenshtein distance with a single row buffer. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  const curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr[0]] = [curr.slice(), 0];
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}
