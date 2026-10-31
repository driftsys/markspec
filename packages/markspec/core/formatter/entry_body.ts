/**
 * @module formatter/entry_body
 *
 * Read and replace the body of one entry in a Markdown file text.
 *
 * Splice-only contract: {@linkcode replaceEntryBody} changes only the
 * lines of the target entry's body. Every other line of the file (other
 * entries, prose, front matter, the title, the trailer block, and each
 * line's own line ending) stays byte-for-byte unchanged. After the splice
 * the text is parsed again; when the set of entries differs (a new entry,
 * a lost entry, a changed title or trailer) or the target's body is not
 * the proposal, the edit is refused.
 *
 * The body range starts after the title paragraph (up to the first blank
 * line after the title line, so a soft-wrapped title is skipped) and the
 * blank lines after it. It has as many lines as the parser's
 * `entry.body`, so lazy continuation lines are included, and it must
 * match that body line for line. The body indent is the list marker
 * column plus two, as in the formatter. Lines are split on `\r\n`, a
 * lone `\r`, or `\n`, as in the parser.
 *
 * Pure: no I/O, Node-compatible.
 */

import type { Entry } from "../model/mod.ts";
import { parseFile } from "../parser/mod.ts";

/** Why {@linkcode replaceEntryBody} refused an edit. */
export type EntryBodyRefusal =
  | "entry-not-found"
  | "body-empty"
  | "proposal-empty"
  | "entries-changed";

/** Result of {@linkcode replaceEntryBody}. */
export type EntryBodyEdit =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly refusal: EntryBodyRefusal };

/** 0-based line range `[start, end)` of a body, with its indent. */
interface BodySpan {
  readonly start: number;
  readonly end: number;
  readonly indent: number;
  /** False when the span does not match the parser's body exactly. */
  readonly exact: boolean;
}

/** Lines of a text with the line ending that follows each line. */
interface SplitText {
  /** Line contents, without line endings. */
  readonly lines: readonly string[];
  /** Ending after each line: `"\r\n"`, `"\r"`, `"\n"`, or `""` (last line). */
  readonly endings: readonly string[];
}

/**
 * Split `text` into lines on `\r\n`, a lone `\r`, or `\n`, the same rule
 * the parser uses to normalize line endings, so line indexes agree with
 * parser line numbers. Each line keeps its own ending.
 */
function splitText(text: string): SplitText {
  const lines: string[] = [];
  const endings: string[] = [];
  const re = /\r\n|\r|\n/g;
  let from = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    lines.push(text.slice(from, m.index));
    endings.push(m[0]);
    from = m.index + m[0].length;
  }
  lines.push(text.slice(from));
  endings.push("");
  return { lines, endings };
}

/** Lines of `text` with trailing whitespace removed, for comparisons. */
function trimmedLines(text: string): string[] {
  return text.split("\n").map((l) => l.trimEnd());
}

/**
 * Locate the body of `entry` in `lines`. `start === end` when the entry
 * has no body.
 *
 * The body starts after the title paragraph and the blank lines that
 * follow it. Its length is the line count of the parser's `entry.body`,
 * so a lazy continuation line (a body line indented less than the body
 * indent) is part of the span. `exact` is false when the dedented span
 * does not match `entry.body` line for line (trailing whitespace
 * ignored); the span is then not reliable and must not be edited.
 */
function bodySpan(lines: readonly string[], entry: Entry): BodySpan {
  const indent = (entry.location.column - 1) + 2;
  const titleIdx = entry.location.line - 1;
  const isBlank = (i: number) => lines[i].trim() === "";
  let start = titleIdx + 1;
  // Skip the rest of the title paragraph (a soft-wrapped title).
  while (start < lines.length && !isBlank(start)) start++;
  while (start < lines.length && isBlank(start)) start++;
  if (entry.body === "") return { start, end: start, indent, exact: true };
  const expected = trimmedLines(entry.body);
  const end = Math.min(start + expected.length, lines.length);
  const actual = spanText(lines, { start, end, indent, exact: true });
  const exact = actual.join("\n") === expected.join("\n");
  return { start, end, indent, exact };
}

/** Dedented span lines, trailing whitespace removed. */
function spanText(lines: readonly string[], span: BodySpan): string[] {
  return lines.slice(span.start, span.end)
    .map((l) => l.trim() === "" ? "" : dedent(l, span.indent).trimEnd());
}

/** Parse `text` and find the entry named `displayId`. */
async function locate(
  text: string,
  file: string,
  displayId: string,
): Promise<
  {
    entries: readonly Entry[];
    entry: Entry | undefined;
    diagnosticCodes: readonly string[];
  }
> {
  const { entries, diagnostics } = await parseFile(text, { file });
  const entry = entries.find((e) => e.displayId === displayId);
  return { entries, entry, diagnosticCodes: diagnostics.map((d) => d.code) };
}

/**
 * Body of the entry `displayId` as written in `text`: dedented, LF line
 * endings, no surrounding blank lines. Returns `""` when the entry has no
 * body and `undefined` when no entry has `displayId`. `file` names a
 * `.md` file. When the body lines cannot be located exactly in `text`,
 * the parser's body is returned (and {@linkcode replaceEntryBody}
 * refuses to edit that entry).
 */
