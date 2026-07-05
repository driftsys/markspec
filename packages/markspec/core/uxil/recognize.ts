/**
 * @module uxil/recognize
 *
 * Form-classification predicate — the DSL-specific routing S8's surface walk
 * uses to send a code span to the right parser. Pure string inspection on the
 * span-inner text (the caller strips backticks). A citation ref
 * (`ux:surface/element…`) or non-uxil text returns `undefined`.
 */

export type UxilForm = "root" | "element" | "child";

/**
 * Classify a uxil code span. `/`-led → element; `.`-led → child surface; a
 * surface followed by a `:` kind *before* any `/` → root declaration.
 * Everything else (a citation ref, plain prose) → `undefined`.
 */
export function classifyUxilForm(spanText: string): UxilForm | undefined {
  const t = spanText.trim();
  if (t.startsWith("/")) return "element";
  if (t.startsWith(".")) return "child";
  const body = t.startsWith("ux:") ? t.slice(3) : t;
  const slash = body.indexOf("/");
  const colon = body.indexOf(":");
  // A `:` before any `/` is the kind clause of a root declaration; a `:` after
  // a `/` is a ref key (a citation), and no `:` at all is a bare citation.
  if (colon >= 0 && (slash < 0 || colon < slash)) return "root";
  return undefined;
}
