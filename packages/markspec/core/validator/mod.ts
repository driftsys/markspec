/**
 * @module validator
 *
 * ID graph validator. Performs file-local checks and cross-file checks:
 * broken references, missing identity attributes, malformed entries,
 * duplicate IDs.
 *
 * Supports two entry shapes during the ADR-002 v2 transition:
 * - **New identity path**: entry carries `Spec-id` / `Test-id` /
 *   `Element-id` / `Reference-id` (bare ULID or URI per ADR-002 Annex B).
 * - **Legacy path**: entry carries `Id:` with TYPE-prefixed ULID (pre-v2
 *   fixtures). Still accepted until Phase 6 migration.
 */

import type { Attribute, Diagnostic, Entry } from "../model/mod.ts";
import { attributeSpec, IDENTITY_KEY_BY_FAMILY } from "../model/mod.ts";

/** Known attribute keys for spec entries (legacy set kept for back-compat). */
const SPEC_ATTR_KEYS = new Set([
  "Id",
  "Spec-id",
  "Satisfies",
  "Derived-from",
  "References",
  "Allocated-to",
  "Labels",
  "Status",
  "External-id",
  "Supersedes",
]);

/** Known attribute keys for test entries. */
const TEST_ATTR_KEYS = new Set([
  "Test-id",
  "Test-level",
  "Verifies",
  "Tests",
  "References",
  "Labels",
  "Status",
  "External-id",
  "Supersedes",
]);

/** Known attribute keys for element entries. */
const ELEMENT_ATTR_KEYS = new Set([
  "Element-id",
  "Element-kind",
  "Part-of",
  "Realizes",
  "Depends-on",
  "Generated-from",
  "References",
  "Labels",
  "Status",
  "External-id",
  "Supersedes",
]);

/** Known attribute keys for reference entries (legacy + new). */
const REF_ATTR_KEYS = new Set([
  "Reference-id",
  "Reference-url",
  "Reference-document",
  "URI",
  "URL",
  "Document",
  "Superseded-by",
  "Labels",
  "Status",
  "External-id",
  "Supersedes",
]);

function knownKeysFor(family: Entry["family"]): Set<string> {
  switch (family) {
    case "spec":
      return SPEC_ATTR_KEYS;
    case "test":
      return TEST_ATTR_KEYS;
    case "element":
      return ELEMENT_ATTR_KEYS;
    case "reference":
      return REF_ATTR_KEYS;
  }
}

/** Legacy TYPE-prefixed ULID format: `SRS_01HGW2Q8MNP3`. */
const LEGACY_ULID_RE = /^[A-Z]{2,6}_[0-9A-Z]{26}$/;

/** Bare ULID per ADR-002 Annex B: 26 chars in Crockford base32 (no I,L,O,U). */
const BARE_ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Minimal URI check per RFC 3986 — scheme followed by colon. */
const URI_RE = /^[a-z][a-z0-9+.-]*:/i;

/** All four identity attribute keys per ADR-002 Part 6. */
const IDENTITY_KEYS: readonly string[] = [
  "Spec-id",
  "Test-id",
  "Element-id",
  "Reference-id",
];

