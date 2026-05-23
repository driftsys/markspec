/**
 * @module lsp/semantic_tokens
 *
 * Produce LSP semantic tokens for an entry's title, embedded display
 * IDs, trailer attribute keys/values, and labels (with a validity
 * modifier sourced from the active profile's `labels` catalog).
 *
 * The builder returns an intermediate `SemanticToken[]` shape that
 * the LSP server encodes into the LSP wire format. Keeping the
 * intermediate is what makes the builder testable without
 * reimplementing the wire encoding in test code.
 *
 * An empty profile labels catalog is treated as "open set" — every
 * label is valid. The `modification` modifier is set only when the
 * catalog is non-empty AND the label is not in it.
 */

import type { EffectiveProfile, Entry } from "../core/model/mod.ts";
import { scanEntryTrailer } from "./entry_trailer.ts";

/** LSP semantic-token legend exported by the server's capabilities. */
export const SEMANTIC_TOKEN_LEGEND = {
  tokenTypes: [
    "class",
    "enum",
    "enumMember",
    "keyword",
    "property",
    "string",
  ] as const,
  tokenModifiers: ["declaration", "static", "modification"] as const,
} as const;

/** One of the token types declared in {@linkcode SEMANTIC_TOKEN_LEGEND}. */
export type SemanticTokenType =
  (typeof SEMANTIC_TOKEN_LEGEND.tokenTypes)[number];

/** One of the token modifiers declared in {@linkcode SEMANTIC_TOKEN_LEGEND}. */
export type SemanticTokenModifier =
  (typeof SEMANTIC_TOKEN_LEGEND.tokenModifiers)[number];

/** A single semantic token with column-based positions. */
export interface SemanticToken {
  /** 0-based line index in the document. */
  readonly line: number;
  /** 0-based column where the token starts. */
  readonly startChar: number;
  /** Length of the token in characters. */
  readonly length: number;
  /** Token type from the legend. */
  readonly tokenType: SemanticTokenType;
  /** Zero or more modifiers from the legend. */
  readonly tokenModifiers: readonly SemanticTokenModifier[];
}

/**
 * Title line pattern: `- [DISPLAY_ID] Title text`.
 *
 * The ID class mirrors the project's canonical display-ID grammar used
 * by `entry_trailer.ts` (`DISPLAY_ID_RE`) and `hover.ts`
 * (`DISPLAY_ID_TOKEN_RE`): a leading alphanumeric followed by at least
 * two more characters from the set `[A-Za-z0-9._/-]`. The `{2,}`
 * quantifier (not `+`) enforces the ≥3-char total length that those
 * modules also require, so semantic-tokens highlighting covers every
 * ID the parser, hover, rename, and references already accept (e.g.
 * `my-entry`, `my.entry`, `ns/entry`).
 */
const TITLE_LINE_RE =
  /^(\s*-\s+\[)(@?[A-Za-z0-9][A-Za-z0-9._/-]{2,})(\]\s*)(.*)$/;

/**
 * Build semantic tokens for every entry in `entries`. Tokens are
 * returned sorted by (line, startChar) — encoding to the LSP wire
 * format requires sorted input.
 */
export function buildSemanticTokens(
  entries: readonly Entry[],
  profile: EffectiveProfile | undefined,
  lines: readonly string[],
): SemanticToken[] {
  const tokens: SemanticToken[] = [];
  const allowedLabels = collectAllowedLabels(profile);

  // Sort entries so we know each entry's end (= next entry's start).
  const sorted = [...entries].sort(
    (a, b) => a.location.line - b.location.line,
  );

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const endLineExclusive = i + 1 < sorted.length
      ? sorted[i + 1].location.line - 1
      : lines.length;

    addTitleTokens(tokens, entry, lines);
    addBodyKeywordTokens(tokens, entry, lines, endLineExclusive);
    addTrailerTokens(tokens, entry, lines, endLineExclusive, allowedLabels);
  }

  tokens.sort((a, b) =>
    a.line !== b.line ? a.line - b.line : a.startChar - b.startChar
  );
  return tokens;
}

/** Collect the active profile's allowed label names, or `undefined` when empty. */
function collectAllowedLabels(
  profile: EffectiveProfile | undefined,
): Set<string> | undefined {
  if (!profile) return undefined;
  const names = new Set<string>();
  for (const [name] of profile.labels) names.add(name);
  return names.size > 0 ? names : undefined;
}

