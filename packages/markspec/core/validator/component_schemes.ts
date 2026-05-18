/**
 * @module validator/component_schemes
 *
 * Component Id-scheme parsers for `markspec:components` listings.
 *
 * Each exported parser accepts a raw `Id:` URI string and returns either
 * `{ ok: true, type: string }` (accepted, with the inferred Item type) or
 * `{ ok: false, code: "MSL-Lxxx", message: string }` (rejected with a
 * specific diagnostic code). Parsers are pure: no I/O, no external fetches.
 *
 * Spec §5 fixes the grammars; this module is their TypeScript implementation.
 */

/** Result from a component scheme parser. */
export type SchemeParseResult =
  | { readonly ok: true; readonly type: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** Guard: does the Id: value look like a URI for a known or generic scheme? */
export function isSchemeQualifiedUri(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+\-.]*:/.test(value);
}

// ---------------------------------------------------------------------------
// §5.1  pkg: — Package URL (purl)
// ---------------------------------------------------------------------------

/**
 * Recognised purl types that map directly to a core Item type.
 * Unmapped types fall back to Component (abstract) with MSL-L030 info.
 */
const PURL_TYPE_MAP: ReadonlyMap<string, string> = new Map([
  ["cargo", "SoftwareComponent"],
  ["npm", "SoftwareComponent"],
  ["maven", "SoftwareComponent"],
  ["pypi", "SoftwareComponent"],
  ["go", "SoftwareComponent"],
  ["nuget", "SoftwareComponent"],
  ["deno", "SoftwareComponent"],
  ["swift", "SoftwareComponent"],
  ["firmware", "SoftwareComponent"],
  ["hw", "HardwareComponent"],
  ["device", "HardwareComponent"],
]);

/**
 * Parse a `pkg:` URI per the Package URL specification.
 *
 * Validates: scheme is "pkg", type and name are non-empty, subpath
 * presence → SoftwareUnit. Accepts any well-formed purl and classifies it;
 * rejects malformed purls with MSL-L031.
 */
export function parsePurl(value: string): SchemeParseResult {
  // Must start with "pkg:"
  if (!value.startsWith("pkg:")) {
    return {
      ok: false,
      code: "MSL-L031",
      message: `malformed purl: scheme must be 'pkg' (got '${
        value.split(":")[0]
      }')`,
    };
  }

  // After "pkg:", the remainder is: type/[namespace/]name[@version][?qualifiers][#subpath]
  const rest = value.slice("pkg:".length);

  // type is required: everything before the first "/"
  const slashIdx = rest.indexOf("/");
  if (slashIdx < 0 || slashIdx === 0) {
    return {
      ok: false,
      code: "MSL-L031",
      message:
        `malformed purl: 'type' component is required (format: pkg:type/name)`,
    };
  }

  const purlType = rest.slice(0, slashIdx).toLowerCase();
  const afterType = rest.slice(slashIdx + 1);

  // name is required: strip optional qualifiers and subpath, then check
  // namespace/name vs just name (slash-separated paths before @/? end with the name)
  const atIdx = afterType.indexOf("@");
  const qIdx = afterType.indexOf("?");
  const hashIdx = afterType.indexOf("#");
  // Name ends at the first of @, ?, # (or end of string)
  let nameEnd = afterType.length;
  if (atIdx >= 0) nameEnd = Math.min(nameEnd, atIdx);
  if (qIdx >= 0) nameEnd = Math.min(nameEnd, qIdx);
  if (hashIdx >= 0) nameEnd = Math.min(nameEnd, hashIdx);

  const nameAndNamespace = afterType.slice(0, nameEnd);
  const nameParts = nameAndNamespace.split("/").filter((p) => p.length > 0);
  if (nameParts.length === 0) {
    return {
      ok: false,
      code: "MSL-L031",
      message:
        `malformed purl: 'name' component is required (format: pkg:type/name)`,
    };
  }
  // The last non-empty segment is the name
  const name = nameParts[nameParts.length - 1];
  if (name.length === 0) {
    return {
      ok: false,
      code: "MSL-L031",
      message: `malformed purl: 'name' component must not be empty`,
    };
  }

  // subpath present → SoftwareUnit (spec §5.1-d)
  const hasSubpath = hashIdx >= 0 && afterType.slice(hashIdx + 1).length > 0;
  if (hasSubpath) {
    return { ok: true, type: "SoftwareUnit" };
  }

  // Map type to Item type; unknown types fall back to Component (MSL-L030 caller)
  const itemType = PURL_TYPE_MAP.get(purlType) ?? null;
  if (itemType === null) {
    // Return a special signal: caller emits MSL-L030 and uses Component fallback
    return { ok: true, type: "Component" };
  }
  return { ok: true, type: itemType };
}

// ---------------------------------------------------------------------------
// §5.2  mfg: — manufacturer part
// ---------------------------------------------------------------------------

