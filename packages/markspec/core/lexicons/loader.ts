/**
 * @module core/lexicons/loader
 *
 * Loads bundled lexicon text files into hash-sets at module init.
 * Lexicons are deno-compile `--include`d so the binary has no I/O at
 * runtime (markspec-prose-analysis §5.4 "no I/O on the hot path").
 *
 * Node.js compat note: this module calls `Deno.readTextFileSync` to load
 * the `--include`d text files at first access. This is an intentional
 * exception to the AGENTS.md "no Deno.* in library code" rule —
 * `default_profile.ts` avoids the issue by inlining its payload as a
 * string constant, but lexicons are user-editable and too large to
 * inline. `loadLexicon` is internal to the markspec binary; it is not
 * part of the JSR-published library surface and should not be imported
 * by Node.js consumers.
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

/**
 * Load a bundled lexicon by name. Cached after first call. Throws if the
 * lexicon file is missing — the file is bundled into the binary via
 * `--include` flags in `scripts/compile_binary.ts`, so a missing file
 * means a broken build, not a user error.
 */
export function loadLexicon(name: LexiconName): ReadonlySet<string> {
  const cached = cache.get(name);
  if (cached) return cached;
  const url = LEXICON_FILES[name];
  const text = Deno.readTextFileSync(url);
  const set = parseLexiconText(text);
  cache.set(name, set);
  return set;
}