/** Emit `enum` (display ID) and `class` (title text) tokens on the entry's title line. */
function addTitleTokens(
  out: SemanticToken[],
  entry: Entry,
  lines: readonly string[],
): void {
  const lineIndex = entry.location.line - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) return;
  const line = lines[lineIndex];
  const m = TITLE_LINE_RE.exec(line);
  if (!m) return;
  const prefix = m[1];
  const id = m[2];
  const close = m[3];
  const title = m[4];
  const idStart = prefix.length;
  out.push({
    line: lineIndex,
    startChar: idStart,
    length: id.length,
    tokenType: "enum",
    tokenModifiers: ["declaration"],
  });
  const titleStart = prefix.length + id.length + close.length;
  if (title.length > 0) {
    out.push({
      line: lineIndex,
      startChar: titleStart,
      length: title.length,
      tokenType: "class",
      tokenModifiers: ["declaration"],
    });
  }
}

/**
 * RFC 2119 modal verbs (lowercase canonical form) and the five EARS
 * pattern triggers. Matched case-insensitively as whole words inside
 * entry body prose, then emitted as `keyword` tokens so themes paint
 * them prominently — the same treatment language keywords get.
 *
 * `not` is intentionally not in the set; negation reads as part of
 * the modal phrase (e.g., `shall not`) and highlighting only the modal
 * verb is enough to anchor the eye.
 */
const BODY_KEYWORD_RE =
  /\b(shall|should|may|must|will|when|while|if|where|then)\b/gi;

/**
 * Gherkin section keywords — section headers, not steps. Rendered as
 * `class` semantic tokens to mirror GitHub Linguist's
 * `entity.name.section.*` and Rouge's `Generic::Heading` scoping;
 * themes paint these like type/heading names.
 *
 * Multi-word keywords (`Scenario Outline`, `Scenario Template`) are
 * matched as single units; bare `Scenario` matches when the longer
 * form isn't present.
 */
const GHERKIN_SECTION_RE =
  /\b(Feature|Background|Rule|Scenario Outline|Scenario Template|Scenarios|Examples|Scenario)\b/g;

/**
 * Gherkin step keywords — rendered as `keyword` semantic tokens to
 * mirror `keyword.control.cucumber` / Rouge `Keyword`. Themes paint
 * these with a strong colour + bold, the same treatment programming-
 * language keywords get.
 */
const GHERKIN_STEP_RE = /\b(Given|When|Then|And|But)\b/g;

/** Detect a fenced code block opener with a `feature` or `gherkin` language tag. */
const FEATURE_FENCE_OPEN_RE = /^\s*(```+|~~~+)\s*(feature|gherkin)\b/i;

/** Detect a fenced code block closer using the same fence character set. */
const FENCE_CLOSE_RE = /^\s*(```+|~~~+)\s*$/;

/**
 * Inline `$Identifier` entity reference (spec §2.5.2). Matched directly
 * against body lines for highlighting; the full parser also tracks
 * `$$…$$` math fences and `\$` escapes, but for visual rendering a
 * straight regex is good enough and avoids relying on parser-emitted
 * positions that are body-relative.
 */
const ENTITY_REF_RE = /\$[A-Za-z][A-Za-z0-9_]*/g;

/**
 * Emit `keyword` tokens for modal verbs and EARS triggers in entry
 * body prose, and for Gherkin keywords inside fenced `feature` /
 * `gherkin` blocks. The scan covers lines between the entry's title
 * line and the next entry (or document end), excluding trailer lines.
 */
function addBodyKeywordTokens(
  out: SemanticToken[],
  entry: Entry,
  lines: readonly string[],
  endLineExclusive: number,
): void {
  const trailerLines = scanEntryTrailer(entry, lines, endLineExclusive);
  // Body ends at the first trailer line. Lines AFTER the trailer block
  // (and up to the next entry's title) are inter-entry prose, not the
  // entry's body — they must not be tokenized as part of this entry.
  const bodyEndExclusive = trailerLines.length > 0
    ? trailerLines[0].lineIndex
    : endLineExclusive;
  // Body starts on the line after the title (1-based location.line is
  // the title line; 0-based body starts at location.line).
  const startIndex = entry.location.line;
  let insideFeatureBlock = false;
  for (let i = startIndex; i < bodyEndExclusive && i < lines.length; i++) {
    const line = lines[i];

    // Track fenced feature/gherkin blocks. The fence delimiters
    // themselves are not tokenized; lines inside emit Gherkin section
    // keywords (Feature/Scenario/...) as `class` and step keywords
    // (Given/When/Then/...) as `keyword`, matching the GitHub Linguist
    // and Rouge conventions for Cucumber.
    if (insideFeatureBlock) {
      if (FENCE_CLOSE_RE.test(line)) {
        insideFeatureBlock = false;
        continue;
      }
      emitTypedMatches(out, GHERKIN_SECTION_RE, line, i, "class", []);
      emitKeywordMatches(out, GHERKIN_STEP_RE, line, i);
      continue;
    }
    if (FEATURE_FENCE_OPEN_RE.test(line)) {
      insideFeatureBlock = true;
      continue;
    }
    if (line.trim() === "") continue;
    emitKeywordMatches(out, BODY_KEYWORD_RE, line, i);
    emitEntityRefMatches(out, line, i);
  }
}

