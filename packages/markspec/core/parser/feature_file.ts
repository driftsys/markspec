/**
 * @module core/parser/feature_file
 *
 * Reads `.feature` files as MarkSpec sources. A header is a run of comment
 * lines that starts with `# [ID] Title` and sits directly above a Gherkin
 * node, optionally with tag lines in between.
 */

import type {
  Background,
  GherkinDocument,
  Scenario,
  Step,
} from "@cucumber/messages";
import type { Diagnostic, Entry } from "../model/mod.ts";
import { parseMarkdown } from "./markdown.ts";
import { buildBlockLineMap } from "./line_map.ts";
import { wrapAsListItem } from "./source.ts";

/** The kind of Gherkin node a header sits above. */
export type FeatureNodeKind =
  | "feature"
  | "rule"
  | "background"
  | "scenario"
  | "examples"
  | "step";

/** One header comment block of a `.feature` file. */
export interface FeatureHeader {
  /**
   * The kind of node the header sits above, or `undefined` when it is not
   * directly above a node (an orphan header).
   */
  readonly kind: FeatureNodeKind | undefined;
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
   * including the removed `#` and spaces. File column = width + offset + 1.
   */
  readonly prefixWidths: readonly number[];
}

const LANGUAGE_RE = /^\s*#\s*language\s*:/;
const HEADER_START_RE = /^\[[^\]]+\]\s/;

/** File line of every node keyword a header may head, with its kind. */
function nodeKinds(document: GherkinDocument): Map<number, FeatureNodeKind> {
  const kinds = new Map<number, FeatureNodeKind>();
  const feature = document.feature;
  if (!feature) return kinds;
  kinds.set(feature.location.line, "feature");
  const addSteps = (steps: readonly Step[]) => {
    for (const step of steps) kinds.set(step.location.line, "step");
  };
  const addScenario = (scenario: Scenario) => {
    kinds.set(scenario.location.line, "scenario");
    addSteps(scenario.steps);
    for (const examples of scenario.examples) {
      kinds.set(examples.location.line, "examples");
    }
  };
  const addBackground = (background: Background) => {
    kinds.set(background.location.line, "background");
    addSteps(background.steps);
  };
  for (const child of feature.children) {
    if (child.background) addBackground(child.background);
    if (child.scenario) addScenario(child.scenario);
    if (child.rule) {
      kinds.set(child.rule.location.line, "rule");
      for (const ruleChild of child.rule.children) {
        if (ruleChild.background) addBackground(ruleChild.background);
        if (ruleChild.scenario) addScenario(ruleChild.scenario);
      }
    }
  }
  return kinds;
}

/**
 * Find the header comment blocks of a parsed `.feature` file.
 *
 * A comment line whose text starts with `[ID] ` starts a new header, so
 * stacked headers are separate. The result is keyed by the file line of the
 * node keyword that a header sits above. A header that is not directly above
 * a node (only tag lines and plain comments may stand between; a blank line,
 * another header or any other line breaks the link) has `kind: undefined`
 * and is keyed by its own first line, so a caller can report it. The two
 * kinds of key never collide, because a node line is not a comment line.
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
  const nodes = nodeKinds(document);
  const commentLines = new Set(document.comments.map((c) => c.location.line));

  // The text of a comment line without the `#` and the spaces after it.
  const headerText = (raw: string) => raw.trimStart().slice(1).trimStart();

  // Group comments into runs of consecutive lines. A `# language:` line is
  // never part of a run; a header-start line begins a new run.
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
    const startsHeader = HEADER_START_RE.test(headerText(raw));
    if (
      last && last.length > 0 && !startsHeader &&
      last[last.length - 1].line + 1 === entry.line
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
    run.forEach((c, i) => {
      const indent = c.text.length - c.text.trimStart().length;
      const afterHash = c.text.slice(indent + 1);
      // The first line drops all spaces after `#`; later lines keep any
      // extra indent, because it can be part of the body.
      const spaces = i === 0
        ? afterHash.length - afterHash.trimStart().length
        : afterHash.startsWith(" ")
        ? 1
        : 0;
      lines.push(afterHash.slice(spaces));
      prefixWidths.push(indent + 1 + spaces);
    });
    if (!HEADER_START_RE.test(lines[0])) continue;
    const startLine = run[0].line;
    const endLine = run[run.length - 1].line;
    // The node follows the run, past tag lines and plain comments.
    let next = endLine + 1;
    for (;;) {
      const line = fileLines[next - 1];
      if (line === undefined) break;
      if (line.trim().startsWith("@")) {
        next++;
      } else if (commentLines.has(next)) {
        if (HEADER_START_RE.test(headerText(line))) break;
        next++;
      } else break;
    }
    const kind = nodes.get(next);
    const header = {
      kind,
      startLine,
      endLine,
      column: run[0].column,
      lines,
      prefixWidths,
    };
    result.set(kind ? next : startLine, header);
  }
  return result;
}

/** Diagnostics that do not apply to a `.feature` header. */
const IGNORED_CODES: ReadonlySet<string> = new Set([
  // Git-style (unindented) trailers are canonical in a header.
  "MSL-P023",
  // The body may come from the Gherkin node description, added later.
  "MSL-P030",
]);

/**
 * Turn one header into an entry whose positions are file-relative.
 *
 * The header lines are wrapped as a Markdown list item and parsed like a
 * source doc comment. A trailer in git style (no indent) is canonical in a
 * `.feature` header, so the Markdown-only MSL-P023 warning is dropped. An
 * empty body is not an error here: the node description can supply it.
 * A header that is only a title still gives an entry, with an empty body.
 * The result has no entry when the header text does not form one.
 *
 * @param header - A header found by {@linkcode findHeaders}.
 * @param file - File path used in locations.
 */
export function headerEntry(
  header: FeatureHeader,
  file: string,
): { entry?: Entry; diagnostics: Diagnostic[] } {
  const lineMap = buildBlockLineMap({
    startLine: header.startLine,
    startColumn: header.column,
    prefixWidths: header.prefixWidths,
  });
  const parse = (lines: readonly string[]) =>
    parseMarkdown(wrapAsListItem([...lines]), { file, lineMap });
  let { entries, diagnostics } = parse(header.lines);
  let entry = entries[0];
  if (!entry && header.lines.length === 1) {
    // The parser admits a title-only item only as a reference. Parse with a
    // placeholder body paragraph, then remove it again.
    const padded = parse([...header.lines, "", "x"]);
    diagnostics = padded.diagnostics;
    if (padded.entries[0]) {
      entry = {
        ...padded.entries[0],
        body: "",
        bodyAst: [],
        bodyTokens: [],
        bodyStartLine: undefined,
        endLine: header.endLine,
      };
    }
  }
  return {
    entry,
    diagnostics: diagnostics.filter((d) => !IGNORED_CODES.has(d.code)),
  };
}
