/**
 * @module lsp/code_actions
 *
 * Code-action builder. Walks the diagnostics the editor has on a
 * range and emits LSP `CodeAction[]` quick fixes for the ones
 * MarkSpec knows how to mechanically repair.
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
 *     first occurrence.
 *   - **MSL-A011** — citation attribute in CSV form. Action: rewrite
 *     the single CSV line as one trailer line per value (the
 *     canonical multi-line form), splitting on top-level commas.
 *   - **MSL-A012** — repeatable attribute with an empty value list.
 *     Action: remove the empty trailer line.
 *   - **MSL-L010** — lockfile reference entry has no `Reference-url:`.
 *     Action: insert a placeholder `Reference-url:` trailer line.
 *   - **MSL-S002** — sync attribute mapping has `locked: true` but
 *     direction is outbound. Action: remove the `locked: true` line.
 *   - **MSL-S003** — unknown conflict-resolution policy in sync config.
 *     Action: replace the bad value with `manual`.
 *   - **MSL-S010** — locally edited locked attribute. Action: surface
 *     an informational stub (full revert requires connector cache I/O).
 */

import { CORE_ABSTRACT_TYPES, CORE_CONCRETE_TYPES } from "../core/model/mod.ts";

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
const ATTRIBUTE_KEY_RE = /'([A-Z][A-Za-z-]*)'/;

/** Capture the bad type value inside `'…'` in an MSL-T020 message. */
const T020_VALUE_RE = /Type: '([^']+)'/;

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
 */
export function buildCodeActions(
  uri: string,
  diagnostics: readonly LspDiagnosticLike[],
  documentText?: string,
): CodeAction[] {
  const out: CodeAction[] = [];
  for (const diag of diagnostics) {
    if (diag.code === "MSL-M060") {
      const action = buildM060Fix(uri, diag);
      if (action) out.push(action);
    } else if (diag.code === "MSL-A030" && documentText !== undefined) {
      const action = buildA030Fix(uri, diag, documentText);
      if (action) out.push(action);
    } else if (diag.code === "MSL-T020" && documentText !== undefined) {
      const action = buildT020Fix(uri, diag, documentText);
      if (action) out.push(action);
    } else if (diag.code === "MSL-A013" && documentText !== undefined) {
      const action = buildA013Fix(uri, diag, documentText);
      if (action) out.push(action);
    } else if (diag.code === "MSL-A011" && documentText !== undefined) {
      const action = buildA011Fix(uri, diag, documentText);
      if (action) out.push(action);
    } else if (diag.code === "MSL-A012" && documentText !== undefined) {
      const action = buildA012Fix(uri, diag, documentText);
      if (action) out.push(action);
    } else if (diag.code === "MSL-L010" && documentText !== undefined) {
      const action = buildL010Fix(uri, diag, documentText);
      if (action) out.push(action);
    } else if (diag.code === "MSL-S002" && documentText !== undefined) {
      const action = buildS002Fix(uri, diag, documentText);
      if (action) out.push(action);
    } else if (diag.code === "MSL-S003" && documentText !== undefined) {
      const action = buildS003Fix(uri, diag, documentText);
      if (action) out.push(action);
    } else if (diag.code === "MSL-S010") {
      const action = buildS010Fix(uri, diag);
      if (action) out.push(action);
    }
  }
  return out;
}

