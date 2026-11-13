/**
 * @module core/formatter/feature_file
 *
 * Write-back for `.feature` files (epic #915, Case B). The only change
 * `fmt` makes is to insert a missing `# Id: <ULID>` line into the header
 * comment of a headed entry. Gherkin text, other comments and line endings
 * stay as they are. The Markdown entry formatter and the ADR-029 prose pass
 * never run on `.feature` text.
 */

import { ulid as defaultUlid } from "@std/ulid";
import type { Entry } from "../model/mod.ts";
import { parseFile } from "../parser/mod.ts";
import { FEATURE_HEADER_START_RE as HEADER_START_RE } from "../parser/feature_file.ts";
import {
  applyLineEnding,
  detectLineEnding,
  normalizeLineEndings,
} from "../util/line_endings.ts";

const LANGUAGE_RE = /^\s*#\s*language\s*:/;
/** Leading whitespace, `#`, and the spaces after it. */
const COMMENT_PREFIX_RE = /^(\s*#[ \t]*)/;

/** Result of {@linkcode formatFeatureFile}. */
export interface FeatureFormatResult {
  readonly output: string;
  readonly changed: boolean;
}

/** `true` when `line` is a comment line. */
function isComment(line: string | undefined): boolean {
  return line !== undefined && line.trimStart().startsWith("#");
}

/**
 * Insert a missing `# Id: <ULID>` line into the header of each entry of a
 * `.feature` file.
 *
 * The line goes before the first trailer line, with that line's comment
 * prefix, so it matches the header's indentation and trailer spacing. A
 * header without a trailer gets a `#` line (unless its last line is already
 * an empty comment) and then the Id line, at the end of the header. An entry
 * that has an Id, and every other part of the file, is left unchanged.
 *
 * @param text - The file text (LF or CRLF).
 * @param entries - The entries parsed from `text`.
 * @param generateUlid - ULID generator.
 */
export function formatFeatureFile(
  text: string,
  entries: readonly Entry[],
  generateUlid: () => string = defaultUlid,
): FeatureFormatResult {
  const ending = detectLineEnding(text);
  const lines = normalizeLineEndings(text).split("\n");
  const missing = entries
    .filter((e) =>
      e.source.kind === "feature-file" && e.id === undefined &&
      e.shape === "Authored"
    )
    .sort((a, b) => b.location.line - a.location.line);
  if (missing.length === 0) return { output: text, changed: false };

  let changed = false;
  for (const entry of missing) {
    const titleIdx = entry.location.line - 1;
    if (!isComment(lines[titleIdx])) continue;
    // End of the header run: consecutive comment lines, up to the next
    // header start or a `# language:` line.
    let endIdx = titleIdx;
    while (isComment(lines[endIdx + 1])) {
      const next = lines[endIdx + 1];
      const nextText = next.trimStart().slice(1).trimStart();
      if (HEADER_START_RE.test(nextText) || LANGUAGE_RE.test(next)) break;
      endIdx++;
    }
    const firstTrailer = entry.attributeLines?.[0];
    const trailerIdx = firstTrailer === undefined
      ? undefined
      : firstTrailer - 1;
    if (
      trailerIdx !== undefined && trailerIdx > titleIdx &&
      trailerIdx <= endIdx
    ) {
      const prefix = COMMENT_PREFIX_RE.exec(lines[trailerIdx])![1];
      lines.splice(trailerIdx, 0, `${prefix}Id: ${generateUlid()}`);
    } else {
      const indent = /^\s*/.exec(lines[titleIdx])![0];
      const added: string[] = [];
      if (lines[endIdx].trim() !== "#") added.push(`${indent}#`);
      added.push(`${indent}# Id: ${generateUlid()}`);
      lines.splice(endIdx + 1, 0, ...added);
    }
    changed = true;
  }
  if (!changed) return { output: text, changed: false };
  return {
    output: applyLineEnding(lines.join("\n"), ending),
    changed: true,
  };
}

/**
 * Parse a `.feature` file and stamp the missing Ids of its entries. A file
 * that does not parse has no entries, so it comes back unchanged.
 *
 * @param text - The file text.
 * @param file - File path, used for parsing and diagnostics.
 * @param generateUlid - ULID generator.
 */
export async function formatFeatureText(
  text: string,
  file: string,
  generateUlid: () => string = defaultUlid,
): Promise<FeatureFormatResult> {
  const { entries } = await parseFile(text, { file });
  return formatFeatureFile(text, entries, generateUlid);
}
