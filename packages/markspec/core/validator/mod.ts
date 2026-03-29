/**
 * @module validator
 *
 * ID graph validator. Performs file-local checks and cross-file checks:
 * broken references, missing Ids, malformed entries, duplicate IDs.
 */

import type { Attribute, Diagnostic, Entry } from "../model/mod.ts";

/** Known attribute keys for typed entries. */
const TYPED_ATTR_KEYS = new Set([
  "Id",
  "Satisfies",
  "Derived-from",
  "Allocates",
  "Component",
  "Constrains",
  "Between",
  "Interface",
  "Verifies",
  "Implements",
  "Labels",
]);

/** Known attribute keys for reference entries. */
const REF_ATTR_KEYS = new Set([
  "Document",
  "URL",
  "Status",
  "Superseded-by",
  "Derived-from",
]);

/** ULID format: TYPE prefix + underscore + 12-26 alphanumeric chars. */
const ULID_RE = /^[A-Z]+_[0-9A-Z]{12,26}$/;

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
 * @returns Validation result with diagnostics
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
    const isTyped = entry.entryType != null;

    // MSL-R003: Typed entry must have Id attribute with valid ULID format.
    if (isTyped) {
      if (!entry.id) {
        diagnostics.push({
          code: "MSL-R003",
          severity: "error",
          message: `${entry.displayId}: missing Id attribute`,
          location: entry.location,
        });
      } else if (!ULID_RE.test(entry.id)) {
        diagnostics.push({
          code: "MSL-R003",
          severity: "error",
          message: `${entry.displayId}: malformed Id '${entry.id}'`,
          location: entry.location,
        });
      }
    }

    // MSL-R004: Exactly one Id per entry.
    if (isTyped) {
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
    if (isTyped && entry.id && ULID_RE.test(entry.id)) {
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

    // MSL-R005: ULID unique across all entries.
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

    // MSL-R010: Unknown attribute keys.
    const knownKeys = isTyped ? TYPED_ATTR_KEYS : REF_ATTR_KEYS;
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

    // MSL-T008: Allocates targets must be SRS entries (resolve against known IDs).
    const allocates = findAttr(entry.attributes, "Allocates");
    if (allocates) {
      const targets = allocates.value.split(",").map((s) => s.trim());
      for (const target of targets) {
        if (!target) continue;
        if (!knownIds.has(target)) {
          diagnostics.push({
            code: "MSL-T008",
            severity: "error",
            message:
              `${entry.displayId}: unresolved reference '${target}' in Allocates`,
            location: entry.location,
          });
        }
      }
    }

    // MSL-T009: Between must list exactly two parties.
    const between = findAttr(entry.attributes, "Between");
    if (between) {
      const parties = between.value.split(",").map((s) => s.trim()).filter(
        (s) => s.length > 0,
      );
      if (parties.length !== 2) {
        diagnostics.push({
          code: "MSL-T009",
          severity: "error",
          message:
            `${entry.displayId}: Between must list exactly 2 parties, found ${parties.length}`,
          location: entry.location,
        });
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