/** Scan a body line for `$Identifier` tokens and emit `string` tokens. */
function emitEntityRefMatches(
  out: SemanticToken[],
  line: string,
  lineIndex: number,
): void {
  ENTITY_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENTITY_REF_RE.exec(line)) !== null) {
    // Skip the second half of a `$$…$$` math fence.
    if (match.index > 0 && line[match.index - 1] === "$") continue;
    // Skip escaped `\$`.
    if (match.index > 0 && line[match.index - 1] === "\\") continue;
    out.push({
      line: lineIndex,
      startChar: match.index,
      length: match[0].length,
      tokenType: "string",
      tokenModifiers: [],
    });
  }
}

/** Run a `g`-flag regex across `line` and push a `keyword` token per match. */
function emitKeywordMatches(
  out: SemanticToken[],
  re: RegExp,
  line: string,
  lineIndex: number,
): void {
  emitTypedMatches(out, re, line, lineIndex, "keyword", []);
}

/**
 * Run a `g`-flag regex across `line` and push a token of the given
 * type/modifiers per match. Shared by the modal/EARS scanner (keyword)
 * and the Gherkin section scanner (class).
 */
function emitTypedMatches(
  out: SemanticToken[],
  re: RegExp,
  line: string,
  lineIndex: number,
  tokenType: SemanticTokenType,
  tokenModifiers: readonly SemanticTokenModifier[],
): void {
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    out.push({
      line: lineIndex,
      startChar: match.index,
      length: match[0].length,
      tokenType,
      tokenModifiers,
    });
  }
}

/** Emit tokens for every trailer line in the entry. */
function addTrailerTokens(
  out: SemanticToken[],
  entry: Entry,
  lines: readonly string[],
  endLineExclusive: number,
  allowedLabels: Set<string> | undefined,
): void {
  const trailerLines = scanEntryTrailer(entry, lines, endLineExclusive);
  for (const tl of trailerLines) {
    // Attribute key — property + static.
    out.push({
      line: tl.lineIndex,
      startChar: tl.keyStart,
      length: tl.keyLength,
      tokenType: "property",
      tokenModifiers: ["static"],
    });

    if (tl.key === "Labels") {
      // One enumMember per label, with `modification` when invalid.
      addLabelTokens(out, tl, lines[tl.lineIndex], allowedLabels);
    } else if (tl.idRanges.length > 0) {
      // Trace attribute with display IDs — emit enumMember per ID, leave
      // the rest of the value uncolored (themes paint the surrounding
      // text via the prose color).
      for (const r of tl.idRanges) {
        out.push({
          line: tl.lineIndex,
          startChar: r.start,
          length: r.length,
          tokenType: "enumMember",
          tokenModifiers: [],
        });
      }
    } else {
      // Plain value — string token covers the whole value range.
      if (tl.valueLength > 0) {
        out.push({
          line: tl.lineIndex,
          startChar: tl.valueStart,
          length: tl.valueLength,
          tokenType: "string",
          tokenModifiers: [],
        });
      }
    }
  }
}

/** Emit one `enumMember` token per comma-separated label, with `modification` when invalid. */
function addLabelTokens(
  out: SemanticToken[],
  tl: { lineIndex: number; valueStart: number; valueLength: number },
  line: string,
  allowedLabels: Set<string> | undefined,
): void {
  const value = line.slice(tl.valueStart, tl.valueStart + tl.valueLength);
  for (const segment of splitWithOffsets(value)) {
    const trimmed = segment.text.trim();
    if (trimmed.length === 0) continue;
    const trimmedStart = segment.text.indexOf(trimmed);
    const start = tl.valueStart + segment.offset + trimmedStart;
    const modifiers: SemanticTokenModifier[] =
      allowedLabels && !allowedLabels.has(trimmed) ? ["modification"] : [];
    out.push({
      line: tl.lineIndex,
      startChar: start,
      length: trimmed.length,
      tokenType: "enumMember",
      tokenModifiers: modifiers,
    });
  }
}

/** A comma-split segment with its offset back into the source value string. */
interface Segment {
  text: string;
  offset: number;
}

/** Split `value` on commas, returning each segment together with its starting offset. */
function splitWithOffsets(value: string): Segment[] {
  const out: Segment[] = [];
  let start = 0;
  for (let i = 0; i <= value.length; i++) {
    if (i === value.length || value[i] === ",") {
      out.push({ text: value.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  return out;
}
