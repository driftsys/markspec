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
import { offsetToRange } from "../range_util.ts";

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

/** RFC 2119 modal verbs + EARS leading-clause keywords that must never
 * trigger Q500 mid-sentence. Sentence-initial exclusion is handled
 * separately by position; this set catches keyword uses elsewhere. */
const PROTECTED_KEYWORDS: ReadonlySet<string> = new Set([
  // RFC 2119 modal verbs
  "Shall",
  "Should",
  "May",
  "Must",
  // EARS leading clauses (sometimes capitalized mid-sentence)
  "When",
  "While",
  "Where",
  "If",
  "Then",
  // Negation
  "Not",
]);

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
 * Scan a paragraph's text for Capitalized phrases per ADR-021
 * Decision 2: ≥1 Capitalized word, optionally extended with up to 2
 * total connector words (of/the/and) bridging adjacent Capitalized
 * words.
 *
 * Excludes:
 * - Sentence-initial Capitalized words (position check via `isSentenceInitial`).
 * - Protected keywords (RFC 2119 + EARS).
 *
 * Algorithm:
 * 1. Extract all word tokens with offsets.
 * 2. Walk tokens greedily: when a Capitalized word is found that is
 *    not sentence-initial and not a protected keyword, start building a
 *    phrase. Extend it by consuming:
 *      - additional Capitalized words (always extend, no connector cost)
 *      - lowercase connector words (cost +1 per word, max budget 2)
 *    Stop extending when the connector budget is exhausted, a
 *    non-connector lowercase word is encountered, or a sentence-initial
 *    Capitalized word starts a new sentence boundary.
 * 3. Emit one PhraseMatch per discovered phrase.
 */
function scanPhrases(
  text: string,
  isSentenceInitial: (offset: number) => boolean,
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

    // Skip sentence-initial words — capitalization at sentence start is
    // grammar, not domain vocabulary.
    if (isSentenceInitial(start.offset)) {
      i++;
      continue;
    }

    // Skip RFC 2119 / EARS protected keywords.
    if (PROTECTED_KEYWORDS.has(start.word)) {
      i++;
      continue;
    }

    // Begin building a phrase starting at this word.
    const phraseWords: WordToken[] = [start];
    let connectorBudget = 0;
    let j = i + 1;

    // Greedily extend. We need to peek ahead to handle connector words:
    // connectors are only consumed when they are followed by a Capitalized word.
    while (j < words.length) {
      const cur = words[j];

      if (isCapitalized(cur.word)) {
        // Protected keywords (RFC 2119 / EARS) must never be absorbed into
        // a phrase — even mid-extension. "Brake When System" must not emit
        // a single phrase "Brake When System".
        if (PROTECTED_KEYWORDS.has(cur.word)) break;
        // Consume the Capitalized word — extends the phrase.
        phraseWords.push(cur);
        j++;
        continue;
      }

      // Check if cur is a connector that might bridge to the next Capitalized word.
      if (!isConnector(cur.word)) {
        // Non-connector, non-Capitalized word — stops the phrase.
        break;
      }

      // cur is a connector. Only consume it (and pay the budget) if there
      // is a subsequent Capitalized word within the same run. Scan forward
      // through consecutive connectors to find the next Capitalized token.
      // Count how many connectors we would consume.
      let pendingConnectors = 0;
      let k = j;
      while (k < words.length && isConnector(words[k].word)) {
        pendingConnectors++;
        k++;
      }

      // Is there a Capitalized word after the connector run?
      if (k < words.length && isCapitalized(words[k].word)) {
        // Would we exceed the connector budget?
        if (connectorBudget + pendingConnectors > MAX_CONNECTORS) {
          // Exceeds budget — stop the phrase here.
          break;
        }
        // Consume the connectors and the Capitalized word.
        for (let ci = j; ci < k; ci++) {
          phraseWords.push(words[ci]);
        }
        phraseWords.push(words[k]);
        connectorBudget += pendingConnectors;
        j = k + 1;
        continue;
      }

      // Connector run is not followed by a Capitalized word — phrase ends.
      break;
    }

    // The phrase runs from phraseWords[0].offset to the end of phraseWords[last].
    // Reconstruct the phrase text as a substring of the original text to preserve
    // any internal whitespace exactly.
    const firstOffset = phraseWords[0].offset;
    const lastWord = phraseWords[phraseWords.length - 1];
    const lastOffset = lastWord.offset + lastWord.word.length;
    const phraseText = text.slice(firstOffset, lastOffset);

    // Collect only the Capitalized tokens for the tokens field.
    const capitalizedTokens = phraseWords
      .filter((w) => isCapitalized(w.word))
      .map((w) => w.word);

    phrases.push({
      phrase: phraseText,
      offset: firstOffset,
      tokens: capitalizedTokens,
    });

    // Advance past this phrase's tokens. Skip the entire range covered
    // (j is already past the last consumed word).
    i = j;
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
  for (const block of blocks) {
    if (block.kind !== "paragraph") continue;
    const p = block as ParagraphNode;
    const text = p.content.text;

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

    const phrases = scanPhrases(text, isSentenceInitial);
    for (const ph of phrases) {
      // Allowlist: skip when ALL Capitalized tokens in the phrase are in
      // the capitalized-allow lexicon (e.g. "Monday" → skip;
      // "Monday Driver" → fire because "Driver" isn't allowlisted).
      if (ph.tokens.every((t) => capitalizedAllow.has(t))) continue;

      // $Identifier hook (deferred ADR-016 leg, per ADR-021 Decision 1).
      if (isIdentifier(ph.phrase)) continue;

      // Resolver: try the slug for the full phrase; for single-token
      // phrases also try the token's slug. First hit wins.
      const phraseSlug = deriveTermSlug(ph.phrase);
      if (phraseSlug.length > 0 && glossary.has(phraseSlug)) continue;
      if (ph.tokens.length === 1) {
        const tokenSlug = deriveTermSlug(ph.tokens[0]);
        if (tokenSlug.length > 0 && glossary.has(tokenSlug)) continue;
      }

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
