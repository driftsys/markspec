/**
 * @module core/validator/per_type_attrs
 *
 * Per-type attribute compatibility check (spec §4.3 — MSL-T022). When
 * an entry's effective type resolves to a core type — via explicit
 * `Type:`, profile classification, or URI-scheme inference for
 * Reference-shape entries — any attribute that's known to the core
 * hierarchy but not allowed on that type fires MSL-T022 as a warning.
 * Unknown attributes (neither universal nor core-typed) fall through
 * to the existing MSL-R010 unknown-attribute warning in
 * `validator/mod.ts`.
 */

import type { Diagnostic, EffectiveProfile, Entry } from "../model/mod.ts";
import {
  attributesForType,
  CORE_TYPE_SCOPED_ATTRS,
  UNIVERSAL_ATTRIBUTE_KEYS,
} from "../model/mod.ts";
import { resolvedCoreType } from "./type_resolution.ts";

/**
 * Attribute keys that are universal to every entry regardless of type
 * (spec §1.4 + §1.5). Sourced entirely from {@linkcode UNIVERSAL_ATTRIBUTE_KEYS}
 * — `Type`, `Source`, `Origin`, `Reference-url`, and `Reference-document`
 * are now first-class catalogue entries, so the previous hand-maintained
 * extension list is no longer needed.
 */
const UNIVERSAL_KEYS: ReadonlySet<string> = new Set<string>(
  UNIVERSAL_ATTRIBUTE_KEYS,
);

/**
 * Emit per-type attribute diagnostics:
 *
 *   - **MSL-T022** (warning) — an attribute is core-known but not
 *     valid on the entry's *resolved* type.
 *   - **MSL-T024** (warning) — the entry's core type could not be
 *     resolved (no explicit `Type:`, no profile classification, no
 *     inferable signal — display-ID prefix / URI scheme /
 *     discriminating attribute) yet it carries a core-type-scoped
 *     attribute, so that attribute cannot be validated. Without this,
 *     such attributes slipped through silently (e.g. `Manufacturer:`
 *     on a `jira:`-scheme reference). Universal and entirely unknown
 *     attributes are exempt — those go through MSL-R010.
 */
export function validatePerTypeAttributes(
  entry: Entry,
  profile?: EffectiveProfile,
): readonly Diagnostic[] {
  const type = resolvedCoreType(entry, profile);
  if (type === undefined) {
    const diagnostics: Diagnostic[] = [];
    for (const attr of entry.rawAttributes) {
      if (UNIVERSAL_KEYS.has(attr.key)) continue;
      if (!CORE_TYPE_SCOPED_ATTRS.has(attr.key)) continue;
      diagnostics.push({
        code: "MSL-T024",
        severity: "warning",
        message:
          `${entry.displayId}: attribute '${attr.key}' is type-specific but ` +
          `the entry's core type could not be resolved; it cannot be ` +
          `validated (spec §8.3)`,
        location: entry.location,
      });
    }
    return diagnostics;
  }

  const allowed = attributesForType(type);
  const diagnostics: Diagnostic[] = [];

  for (const attr of entry.rawAttributes) {
    if (UNIVERSAL_KEYS.has(attr.key)) continue;
    if (allowed.has(attr.key)) continue;
    if (!CORE_TYPE_SCOPED_ATTRS.has(attr.key)) continue;
    diagnostics.push({
      code: "MSL-T022",
      severity: "warning",
      message:
        `${entry.displayId}: attribute '${attr.key}' is not valid on Type: ${type} ` +
        `(spec §1.6, ADR-003 §Part 2)`,
      location: entry.location,
    });
  }

  return diagnostics;
}
