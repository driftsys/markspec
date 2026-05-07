/**
 * @module render/typst/colors
 *
 * Profile-driven entry color resolution. Pure function that maps an entry
 * and the active profile to a palette hue name (or `null` for uncolored).
 *
 * See docs/superpowers/specs/2026-05-06-profile-driven-entry-colors-design.md
 * for the resolution table.
 */

import type { EffectiveProfile, Entry } from "../../core/mod.ts";

/** The seven palette hues the renderer can emit. */
export const PALETTE_HUES = [
  "blue",
  "cyan",
  "teal",
  "orange",
  "red",
  "purple",
  "grey",
] as const;

export type PaletteHue = typeof PALETTE_HUES[number];

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

  return hueEntry.value as PaletteHue;
}
