/**
 * @module core/gherkin/parse
 *
 * Wraps, parses and normalizes one Gherkin block into a {@linkcode FeatureAst}.
 * The function is pure: it takes the loaded parser as an argument.
 */

import type {
  Background,
  Examples,
  GherkinDocument,
  Scenario,
  Step,
} from "@cucumber/messages";
import type { GherkinApi } from "./load.ts";
import type {
  ExamplesAst,
  FeatureParse,
  ScenarioAst,
  SectionAst,
  StepAst,
  StepKeyword,
} from "./types.ts";

const LANGUAGE_RE = /^\s*#\s*language\s*:\s*([A-Za-z-]+)\s*$/;

// `keywordType` values of `StepKeywordType` in `@cucumber/messages`.
const KEYWORD_BY_TYPE: Record<string, StepKeyword> = {
  Context: "given",
  Action: "when",
  Outcome: "then",
  Unknown: "step",
};

/** Where and how the synthetic Feature line was added. */
interface Wrap {
  readonly text: string;
  readonly language: string;
  /** 1-based line of the synthetic line, or 0 when none was added. */
  readonly syntheticLine: number;
}

function wrapSource(api: GherkinApi, source: string): Wrap {
  const lines = source.split("\n");
  // The language comment may follow blank or comment lines, as in the parser.
  let start = 0;
  let language = "en";
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed !== "" && !trimmed.startsWith("#")) break;
    const match = LANGUAGE_RE.exec(lines[i].replace(/\r$/, ""));
    if (match) {
      language = match[1];
      start = i + 1;
      break;
    }
  }
  const featureWords = api.dialects[language]?.feature ?? ["Feature"];
  for (let i = start; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (
      trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("@")
    ) continue;
    if (featureWords.some((word) => trimmed.startsWith(`${word}:`))) {
      return { text: source, language, syntheticLine: 0 };
    }
    break;
  }
  const synthetic = `${featureWords[0]}:`;
  const wrapped = [...lines.slice(0, start), synthetic, ...lines.slice(start)];
  return {
    text: wrapped.join("\n"),
    language,
    syntheticLine: start + 1,
  };
}

