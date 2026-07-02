/**
 * @module formatter/md_equiv
 *
 * CommonMark-semantic Markdown equivalence — the gate for the ADR-029
 * dprint pass. Two fragments are equivalent when they parse to the
 * same mdast structure after eliding source `position`s and collapsing
 * ASCII whitespace runs inside `text` node values. Only ASCII
 * whitespace is collapsed — NBSP (U+00A0) and Unicode spaces are
 * content, not wrap artifacts, and must not compare equal to a plain
 * space. Soft-wrap positions,
 * emphasis delimiter style (`*x*` vs `_x_`), table cell padding, and
 * list marker style are presentation, not content — they compare
 * equal. Hard breaks are `break` nodes in mdast, so wrap-collapsing
 * cannot erase or fabricate one. Code (`code`, `inlineCode`), `html`,
 * and definition `url`s stay byte-exact.
 *
 * DELIBERATELY weaker than ADR-015's `astEquivalent` (byte-verbatim on
 * inline markup). Used ONLY to accept/reject dprint output; the
 * ADR-015 relation still guards §5.2 body emission (MSL-F900) and must
 * not be modified.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const parser = unified().use(remarkParse).use(remarkGfm);

/** True when `a` and `b` are the same Markdown, modulo presentation. */
export function markdownSemanticallyEquivalent(
  a: string,
  b: string,
): boolean {
  if (a === b) return true;
  return deepEqual(
    normalize(parser.parse(a)),
    normalize(parser.parse(b)),
  );
}

/**
 * Recursively strip `position` keys and collapse ASCII whitespace runs
 * in `text` node values (reflow can only introduce ASCII spaces and
 * newlines; `\s` would also match NBSP and Unicode Zs spaces, letting
 * a content change pass as a wrap change). Returns a plain JSON-ish
 * structure for comparison; never mutates the input tree.
 */
function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (node === null || typeof node !== "object") return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) {
    if (key === "position") continue;
    if (
      key === "value" && src.type === "text" &&
      typeof src.value === "string"
    ) {
      out.value = src.value.replace(/[ \t\r\n\f\v]+/g, " ");
      continue;
    }
    out[key] = normalize(src[key]);
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
