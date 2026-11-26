/**
 * @module core/lint/rules/xref
 *
 * Cross-entry consistency rules. Currently ships MSL-Q500
 * (xref-glossary-undefined) — the flagship rule per
 * markspec-prose-analysis §2.8 and ADR-021.
 */

import type { Entry } from "../../model/mod.ts";
import type { ParagraphNode } from "../../ast/nodes.ts";
import type { LintDiagnostic } from "../types.ts";
import type { GlossaryIndex } from "../glossary.ts";
import { deriveTermSlug } from "../../parser/glossary.ts";
import { KEYWORD_WORDS } from "../../util/modals.ts";
import { maskNonProse, offsetToRange } from "../range_util.ts";
import { collectDefinitions } from "../../ast/normalize.ts";

/** Hook signature for the $Identifier registry leg. Returns true when
 * the token is a resolvable $Identifier (i.e. should be skipped by
 * Q500). See ADR-021 Decision 1 for the integration seam, and
 * {@linkcode buildIdentifierIndex} + {@linkcode buildIsIdentifierHook}
 * for the corpus-scan implementation that backs it today. */
export type IsIdentifierHook = (token: string) => boolean;

/**
 * Build a corpus-wide `$Identifier` index from every entry's `bodyTokens`.
 *
 * Aggregates the bare name (text with leading `$` stripped) of every
 * `entity-ref` token across `entries` into a `Set<string>`. The set is
 * the data backing the {@linkcode IsIdentifierHook} closure produced by
 * {@linkcode buildIsIdentifierHook}.
 *
 * Behavioural contract (ADR-021 Decision 1, additive-enrichment invariant):
 *   - Every name in the index is observed in the corpus as `$Name`.
 *   - The index is purely additive: more entries → more silenced phrases,
 *     never more diagnostics.
 *
 * Scope note: this is the pragmatic minimal resolver leg per issue #502.
 * The formal `MSL-M050`/`MSL-M051` entity-resolution model (definition
 * vs. use, typed identifiers, profile Aliases) is deferred to a
 * follow-up story — the closure body changes but the hook signature
 * stays the same.
 */
export function buildIdentifierIndex(
  entries: readonly Entry[],
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const entry of entries) {
    for (const token of entry.bodyTokens) {
      if (token.kind !== "entity-ref") continue;
      // `token.text` is the full `$Identifier` form; strip the leading `$`.
      out.add(token.text.slice(1));
    }
  }
  return out;
}

/**
 * Build the {@linkcode IsIdentifierHook} closure from a precomputed
 * index. Separated from {@linkcode buildIdentifierIndex} so the index
 * can be computed once per `runLint` invocation and reused across
 * every in-scope entry.
 */
export function buildIsIdentifierHook(
  index: ReadonlySet<string>,
): IsIdentifierHook {
  return (phrase) => index.has(phrase);
}

/** Modal and EARS keywords never trigger Q500, in any casing: `Shall`,
 * `SHALL` and `shall` are keywords, not undefined terms. The word list
 * lives in `core/util/modals.ts`. */
function isProtectedKeyword(word: string): boolean {
  return KEYWORD_WORDS.has(word.toLowerCase());
}

/** Lowercase connector words that join adjacent Capitalized words into
 * a single multi-word phrase per ADR-021 Decision 2. The budget of
 * 2 connector words across the whole phrase must not be exceeded. */
const CONNECTOR_WORDS: ReadonlySet<string> = new Set(["of", "the", "and"]);

/** Maximum total connector words allowed in a single phrase (ADR-021 Decision 2). */
const MAX_CONNECTORS = 2;

/** A Capitalized phrase match within a paragraph text. */
interface PhraseMatch {
  readonly phrase: string;
  /** Byte offset of the phrase's first character in the paragraph text. */
  readonly offset: number;
  readonly tokens: readonly string[];
}

/** A word token extracted from text with its byte offset. */
interface WordToken {
  readonly word: string;
  readonly offset: number;
}

/**
 * Extract all word tokens (letter+digit sequences) with their byte offsets.
 * Words are sequences matching /[A-Za-z0-9]+/ (PascalCase terms, connectors).
 */
function extractWords(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const re = /[A-Za-z][A-Za-z0-9]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ word: m[0], offset: m.index });
  }
  return tokens;
}

/** Returns true when a word looks like a Capitalized/PascalCase term:
 * starts with uppercase and has at least one more character (avoids
 * single uppercase abbreviation letters that appear mid-sentence like
 * "I" or just the article "A"). */
