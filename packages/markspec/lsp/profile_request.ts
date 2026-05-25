/**
 * @module lsp/profile_request
 *
 * Pure helper for the LSP `markspec/profile` custom request. Derives the
 * wire-shape response from `core/profile`'s in-memory model:
 *
 *   - Strips `{NNNN}` placeholder from `displayIdPattern` to compute
 *     `prefix`.
 *   - Resolves the type's color role (e.g. "primary") through
 *     `EffectiveProfile.colors` to a palette hue name ("blue" | ...).
 *   - Validates the hue against `PALETTE_HUES`; returns `null` on any
 *     failure path (no role declared, role not in colors map, value
 *     outside palette).
 *
 * No file I/O, no LSP types — testable from a unit test with synthetic
 * profile inputs.
 *
 * See `docs/superpowers/specs/2026-05-25-lsp-profile-request-design.md` §3
 * for the response shape and §5 for the edge-case decisions.
 */

import type {
  EffectiveProfile,
  PaletteHue,
  ProfileChain,
} from "../core/mod.ts";
import { PALETTE_HUES } from "../core/mod.ts";

/** A single tier in the profile chain. */
export interface ProfileLayer {
  /** Manifest `id`, e.g. "markspec/default". */
  readonly name: string;
  /** Resolved source — file path or package specifier. */
  readonly source: string;
}

/** Per-type metadata exposed to clients. */
export interface ProfileTypeInfo {
  /** Type name, e.g. "stakeholder-requirement". */
  readonly name: string;
  /** Display-ID prefix derived from `displayIdPattern` (placeholder stripped). Empty string when no pattern. */
  readonly prefix: string;
  /** Palette hue name, or `null` when no color resolves. */
  readonly color: PaletteHue | null;
}

/** Effective profile view returned by `markspec/profile`. */
export interface EffectiveProfileInfo {
  /** Innermost (child-most) tier's id, or "(none)" when no profile is loaded. */
  readonly name: string;
  readonly types: ReadonlyArray<ProfileTypeInfo>;
}

/** Top-level response shape. */
export interface MarkspecProfileResponse {
  readonly chain: ReadonlyArray<ProfileLayer>;
  readonly effective: EffectiveProfileInfo;
}

/**
 * Empty response shape — returned when no profile is loaded (file-local
 * mode). Exported so both the helper's empty-shape branch and the server's
 * cache initializer reference one literal, avoiding drift.
 */
export const EMPTY_PROFILE_RESPONSE: MarkspecProfileResponse = {
  chain: [],
  effective: { name: "(none)", types: [] },
};

/**
 * Compute the LSP wire response from the loaded chain + effective profile.
 *
 * Returns the empty shape (`chain: []`, `effective.name: "(none)"`,
 * `effective.types: []`) when `chain` is `null` or `effective` is
 * `undefined` — the file-local mode.
 */
export function buildProfileResponse(
  chain: ProfileChain | null,
  effective: EffectiveProfile | undefined,
): MarkspecProfileResponse {
  if (!chain || !effective) {
    return EMPTY_PROFILE_RESPONSE;
  }

  const layers: ProfileLayer[] = chain.tiers.map((tier) => ({
    name: tier.id,
    source: tier.sourcePath,
  }));

  const effectiveName = chain.tiers.length > 0
    ? chain.tiers[chain.tiers.length - 1].id
    : "(none)";

  const types: ProfileTypeInfo[] = [];
  for (const [name, entry] of effective.types) {
    const typeDef = entry.value;
    types.push({
      name,
      prefix: derivePrefix(typeDef.displayIdPattern.value),
      color: resolveHue(typeDef.color.value, effective),
    });
  }

  return { chain: layers, effective: { name: effectiveName, types } };
}

/**
 * Strip the `{...}` placeholder from a display-ID pattern to yield the
 * fixed prefix. Returns the empty string when no placeholder is present
 * or the pattern is undefined.
 */
function derivePrefix(pattern: string | undefined): string {
  if (!pattern) return "";
  const idx = pattern.indexOf("{");
  if (idx < 0) return "";
  return pattern.slice(0, idx);
}

/**
 * Resolve a type's color role through the profile's `colors` map to a
 * palette hue name. Returns `null` when:
 *   - the type declares no color role,
 *   - the role is not bound in `effective.colors`, or
 *   - the bound value is not a member of {@linkcode PALETTE_HUES}.
 */
function resolveHue(
  roleName: string | undefined,
  effective: EffectiveProfile,
): PaletteHue | null {
  if (!roleName) return null;
  const bound = effective.colors.get(roleName);
  if (!bound) return null;
  const hue = bound.value;
  if (!(PALETTE_HUES as readonly string[]).includes(hue)) return null;
  return hue as PaletteHue;
}
