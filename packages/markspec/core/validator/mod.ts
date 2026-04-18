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
import { IDENTITY_KEY_BY_FAMILY } from "../model/mod.ts";

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

/** MSL-T reference integrity checks. */
function checkReferences(
  entries: readonly Entry[],
  diagnostics: Diagnostic[],
): void {
  const knownIds = new Set(entries.map((e) => e.displayId));

  for (const entry of entries) {
    // MSL-T001: Satisfies targets must exist.
    const satisfies = findAttr(entry.attributes, "Satisfies");
    if (satisfies) {
      const targets = satisfies.value.split(",").map((s) => s.trim());
      for (const target of targets) {
        if (!target) continue;
        if (!knownIds.has(target)) {
          diagnostics.push({
            code: "MSL-T001",
            severity: "error",
            message:
              `${entry.displayId}: unresolved reference '${target}' in Satisfies`,
            location: entry.location,
          });
        }
      }
    }

    // MSL-T004: Derived-from ID portion checked against known entries.
    const derivedFrom = findAttr(entry.attributes, "Derived-from");
    if (derivedFrom) {
      const idPart = derivedFrom.value.split(/\s/)[0];
      if (idPart && !knownIds.has(idPart)) {
        diagnostics.push({
          code: "MSL-T004",
          severity: "warning",
          message:
            `${entry.displayId}: unresolved Derived-from reference '${idPart}'`,
          location: entry.location,
        });
      }
    }

    // MSL-T005: References targets must exist.
    const references = findAttr(entry.attributes, "References");
    if (references) {
      const targets = references.value.split(",").map((s) => s.trim());
      for (const target of targets) {
        if (!target) continue;
        if (!knownIds.has(target)) {
          diagnostics.push({
            code: "MSL-T005",
            severity: "error",
            message:
              `${entry.displayId}: unresolved reference '${target}' in References`,
            location: entry.location,
          });
        }
      }
    }

    // MSL-T006: Allocated-to targets must exist.
    const allocatedTo = findAttr(entry.attributes, "Allocated-to");
    if (allocatedTo) {
      const targets = allocatedTo.value.split(",").map((s) => s.trim());
      for (const target of targets) {
        if (!target) continue;
        if (!knownIds.has(target)) {
          diagnostics.push({
            code: "MSL-T006",
            severity: "error",
            message:
              `${entry.displayId}: unresolved reference '${target}' in Allocated-to`,
            location: entry.location,
          });
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
