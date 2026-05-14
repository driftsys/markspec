/**
 * @module core/validator/per_type_attrs
 *
 * Per-type attribute compatibility check (spec §4.3 — MSL-T022). When
 * an entry carries an explicit `Type:` that resolves to a core type,
 * any attribute that's known to the core hierarchy but not allowed on
 * that type fires MSL-T022 as a warning. Unknown attributes (neither
 * universal nor core-typed) fall through to the existing MSL-R010
 * unknown-attribute warning in `validator/mod.ts`.
 */

import type { Diagnostic, Entry } from "../model/mod.ts";
import {
  attributesForType,
  CORE_TYPE_HIERARCHY,
  CORE_TYPE_SCOPED_ATTRS,
  UNIVERSAL_ATTRIBUTE_KEYS,
} from "../model/mod.ts";

/**
 * Attribute keys that are universal to every entry regardless of type
 * (spec §1.4 + §1.5). The core attribute catalog covers most of these;
 * a few additional keys (`Type`, `Source`, `Origin`, the Reference-shape
 * promoted attrs) are core-known but not in {@linkcode UNIVERSAL_ATTRIBUTE_KEYS}
 * directly, so they're added here.
 */
const UNIVERSAL_KEYS: ReadonlySet<string> = new Set<string>([
  ...UNIVERSAL_ATTRIBUTE_KEYS,
  "Type",
  "Source",
  "Origin",
  "Reference-url",
  "Reference-document",
]);

/** Find the explicit `Type:` attribute on an entry. */
function explicitType(entry: Entry): string | undefined {
  for (const attr of entry.rawAttributes) {
    if (attr.key === "Type") return attr.value.trim();
  }
  return undefined;
}

/**
 * Emit MSL-T022 warnings for attributes that are core-known but not
 * valid on the entry's resolved type. Skips entries without an
 * explicit `Type:`, entries whose `Type:` is not a core type (those
 * are handled by MSL-T020 / MSL-T023 / MSL-T021), and attributes that
 * are universal or unknown to the core hierarchy entirely (those go
 * through MSL-R010).
 */
export function validatePerTypeAttributes(
  entry: Entry,
): readonly Diagnostic[] {
  const type = explicitType(entry);
  if (type === undefined) return [];
  if (!CORE_TYPE_HIERARCHY[type]) return [];

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
