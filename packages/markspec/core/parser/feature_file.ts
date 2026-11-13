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
  Tag,
} from "@cucumber/messages";
import type { Diagnostic, Entry } from "../model/mod.ts";
import type { FeatureNode } from "../ast/nodes.ts";
import type { GherkinApi } from "../gherkin/load.ts";
import { parseFeature } from "../gherkin/parse.ts";
import { projectFeature } from "../gherkin/project.ts";
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
 * A header that is only a title still gives an entry, with an empty body
 * (`allowTitleOnly`).
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
  const { entries, diagnostics } = parseMarkdown(
    wrapAsListItem([...header.lines]),
    { file, lineMap, allowTitleOnly: true },
  );
  const entry = entries[0];
  return {
    entry,
    diagnostics: diagnostics.filter((d) => !IGNORED_CODES.has(d.code)),
  };
}

/** Node kinds that a header turns into an entry. */
type EntryNodeKind = "feature" | "rule" | "scenario";

/** A header line anywhere in a file: `# [ID] ` after optional indent. */
const HEADER_LINE_RE = /^\s*#\s*\[[^\]]+\]\s/m;

/** A child of a Feature or a Rule in the parser's document. */
type FeatureChild = NonNullable<GherkinDocument["feature"]>["children"][number];

/** One headed node of the file, with the scenarios it owns. */
interface HeadedNode {
  readonly kind: EntryNodeKind;
  readonly header: FeatureHeader;
  readonly startLine: number;
  readonly endLine: number;
  readonly description: string;
  readonly scenarios: number[];
}

/**
 * Read the entries of a `.feature` file (epic #915 Case B).
 *
 * A `Feature`, `Rule` or `Scenario` with a `# [ID] Title` header comment is
 * an entry. A scenario without a header belongs to the nearest enclosing
 * headed `Rule`, else the headed `Feature`; with no headed ancestor it is not
 * in the model. Each entry gets one `FeatureNode`: its `source` is the text
 * of the owning node's span (first tag or keyword line to its last content
 * line), its `feature` is the projected AST with ranges rebased to that
 * span, and its `range` is set so `featureFileLine` returns file lines.
 * The Gherkin description of the node is appended to the body after the
 * header prose. Tags are not labels.
 *
 * Diagnostics: the header parse diagnostics; `MSL-P030` when an entry has
 * neither header prose nor a description; `MSL-B069` (warning) for a header
 * above a Background, Examples or step, or above no node. When the file does
 * not parse, there are no entries and one `MSL-B062` warning at the parser
 * position, but only when the file has a header line, so a plain Cucumber
 * file never gets a new diagnostic.
 *
 * @param text - The file text (LF or CRLF).
 * @param options.file - File path used in locations.
 * @param options.api - The loaded Gherkin parser.
 */
