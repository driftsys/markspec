/**
 * @module core/discovery/gitignore
 *
 * Pure-TypeScript `.gitignore` pattern matcher. Implements the standard
 * semantics the discovery walker needs: `#` comments, `!` negation,
 * trailing-`/` directory-only patterns, leading-`/` and contains-`/`
 * anchoring, `*` / `?` / `[...]` globs, and `**` cross-directory globs.
 * Last matching rule wins.
 *
 * Per git semantics, a file inside an ignored directory cannot be
 * re-included by a negation — the walker enforces this by pruning
 * ignored directories without descending.
 *
 * No I/O, no platform APIs — Node-compatible by construction.
 */

/** One compiled gitignore rule. */
export interface GitignoreRule {
  /** Matches a root-relative POSIX path (no leading slash). */
  readonly regex: RegExp;
  /** `!pattern` — a match un-ignores the path. */
  readonly negated: boolean;
  /** `pattern/` — matches directories only. */
  readonly dirOnly: boolean;
}

const REGEX_SPECIALS = /[.+^${}()|\\]/;

function escapeRegexChar(c: string): string {
  return REGEX_SPECIALS.test(c) ? `\\${c}` : c;
}

/** Translate one gitignore glob (already stripped of `!`, `/` affixes)
 * into a regex source string. */
function globToRegexSource(pattern: string): string {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      // Consume the whole run of consecutive `*` so we never emit adjacent
      // unbounded quantifiers (which backtrack catastrophically against a
      // non-matching input). Git likewise treats consecutive `*` that are
      // not a slash-delimited `**` as regular asterisks.
      let stars = 0;
      while (pattern[i] === "*") {
        stars++;
        i++;
      }
      if (stars >= 2 && pattern[i] === "/") {
        re += "(?:[^/]+/)*"; // `**/` — zero or more whole segments
        i++; // consume the `/`
      } else if (stars >= 2) {
        re += ".*"; // leading/trailing/bare `**` — crosses directories
      } else {
        re += "[^/]*"; // single `*` — within one path segment
      }
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if (c === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end < 0) {
        re += "\\[";
        i++;
      } else {
        let cls = pattern.slice(i + 1, end);
        if (cls.startsWith("!")) cls = `^${cls.slice(1)}`;
        re += `[${cls}]`;
        i = end + 1;
      }
    } else if (c === "\\" && i + 1 < pattern.length) {
      re += escapeRegexChar(pattern[i + 1]);
      i += 2;
    } else {
      re += escapeRegexChar(c);
      i++;
    }
  }
  return re;
}

/**
 * Parse `.gitignore` content into compiled rules.
 *
 * @param content - Raw file content (LF or CRLF).
 * @param baseDir - Root-relative POSIX dir the `.gitignore` lives in
 *   (`""` for the root one). Patterns only match paths under it.
 */
export function parseGitignore(
  content: string,
  baseDir: string,
): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const rawLine of content.split("\n")) {
    // Strip CR and unescaped trailing spaces (git semantics).
    const line = rawLine.replace(/\r$/, "").replace(/(?<!\\) +$/, "");
    if (line === "" || line.startsWith("#")) continue;
    let pattern = line;
    let negated = false;
    if (pattern.startsWith("!")) {
      negated = true;
      pattern = pattern.slice(1);
    }
    let dirOnly = false;
    if (pattern.endsWith("/")) {
      dirOnly = true;
      pattern = pattern.slice(0, -1);
    }
    // A separator anywhere in the pattern anchors it to baseDir;
    // otherwise it matches at any depth below baseDir.
    const anchored = pattern.includes("/");
    if (pattern.startsWith("/")) pattern = pattern.slice(1);
    if (pattern === "") continue;
    const prefix = baseDir === ""
      ? ""
      : `${baseDir.replace(/[.+^${}()|\\]/g, "\\$&")}/`;
    const depth = anchored ? "" : "(?:.*/)?";
    let regex: RegExp;
    try {
      regex = new RegExp(`^${prefix}${depth}${globToRegexSource(pattern)}$`);
    } catch {
      continue; // skip a line that compiles to an invalid regex (e.g. a
      // malformed character class) rather than crashing discovery
    }
    rules.push({ regex, negated, dirOnly });
  }
  return rules;
}

/**
 * Test a root-relative POSIX path against compiled rules.
 * Last matching rule wins; no match → not ignored.
 *
 * @param isDir - Directory-only rules (`build/`) match only when true.
 */
export function isIgnored(
  relPath: string,
  isDir: boolean,
  rules: readonly GitignoreRule[],
): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.regex.test(relPath)) ignored = !rule.negated;
  }
  return ignored;
}
