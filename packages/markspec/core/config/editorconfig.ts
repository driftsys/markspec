/**
 * @module config/editorconfig
 *
 * Resolve the Markdown style of `markspec fmt` (line width and line
 * ending) from `.editorconfig` files, with the same rules as `prim fmt`
 * (driftsys/markspec#984, driftsys/prim#227).
 *
 * The rules follow the EditorConfig specification as implemented by the
 * `ec4rs` crate that prim uses:
 *
 * - The `.editorconfig` files are read from the file's directory up to the
 *   file system root. The walk stops after the first file whose preamble
 *   holds `root = true`.
 * - Files are applied from the outermost to the nearest, and sections in
 *   file order, so a later match overrides an earlier one.
 * - A section glob without a `/` matches the file name in any directory
 *   below the `.editorconfig` file. A glob with a `/` matches the path
 *   relative to the `.editorconfig` file; a leading `/` is dropped.
 * - A line that is not a comment, a section header or a `key = value` pair
 *   makes the whole chain invalid, and the defaults apply (prim drops the
 *   whole cascade in the same case).
 * - A file that cannot be read is skipped.
 *
 * Keys read: `max_line_length` (a non-negative integer, optionally with
 * `+`, as Rust `usize` parses it; `off`, unset and invalid values give 80)
 * and `end_of_line` (`lf`, `crlf`; `cr`, an unset key and an invalid value
 * give `lf`).
 *
 * Paths must be absolute: core never reads the current directory.
 *
 * No file I/O here: the caller injects `readFile`, so the module runs on
 * Node and Deno.
 */

import type { ReadFile } from "./mod.ts";

/** Line width used when no `.editorconfig` sets `max_line_length`. The
 * single source of the default: the formatter's own default
 * (`MARKSPEC_MARKDOWN_GLOBAL_CONFIG.lineWidth`) reads this value. */
export const DEFAULT_MARKDOWN_LINE_WIDTH = 80;

/** The Markdown style resolved for one file. */
export interface EditorConfigStyle {
  /** Line width of the Markdown pass, in columns. */
  readonly lineWidth: number;
  /** Line ending to write. */
  readonly endOfLine: "lf" | "crlf";
  /** `true` when `end_of_line` is set to a value prim reads (`lf`,
   * `crlf` or `cr`); `false` when LF comes from the default. */
  readonly endOfLineSet: boolean;
}

/** One parsed section of an `.editorconfig` file. */
interface Section {
  readonly matcher: (relativePath: string) => boolean;
  /** Pairs with lowercase keys, in file order. */
  readonly pairs: ReadonlyArray<readonly [string, string]>;
}

/** One parsed `.editorconfig` file. */
interface ParsedConfig {
  readonly root: boolean;
  readonly sections: readonly Section[];
}

/** Result of parsing one file: the config, or `"invalid"`. */
type ParseResult = ParsedConfig | "invalid";

/** Resolves {@linkcode EditorConfigStyle} for an absolute file path. A
 * relative path is rejected: core never reads the current directory, so
 * the module runs on Node and Deno alike. */
export type EditorConfigResolver = (
  filePath: string,
) => Promise<EditorConfigStyle>;

/**
 * Create a resolver that caches each parsed `.editorconfig` file, so a run
 * over many files reads every config file once.
 */
export function createEditorConfigResolver(
  readFile: ReadFile,
): EditorConfigResolver {
  const cache = new Map<string, Promise<ParseResult | undefined>>();
  const load = (path: string) => {
    let pending = cache.get(path);
    if (!pending) {
      pending = readFile(path).then((text) =>
        text === undefined ? undefined : parseEditorConfig(text)
      );
      cache.set(path, pending);
    }
    return pending;
  };
  return async (filePath) => {
    const absolute = normalizePath(filePath);
    if (absolute === undefined) {
      throw new TypeError(
        `.editorconfig resolution needs an absolute path, got "${filePath}"`,
      );
    }
    // Nearest first while walking up.
    const chain: Array<{ dir: string; config: ParsedConfig }> = [];
    for (const dir of ancestorDirs(absolute)) {
      const parsed = await load(configPath(dir));
      if (parsed === "invalid") return defaultStyle();
      if (parsed !== undefined) {
        chain.push({ dir, config: parsed });
        if (parsed.root) break;
      }
    }
    const props = new Map<string, string>();
    for (const { dir, config } of chain.reverse()) {
      const rel = absolute.slice(dir.length + (dir.endsWith("/") ? 0 : 1));
      for (const section of config.sections) {
        if (!section.matcher(rel)) continue;
        for (const [key, value] of section.pairs) props.set(key, value);
      }
    }
    return styleFrom(props);
  };
}