export async function readEntryBody(
  text: string,
  file: string,
  displayId: string,
): Promise<string | undefined> {
  const { entry } = await locate(text, file, displayId);
  if (!entry) return undefined;
  const { lines } = splitText(text);
  const span = bodySpan(lines, entry);
  if (!span.exact) return entry.body;
  return lines.slice(span.start, span.end)
    .map((l) => l.trim() === "" ? "" : dedent(l, span.indent))
    .join("\n");
}

/** Remove up to `indent` leading spaces. */
function dedent(line: string, indent: number): string {
  let i = 0;
  while (i < indent && line[i] === " ") i++;
  return line.slice(i);
}

/**
 * Return `text` with the body of entry `displayId` replaced by `body`,
 * re-indented to the body indent. Every other line stays byte-for-byte
 * unchanged. Inserted lines take the line ending of the title line. In
 * `body`, `\r\n` and a lone `\r` count as line breaks.
 *
 * Refusals: `entry-not-found` (no such entry), `body-empty` (the entry
 * has no body), `proposal-empty` (`body` is blank), `entries-changed`
 * (the body lines cannot be located exactly in `text`; or the edited
 * text no longer parses to the same entries, with the same title and
 * trailer for the target, and with the proposal as the target's body;
 * or the parse raises more structural diagnostics of some code, such as
 * MSL-P020, than the original text).
 */
export async function replaceEntryBody(
  text: string,
  file: string,
  displayId: string,
  body: string,
): Promise<EntryBodyEdit> {
  const before = await locate(text, file, displayId);
  const entry = before.entry;
  if (!entry) return { ok: false, refusal: "entry-not-found" };
  const { lines, endings } = splitText(text);
  const span = bodySpan(lines, entry);
  if (span.start === span.end) return { ok: false, refusal: "body-empty" };
  if (!span.exact) return { ok: false, refusal: "entries-changed" };

  const proposal = body.replace(/\r\n?/g, "\n").split("\n");
  while (proposal.length > 0 && proposal[0].trim() === "") proposal.shift();
  while (proposal.length > 0 && proposal[proposal.length - 1].trim() === "") {
    proposal.pop();
  }
  if (proposal.length === 0) return { ok: false, refusal: "proposal-empty" };

  const titleIdx = entry.location.line - 1;
  const eol = endings[titleIdx];
  const indentStr = " ".repeat(span.indent);
  const inserted = proposal.map((l) =>
    (l.trim() === "" ? "" : indentStr + l) + eol
  );
  // The final line of the file has no ending after it; keep the old
  // ending of the last body line when the body reaches the file end.
  if (span.end === lines.length) {
    const last = inserted.length - 1;
    inserted[last] = indentStr + proposal[last] + endings[span.end - 1];
  }
  const keep = (from: number, to: number) => {
    let out = "";
    for (let i = from; i < to; i++) out += lines[i] + endings[i];
    return out;
  };
  const edited = keep(0, span.start) + inserted.join("") +
    keep(span.end, lines.length);

  const after = await locate(edited, file, displayId);
  if (
    !sameEntries(before.entries, after.entries, entry, after.entry) ||
    addsParseDiagnostic(before.diagnosticCodes, after.diagnosticCodes) ||
    trimmedLines(after.entry?.body ?? "").join("\n") !==
      proposal.map((l) => l.trimEnd()).join("\n")
  ) {
    return { ok: false, refusal: "entries-changed" };
  }
  return { ok: true, text: edited };
}

/**
 * Identity check: same entry count; per index, same display ID and Id;
 * for the target, also the same title and the same trailer attributes.
 * No known body edit changes an Id or the target's trailer without also
 * raising a parse diagnostic, so those comparisons are a second safety
 * check behind {@linkcode addsParseDiagnostic}.
 */
function sameEntries(
  before: readonly Entry[],
  after: readonly Entry[],
  target: Entry,
  targetAfter: Entry | undefined,
): boolean {
  if (before.length !== after.length || !targetAfter) return false;
  for (let i = 0; i < before.length; i++) {
    if (before[i].displayId !== after[i].displayId) return false;
    if (before[i].id !== after[i].id) return false;
  }
  if (target.title !== targetAfter.title) return false;
  const a = target.rawAttributes;
  const b = targetAfter.rawAttributes;
  if (a.length !== b.length) return false;
  return a.every((attr, i) =>
    attr.key === b[i].key && attr.value === b[i].value
  );
}

/**
 * True when `after` holds more diagnostics of some code than `before`.
 * Counts per code, not messages, so diagnostics whose location moved with
 * the splice do not count as new. This catches a body with a trailer-like
 * line or an entry-shaped list item after a blank line (MSL-P020), which
 * the parser keeps as body text and the entry comparison alone cannot
 * see. An entry-shaped item directly after a paragraph line, with no
 * blank line between them, raises no diagnostic; the parser keeps it as
 * body text and adds no entry, so the edit is accepted.
 */
function addsParseDiagnostic(
  before: readonly string[],
  after: readonly string[],
): boolean {
  const counts = new Map<string, number>();
  for (const code of before) counts.set(code, (counts.get(code) ?? 0) + 1);
  for (const code of after) {
    const left = (counts.get(code) ?? 0) - 1;
    if (left < 0) return true;
    counts.set(code, left);
  }
  return false;
}
