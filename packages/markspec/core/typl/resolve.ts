/**
 * @module typl/resolve
 *
 * typl instantiation of the DSL-agnostic base-resolution engine
 * (core/decl/resolve, #722). Published typl symbols are dotted paths
 * (`$powertrain.brake.pedal_position`, ≥2 segments); relative refs keep
 * the sigil and mark relativity with a leading dot (`$.pedal_position`).
 * `$` is a *sigil* (part of the token), not a URI scheme — unlike uxil's
 * `ux:`, it stays on relative forms. See the S5 design spec
 * (docs/wip/2026-07-04-typl-published-tier-design.md, D2–D5).
 */
import type { RefOps } from "../decl/mod.ts";

/** True for `$.x` / `$.a.b` — a relative published ref. */
export function isRelativeTyplName(name: string): boolean {
  return /^\$\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(name);
}

/** True for `$a.b` / `$a.b.c` — an absolute published name (≥2 segments). */
export function isPublishedTyplName(name: string): boolean {
  return /^\$[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(name);
}

/** Strip the `$` sigil: `$powertrain.brake` → `powertrain.brake`. */
export function typlPathOf(name: string): string {
  return name.startsWith("$") ? name.slice(1) : name;
}

/**
 * Engine parameterization for typl: absolute = the sigil is followed by
 * an identifier character; join = base path + relative segments with the
 * sigil restored (`join("powertrain.brake", "$.x")` → `$powertrain.brake.x`).
 */
export const TYPL_REF_OPS: RefOps = {
  isAbsolute: (ref) => /^\$[A-Za-z_]/.test(ref),
  join: (base, ref) => `$${base}.${ref.slice(2)}`,
};
