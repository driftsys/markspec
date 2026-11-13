/**
 * @module core/parser/feature_file
 *
 * Reads `.feature` files as MarkSpec sources. A header is a run of comment
 * lines that starts with `# [ID] Title` and sits directly above a Gherkin
 * node, optionally with tag lines in between.
 */

import type { GherkinDocument } from "@cucumber/messages";

/** One header comment block of a `.feature` file. */
export interface FeatureHeader {
  /** 1-based file line of the first comment line. */
  readonly startLine: number;
  /** 1-based file line of the last comment line. */
  readonly endLine: number;
  /** 1-based column of the `#` on the first comment line. */
  readonly column: number;
  /** Comment lines with the `#` and one following space removed. */
  readonly lines: readonly string[];
  /**
   * For each line, the number of characters from the line start up to and
   * including the removed `#` and space. File column = width + offset + 1.
   */
  readonly prefixWidths: readonly number[];
}

const LANGUAGE_RE = /^\s*#\s*language\s*:/;
const HEADER_START_RE = /^\[[^\]]+\]\s/;

/** File lines of every node keyword a header may head. */
function nodeLines(document: GherkinDocument): Set<number> {
  const lines = new Set<number>();
  const feature = document.feature;
  if (!feature) return lines;
  lines.add(feature.location.line);
  const addScenario = (
    scenario: NonNullable<
      typeof feature.children[number]["scenario"]
    >,
  ) => {
    lines.add(scenario.location.line);
    for (const examples of scenario.examples) {
      lines.add(examples.location.line);
    }
  };
  for (const child of feature.children) {
    if (child.background) lines.add(child.background.location.line);
    if (child.scenario) addScenario(child.scenario);
    if (child.rule) {
      lines.add(child.rule.location.line);
      for (const ruleChild of child.rule.children) {
        if (ruleChild.background) lines.add(ruleChild.background.location.line);
        if (ruleChild.scenario) addScenario(ruleChild.scenario);
      }
    }
  }
  return lines;
}

/**
 * Find the header comment blocks of a parsed `.feature` file, keyed by the
 * file line of the node keyword each one heads.
 *
 * @param document - The parsed Gherkin document of `text`.
 * @param text - The file text. Line endings may be LF or CRLF.
 */
export function findHeaders(
  document: GherkinDocument,
  text: string,
): Map<number, FeatureHeader> {
  const result = new Map<number, FeatureHeader>();
  const fileLines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const nodes = nodeLines(document);

  // Group comments into runs of consecutive lines. A `# language:` line is
  // never part of a run.
  const runs: { line: number; column: number; text: string }[][] = [];
  for (const comment of document.comments) {
    const raw = comment.text.replace(/\r$/, "");
    if (LANGUAGE_RE.test(raw)) {
      runs.push([]);
      continue;
    }
    const entry = {
      line: comment.location.line,
      // The parser reports column 1 for comments; use the real `#` column.
      column: raw.length - raw.trimStart().length + 1,
      text: raw,
    };
    const last = runs[runs.length - 1];
    if (
      last && last.length > 0 && last[last.length - 1].line + 1 === entry.line
    ) {
      last.push(entry);
    } else {
      runs.push([entry]);
    }
  }

  for (const run of runs) {
    if (run.length === 0) continue;
    const lines: string[] = [];
    const prefixWidths: number[] = [];
    for (const c of run) {
      const indent = c.text.length - c.text.trimStart().length;
      const afterHash = c.text.slice(indent + 1);
      const spaces = afterHash.startsWith(" ") ? 1 : 0;
      lines.push(afterHash.slice(spaces));
      prefixWidths.push(indent + 1 + spaces);
    }
    if (!HEADER_START_RE.test(lines[0])) continue;
    // The node follows the run, past any tag lines.
    let next = run[run.length - 1].line + 1;
    while (fileLines[next - 1]?.trim().startsWith("@")) next++;
    if (!nodes.has(next)) continue;
    result.set(next, {
      startLine: run[0].line,
      endLine: run[run.length - 1].line,
      column: run[0].column,
      lines,
      prefixWidths,
    });
  }
  return result;
}
