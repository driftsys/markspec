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

import type { Diagnostic, Entry } from "../model/mod.ts";
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
 * Emit MSL-T022 warnings for attributes that are core-known but not
 * valid on the entry's resolved type. Skips entries whose type cannot
 * be resolved (no explicit `Type:`, no profile classification, no URI
 * scheme inference — those are handled by MSL-T020 / MSL-T021 /
 * MSL-T023) and attributes that are universal or entirely unknown to
 * the core hierarchy (those go through MSL-R010).
 */
export function validatePerTypeAttributes(
  entry: Entry,
): readonly Diagnostic[] {
  const type = resolvedCoreType(entry);
  if (type === undefined) return [];

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