export function parseFeatureFile(
  text: string,
  options: { readonly file: string; readonly api: GherkinApi },
): { entries: Entry[]; diagnostics: Diagnostic[] } {
  const { file, api } = options;
  const entries: Entry[] = [];
  const diagnostics: Diagnostic[] = [];
  const hasHeader = HEADER_LINE_RE.test(text);

  const parsed = parseFeature(api, text);
  if (!parsed.ok) {
    if (hasHeader) {
      const reason = parsed.message.split("\n")[0]
        .replace(/^\(\d+:\d+\):\s*/, "").trim();
      diagnostics.push({
        code: "MSL-B062",
        severity: "warning",
        message: `Gherkin file does not parse: ${reason}`,
        location: { file, line: parsed.line, column: parsed.column },
      });
    }
    return { entries, diagnostics };
  }
  if (!hasHeader) return { entries, diagnostics };

  const document = api.parse(text);
  const headers = findHeaders(document, text);
  for (const header of headers.values()) {
    if (
      header.kind === "feature" || header.kind === "rule" ||
      header.kind === "scenario"
    ) continue;
    const id = /^\[([^\]]+)\]/.exec(header.lines[0])?.[1] ?? "";
    diagnostics.push({
      code: "MSL-B069",
      severity: "warning",
      message: header.kind === undefined
        ? `[${id}]: a # [ID] header is not directly above a Feature, Rule ` +
          "or Scenario, so it is not an entry; remove the blank line or " +
          "other text between the header and the node"
        : `[${id}]: a # [ID] header stands above a ${header.kind}, which ` +
          "cannot be an entry; move it above a Feature, Rule or Scenario",
      location: { file, line: header.startLine, column: header.column },
    });
  }

  const feature = document.feature;
  if (!feature) return { entries, diagnostics: sortByLine(diagnostics) };

  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  // Last content line at or before `bound`, skipping blank and comment
  // lines, but never above `floor`.
  const lastContent = (bound: number, floor: number): number => {
    let line = bound;
    while (line > floor) {
      const trimmed = (lines[line - 1] ?? "").trim();
      if (trimmed !== "" && !trimmed.startsWith("#")) break;
      line--;
    }
    return line;
  };
  const firstLine = (
    node: { location: { line: number }; tags?: readonly Tag[] },
  ) =>
    Math.min(
      node.location.line,
      ...(node.tags ?? []).map((t) => t.location.line),
    );
  const headed = (line: number, kind: EntryNodeKind) => {
    const header = headers.get(line);
    return header?.kind === kind ? header : undefined;
  };

  const nodes: HeadedNode[] = [];
  const featureEnd = lastContent(lines.length, feature.location.line);
  const featureHeader = headed(feature.location.line, "feature");
  const featureNode: HeadedNode | undefined = featureHeader && {
    kind: "feature",
    header: featureHeader,
    startLine: firstLine(feature),
    endLine: featureEnd,
    description: feature.description,
    scenarios: [],
  };
  if (featureNode) nodes.push(featureNode);

  // Walk the children in the order `parseFeature` lists scenarios, so a
  // running index addresses `parsed.feature.scenarios`.
  let index = 0;
  const walk = (
    children: readonly FeatureChild[],
    bound: number,
    owner: HeadedNode | undefined,
  ) => {
    children.forEach((child, i) => {
      const next = children[i + 1];
      const nextNode = next && (next.scenario ?? next.background ?? next.rule);
      const nextStart = nextNode ? firstLine(nextNode) : bound + 1;
      if (child.scenario) {
        const scenario = child.scenario;
        const header = headed(scenario.location.line, "scenario");
        if (header) {
          nodes.push({
            kind: "scenario",
            header,
            startLine: firstLine(scenario),
            endLine: lastContent(nextStart - 1, scenario.location.line),
            description: scenario.description,
            scenarios: [index],
          });
        } else owner?.scenarios.push(index);
        index++;
      } else if (child.rule) {
        const rule = child.rule;
        const end = lastContent(nextStart - 1, rule.location.line);
        const header = headed(rule.location.line, "rule");
        const ruleNode: HeadedNode | undefined = header && {
          kind: "rule",
          header,
          startLine: firstLine(rule),
          endLine: end,
          description: rule.description,
          scenarios: [],
        };
        if (ruleNode) nodes.push(ruleNode);
        walk(rule.children, end, ruleNode ?? owner);
      }
    });
  };
  walk(feature.children, featureEnd, featureNode);

  nodes.sort((a, b) => a.header.startLine - b.header.startLine);
  for (const node of nodes) {
    const result = headerEntry(node.header, file);
    diagnostics.push(...result.diagnostics);
    const base = result.entry;
    if (!base) continue;
    const description = normalizeDescription(node.description);
    const body = [base.body, description].filter((p) => p !== "").join("\n\n");
    if (body === "" && base.shape !== "Reference") {
      diagnostics.push({
        code: "MSL-P030",
        severity: "error",
        message: `${base.displayId}: Authored entry has no body block -- ` +
          "a .feature header needs prose, or the node a description",
        location: { file, line: base.location.line, column: 1 },
      });
    }
    const bodyStart = base.bodyStartLine ?? (base.location.line + 1);
    const block: FeatureNode = {
      kind: "feature",
      source: lines.slice(node.startLine - 1, node.endLine).join("\n"),
      feature: projectFeature(parsed.feature, node.scenarios, node),
      range: {
        start: { line: node.startLine - bodyStart, column: 1 },
        end: { line: node.endLine - bodyStart + 1, column: 1 },
      },
    };
    entries.push({
      ...base,
      body,
      bodyAst: [...(base.bodyAst ?? []), block],
      source: { kind: "feature-file", node: node.kind },
    });
  }
  return { entries, diagnostics: sortByLine(diagnostics) };
}

/** Trim each description line and drop leading and trailing blank lines. */
function normalizeDescription(description: string): string {
  return description.split("\n").map((l) => l.trim()).join("\n").trim();
}

function sortByLine(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.sort((a, b) =>
    (a.location?.line ?? 0) - (b.location?.line ?? 0)
  );
}
