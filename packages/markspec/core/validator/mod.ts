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
  IDENTITY_KEY,
  ULID_RE,
  UNIVERSAL_ATTRIBUTE_KEYS,
  URI_SCHEME_RE,
} from "../model/mod.ts";
import { HTTP_URL_RE } from "./value_types.ts";

/** Universal attribute keys the core recognizes. */
const UNIVERSAL_KEYS = new Set(UNIVERSAL_ATTRIBUTE_KEYS);

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
    const idAttrs = entry.rawAttributes.filter((a) => a.key === IDENTITY_KEY);
    if (idAttrs.length === 0) {
      diagnostics.push({
        code: "MSL-R003",
        severity: "error",
        message: `${entry.displayId}: missing Id: attribute`,
        location: entry.location,
      });
    } else if (idAttrs.length > 1) {
      diagnostics.push({
        code: "MSL-R003",
        severity: "error",
        message:
          `${entry.displayId}: multiple Id: attributes (${idAttrs.length}) — exactly one is required`,
        location: entry.location,
      });
    }

    // MSL-R004: `Id:` value must be a ULID or a scheme-qualified URI.
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
      }
      // Shape consistency: ULID ↔ identified, URI ↔ referenced.
      if (isUlid && entry.shape !== "identified") {
        diagnostics.push({
          code: "MSL-R004",
          severity: "error",
          message:
            `${entry.displayId}: Id: value is a ULID but entry shape is ${entry.shape}`,
          location: entry.location,
        });
      } else if (isUri && entry.shape !== "referenced") {
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
      entry.shape === "referenced" && !REFERENCE_SLUG_RE.test(entry.displayId)
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
    const existingDisplay = displayIds.get(entry.displayId);
    if (existingDisplay) {
      diagnostics.push({
        code: "MSL-R006",
        severity: "error",
        message:
          `duplicate display ID '${entry.displayId}' (also at ${existingDisplay.location.file}:${existingDisplay.location.line})`,
        location: entry.location,
      });
    } else {
      displayIds.set(entry.displayId, entry);
    }

    // MSL-R005: identity value unique across all entries.
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
      } else {
        ids.set(entry.id, entry);
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
      // attributes (spec §1.5); profile-declared attribute types are
      // validated by the profile-aware Stage 3 instead.
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
      if (resolved.shape !== "referenced") {
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

export { runPipeline } from "./pipeline.ts";
export type { PipelineResult } from "./pipeline.ts";

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
