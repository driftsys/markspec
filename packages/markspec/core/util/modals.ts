/**
 * @module core/util/modals
 *
 * RFC 2119 and EARS modal-keyword helpers shared by `formatter/mod.ts`
 * and `ast/normalize.ts`. Extracted to `core/util/` to avoid a dep cycle:
 * `ast/` is a dependency of `formatter/`, so `formatter → ast` is OK but
 * `ast → formatter` is not.
 */

/**
 * RFC 2119 modal keywords in uppercase form, with optional ` NOT` suffix.
 * Captured for canonical-form normalisation per spec §3.4.1: uppercase
 * input is accepted but emitted lowercase, unconditionally.
 */
export const RFC2119_MODAL_RE = /\b(SHALL|SHOULD|MAY|MUST)(\s+NOT)?\b/g;

/**
 * EARS keywords subject to the sentence-initial rule of spec §3.4.1:
 * lowercased when mid-sentence, preserved when starting a sentence.
 * `If…then` is deferred to a later slice because its multi-token form
 * needs separate handling.
 */
export const EARS_KEYWORD_RE = /\b(When|While|Where|Unless)\b/g;

/**
 * Decide whether the EARS keyword at `offset` in `line` is at sentence
 * start (return value true). Walks left over whitespace and reports true
 * when it hits the beginning of the line or a sentence-terminating
 * punctuation character (`.`, `!`, `?`).
 */
export function isSentenceInitial(line: string, offset: number): boolean {
  if (offset === 0) return true;
  let i = offset - 1;
  while (i >= 0 && (line[i] === " " || line[i] === "\t")) i--;
  if (i < 0) return true;
  const prev = line[i];
  return prev === "." || prev === "!" || prev === "?";
}