/** Token character set: ALPHA / DIGIT / "-" / "." / "_" */
const TOKEN_CHAR_RE = /^[A-Za-z0-9\-._]+$/;

/**
 * Parse a `mfg:vendor:partno` URI per spec §5.2.
 *
 * Rules: literal "mfg:" prefix, non-empty vendor token, ":", non-empty
 * partno (may contain further ":"). Invalid → MSL-L032.
 */
export function parseMfgId(value: string): SchemeParseResult {
  if (!value.startsWith("mfg:")) {
    return {
      ok: false,
      code: "MSL-L032",
      message: `malformed mfg id: must start with 'mfg:'`,
    };
  }

  const afterPrefix = value.slice("mfg:".length);
  // First ":" ends the vendor
  const colonIdx = afterPrefix.indexOf(":");
  if (colonIdx < 0) {
    return {
      ok: false,
      code: "MSL-L032",
      message:
        `malformed mfg id: missing ':' separator between vendor and partno`,
    };
  }

  const vendor = afterPrefix.slice(0, colonIdx);
  const partno = afterPrefix.slice(colonIdx + 1);

  if (vendor.length === 0) {
    return {
      ok: false,
      code: "MSL-L032",
      message: `malformed mfg id: vendor must not be empty`,
    };
  }
  if (!TOKEN_CHAR_RE.test(vendor)) {
    return {
      ok: false,
      code: "MSL-L032",
      message:
        `malformed mfg id: vendor '${vendor}' contains invalid characters (allowed: [A-Za-z0-9-._ ])`,
    };
  }
  if (partno.length === 0) {
    return {
      ok: false,
      code: "MSL-L032",
      message: `malformed mfg id: partno must not be empty`,
    };
  }

  // Validate all segments of the partno (split by ":" for per-segment check)
  for (const segment of partno.split(":")) {
    if (segment.length === 0) {
      return {
        ok: false,
        code: "MSL-L032",
        message: `malformed mfg id: partno segment must not be empty`,
      };
    }
    if (!TOKEN_CHAR_RE.test(segment)) {
      return {
        ok: false,
        code: "MSL-L032",
        message:
          `malformed mfg id: partno segment '${segment}' contains invalid characters`,
      };
    }
  }

  return { ok: true, type: "HardwareComponent" };
}

// ---------------------------------------------------------------------------
// §5.3  gtin: — GS1 Global Trade Item Number
// ---------------------------------------------------------------------------

const VALID_GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * Compute the GS1 mod-10 check digit for a digit string (without the
 * check digit itself). Returns the expected final digit (0–9).
 *
 * Algorithm: multiply alternating digits from right by 3 and 1 (rightmost
 * non-check digit × 3), sum, check digit = (10 - (sum mod 10)) mod 10.
 */
function computeGtinCheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const posFromRight = digits.length - i; // 1-based from the right (excl. check)
    const multiplier = posFromRight % 2 === 1 ? 3 : 1;
    sum += parseInt(digits[i], 10) * multiplier;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Parse a `gtin:` URI per spec §5.3 and GS1 General Specifications.
 *
 * Validates: exactly 8/12/13/14 digits, correct GS1 check digit.
 * Errors: MSL-L033 (wrong length), MSL-L034 (bad check digit).
 */
export function parseGtinId(value: string): SchemeParseResult {
  if (!value.startsWith("gtin:")) {
    return {
      ok: false,
      code: "MSL-L033",
      message: `malformed gtin id: must start with 'gtin:'`,
    };
  }

  const digits = value.slice("gtin:".length);

  if (!/^\d+$/.test(digits)) {
    return {
      ok: false,
      code: "MSL-L033",
      message:
        `malformed gtin id: expected digits after 'gtin:' (got '${digits}')`,
    };
  }

  if (!VALID_GTIN_LENGTHS.has(digits.length)) {
    return {
      ok: false,
      code: "MSL-L033",
      message: `gtin: expected 8/12/13/14 digits, got ${digits.length}`,
    };
  }

  // Verify check digit
  const payload = digits.slice(0, -1);
  const givenCheck = parseInt(digits[digits.length - 1], 10);
  const expectedCheck = computeGtinCheckDigit(payload);
  if (givenCheck !== expectedCheck) {
    return {
      ok: false,
      code: "MSL-L034",
      message:
        `gtin: check digit mismatch (got ${givenCheck}, expected ${expectedCheck})`,
    };
  }

  return { ok: true, type: "HardwareComponent" };
}

// ---------------------------------------------------------------------------
// §5.4  cpe: — Common Platform Enumeration 2.3
// ---------------------------------------------------------------------------

const VALID_CPE_PARTS = new Set(["a", "o", "h"]);