function buildA012Fix(
  uri: string,
  diag: LspDiagnosticLike,
  documentText: string,
): CodeAction | undefined {
  const match = ATTRIBUTE_KEY_RE.exec(diag.message);
  if (!match) return undefined;
  const attrKey = match[1];
  const lines = documentText.split("\n");
  const lineRe = new RegExp(`^\\s{4,}${attrKey}\\s*:`);
  for (let i = diag.range.start.line; i < lines.length; i++) {
    if (!lineRe.test(lines[i])) continue;
    return {
      title: `Remove empty '${attrKey}' line`,
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
  return undefined;
}

function buildA011Fix(
  uri: string,
  diag: LspDiagnosticLike,
  documentText: string,
): CodeAction | undefined {
  const match = ATTRIBUTE_KEY_RE.exec(diag.message);
  if (!match) return undefined;
  const attrKey = match[1];
  const lines = documentText.split("\n");
  const lineRe = new RegExp(`^(\\s{4,})${attrKey}\\s*:\\s*(.*)$`);
  for (let i = diag.range.start.line; i < lines.length; i++) {
    const m = lineRe.exec(lines[i]);
    if (!m) continue;
    const indent = m[1];
    const rawValue = m[2];
    // Split on top-level commas (depth-0). Commas inside `[…]` are
    // citation locators and must not split — same rule the
    // MSL-A011 validator uses.
    const values: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of rawValue) {
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
    const nonEmpty = values.filter((v) => v.length > 0);
    if (nonEmpty.length < 2) return undefined;
    const newText = nonEmpty
      .map((v) => `${indent}${attrKey}: ${v}\n`)
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
  return undefined;
}

function buildM060Fix(
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
  documentText: string,
): CodeAction | undefined {
  const match = ATTRIBUTE_KEY_RE.exec(diag.message);
  if (!match) return undefined;
  const attrKey = match[1];
  // Walk forward from the diagnostic's line and find the trailer
  // line that defines this attribute — `<indent><Key>:`. The parser
  // canonicalises trailer indent to 6 spaces but accepts any indent
  // ≥4 (one tab), so we match leniently.
  const lines = documentText.split("\n");
  const startLine = diag.range.start.line;
  const lineRe = new RegExp(`^\\s{4,}${attrKey}\\s*:`);
  for (let i = startLine; i < lines.length; i++) {
    if (!lineRe.test(lines[i])) continue;
    return {
      title: `Remove '${attrKey}' line`,
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
  return undefined;
}

function buildT020Fix(
  uri: string,
  diag: LspDiagnosticLike,
  documentText: string,
): CodeAction | undefined {
  const match = T020_VALUE_RE.exec(diag.message);
  if (!match) return undefined;
  const badValue = match[1];
  const suggestion = closestCoreType(badValue);
  if (!suggestion) return undefined;
  // Scan forward from the diagnostic line for the matching Type:
  // trailer line, then locate the bad value's column within it.
  const lines = documentText.split("\n");
  for (let i = diag.range.start.line; i < lines.length; i++) {
    const line = lines[i];
    const idx = line.indexOf(badValue);
    if (idx < 0) continue;
    // Confirm this line is a `Type:` trailer (defensive against an
    // accidental occurrence of the bad value in body prose).
    if (!/^\s{4,}Type\s*:/.test(line)) continue;
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
  return undefined;
}

function buildA013Fix(
  uri: string,
  diag: LspDiagnosticLike,
  documentText: string,
): CodeAction | undefined {
  const match = ATTRIBUTE_KEY_RE.exec(diag.message);
  if (!match) return undefined;
  const attrKey = match[1];
  // Collect every trailer line that defines this attribute, from the
  // diagnostic's line forward. Keep the first; emit a delete edit
  // for each subsequent one. Stop scanning once a non-trailer,
  // non-blank line is hit (end of the trailer block).
  const lines = documentText.split("\n");
  const lineRe = new RegExp(`^\\s{4,}${attrKey}\\s*:`);
  const trailerRe = /^\s{4,}[A-Z][A-Za-z-]*\s*:/;
  const dupLines: number[] = [];
  let seenFirst = false;
  let inBlock = false;
  for (let i = diag.range.start.line; i < lines.length; i++) {
    const line = lines[i];
    if (lineRe.test(line)) {
      inBlock = true;
      if (seenFirst) dupLines.push(i);
      else seenFirst = true;
    } else if (inBlock && line.trim() !== "" && !trailerRe.test(line)) {
      break;
    }
  }
  if (dupLines.length === 0) return undefined;
  const edits: TextEdit[] = dupLines.map((i) => ({
    range: {
      start: { line: i, character: 0 },
      end: { line: i + 1, character: 0 },
    },
    newText: "",
  }));
  return {
    title: `Remove duplicate '${attrKey}' line(s)`,
    kind: "quickfix",
    diagnostics: [diag],
    isPreferred: true,
    edit: { changes: { [uri]: edits } },
  };
}

/** Return the closest core type name within {@linkcode MAX_SUGGESTION_DISTANCE}
 * Levenshtein distance, or `undefined` when nothing is close enough. */
function closestCoreType(value: string): string | undefined {
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

function buildS010Fix(
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
