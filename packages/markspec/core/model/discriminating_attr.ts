/**
 * @module core/model/discriminating_attr
 *
 * Spec §1.3.1 step 6 — discriminating-attribute introspection.
 *
 * The presence of a type-specific attribute key on an entry whose core
 * type is otherwise unresolved infers that type. Only attribute keys
 * **uniquely owned** by a single concrete core type are listed here; keys
 * shared between siblings (e.g., `Caused-by` between Record and Risk, or
 * `Manufacturer` between HardwareComponent and HardwareUnit) are not
 * discriminating and intentionally absent.
 *
 * Owner mapping is derived from spec §1.6 “Per-abstract-type and
 * per-concrete-type attributes” (ADR-003 §Part 2 catalogue).
 *
 * `Source:` could in principle also discriminate to `SoftwareUnit`, but
 * step 3 introspection already runs ahead of step 6 and would have
 * matched filename/extension first — listing it here would only fire
 * when the filename pattern misses, which is fine to support.
 */

/**
 * Map from discriminating attribute key → unique-owner core type. Each
 * key here appears in exactly one concrete type's attribute list per
 * §1.6, so its presence is sufficient to infer that type.
 */
const DISCRIMINATING_ATTRIBUTES: ReadonlyMap<string, string> = new Map([
  // Test
  ["Verifies", "Test"],
  ["Tests", "Test"],
  // Contract
  ["Schema-language", "Contract"],
  // Record
  ["Affects", "Record"],
  // Risk
  ["Mitigated-by", "Risk"],
  // SoftwareComponent
  ["License", "SoftwareComponent"],
  ["Build-manifest", "SoftwareComponent"],
  ["Package-manager", "SoftwareComponent"],
  // HardwareInterface
  ["Bus-protocol", "HardwareInterface"],
  ["Connector-type", "HardwareInterface"],
  ["Voltage-level", "HardwareInterface"],
  ["Signal-direction", "HardwareInterface"],
  // SoftwareUnit
  ["Source", "SoftwareUnit"],
  ["Symbol", "SoftwareUnit"],
  ["Language", "SoftwareUnit"],
  // HardwareUnit
  ["Footprint", "HardwareUnit"],
  ["Value", "HardwareUnit"],
  // Definition
  ["Aliases", "Definition"],
  ["See-also", "Definition"],
]);

/**
 * Infer a core type from the first discriminating attribute key present
 * on the entry. `attributeKeys` is the source-order list of attribute
 * keys (TitleCase-Hyphenated form, as parsed). Returns `undefined` when
 * no discriminating key is found.
 *
 * Source order matters: if an entry mistakenly carries discriminators
 * for two different types (e.g., `Verifies:` and `Schema-language:`),
 * the first one in source order wins for step-6 purposes. The MSL-T022
 * pass then flags the second one as incompatible.
 */
export function inferTypeFromDiscriminatingAttr(
  attributeKeys: readonly string[],
): string | undefined {
  for (const key of attributeKeys) {
    const type = DISCRIMINATING_ATTRIBUTES.get(key);
    if (type !== undefined) return type;
  }
  return undefined;
}
