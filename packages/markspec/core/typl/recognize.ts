/**
 * @module typl/recognize
 *
 * typl declaration recognizer — the DSL-specific predicate the shared
 * declaration-surface machinery (core/decl) is parameterized by. A typl
 * declaration is a binding (`$Name : …`) or a typedef (`type Name = …`).
 * The bullet and inline surfaces share this text recognizer; the fence
 * surface is recognized by its `typl` info-string (see fence.ts).
 *
 * See ADR-019.
 */

/** Matches a typl binding: `$Name :`, `$a.b :` (published), `$.x :` (relative). */
const BINDING_RE = /^\$\.?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\s*:/;

/** Matches a typl typedef: `type Name =`. */
const TYPEDEF_RE = /^type\s+[A-Za-z_][A-Za-z0-9_]*\s*=/;

/** True when `text` begins a typl binding or typedef declaration. */
export function isTyplDeclarationText(text: string): boolean {
  return BINDING_RE.test(text) || TYPEDEF_RE.test(text);
}