/** Parse and normalize one Gherkin block. */
export function parseFeature(api: GherkinApi, source: string): FeatureParse {
  const wrap = wrapSource(api, source);
  const shift = (line: number): number =>
    wrap.syntheticLine > 0 && line > wrap.syntheticLine ? line - 1 : line;
  let document: GherkinDocument;
  try {
    document = api.parse(wrap.text);
  } catch (err) {
    const first = (err as { errors?: { location?: Loc; message?: string }[] })
      .errors?.[0];
    const location = first?.location;
    return {
      ok: false,
      line: location ? Math.max(1, shift(location.line)) : 1,
      column: location?.column ?? 1,
      message: first?.message ??
        (err instanceof Error ? err.message : String(err)),
    };
  }
  const parsed = document.feature;
  if (!parsed) {
    return {
      ok: false,
      line: 1,
      column: 1,
      message: "no Feature found in the Gherkin block",
    };
  }

  const sourceLines = source.split("\n");
  // Exclusive end column of a source line, after trailing whitespace.
  const lineEnd = (line: number): number =>
    (sourceLines[line - 1] ?? "").trimEnd().length + 1;
  const sections: SectionAst[] = [];
  const synthetic = wrap.syntheticLine > 0;
  const section = (keyword: string, at: Loc) => {
    const line = shift(at.line);
    const column = at.column ?? 1;
    sections.push({
      keyword,
      range: {
        start: { line, column },
        end: { line, column: column + keyword.length + 1 },
      },
    });
  };
  if (!synthetic) section(parsed.keyword, parsed.location);

  const step = (s: Step): StepAst => {
    const keyword = s.keyword.trimEnd();
    const startLine = shift(s.location.line);
    const column = s.location.column ?? 1;
    let endLine = startLine;
    let endColumn = column + s.keyword.length + s.text.length;
    if (s.docString) {
      const contentLines = s.docString.content === ""
        ? 0
        : s.docString.content.split("\n").length;
      endLine = shift(s.docString.location.line) + contentLines + 1;
      endColumn = lineEnd(endLine);
    }
    if (s.dataTable) {
      const last = s.dataTable.rows[s.dataTable.rows.length - 1];
      if (last) {
        endLine = shift(last.location.line);
        endColumn = lineEnd(endLine);
      }
    }
    return {
      keyword,
      normalized: normalizeStep(api, wrap.language, s),
      text: s.text,
      ...(s.docString
        ? {
          docString: {
            ...(s.docString.mediaType
              ? { mediaType: s.docString.mediaType }
              : {}),
            content: s.docString.content,
          },
        }
        : {}),
      ...(s.dataTable
        ? {
          dataTable: s.dataTable.rows.map((r) => r.cells.map((c) => c.value)),
        }
        : {}),
      range: {
        start: { line: startLine, column },
        end: { line: endLine, column: endColumn },
      },
    };
  };

  const examples = (e: Examples): ExamplesAst => {
    section(e.keyword, e.location);
    const rows = e.tableBody;
    const lastRow = rows[rows.length - 1] ?? e.tableHeader;
    const start = shift(e.location.line);
    return {
      name: e.name.trim(),
      keyword: e.keyword,
      tags: e.tags.map((t) => t.name),
      header: e.tableHeader?.cells.map((c) => c.value) ?? [],
      rows: rows.map((r) => r.cells.map((c) => c.value)),
      range: {
        start: { line: start, column: e.location.column ?? 1 },
        end: lastRow
          ? {
            line: shift(lastRow.location.line),
            column: lineEnd(shift(lastRow.location.line)),
          }
          : {
            line: start,
            column: (e.location.column ?? 1) + e.keyword.length + 1,
          },
      },
    };
  };

  const scenarios: ScenarioAst[] = [];
  const scenario = (
    s: Scenario,
    background: readonly StepAst[],
    ruleName: string | undefined,
  ) => {
    section(s.keyword, s.location);
    const steps = s.steps.map(step);
    const exs = s.examples.map(examples);
    const start = shift(s.location.line);
    const column = s.location.column ?? 1;
    const tail = [...steps, ...exs].map((x) => x.range.end);
    const end = tail.length > 0
      ? tail.reduce((a, b) =>
        b.line > a.line || (b.line === a.line && b.column > a.column) ? b : a
      )
      : { line: start, column: column + s.keyword.length + 1 };
    scenarios.push({
      name: s.name.trim(),
      keyword: s.keyword,
      tags: s.tags.map((t) => t.name),
      ...(ruleName !== undefined ? { ruleName } : {}),
      description: s.description,
      isOutline: s.examples.length > 0 ||
        isOutlineKeyword(api, wrap.language, s.keyword),
      background,
      steps,
      examples: exs,
      range: { start: { line: start, column }, end },
    });
  };

  const backgroundSteps = (b: Background): StepAst[] => {
    section(b.keyword, b.location);
    return b.steps.map(step);
  };

  let featureBackground: StepAst[] = [];
  for (const child of parsed.children) {
    if (child.background) {
      featureBackground = [
        ...featureBackground,
        ...backgroundSteps(child.background),
      ];
    } else if (child.scenario) {
      scenario(child.scenario, featureBackground, undefined);
    } else if (child.rule) {
      const rule = child.rule;
      section(rule.keyword, rule.location);
      let ruleBackground = featureBackground;
      for (const inner of rule.children) {
        if (inner.background) {
          ruleBackground = [
            ...ruleBackground,
            ...backgroundSteps(inner.background),
          ];
        } else if (inner.scenario) {
          scenario(inner.scenario, ruleBackground, rule.name.trim());
        }
      }
    }
  }

  return {
    ok: true,
    feature: {
      name: parsed.name.trim(),
      keyword: parsed.keyword,
      synthetic,
      language: parsed.language || wrap.language,
      description: parsed.description,
      tags: parsed.tags.map((t) => t.name),
      scenarios,
      sections,
    },
  };
}

interface Loc {
  readonly line: number;
  readonly column?: number;
}

function normalizeStep(
  api: GherkinApi,
  language: string,
  s: Step,
): StepKeyword {
  const type = s.keywordType ?? "Unknown";
  // The parser reports And and But alike as Conjunction. A dialect may use
  // one word for both; such a word counts as `but` only when it is in the
  // `but` table, so a shared word is normalized as `but`.
  if (type !== "Conjunction") return KEYWORD_BY_TYPE[type] ?? "step";
  const but = api.dialects[language]?.but ?? ["But "];
  return but.some((word) => word.trim() === s.keyword.trim()) ? "but" : "and";
}

function isOutlineKeyword(
  api: GherkinApi,
  language: string,
  keyword: string,
): boolean {
  const outline = api.dialects[language]?.scenarioOutline ?? [];
  return outline.includes(keyword);
}
