/**
 * @module render/typst/colors
 *
 * Profile-driven entry color resolution. Pure function that maps an entry
 * and the active profile to a palette hue name (or `null` for uncolored).
 *
 * See docs/superpowers/specs/2026-05-06-profile-driven-entry-colors-design.md
 * for the resolution table.
 */

import {
  type EffectiveProfile,
  type Entry,
  PALETTE_HUES,
  type PaletteHue,
} from "../../core/mod.ts";

// Re-export so existing consumers of these symbols (tests, downstream code)
// don't need to switch imports. The single source of truth lives in
// `core/model/palette.ts`.
export { PALETTE_HUES };
export type { PaletteHue };

/** Default identified-entry hue when no profile / no type color resolves. */
const DEFAULT_HUE: PaletteHue = "blue";

/**
 * Resolve the palette hue for an entry under the active profile.
 *
 * Returns `null` for referenced-shape entries (uncolored block).
 * Returns a palette hue name for identified entries — using the type's
 * declared color when available, falling back to `"blue"` otherwise.
 *
 * The fallback is the palette hue directly (not the `primary` semantic
 * name) so the renderer works for files compiled without a profile.
 */
export function resolveEntryColor(
  entry: Entry,
  profile: EffectiveProfile | undefined,
): PaletteHue | null {
  if (entry.shape === "referenced") return null;

  if (!profile || !entry.type) return DEFAULT_HUE;

  const typeDef = profile.types.get(entry.type);
  const colorName = typeDef?.value.color.value;
  if (!colorName) return DEFAULT_HUE;

  const hueEntry = profile.colors.get(colorName);
  if (!hueEntry) return DEFAULT_HUE;

  // Defense in depth: the manifest parser already enforces PALETTE_HUES, but
  // EffectiveProfile can in principle be constructed programmatically (tests,
  // future APIs) without going through parseManifest. Guard the cast so an
  // invalid hue can never reach the Typst interpolation in template.ts.
  const hue = hueEntry.value;
  if (!(PALETTE_HUES as readonly string[]).includes(hue)) return DEFAULT_HUE;
  return hue as PaletteHue;
}
