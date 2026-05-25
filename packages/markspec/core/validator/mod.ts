/**
 * @module validator
 *
 * Core structural validator. Performs file-local checks and cross-file
 * checks for structural integrity: well-formed `Id:` values, unique
 * display IDs, unique identity values, resolvable cross-references.
 *
 * Shape discrimination follows the language spec Part 2.4: `Id:` value
 * is a bare ULID → identified entry; `Id:` value is a scheme-qualified
 * URI (RFC 3986) → referenced entry; anything else is an error.
 *
 * Type-level rules (required-per-type attributes, relation target-type
 * constraints, enum vocabularies) are profile-declared and evaluated by
 * a profile-aware validator layer (not in the core).
 */

import type { Attribute, Diagnostic, Entry } from "../model/mod.ts";
import {
  attributeSpec,
  CORE_TYPE_SCOPED_ATTRS,
  CSV_SPLITTABLE_TYPES,
  IDENTITY_KEY,
  ULID_RE,
  UNIVERSAL_ATTRIBUTE_KEYS,
  URI_SCHEME_RE,
} from "../model/mod.ts";
import { HTTP_URL_RE } from "./value_types.ts";
import { validateTypl } from "../typl/mod.ts";

/** Universal attribute keys the core recognizes. */
const UNIVERSAL_KEYS = new Set(UNIVERSAL_ATTRIBUTE_KEYS);

/**
 * Value-type set that's repeatable per spec §1.8 — these attributes
 * accept multiple lines for distinct values, so multiple trailers with
 * the same key are legal. Single-cardinality attributes are anything
 * not in this set.
 */
const REPEATABLE_VALUE_TYPES: ReadonlySet<string> = new Set([
  "id-list",
  "tag-list",
  "citation",
  "external-id",
]);

/**
 * Slug pattern for Reference-shape display IDs (spec §1.7, ADR-002 §Part 3).
 * Pandoc/BibTeX cite-key convention, restricted to a portable character
 * set: starts with a letter, body alphanumeric + `.` / `/` / `-` / `_`,
 * ends with an alphanumeric.
 */
