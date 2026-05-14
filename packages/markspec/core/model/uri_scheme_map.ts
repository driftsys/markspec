/**
 * @module model/uri_scheme_map
 *
 * Reference-shape URI → core type inference per ADR-003 §Part 6.
 * Used by spec §1.3.1 step 5 of the type-resolution chain: a Reference
 * entry whose `Id:` is a recognised URI scheme can infer its core type
 * without an explicit `Type:` attribute.
 *
 * The map is intentionally conservative: only patterns the spec lists
 * normatively are encoded. Profile extensions to the scheme map land
 * in the profile layer.
 */

/**
 * Rule: a regex matched against the full URI value plus the core type
 * the URI infers to. Rules are checked in declaration order; the first
 * match wins. Patterns are anchored at the start (`^`) but not at the
 * end so package URLs with versions / subpaths still match.
 */
interface UriSchemeRule {
  readonly pattern: RegExp;
  readonly type: string;
}

const URI_SCHEME_RULES: readonly UriSchemeRule[] = [
  // Package URLs (purl) — Software components
  { pattern: /^pkg:cargo\//, type: "SoftwareComponent" },
  { pattern: /^pkg:npm\//, type: "SoftwareComponent" },
  { pattern: /^pkg:maven\//, type: "SoftwareComponent" },
  { pattern: /^pkg:pypi\//, type: "SoftwareComponent" },
  { pattern: /^pkg:go\//, type: "SoftwareComponent" },
  { pattern: /^pkg:nuget\//, type: "SoftwareComponent" },
  { pattern: /^pkg:deno\//, type: "SoftwareComponent" },
  { pattern: /^pkg:swift\//, type: "SoftwareComponent" },
  { pattern: /^pkg:firmware\//, type: "SoftwareComponent" },

  // Package URLs — Hardware components
  { pattern: /^pkg:hw\//, type: "HardwareComponent" },
  { pattern: /^pkg:device\//, type: "HardwareComponent" },

  // Standards / regulations / RFCs / papers
  { pattern: /^urn:iso:std:iso:/, type: "Requirement" },
  { pattern: /^urn:iso:std:iec:/, type: "Requirement" },
  { pattern: /^urn:iso:std:iso:iec:ieee:/, type: "Requirement" },
  { pattern: /^urn:ietf:rfc:/, type: "Requirement" },
  { pattern: /^urn:nist:/, type: "Requirement" },
  { pattern: /^urn:unece:/, type: "Requirement" },
  { pattern: /^doi:/, type: "Requirement" },

  // External tracker schemes — Requirement (proxy item in external system)
  { pattern: /^codebeamer:/, type: "Requirement" },
  { pattern: /^doors:/, type: "Requirement" },
  { pattern: /^polarion:/, type: "Requirement" },

  // Interface description schemes
  { pattern: /^urn:openapi:/, type: "Contract" },
  { pattern: /^urn:asyncapi:/, type: "Contract" },
  { pattern: /^urn:protobuf:/, type: "Contract" },
  { pattern: /^urn:wsdl:/, type: "Contract" },
  { pattern: /^urn:autosar:port:/, type: "Contract" },

  // Hardware interfaces (bus networks)
  { pattern: /^urn:can-bus:/, type: "HardwareInterface" },

  // Glossary terms
  { pattern: /^urn:refhub:term:/, type: "Definition" },
  { pattern: /^urn:driftsys:refhub:term:/, type: "Definition" },

  // PLM
  { pattern: /^plm:/, type: "HardwareComponent" },
];

/**
 * Infer a core type name from a Reference-shape `Id:` value (a URI).
 * Returns `undefined` when no rule matches — the caller should leave
 * the entry type unresolved rather than guess.
 *
 * @param idValue The raw `Id:` value (a scheme-qualified URI).
 */
export function inferTypeFromUriScheme(idValue: string): string | undefined {
  for (const rule of URI_SCHEME_RULES) {
    if (rule.pattern.test(idValue)) return rule.type;
  }
  return undefined;
}
