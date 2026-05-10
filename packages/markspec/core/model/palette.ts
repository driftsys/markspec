/**
 * @module model/palette
 *
 * The seven-hue entry color palette and its semantic-name regex. Single
 * source of truth — both the profile manifest parser and the renderer
 * import from here so the two layers can never drift.
 *
 * Mirrors the `diagram:` group in `theme/tokens.yaml`. Adding a hue is a
 * tokens-side change followed by an entry here; the order does not matter
 * but kept stable for diagnostic message readability.
 */

/** The seven palette hues a profile may bind a semantic color name to. */
export const PALETTE_HUES = [
  "blue",
  "cyan",
  "teal",
  "orange",
  "red",
  "purple",
  "grey",
] as const;

/** Type of a palette hue name. */
export type PaletteHue = typeof PALETTE_HUES[number];

/** Regex for a valid semantic color-role name (key into `profile.colors:`). */
export const COLOR_NAME_RE = /^[a-z][a-z0-9-]*$/;