/**
 * `path` with `/` separators, or `undefined` when it is not absolute. A
 * POSIX path (`/a/b`) and a Windows path (`C:\a\b`, `C:/a/b`, or a
 * `\\server\share` UNC path) are both accepted on every platform, so the
 * walk does not depend on the host's path module. Windows accepts `/` in a
 * path, so the config paths built from it can be read as they are.
 */
function normalizePath(path: string): string | undefined {
  const slashed = path.replaceAll("\\", "/");
  return slashed.startsWith("/") || /^[A-Za-z]:\//.test(slashed)
    ? slashed
    : undefined;
}

/** The directories that hold `path`, nearest first, ending at the root
 * (`/`, `C:/`, or `//server/share/`). */
function ancestorDirs(path: string): string[] {
  const unc = /^\/\/[^/]+\/[^/]+\//.exec(path)?.[0];
  const root = unc ?? (/^[A-Za-z]:\//.exec(path)?.[0] ?? "/");
  const dirs: string[] = [];
  let dir = path.slice(0, path.lastIndexOf("/"));
  while (dir.length >= root.length) {
    dirs.push(dir);
    dir = dir.slice(0, dir.lastIndexOf("/"));
  }
  if (dirs.at(-1) !== root) dirs.push(root);
  return dirs;
}

/** Path of the `.editorconfig` file in `dir`. */
function configPath(dir: string): string {
  return dir.endsWith("/") ? `${dir}.editorconfig` : `${dir}/.editorconfig`;
}

/** Resolve the style of one file without a shared cache. */
export function resolveEditorConfigStyle(
  filePath: string,
  readFile: ReadFile,
): Promise<EditorConfigStyle> {
  return createEditorConfigResolver(readFile)(filePath);
}

function defaultStyle(): EditorConfigStyle {
  return {
    lineWidth: DEFAULT_MARKDOWN_LINE_WIDTH,
    endOfLine: "lf",
    endOfLineSet: false,
  };
}

/** Map resolved properties to the style (prim `style_from`). */
function styleFrom(props: ReadonlyMap<string, string>): EditorConfigStyle {
  // ec4rs parses `max_line_length` as a Rust `usize` (`off` aside), and
  // prim uses the number as given, `0` included; `+100` is 100. Anything
  // else (`off`, `unset`, a negative or invalid value) leaves prim's
  // Markdown default of 80 (`unwrap_or(80)`).
  let lineWidth = DEFAULT_MARKDOWN_LINE_WIDTH;
  const max = props.get("max_line_length")?.toLowerCase();
  if (max !== undefined && /^\+?\d+$/.test(max)) {
    const n = Number(max);
    if (Number.isSafeInteger(n)) lineWidth = n;
  }
  // `crlf` gives CRLF; `lf` and `cr` give LF. An unset key or a value
  // ec4rs rejects leaves prim's default, LF (`Style::default()`).
  const eol = props.get("end_of_line")?.toLowerCase();
  const endOfLineSet = eol === "lf" || eol === "crlf" || eol === "cr";
  const endOfLine = eol === "crlf" ? "crlf" : "lf";
  return { lineWidth, endOfLine, endOfLineSet };
}

/**
 * Parse the text of one `.editorconfig` file. Returns `"invalid"` when a
 * line is neither a comment, a section header nor a `key = value` pair.
 * The line grammar is the one of `ec4rs` (prim `editorconfig/line.rs`).
 */
export function parseEditorConfig(text: string): ParseResult {
  let root = false;
  const sections: Section[] = [];
  let current: { glob: string; pairs: Array<[string, string]> } | undefined;
  const flush = () => {
    if (current) {
      sections.push({
        matcher: compileGlob(current.glob),
        pairs: current.pairs,
      });
    }
  };
  const lines = text.replace(/^﻿/, "").split(/\r?\n|\r/);
  for (const raw of lines) {
    const line = parseLine(raw);
    if (line.kind === "nothing") continue;
    if (line.kind === "invalid") return "invalid";
    if (line.kind === "section") {
      flush();
      current = { glob: line.glob, pairs: [] };
      continue;
    }
    const key = line.key.toLowerCase();
    if (current) {
      current.pairs.push([key, line.value]);
    } else if (key === "root") {
      root = line.value.toLowerCase() === "true";
    }
  }
  flush();
  return { root, sections };
}

type Line =
  | { kind: "nothing" }
  | { kind: "invalid" }
  | { kind: "section"; glob: string }
  | { kind: "pair"; key: string; value: string };

function isComment(c: string): boolean {
  return c === ";" || c === "#";
}

/** One line, as `ec4rs` `parse_line` reads it. */
function parseLine(input: string): Line {
  let rest = input.trimStart();
  if (rest.length > 0 && isComment(rest[0])) return { kind: "nothing" };
  // A comment after the last `]` is stripped; any other `;` or `#` stays.
  const bracket = rest.lastIndexOf("]");
  const comment = Math.max(rest.lastIndexOf(";"), rest.lastIndexOf("#"));
  if (bracket >= 0 && comment > bracket) rest = rest.slice(0, comment);
  rest = rest.trimEnd();
  if (rest.length === 0) return { kind: "nothing" };
  if (rest.startsWith("[") && rest.endsWith("]") && rest.length >= 2) {
    const glob = rest.slice(1, -1);
    return glob.length === 0 ? { kind: "invalid" } : { kind: "section", glob };
  }
  const eq = rest.indexOf("=");
  if (eq < 0) return { kind: "invalid" };
  const key = rest.slice(0, eq).trimEnd();
  const value = rest.slice(eq + 1).trimStart();
  if (key.length === 0 || value.length === 0) return { kind: "invalid" };
  return { kind: "pair", key, value };
}

/**
 * Compile an EditorConfig section glob to a matcher of `/`-separated paths
 * relative to the `.editorconfig` directory. Supports `*`, `**`, `?`,
 * `[set]`, `[!set]`, `{a,b}`, `{n1..n2}` and `\` escapes.
 */
export function compileGlob(glob: string): (relativePath: string) => boolean {
  const ranges: Array<[number, number]> = [];
  const anchored = glob.includes("/");
  const pattern = anchored && glob.startsWith("/") ? glob.slice(1) : glob;
  // A glob ending in `/` matches any file name in that directory (ec4rs
  // appends `AnySeq(false)` after a trailing separator).
  const body = translate(pattern, ranges) +
    (pattern.endsWith("/") ? "[^/]*" : "");
  const source = anchored ? `^${body}$` : `^(?:.*/)?${body}$`;
  const re = new RegExp(source, "s");
  return (path) => {
    const m = re.exec(path);
    if (!m) return false;
    // Numeric ranges are matched as integers, then checked here.
    for (let i = 0; i < ranges.length; i++) {
      const n = Number(m[i + 1]);
      const [lo, hi] = ranges[i];
      if (n < lo || n > hi) return false;
    }
    return true;
  };
}

function escapeRe(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Index of the `}` that closes the `{` at `open`, or -1. */
function closingBrace(glob: string, open: number): number {
  let depth = 0;
  for (let i = open; i < glob.length; i++) {
    const c = glob[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Split brace content on top-level commas. */
function splitAlternatives(content: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(content.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(content.slice(start));
  return parts;
}

function translate(glob: string, ranges: Array<[number, number]>): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "\\" && i + 1 < glob.length) {
      out += escapeRe(glob[++i]);
    } else if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "[") {
      // ec4rs splits the glob on `/` before it reads a set, so a set
      // never spans a `/`: an unclosed `[` in its segment is literal.
      const close = glob.indexOf("]", i + 1);
      const slash = glob.indexOf("/", i + 1);
      if (close < 0 || (slash >= 0 && slash < close)) {
        out += "\\[";
        continue;
      }
      let set = glob.slice(i + 1, close);
      const negate = set.startsWith("!");
      if (negate) set = set.slice(1);
      // ec4rs drops `/` from a set. An empty set is the literal `[]`, or
      // any one character when negated.
      set = set.replaceAll("/", "");
      if (set === "") {
        out += negate ? "[^/]" : "\\[\\]";
      } else {
        out += `[${negate ? "^/" : ""}${set.replace(/[\\\]^]/g, "\\$&")}]`;
      }
      i = close;
    } else if (c === "{") {
      const close = closingBrace(glob, i);
      if (close < 0) {
        out += "\\{";
        continue;
      }
      const content = glob.slice(i + 1, close);
      const range = /^([+-]?\d+)\.\.([+-]?\d+)$/.exec(content);
      const alternatives = splitAlternatives(content);
      if (range) {
        const a = Number(range[1]);
        const b = Number(range[2]);
        ranges.push([Math.min(a, b), Math.max(a, b)]);
        out += "([+-]?\\d+)";
      } else if (alternatives.length > 1) {
        out += `(?:${
          alternatives.map((alt) => translate(alt, ranges)).join("|")
        })`;
      } else {
        out += `\\{${translate(content, ranges)}\\}`;
      }
      i = close;
    } else {
      out += escapeRe(c);
    }
  }
  return out;
}
