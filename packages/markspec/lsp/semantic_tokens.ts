/**
 * @module lsp/semantic_tokens
 *
 * Produce LSP semantic tokens for an entry's title, embedded display
 * IDs, trailer attribute keys/values, labels (with a validity modifier
 * sourced from the active profile's `labels` catalog), and body
 * inline constructs (modal verbs, EARS triggers, Gherkin keywords,
 * `$Identifier` entity refs).
 *
 * Per ADR-016 Decision 8, body inline constructs are not rediscovered
 * here. The parser emits them on each `Entry.bodyTokens` with
 * file-relative {@linkcode SourceLocation}; this builder is a thin
 * switch from {@linkcode BodyTokenKind} to {@linkcode SemanticTokenType}.
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

import type {
  BodyTokenKind,
  EffectiveProfile,
  Entry,
} from "../core/model/mod.ts";
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
 * Map each {@linkcode BodyTokenKind} to its LSP semantic-token type.
 * `inline-code` is intentionally absent — the TextMate grammar already
 * paints backtick spans, per ADR-016 Decision 8.
 */
const BODY_TOKEN_TYPE: Readonly<
  Partial<Record<BodyTokenKind, SemanticTokenType>>
> = {
  "modal": "keyword",
  "ears-trigger": "keyword",
  "gherkin-section": "class",
  "gherkin-step": "keyword",
  "entity-ref": "string",
  // "inline-code": no emission
};

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
    addBodyTokens(tokens, entry);
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
 * Emit semantic tokens for the entry's body inline constructs by mapping
 * each {@linkcode BodyToken} to its LSP token type per ADR-016 Decision 8.
 * Token locations are file-relative 1-based; converted here to LSP's
 * 0-based line/character.
 */
function addBodyTokens(out: SemanticToken[], entry: Entry): void {
  for (const token of entry.bodyTokens) {
    const tokenType = BODY_TOKEN_TYPE[token.kind];
    if (!tokenType) continue;
    out.push({
      line: token.location.line - 1,
      startChar: token.location.column - 1,
      length: token.text.length,
      tokenType,
      tokenModifiers: [],
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
