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
 * a lost entry, a changed title or trailer), the edit is refused.
 *
 * The body range is the lines after the title paragraph (up to the first
 * blank line after the title line, so a soft-wrapped title is skipped) and
 * before the attribute block (or the item end when there is no attribute
 * block), without surrounding blank lines. The body indent is the list
 * marker column plus two, as in the formatter.
 *
 * Pure: no I/O, Node-compatible.
 */

import type { Entry } from "../model/mod.ts";
import { parseFile } from "../parser/mod.ts";
import { findAttributeBlockRange, findItemEnd } from "./mod.ts";

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
}

/** Remove one trailing `\r` (the CR of a CRLF ending). */
function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/**
 * Locate the body of `entry` in `lines` (split on `\n`, CR removed).
 * `start === end` when the entry has no body.
 */
function bodySpan(lines: readonly string[], entry: Entry): BodySpan {
  const indent = (entry.location.column - 1) + 2;
  const titleIdx = entry.location.line - 1;
  const attrs = findAttributeBlockRange(lines, entry.location.line, indent);
  let end = attrs ? attrs.start : findItemEnd(lines, titleIdx, indent);
  const isBlank = (i: number) => lines[i].trim() === "";
  while (end > titleIdx + 1 && isBlank(end - 1)) end--;
  let start = titleIdx + 1;
  // Skip the rest of the title paragraph (a soft-wrapped title).
  while (start < end && !isBlank(start)) start++;
  while (start < end && isBlank(start)) start++;
  if (start >= end) return { start: end, end, indent };
  return { start, end, indent };
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
 * `.md` file.
 */
export async function readEntryBody(
  text: string,
  file: string,
  displayId: string,
): Promise<string | undefined> {
  const { entry } = await locate(text, file, displayId);
  if (!entry) return undefined;
  const lines = text.split("\n").map(stripCr);
  const span = bodySpan(lines, entry);
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
 * unchanged. Inserted lines take the line ending of the title line.
 *
 * Refusals: `entry-not-found` (no such entry), `body-empty` (the entry
 * has no body), `proposal-empty` (`body` is blank), `entries-changed`
 * (the edited text no longer parses to the same entries, with the same
 * title and trailer for the target, or the parse raises a structural
 * diagnostic, such as MSL-P020, that the original text did not raise).
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
  const rawLines = text.split("\n");
  const lines = rawLines.map(stripCr);
  const span = bodySpan(lines, entry);
  if (span.start === span.end) return { ok: false, refusal: "body-empty" };

  const proposal = body.replace(/\r\n/g, "\n").split("\n");
  while (proposal.length > 0 && proposal[0].trim() === "") proposal.shift();
  while (proposal.length > 0 && proposal[proposal.length - 1].trim() === "") {
    proposal.pop();
  }
  if (proposal.length === 0) return { ok: false, refusal: "proposal-empty" };

  const titleIdx = entry.location.line - 1;
  const eol = rawLines[titleIdx].endsWith("\r") ? "\r" : "";
  const indentStr = " ".repeat(span.indent);
  const inserted = proposal.map((l) =>
    (l.trim() === "" ? "" : indentStr + l) + eol
  );
  // The final line of the file has no `\n` after it; keep its own ending
  // when the body reaches it.
  if (span.end === rawLines.length) {
    const lastOld = rawLines[span.end - 1];
    const last = inserted.length - 1;
    inserted[last] = stripCr(inserted[last]) +
      (lastOld.endsWith("\r") ? "\r" : "");
  }
  const edited = [
    ...rawLines.slice(0, span.start),
    ...inserted,
    ...rawLines.slice(span.end),
  ].join("\n");

  const after = await locate(edited, file, displayId);
  if (
    !sameEntries(before.entries, after.entries, entry, after.entry) ||
    addsParseDiagnostic(before.diagnosticCodes, after.diagnosticCodes)
  ) {
    return { ok: false, refusal: "entries-changed" };
  }
  return { ok: true, text: edited };
}

/**
 * Identity check: same entry count; per index, same display ID and Id;
 * for the target, also the same title and the same trailer attributes.
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
 * the splice do not count as new. This catches a body that holds a
 * trailer-like line or an entry-shaped list item (MSL-P020), which the
 * parser keeps as body text and the entry comparison alone cannot see.
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