function isCapitalized(word: string): boolean {
  if (word.length < 2) return false;
  return word[0] >= "A" && word[0] <= "Z";
}

/** Returns true when a word is a lowercase connector that may bridge
 * two Capitalized tokens within the same phrase. */
function isConnector(word: string): boolean {
  return CONNECTOR_WORDS.has(word.toLowerCase()) &&
    word[0] === word[0].toLowerCase();
}

/**
 * Extend a phrase that starts at the Capitalized word `words[start]`, per
 * ADR-021 Decision 2, and return the indexes of the words it holds. The
 * phrase consumes:
 *   - additional Capitalized words (always extend, no connector cost)
 *   - lowercase connector words (cost +1 per word, max budget 2), only
 *     when the connector run is followed by a Capitalized word.
 *
 * It stops when the connector budget is exhausted or a non-connector
 * lowercase word is encountered. When `joinKeywords` is `false`, it also
 * stops before a protected keyword: "Brake When System" is not one
 * phrase. When `joinKeywords` is `true`, a keyword extends the phrase
 * like any other Capitalized word; {@linkcode scanPhrases} uses this to
 * find a glossary term that contains a keyword (#1028).
 */
function extendPhrase(
  words: readonly WordToken[],
  start: number,
  joinKeywords: boolean,
): number[] {
  const stopsAt = (word: string) => !joinKeywords && isProtectedKeyword(word);
  const held = [start];
  let connectorBudget = 0;
  let j = start + 1;
  while (j < words.length) {
    const cur = words[j];

    if (isCapitalized(cur.word)) {
      if (stopsAt(cur.word)) break;
      held.push(j);
      j++;
      continue;
    }

    // Non-connector, non-Capitalized word — stops the phrase.
    if (!isConnector(cur.word)) break;

    // cur is a connector. Only consume the connector run (and pay the
    // budget) if a Capitalized word follows it.
    let k = j;
    while (k < words.length && isConnector(words[k].word)) k++;
    const pendingConnectors = k - j;
    if (k >= words.length || !isCapitalized(words[k].word)) break;
    // A keyword after the connectors ends the phrase before them.
    if (stopsAt(words[k].word)) break;
    if (connectorBudget + pendingConnectors > MAX_CONNECTORS) break;
    for (let ci = j; ci <= k; ci++) held.push(ci);
    connectorBudget += pendingConnectors;
    j = k + 1;
  }
  return held;
}

/** The text of `text` from the first to the last word of `held`. */
function spanText(
  text: string,
  words: readonly WordToken[],
  held: readonly number[],
): string {
  const first = words[held[0]];
  const last = words[held[held.length - 1]];
  return text.slice(first.offset, last.offset + last.word.length);
}

/**
 * Number of leading words of `held` that form the longest glossary term
 * containing a protected keyword, or 0 when there is none. Only spans
 * that end on a Capitalized word are tried.
 */
function keywordTermLength(
  text: string,
  words: readonly WordToken[],
  held: readonly number[],
  isDefinedTerm: (phrase: string) => boolean,
): number {
  const firstKeyword = held.findIndex((w) => isProtectedKeyword(words[w].word));
  if (firstKeyword < 0) return 0;
  for (let n = held.length; n > firstKeyword; n--) {
    if (!isCapitalized(words[held[n - 1]].word)) continue;
    if (isDefinedTerm(spanText(text, words, held.slice(0, n)))) return n;
  }
  return 0;
}

/**
 * Scan a paragraph's text for Capitalized phrases per ADR-021
 * Decision 2: ≥1 Capitalized word, optionally extended with up to 2
 * total connector words (of/the/and) bridging adjacent Capitalized
 * words (see {@linkcode extendPhrase}).
 *
 * Excludes:
 * - Sentence-initial Capitalized words (position check via `isSentenceInitial`),
 *   unless they start a glossary term that contains a keyword (below).
 * - Protected keywords (RFC 2119 + EARS), in any casing. A keyword ends a
 *   phrase and never starts one.
 * - A glossary term that contains a protected keyword ("May Day
 *   Protocol", "NOT READY STATE"; #1028). At each phrase start, the
 *   phrase is first extended across keywords; when a leading part of it
 *   that holds a keyword is a defined term (`isDefinedTerm`), that part is
 *   skipped as a whole. Otherwise the keyword splits the phrase as above.
 *
 * Emits one PhraseMatch per discovered phrase.
 */