/**
 * Parse a `cpe:` URI per spec §5.4 and NIST IR 7695.
 *
 * Accepts only the CPE 2.3 formatted-string binding (`cpe:2.3:…`).
 * Errors: MSL-L035 (legacy 2.2 URI binding), MSL-L036 (invalid part).
 */
export function parseCpeId(value: string): SchemeParseResult {
  if (!value.startsWith("cpe:")) {
    return {
      ok: false,
      code: "MSL-L035",
      message: `malformed cpe id: must start with 'cpe:'`,
    };
  }

  // Reject CPE 2.2 URI binding (cpe:/)
  if (value.startsWith("cpe:/")) {
    return {
      ok: false,
      code: "MSL-L035",
      message:
        `cpe: use 2.3 formatted-string binding (cpe:2.3:…), not the legacy URI binding (cpe:/…)`,
    };
  }

  // Must start with cpe:2.3:
  if (!value.startsWith("cpe:2.3:")) {
    return {
      ok: false,
      code: "MSL-L035",
      message: `cpe: use 2.3 formatted-string binding (cpe:2.3:…); '${
        value.slice(0, 10)
      }…' is not recognised`,
    };
  }

  // After cpe:2.3: there must be exactly 11 colon-separated components
  const components = value.slice("cpe:2.3:".length).split(":");
  if (components.length !== 11) {
    return {
      ok: false,
      code: "MSL-L035",
      message:
        `cpe: expected 11 colon-separated components after 'cpe:2.3:' per NIST IR 7695 §6.2, got ${components.length}`,
    };
  }

  const part = components[0].toLowerCase();
  if (!VALID_CPE_PARTS.has(part)) {
    return {
      ok: false,
      code: "MSL-L036",
      message:
        `cpe: 'part' must be 'a' (application), 'o' (OS), or 'h' (hardware); got '${
          components[0]
        }'`,
    };
  }

  const itemType = part === "h" ? "HardwareComponent" : "SoftwareComponent";
  return { ok: true, type: itemType };
}

// ---------------------------------------------------------------------------
// §5.5  urn:system: and urn:tool:
// ---------------------------------------------------------------------------

/** URN segment character set per spec §5.5 ABNF. */
const SEGMENT_CHAR_RE = /^[A-Za-z0-9\-._]+$/;

/**
 * Parse a `urn:system:` or `urn:tool:` URI per spec §5.5.
 *
 * Validates: non-empty segments separated by ":", all chars in
 * ALPHA/DIGIT/-/./_ . Invalid → MSL-L037.
 */
export function parseUrnSystemOrTool(value: string): SchemeParseResult {
  const isSystem = value.startsWith("urn:system:");
  const isTool = value.startsWith("urn:tool:");

  if (!isSystem && !isTool) {
    return {
      ok: false,
      code: "MSL-L037",
      message: `malformed urn id: expected 'urn:system:' or 'urn:tool:' prefix`,
    };
  }

  const prefix = isSystem ? "urn:system:" : "urn:tool:";
  const body = value.slice(prefix.length);

  if (body.length === 0) {
    return {
      ok: false,
      code: "MSL-L037",
      message:
        `malformed ${prefix} id: path must not be empty after '${prefix}'`,
    };
  }

  const segments = body.split(":");
  for (const seg of segments) {
    if (seg.length === 0) {
      return {
        ok: false,
        code: "MSL-L037",
        message:
          `malformed ${prefix} id: segment must not be empty (consecutive ':' or trailing ':')`,
      };
    }
    if (!SEGMENT_CHAR_RE.test(seg)) {
      return {
        ok: false,
        code: "MSL-L037",
        message:
          `malformed ${prefix} id: segment '${seg}' contains invalid characters (allowed: [A-Za-z0-9-._])`,
      };
    }
  }

  const itemType = isSystem ? "Component" : "SoftwareComponent";
  return { ok: true, type: itemType };
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

/**
 * Classify a component entry's `Id:` value against the six core schemes.
 *
 * Returns a {@linkcode SchemeParseResult}:
 * - `{ ok: true, type }` on recognition (may still emit MSL-L030 for
 *   unknown purl types — the caller handles that).
 * - `{ ok: false, code, message }` for scheme-level parse errors.
 * - `null` when the value doesn't look like any component scheme (caller
 *   should check if it's a valid RFC 3986 URI for the generic fallback).
 *
 * Matching is longest-declared-prefix-wins per spec §5.
 */
export function parseComponentScheme(value: string): SchemeParseResult | null {
  if (value.startsWith("pkg:")) return parsePurl(value);
  if (value.startsWith("mfg:")) return parseMfgId(value);
  if (value.startsWith("gtin:")) return parseGtinId(value);
  if (value.startsWith("cpe:")) return parseCpeId(value);
  if (value.startsWith("urn:system:") || value.startsWith("urn:tool:")) {
    return parseUrnSystemOrTool(value);
  }
  return null;
}