/** Family-specific display-ID regexes per ADR-002 §Annex B. */
const DISPLAY_ID_RE: Record<Entry["family"], RegExp> = {
  spec: /^[A-Z]{2,6}_[A-Z][A-Z0-9]{2,7}(_[A-Z][A-Z0-9]{2,7})?_\d{3,6}$/,
  test: /^[A-Z]{2,6}_[A-Z][A-Z0-9]{2,7}(_[A-Z][A-Z0-9]{2,7})?_\d{3,6}$/,
  element:
    /^(::)?[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?(::[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?)*$/,
  reference: /^[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?$/,
};

/** Result of a validation pass. */
export interface ValidateResult {
  /** Diagnostics found during validation. */
  readonly diagnostics: readonly Diagnostic[];
  /** Whether validation passed with no errors. */
  readonly valid: boolean;
}

/**
 * Validate a set of parsed entries for structural correctness
 * and reference integrity.
 *
 * @param entries - Parsed entries to validate
 */
export function validate(entries: readonly Entry[]): ValidateResult {
  const diagnostics: Diagnostic[] = [];

  checkStructural(entries, diagnostics);
  checkReferences(entries, diagnostics);

  const valid = !diagnostics.some((d) => d.severity === "error");
  return { diagnostics, valid };
}

/** MSL-R structural checks on individual entries and cross-entry uniqueness. */
function checkStructural(
  entries: readonly Entry[],
  diagnostics: Diagnostic[],
): void {
  const displayIds = new Map<string, Entry>();
  const ulids = new Map<string, Entry>();

  for (const entry of entries) {
    const identityAttrs = entry.attributes.filter((a) =>
      IDENTITY_KEYS.includes(a.key)
    );
    const hasNewIdentity = identityAttrs.length > 0;
    const isSpec = entry.family === "spec";

    if (hasNewIdentity) {
      validateNewIdentity(entry, identityAttrs, diagnostics);
    } else {
      validateLegacyIdentity(entry, isSpec, diagnostics);
    }

    // MSL-R009: Spec/Test entry NNNN must be > 0 (no 000, 0000, etc.).
    if (entry.family === "spec" || entry.family === "test") {
      const parts = entry.displayId.split("_");
      if (parts.length >= 3) {
        const nnnn = parts[parts.length - 1];
        if (/^\d+$/.test(nnnn) && parseInt(nnnn, 10) === 0) {
          diagnostics.push({
            code: "MSL-R009",
            severity: "error",
            message: `${entry.displayId}: NNNN must be > 0`,
            location: entry.location,
          });
        }
      }
    }

    // MSL-R006: Display ID unique across all entries.
    const existing = displayIds.get(entry.displayId);
    if (existing) {
      diagnostics.push({
        code: "MSL-R006",
        severity: "error",
        message:
          `duplicate display ID '${entry.displayId}' (also at ${existing.location.file}:${existing.location.line})`,
        location: entry.location,
      });
    } else {
      displayIds.set(entry.displayId, entry);
    }

    // MSL-R005: identity value unique across all entries.
    if (entry.id) {
      const existingUlid = ulids.get(entry.id);
      if (existingUlid) {
        diagnostics.push({
          code: "MSL-R005",
          severity: "error",
          message:
            `duplicate Id '${entry.id}' (also at ${existingUlid.location.file}:${existingUlid.location.line})`,
          location: entry.location,
        });
      } else {
        ulids.set(entry.id, entry);
      }
    }

    // MSL-R014: Attribute value matches its declared type's vocabulary.
    // Scoped to enum types today (Status / Test-level / Element-kind);
    // other value-type checks follow in later phases.
    validateEnumValues(entry, diagnostics);

    // MSL-R010: Unknown attribute keys per family.
    const knownKeys = knownKeysFor(entry.family);
    for (const attr of entry.attributes) {
      if (!knownKeys.has(attr.key)) {
        diagnostics.push({
          code: "MSL-R010",
          severity: "warning",
          message: `${entry.displayId}: unknown attribute '${attr.key}'`,
          location: entry.location,
        });
      }
    }
  }
}

/** Run new-identity-path rules per ADR-002 Part 6. */
function validateNewIdentity(
  entry: Entry,
  identityAttrs: readonly Attribute[],
  diagnostics: Diagnostic[],
): void {
  // MSL-R003: exactly one identity attribute per entry.
  if (identityAttrs.length > 1) {
    const keys = identityAttrs.map((a) => a.key).join(", ");
    diagnostics.push({
      code: "MSL-R003",
      severity: "error",
      message:
        `${entry.displayId}: multiple identity attributes present (${keys}) — only one of Spec-id/Test-id/Element-id/Reference-id is allowed`,
      location: entry.location,
    });
  }

  // MSL-R003: identity attribute must match family — the parser uses the
  // attribute to derive family, so a mismatch here means a legacy Id was
  // also present. Flag the legacy Id as a migration conflict.
  const hasLegacyId = entry.attributes.some((a) => a.key === "Id");
  if (hasLegacyId) {
    diagnostics.push({
      code: "MSL-R003",
      severity: "error",
      message:
        `${entry.displayId}: legacy 'Id:' attribute is present alongside a new identity attribute — remove Id: and keep only ${
          IDENTITY_KEY_BY_FAMILY[entry.family]
        }`,
      location: entry.location,
    });
  }

  // MSL-R004: identity value format per family.
  const identity = identityAttrs[0];
  if (identity.key === "Reference-id") {
    if (!URI_RE.test(identity.value)) {
      diagnostics.push({
        code: "MSL-R004",
        severity: "error",
        message:
          `${entry.displayId}: Reference-id '${identity.value}' is not a URI (expected a scheme like urn:, doi:, or https:)`,
        location: entry.location,
      });
    }
  } else {
    if (!BARE_ULID_RE.test(identity.value)) {
      diagnostics.push({
        code: "MSL-R004",
        severity: "error",
        message:
          `${entry.displayId}: ${identity.key} '${identity.value}' is not a bare 26-char Crockford base32 ULID`,
        location: entry.location,
      });
    }
  }

  // MSL-R007: display ID must match the family's format.
  const regex = DISPLAY_ID_RE[entry.family];
  if (!regex.test(entry.displayId)) {
    diagnostics.push({
      code: "MSL-R007",
      severity: "error",
      message:
        `${entry.displayId}: display ID does not match the ${entry.family} family format`,
      location: entry.location,
    });
  }
}

/**
 * Validate enum-type attribute values against their catalog vocabulary.
 *
 * Per ADR-002 §2.6, each attribute carries a declared value type. Enum
 * attributes (`Status`, `Test-level`, `Element-kind`) have a closed
 * vocabulary; anything outside it emits MSL-R014.
 */
function validateEnumValues(
  entry: Entry,
  diagnostics: Diagnostic[],
): void {
  for (const attr of entry.attributes) {
    const spec = attributeSpec(attr.key);
    if (!spec) continue;
    if (spec.type !== "enum") continue;
    if (!spec.enumValues) continue;
    if (spec.enumValues.includes(attr.value)) continue;
    diagnostics.push({
      code: "MSL-R014",
      severity: "error",
      message:
        `${entry.displayId}: ${attr.key} value '${attr.value}' is not one of ${
          spec.enumValues.join(", ")
        }`,
      location: entry.location,
    });
  }
}

/** Run legacy-Id path rules (pre-v2 fixtures). */
function validateLegacyIdentity(
  entry: Entry,
  isSpec: boolean,
  diagnostics: Diagnostic[],
): void {
  // MSL-R003: Spec entry must have Id attribute with valid ULID format.
  if (isSpec) {
    if (!entry.id) {
      diagnostics.push({
        code: "MSL-R003",
        severity: "error",
        message: `${entry.displayId}: missing Id attribute`,
        location: entry.location,
      });
    } else if (!LEGACY_ULID_RE.test(entry.id)) {
      diagnostics.push({
        code: "MSL-R003",
        severity: "error",
        message: `${entry.displayId}: malformed Id '${entry.id}'`,
        location: entry.location,
      });
    }
  }

  // MSL-R004: Exactly one Id per entry.
  if (isSpec) {
    const idCount = entry.attributes.filter((a) => a.key === "Id").length;
    if (idCount > 1) {
      diagnostics.push({
        code: "MSL-R004",
        severity: "error",
        message: `${entry.displayId}: multiple Id attributes (${idCount})`,
        location: entry.location,
      });
    }
  }

  // MSL-R007: Display ID type prefix must match ULID type prefix.
  if (isSpec && entry.id && LEGACY_ULID_RE.test(entry.id)) {
    const displayPrefix = entry.entryType!;
    const ulidPrefix = entry.id.split("_")[0];
    if (displayPrefix !== ulidPrefix) {
      diagnostics.push({
        code: "MSL-R007",
        severity: "error",
        message:
          `${entry.displayId}: type prefix '${displayPrefix}' does not match Id prefix '${ulidPrefix}'`,
        location: entry.location,
      });
    }
  }

  // MSL-R008: Reference entry must have URI or URL attribute.
  if (!isSpec && entry.family === "reference") {
    const hasUri = entry.attributes.some((a) => a.key === "URI");
    const hasUrl = entry.attributes.some((a) => a.key === "URL");
    if (!hasUri && !hasUrl) {
      diagnostics.push({
        code: "MSL-R008",
        severity: "error",
        message:
          `${entry.displayId}: reference entry must have URI or URL attribute`,
        location: entry.location,
      });
    }
  }
}

/**
 * Family-aware traceability rule per ADR-002 §Part 2-5 / language.md §8.3.
 *
 * Each attribute that carries cross-entry references specifies which family
 * its targets must belong to. The relation names here use the on-wire
 * codes MSL-T001/T004/T005/T006 + T007-T013 for the new rules; note the
 * numbering diverges from language.md §8.3 (a docs PR will re-align).
 */
interface TraceabilityRule {
  /** Attribute key (e.g., `Satisfies`, `Realizes`). */
  readonly key: string;
  /** Expected target family, or `"same"` for Supersedes. */
  readonly target: Entry["family"] | "same";
  /** MSL diagnostic code. */
  readonly code: string;
  /** Diagnostic severity when target is missing or wrong family. */
  readonly severity: "error" | "warning";
  /** Which source families may carry this attribute (optional). */
  readonly source?: readonly Entry["family"][];
  /**
   * Whether the value may carry a free-text locator after the slug
   * (`"ID §locator"`). Only `Derived-from` historically permitted this
   * shape; the catalog treats it as `id-list`, so locators are no longer
   * valid but we keep tolerance for legacy fixtures.
   */
  readonly tolerateLocator?: boolean;
}

const TRACEABILITY_RULES: readonly TraceabilityRule[] = [
  {
    key: "Satisfies",
    target: "spec",
    code: "MSL-T001",
    severity: "error",
    source: ["spec"],
  },
  {
    key: "Derived-from",
    target: "spec",
    code: "MSL-T004",
    severity: "warning",
    source: ["spec"],
    tolerateLocator: true,
  },
  {
    key: "References",
    target: "reference",
    code: "MSL-T005",
    severity: "error",
    source: ["spec", "test", "element"],
    // References is a `citation` type per ADR-002 §2.6: "slug + optional
    // free-text locator". Strip the locator before resolution.
    tolerateLocator: true,
  },
  {
    key: "Allocated-to",
    target: "element",
    code: "MSL-T006",
    severity: "error",
    source: ["spec"],
  },
  {
    key: "Realizes",
    target: "spec",
    code: "MSL-T007",
    severity: "error",
    source: ["element"],
  },
  {
    key: "Verifies",
    target: "spec",
    code: "MSL-T008",
    severity: "error",
    source: ["test"],
  },
  {
    key: "Tests",
    target: "element",
    code: "MSL-T009",
    severity: "error",
    source: ["test"],
  },
  {
    key: "Part-of",
    target: "element",
    code: "MSL-T010",
    severity: "error",
    source: ["element"],
  },
  {
    key: "Depends-on",
    target: "element",
    code: "MSL-T011",
    severity: "error",
    source: ["element"],
  },
  {
    key: "Supersedes",
    target: "same",
    code: "MSL-T012",
    severity: "error",
  },
];

/** Split a repeatable attribute value into individual target identifiers. */
function splitTargets(value: string, tolerateLocator: boolean): string[] {
  if (tolerateLocator) {
    // Legacy form accepted locator suffix after the ID (e.g., "SYS_X §1.2").
    const first = value.split(/\s/)[0];
    return first ? [first] : [];
  }
  return value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

/** MSL-T traceability integrity checks. */
function checkReferences(
  entries: readonly Entry[],
  diagnostics: Diagnostic[],
): void {
  const byDisplayId = new Map<string, Entry>();
  for (const entry of entries) {
    if (!byDisplayId.has(entry.displayId)) {
      byDisplayId.set(entry.displayId, entry);
    }
  }

  for (const entry of entries) {
    for (const rule of TRACEABILITY_RULES) {
      if (rule.source && !rule.source.includes(entry.family)) continue;
      const attr = findAttr(entry.attributes, rule.key);
      if (!attr) continue;

      const targets = splitTargets(attr.value, rule.tolerateLocator ?? false);
      for (const target of targets) {
        const resolved = byDisplayId.get(target);
        if (!resolved) {
          diagnostics.push({
            code: rule.code,
            severity: rule.severity,
            message:
              `${entry.displayId}: unresolved reference '${target}' in ${rule.key}`,
            location: entry.location,
          });
          continue;
        }

        // Family check
        const expected = rule.target === "same" ? entry.family : rule.target;
        if (resolved.family !== expected) {
          diagnostics.push({
            code: rule.code,
            severity: rule.severity,
            message:
              `${entry.displayId}: ${rule.key} target '${target}' is family '${resolved.family}', expected '${expected}'`,
            location: entry.location,
          });
          continue;
        }

        // MSL-T013: warn when upstream target is deprecated or withdrawn.
        if (
          rule.key === "Satisfies" || rule.key === "Derived-from" ||
          rule.key === "Realizes" || rule.key === "Verifies"
        ) {
          const status = findAttr(resolved.attributes, "Status")?.value;
          if (status === "deprecated" || status === "withdrawn") {
            diagnostics.push({
              code: "MSL-T013",
              severity: "warning",
              message:
                `${entry.displayId}: ${rule.key} target '${target}' has Status: ${status}`,
              location: entry.location,
            });
          }
        }
      }
    }
  }
}

/** Find first attribute by key. */
function findAttr(
  attrs: readonly Attribute[],
  key: string,
): Attribute | undefined {
  return attrs.find((a) => a.key === key);
}
