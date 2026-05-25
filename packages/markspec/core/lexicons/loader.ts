/**
 * @module core/lexicons/loader
 *
 * Loads bundled lexicon text files into hash-sets at module init.
 * Lexicons are deno-compile `--include`d so the binary has no I/O at
 * runtime (markspec-prose-analysis §5.4 "no I/O on the hot path").
 */

const LEXICON_FILES = {
  "capitalized-allow": new URL("./capitalized-allow.txt", import.meta.url),
  "sentence-abbrev": new URL("./sentence-abbrev.txt", import.meta.url),
} as const;

export type LexiconName = keyof typeof LEXICON_FILES;

/**
 * Parse lexicon text — one token per line, `#` comments, blank lines
 * dropped. Each token is trimmed; the resulting set is case-sensitive.
 */
export function parseLexiconText(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    out.add(line);
  }
  return out;
}

const cache = new Map<LexiconName, ReadonlySet<string>>();

/** Load a bundled lexicon by name. Cached after first call. */
export function loadLexicon(name: LexiconName): ReadonlySet<string> {
  const cached = cache.get(name);
  if (cached) return cached;
  const url = LEXICON_FILES[name];
  const text = Deno.readTextFileSync(url);
  const set = parseLexiconText(text);
  cache.set(name, set);
  return set;
}