function scanPhrases(
  text: string,
  isSentenceInitial: (offset: number) => boolean,
  isDefinedTerm: (phrase: string) => boolean,
): PhraseMatch[] {
  const words = extractWords(text);
  const phrases: PhraseMatch[] = [];
  let i = 0;

  while (i < words.length) {
    const start = words[i];

    // Skip non-Capitalized words.
    if (!isCapitalized(start.word)) {
      i++;
      continue;
    }

    // A defined term that contains a keyword is consumed whole, also at a
    // sentence start ("May Day Protocol applies.").
    const wide = extendPhrase(words, i, true);
    const termLength = keywordTermLength(text, words, wide, isDefinedTerm);
    if (termLength > 0) {
      i = wide[termLength - 1] + 1;
      continue;
    }

    // Skip sentence-initial words — capitalization at sentence start is
    // grammar, not domain vocabulary.
    if (isSentenceInitial(start.offset)) {
      i++;
      continue;
    }

    // Skip RFC 2119 / EARS protected keywords.
    if (isProtectedKeyword(start.word)) {
      i++;
      continue;
    }

    const held = extendPhrase(words, i, false);
    phrases.push({
      phrase: spanText(text, words, held),
      offset: start.offset,
      // Only the Capitalized tokens.
      tokens: held.map((w) => words[w].word).filter(isCapitalized),
    });
    // Advance past this phrase's last word.
    i = held[held.length - 1] + 1;
  }

  return phrases;
}

/** Public entry point: run Q500 against an entry's paragraph bodies. */
export function runXrefRules(
  entry: Entry,
  glossary: GlossaryIndex,
  capitalizedAllow: ReadonlySet<string>,
  isIdentifier: IsIdentifierHook,
): LintDiagnostic[] {
  const out: LintDiagnostic[] = [];
  const blocks = entry.bodyAst ?? [];
  const definitions = collectDefinitions(blocks);
  const isGlossaryTerm = (phrase: string) => {
    const slug = deriveTermSlug(phrase);
    return slug.length > 0 && glossary.has(slug);
  };
  for (const block of blocks) {
    if (block.kind !== "paragraph") continue;
    const p = block as ParagraphNode;
    // Inline code and link syntax (destinations, titles, images, ...) are
    // not prose: blank them with spaces so offsets stay the same (#1017).
    const text = maskNonProse(p.content.text, definitions);

    // Compute sentence-initial offsets using a simple heuristic:
    // offset 0 is always sentence-initial; after a sentence terminator
    // (./?/!) followed by whitespace, the next non-whitespace position
    // is sentence-initial.
    const sentenceStarts = new Set<number>([0]);
    for (let i = 1; i < text.length; i++) {
      const prev = text[i - 1];
      if (prev !== "." && prev !== "?" && prev !== "!") continue;
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (j > i) sentenceStarts.add(j);
    }
    const isSentenceInitial = (off: number) => sentenceStarts.has(off);

    const phrases = scanPhrases(text, isSentenceInitial, isGlossaryTerm);
    for (const ph of phrases) {
      // Allowlist: skip when ALL Capitalized tokens in the phrase are in
      // the capitalized-allow lexicon (e.g. "Monday" → skip;
      // "Monday Driver" → fire because "Driver" isn't allowlisted).
      if (ph.tokens.every((t) => capitalizedAllow.has(t))) continue;

      // $Identifier hook (deferred ADR-016 leg, per ADR-021 Decision 1).
      if (isIdentifier(ph.phrase)) continue;

      // Resolver: try the slug for the full phrase; for single-token
      // phrases also try the token's slug. First hit wins.
      if (isGlossaryTerm(ph.phrase)) continue;
      if (ph.tokens.length === 1 && isGlossaryTerm(ph.tokens[0])) continue;

      // Convert body-relative paragraph range to file-absolute line.
      // `p.range.start.line` is body-relative (line 1 = first body line).
      // `entry.bodyStartLine` is the file-absolute line where the body
      // begins (slice 3 LintDiagnostic.range contract). Fall back to
      // `entry.location.line + 1` when the field is absent (test fixtures).
      const absBodyStart = entry.bodyStartLine ??
        (entry.location.line + 1);
      const absLine = absBodyStart + p.range.start.line - 1;
      const range = offsetToRange(
        text,
        ph.offset,
        ph.phrase.length,
        absLine,
        p.range.start.column,
      );
      out.push({
        code: "MSL-Q500",
        slug: "xref-glossary-undefined",
        severity: "warning",
        scoreContribution: 3,
        group: "xref",
        message:
          `xref-glossary-undefined: '${ph.phrase}' is not in the glossary, not in a DefinitionList, and not in the capitalized-allow lexicon`,
        location: entry.location,
        range,
      });
    }
  }
  return out;
}
