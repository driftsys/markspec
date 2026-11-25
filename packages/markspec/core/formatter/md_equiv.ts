/**
 * @module formatter/md_equiv
 *
 * GFM-semantic Markdown equivalence (CommonMark with the GitHub Flavored
 * Markdown extensions, parsed by remark-parse and remark-gfm) — the gate for
 * the ADR-029 dprint pass and entry tab-marker normalization. Two fragments
 * are equivalent when they parse to the same mdast structure after eliding
 * source `position`s and collapsing ASCII whitespace runs inside `text` node
 * values. Only ASCII
 * whitespace is collapsed — NBSP (U+00A0) and Unicode spaces are
 * content, not wrap artifacts, and must not compare equal to a plain
 * space. Soft-wrap positions,
 * emphasis delimiter style (`*x*` vs `_x_`), table cell padding, and
 * list marker style are presentation, not content — they compare
 * equal. Hard breaks are `break` nodes in mdast, so wrap-collapsing
 * cannot erase or fabricate one. Code (`code`, `inlineCode`), `html`,
 * and definition `url`s stay byte-exact. The language tag of a fenced code
 * block is compared as mdast `lang`. The info-string text after it is
 * compared as written in the source, without its leading and trailing
 * spaces: an escape or a character reference in it is not decoded (#1008).
 *
 * The fragments are parsed with remark-parse and remark-gfm, so GFM
 * constructs such as tables and task lists are part of the compared tree.
 *
 * DELIBERATELY weaker than ADR-015's `astEquivalent` (byte-verbatim on
 * inline markup). Used to accept/reject dprint output and tab-marker rewrites.
 *
 * Two checks guard §5.2 body emission (MSL-F900). The first is the ADR-015
 * relation, which must not be modified. The second is this relation with
 * {@linkcode MarkdownEquivalenceOptions} `ignoreTextCase`, `ignoreListStart`
 * and `featureLangAlias`: it compares an emitted entry body with the original
 * body text, so it also sees text that the AST build dropped (#989). It
 * allows three rewrites: text case, the ordered-list start, and a `feature`
 * fence language read as `gherkin`. The info-string text after the language
 * is still compared as written in the source.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { verbatimFenceMeta } from "../ast/build.ts";

const parser = unified().use(remarkParse).use(remarkGfm);

/** Extra relaxations of {@linkcode markdownSemanticallyEquivalent}. Every
 * option defaults to `false`, which keeps the default relation. */
export interface MarkdownEquivalenceOptions {
  /** Compare `text` node values case-insensitively. Other values (code,
   * `html`, URLs, image `alt`) stay case-sensitive. */
  readonly ignoreTextCase?: boolean;
  /** Ignore the `start` number of ordered lists. */
  readonly ignoreListStart?: boolean;
  /** Read the code `lang` `feature` as `gherkin`. The body emitter writes a
   * fence that the AST builder reads as a feature block (`lang` `gherkin` or
   * `feature`, `core/ast/build.ts`) with the `gherkin` info string
   * (`renderFeature`, `core/ast/render.ts`); keep this alias in sync with
   * both. Every other `lang` value stays byte-exact. */
  readonly featureLangAlias?: boolean;
}

/** True when `a` and `b` are the same Markdown, modulo presentation. */
export function markdownSemanticallyEquivalent(
  a: string,
  b: string,
  options: MarkdownEquivalenceOptions = {},
): boolean {
  if (a === b) return true;
  return deepEqual(
    markdownEquivalenceTree(a, options),
    markdownEquivalenceTree(b, options),
  );
}

/**
 * The normalized tree that {@linkcode markdownSemanticallyEquivalent}
 * compares for `text`: the mdast tree without positions, with whitespace
 * runs in text collapsed, and with each code node's decoded `meta` replaced
 * by `verbatimMeta`.
 *
 * @internal Exported for tests.
 */
export function markdownEquivalenceTree(
  text: string,
  options: MarkdownEquivalenceOptions = {},
): unknown {
  return normalize(parser.parse(text), options, text);
}

/**
 * The verbatim info-string text after the language tag of the fenced code
 * block `node` in `source`, with leading and trailing spaces and tabs
 * removed, or `undefined` when there is none. An indented code block has no
 * `lang` and never has this text. mdast `meta` decodes escapes and character
 * references, so `a&amp;b` and `a&b` have the same `meta`; this text keeps
 * them apart, so a rewrite of the info string is a difference (#1008). The
 * language tag itself is not part of this text: it is compared as mdast
 * `lang`, so a relation that maps `lang` values applies to it alone.
 */
function verbatimMeta(
  node: Record<string, unknown>,
  source: string,
): string | undefined {
  if (!node.lang) return undefined;
  const offset = (node.position as { start?: { offset?: number } } | undefined)
    ?.start?.offset;
  if (offset === undefined) return undefined;
  return verbatimFenceMeta(source.slice(offset))?.trim() || undefined;
}

/**
 * Recursively strip `position` keys and collapse ASCII whitespace runs
 * in `text` node values (reflow can only introduce ASCII spaces and
 * newlines; `\s` would also match NBSP and Unicode Zs spaces, letting
 * a content change pass as a wrap change). Returns a plain JSON-ish
 * structure for comparison; never mutates the input tree.
 */
function normalize(
  node: unknown,
  options: MarkdownEquivalenceOptions,
  source: string,
): unknown {
  if (Array.isArray(node)) {
    return node.map((n) => normalize(n, options, source));
  }
  if (node === null || typeof node !== "object") return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (src.type === "code") out.verbatimMeta = verbatimMeta(src, source);
  for (const key of Object.keys(src).sort()) {
    if (key === "position") continue;
    // The decoded `meta` is replaced by `verbatimMeta` above.
    if (key === "meta" && src.type === "code") continue;
    if (
      key === "value" && src.type === "text" &&
      typeof src.value === "string"
    ) {
      const value = src.value.replace(/[ \t\r\n\f\v]+/g, " ");
      out.value = options.ignoreTextCase ? value.toLowerCase() : value;
      continue;
    }
    if (key === "start" && src.type === "list" && options.ignoreListStart) {
      continue;
    }
    if (
      key === "lang" && src.type === "code" && options.featureLangAlias &&
      src.lang === "feature"
    ) {
      out.lang = "gherkin";
      continue;
    }
    out[key] = normalize(src[key], options, source);
  }
  return out;
}

/** Structural deep-equality over the normalized trees. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every((k) =>
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      )
    );
  }
  return false;
}