const REFERENCE_SLUG_RE = /^[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?$/;

/** Result of a validation pass. */
export interface ValidateResult {
  /** Diagnostics found during validation. */
  readonly diagnostics: readonly Diagnostic[];
  /** Whether validation passed with no errors. */
  readonly valid: boolean;
}

/**
 * Validate a set of parsed entries for structural correctness and
 * cross-reference integrity.
 *
 * @param entries - Parsed entries to validate
 */
export function validate(entries: readonly Entry[]): ValidateResult {
  const diagnostics: Diagnostic[] = [];

  checkStructural(entries, diagnostics);
  checkReferences(entries, diagnostics);

  // Typl cross-entry collisions (TYPL-002/003) and undefined-typedef-refs
  // (TYPL-005). Per-block diagnostics (TYPL-001/004/006/007/008) already
  // fired during parse via the bridge.
  const typlResult = validateTypl(entries);
  diagnostics.push(...typlResult.diagnostics);

  const valid = !diagnostics.some((d) => d.severity === "error");
  return { diagnostics, valid };
}

/** MSL-R structural checks on individual entries and cross-entry uniqueness. */
function checkStructural(
  entries: readonly Entry[],
  diagnostics: Diagnostic[],
): void {
  const displayIds = new Map<string, Entry>();
  const ids = new Map<string, Entry>();

  for (const entry of entries) {
    // MSL-R003: exactly one `Id:` attribute per entry.
    // Dual-emit: MSL-I002 (Reference missing Id), MSL-I003 (Authored missing
    // Id), MSL-I004 (multiple Id) — nextgen §4.2 codes alongside legacy.
    const idAttrs = entry.rawAttributes.filter((a) => a.key === IDENTITY_KEY);
    if (idAttrs.length === 0) {
      diagnostics.push({
        code: "MSL-R003",
        severity: "error",
        message: `${entry.displayId}: missing Id: attribute`,
        location: entry.location,
      });
      // Dual-emit: shape-specific nextgen code
      if (entry.shape === "Reference") {
        diagnostics.push({
          code: "MSL-I002",
          severity: "error",
          message: `${entry.displayId}: Reference-shape entry without Id: ` +
            `fmt cannot mint URIs (spec section 4.2)`,
          location: entry.location,
        });
      } else {
        diagnostics.push({
          code: "MSL-I003",
          severity: "error",
          message: `${entry.displayId}: Authored-shape entry without Id: ` +
            `run fmt to mint a ULID (spec section 4.2)`,
          location: entry.location,
        });
      }
    } else if (idAttrs.length > 1) {
      diagnostics.push({
        code: "MSL-R003",
        severity: "error",
        message:
          `${entry.displayId}: multiple Id: attributes (${idAttrs.length}) — exactly one is required`,
        location: entry.location,
      });
      // Dual-emit: MSL-I004
      diagnostics.push({
        code: "MSL-I004",
        severity: "error",
        message: `${entry.displayId}: multiple Id: trailers ` +
          `(${idAttrs.length}) on the same entry (spec section 4.2)`,
        location: entry.location,
      });
    }

    // MSL-R004: `Id:` value must be a ULID or a scheme-qualified URI.
    // Dual-emit: MSL-I001 — nextgen §4.2 code alongside legacy.
    if (idAttrs.length > 0) {
      const value = idAttrs[0].value;
      const isUlid = ULID_RE.test(value);
      const isUri = URI_SCHEME_RE.test(value);
      if (!isUlid && !isUri) {
        diagnostics.push({
          code: "MSL-R004",
          severity: "error",
          message:
            `${entry.displayId}: Id: value '${value}' is neither a bare ULID nor a scheme-qualified URI`,
          location: entry.location,
        });
        diagnostics.push({
          code: "MSL-I001",
          severity: "error",
          message:
            `${entry.displayId}: Id: value '${value}' is neither a ULID ` +
            `(^[0-9A-HJKMNP-TV-Z]{26}$) nor an RFC 3986 URI (spec section 4.2)`,
          location: entry.location,
        });
      }
      // Shape consistency: ULID ↔ identified, URI ↔ referenced.
      if (isUlid && entry.shape !== "Authored") {
        diagnostics.push({
          code: "MSL-R004",
          severity: "error",
          message:
            `${entry.displayId}: Id: value is a ULID but entry shape is ${entry.shape}`,
          location: entry.location,
        });
      } else if (isUri && entry.shape !== "Reference") {
        diagnostics.push({
          code: "MSL-R004",
          severity: "error",
          message:
            `${entry.displayId}: Id: value is a URI but entry shape is ${entry.shape}`,
          location: entry.location,
        });
      }
    }

    // MSL-I006: Reference-shape display ID must match the slug pattern
    // (spec §1.7, ADR-002 §Part 3). Authored entries have a free-form
    // display ID at core level (tightened by profile patterns).
    if (
      entry.shape === "Reference" && !REFERENCE_SLUG_RE.test(entry.displayId)
    ) {
      diagnostics.push({
        code: "MSL-I006",
        severity: "error",
        message: `${entry.displayId}: Reference-shape display ID does not ` +
          `match the slug pattern (spec §1.7); expected ` +
          `^[A-Za-z]([A-Za-z0-9._/-]*[A-Za-z0-9])?$`,
        location: entry.location,
      });
    }

    // MSL-R006: Display ID unique across all entries.
    // Dual-emit: MSL-I008 (warning) — nextgen §4.2.
    const existingDisplay = displayIds.get(entry.displayId);
    if (existingDisplay) {
      diagnostics.push({
        code: "MSL-R006",
        severity: "error",
        message:
          `duplicate display ID '${entry.displayId}' (also at ${existingDisplay.location.file}:${existingDisplay.location.line})`,
        location: entry.location,
      });
      diagnostics.push({
        code: "MSL-I008",
        severity: "warning",
        message: `duplicate display ID '${entry.displayId}' within the same ` +
          `shape (also at ${existingDisplay.location.file}:` +
          `${existingDisplay.location.line}) -- cross-references resolve ` +
          `by Id:, so this is style-only (spec section 4.2)`,
        location: entry.location,
      });
    } else {
      displayIds.set(entry.displayId, entry);
    }

    // MSL-R005: identity value unique across all entries.
    // Dual-emit: MSL-I007 — nextgen §4.2.
    if (entry.id) {
      const existingId = ids.get(entry.id);
      if (existingId) {
        diagnostics.push({
          code: "MSL-R005",
          severity: "error",
          message:
            `duplicate Id '${entry.id}' (also at ${existingId.location.file}:${existingId.location.line})`,
          location: entry.location,
        });
        diagnostics.push({
          code: "MSL-I007",
          severity: "error",
          message:
            `duplicate Id: value '${entry.id}' across the project (also ` +
            `at ${existingId.location.file}:${existingId.location.line}) ` +
            `(spec section 4.2)`,
          location: entry.location,
        });
      } else {
        ids.set(entry.id, entry);
      }
    }

    // MSL-P010 — entry title is empty after trimming. The parser
    // accepts an empty title for shape stability (`[REQ-001]` with
    // nothing after) but the canonical form per spec §4.2 requires a
    // non-empty human-readable title. Fires regardless of shape.
    if (entry.title.trim().length === 0) {
      diagnostics.push({
        code: "MSL-P010",
        severity: "error",
        message: `${entry.displayId}: title is empty after trimming ` +
          `(spec §4.2); add a non-empty human-readable title after ']'`,
        location: entry.location,
      });
    }

    // MSL-A011 — `citation`-typed attribute (References:) used CSV
    // form. The canonical form is multi-line per spec §2.3.2: locators
    // may contain commas (e.g. `[@iso26262, p. 42]`), so the parser
    // never CSV-splits citation values. Detection scans for a `,` at
    // bracket-depth zero — commas inside `[…]` are locators and OK.
    for (const attr of entry.rawAttributes) {
      const spec = attributeSpec(attr.key);
      if (spec?.type !== "citation") continue;
      let depth = 0;
      let sawTopLevelComma = false;
      for (const ch of attr.value) {
        if (ch === "[") depth++;
        else if (ch === "]" && depth > 0) depth--;
        else if (ch === "," && depth === 0) {
          sawTopLevelComma = true;
          break;
        }
      }
      if (sawTopLevelComma) {
        diagnostics.push({
          code: "MSL-A011",
          severity: "error",
          message: `${entry.displayId}: '${attr.key}' is citation-typed and ` +
            `must use multi-line form (spec §2.3.2); CSV is rejected because ` +
            `Pandoc locators may contain commas`,
          location: entry.location,
        });
      }
    }

    // MSL-A012 — repeatable attribute value list is empty (spec §1.8).
    // Fires when an authored repeatable attribute (id-list, tag-list,
    // citation, external-id) carries no non-empty values after trimming
    // and CSV splitting. `citation` is not CSV-splittable, so its check
    // is a plain trim-and-empty test.
    for (const attr of entry.rawAttributes) {
      const spec = attributeSpec(attr.key);
      if (!spec) continue;
      if (!REPEATABLE_VALUE_TYPES.has(spec.type)) continue;
      const raw = attr.value;
      const isCitation = spec.type === "citation";
      const values = isCitation
        ? [raw.trim()].filter((s) => s.length > 0)
        : raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      if (values.length === 0) {
        diagnostics.push({
          code: "MSL-A012",
          severity: "error",
          message: `${entry.displayId}: '${attr.key}' is a repeatable ` +
            `attribute but the value list is empty (spec §1.8)`,
          location: entry.location,
        });
      }
    }

    // MSL-A013 — single-cardinality core attribute used more than once.
    // `Id:` is excluded because MSL-R003 (above) reports its duplicates
    // with a more specific message. Profile-declared attribute
    // cardinality is enforced by the profile-aware Stage 3 (MSL-A002).
    const seenSingleKeys = new Set<string>();
    const reportedA013 = new Set<string>();
    for (const attr of entry.rawAttributes) {
      if (attr.key === IDENTITY_KEY) continue;
      const spec = attributeSpec(attr.key);
      if (!spec) continue;
      if (REPEATABLE_VALUE_TYPES.has(spec.type)) continue;
      if (seenSingleKeys.has(attr.key)) {
        if (!reportedA013.has(attr.key)) {
          diagnostics.push({
            code: "MSL-A013",
            severity: "error",
            message:
              `${entry.displayId}: '${attr.key}' is single-cardinality ` +
              `but appears more than once (spec §1.8)`,
            location: entry.location,
          });
          reportedA013.add(attr.key);
        }
      } else {
        seenSingleKeys.add(attr.key);
      }
    }

    // MSL-A030 / MSL-A050 / MSL-R010 checks per attribute
    // (§4.4 / §4.8 / spec §1.5).
    for (const attr of entry.rawAttributes) {
      // MSL-A030: generated-origin attributes must not appear in source.
      const spec = attributeSpec(attr.key);
      if (spec?.origin === "generated") {
        diagnostics.push({
          code: "MSL-A030",
          severity: "error",
          message:
            `${entry.displayId}: '${attr.key}' has generated origin and must not appear in source (computed at build time per ADR-003 §Part 3)`,
          location: entry.location,
        });
        continue;
      }
      // MSL-A050: value does not parse against the declared value type
      // (§4.4). The core knows the value type for the promoted Reference
      // attributes (spec §1.5) and the universal enum attributes;
      // profile-declared attribute types are validated by the
      // profile-aware Stage 3 instead.
      if (attr.key === "Reference-url") {
        if (!HTTP_URL_RE.test(attr.value.trim())) {
          diagnostics.push({
            code: "MSL-A050",
            severity: "error",
            message: `${entry.displayId}: Reference-url value ` +
              `'${attr.value.trim()}' is not an http(s) URL (spec §1.5)`,
            location: entry.location,
          });
          continue;
        }
      }
      if (spec?.type === "enum" && spec.enumValues) {
        const trimmed = attr.value.trim();
        if (trimmed.length > 0 && !spec.enumValues.includes(trimmed)) {
          diagnostics.push({
            code: "MSL-A050",
            severity: "error",
            message: `${entry.displayId}: ${attr.key} value '${trimmed}' ` +
              `is not in the allowed set ` +
              `{${spec.enumValues.join(", ")}} (spec §1.8 enum)`,
            location: entry.location,
          });
          continue;
        }
      }
      // MSL-R010: Unknown attributes are warnings in the core. A
      // profile-aware validator widens this check to include profile-declared
      // attributes; until then, anything outside the universal set is
      // unrecognized. Core-typed attributes (per ADR-003 §Part 2) are
      // suppressed here — the per-type validator emits a more specific
      // MSL-T022 when they appear on the "wrong" type.
      if (
        !UNIVERSAL_KEYS.has(attr.key) &&
        attr.key !== "Type" &&
        !CORE_TYPE_SCOPED_ATTRS.has(attr.key)
      ) {
        diagnostics.push({
          code: "MSL-R010",
          severity: "warning",
          message:
            `${entry.displayId}: unknown attribute '${attr.key}' (not in core universal set; profile-declared attributes are permitted when a profile is loaded)`,
          location: entry.location,
        });
      }

      // MSL-A006: empty element in CSV attribute value (e.g. "A,,B").
      const csvSpec = attributeSpec(attr.key);
      if (
        csvSpec && CSV_SPLITTABLE_TYPES.has(csvSpec.type) &&
        attr.value.includes(",")
      ) {
        const parts = attr.value.split(",").map((s) => s.trim());
        const emptyCount = parts.filter((s) => s.length === 0).length;
        if (emptyCount > 0) {
          diagnostics.push({
            code: "MSL-A006",
            severity: "warning",
            message:
              `${entry.displayId}: attribute '${attr.key}' contains ${emptyCount} empty element(s) in CSV value "${attr.value}"`,
            location: entry.location,
          });
        }
      }
    }
  }
}

/** Cross-reference integrity checks. */
function checkReferences(
  entries: readonly Entry[],
  diagnostics: Diagnostic[],
): void {
  // Build a display-ID index for cross-reference resolution.
  const byDisplayId = new Map<string, Entry>();
  for (const entry of entries) {
    if (!byDisplayId.has(entry.displayId)) {
      byDisplayId.set(entry.displayId, entry);
    }
  }

  // Also index by `Id:` value so references may target ULIDs or URIs
  // directly (profile tooling commonly accepts either).
  const byId = new Map<string, Entry>();
  for (const entry of entries) {
    if (entry.id && !byId.has(entry.id)) {
      byId.set(entry.id, entry);
    }
  }

  // MSL-T012: `Supersedes:` — the one baked-in relation. Target must
  // resolve; profile rules check type/shape compatibility separately.
  for (const entry of entries) {
    const supersedes = entry.rawAttributes.find((a) => a.key === "Supersedes");
    if (!supersedes) continue;
    const target = supersedes.value.trim();
    const resolved = byDisplayId.get(target) ?? byId.get(target);
    if (!resolved) {
      diagnostics.push({
        code: "MSL-T012",
        severity: "error",
        message: `${entry.displayId}: Supersedes target '${target}' not found`,
        location: entry.location,
      });
    }
  }

  // MSL-T005: `References:` — citations must resolve to a referenced
  // entry. This is a universal relation (citing identified → referenced).
  for (const entry of entries) {
    const citations = entry.rawAttributes.filter((a) => a.key === "References");
    for (const attr of citations) {
      // Citation format: "slug [free-text locator]"; take the first token.
      const slug = attr.value.split(/\s/)[0];
      if (!slug) continue;
      const resolved = byDisplayId.get(slug) ?? byId.get(slug);
      if (!resolved) {
        diagnostics.push({
          code: "MSL-T005",
          severity: "error",
          message:
            `${entry.displayId}: References: unresolved citation '${slug}'`,
          location: entry.location,
        });
        continue;
      }
      if (resolved.shape !== "Reference") {
        diagnostics.push({
          code: "MSL-R085",
          severity: "warning",
          message:
            `${entry.displayId}: References: target '${slug}' resolves to a ` +
            `'${resolved.shape}' entry but References must cite a ` +
            `Reference-shape entry (spec §4.8)`,
          location: entry.location,
        });
      }
    }
  }
}

// Re-exported for callers that want to write their own cross-reference
// checks over the core index.
export function indexByDisplayId(
  entries: readonly Entry[],
): ReadonlyMap<string, Entry> {
  const map = new Map<string, Entry>();
  for (const entry of entries) {
    if (!map.has(entry.displayId)) map.set(entry.displayId, entry);
  }
  return map;
}

// Retained export for downstream consumers.
export function findAttr(
  attrs: readonly Attribute[],
  key: string,
): Attribute | undefined {
  return attrs.find((a) => a.key === key);
}

export { runPipeline, suppressDeclaredAttrR010 } from "./pipeline.ts";
export type { PipelineResult } from "./pipeline.ts";

export { validateListingDocuments } from "./listing.ts";
export type { ListingFileContext, ListingKind } from "./listing.ts";

export { classifyEntriesStage, classifyEntry } from "./types.ts";
export type { ClassifyResult, ClassifyStageResult } from "./types.ts";

export { compileDisplayIdPattern } from "./pattern.ts";

export { effectiveScope, validateAttributesForEntry } from "./attributes.ts";
export type { EffectiveAttrScope } from "./attributes.ts";

export { validateValue } from "./value_types.ts";
export type { ValueValidator } from "./value_types.ts";

export { normalizeListValues } from "./normalize.ts";

export {
  effectiveTraceRules,
  matchesAnyTarget,
  validateTraceabilityForEntry,
} from "./traceability.ts";
