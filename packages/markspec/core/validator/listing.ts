/**
 * @module validator/listing
 *
 * Listing-directive validator — MSL-L010 through MSL-L050.
 *
 * Validates four concern areas:
 *
 * 1. Directive placement / conflict (§2.3): L010, L011, L012
 * 2. Glossary heading-shape grammar (§4.2): L020–L024 (delegated to
 *    `validateGlossaryStructure`)
 * 3. Component Id-scheme parsers (§5): L030–L037 (via `parseComponentScheme`)
 * 4. Per-directive content (§6): L040, L041, L042, L043, L050
 *
 * Called from the validate CLI command once per invocation, receiving one
 * {@linkcode ListingFileContext} per validated file. The listing validator
 * is separate from `runPipeline` because it requires per-file context
 * (file name, raw content, directives) that the flat Entry-list pipeline
 * does not carry.
 */

import { basename } from "@std/path";
import type { Diagnostic, Directive, Entry } from "../model/mod.ts";
import { descendantsOf } from "../model/mod.ts";
import { validateGlossaryStructure } from "../parser/glossary.ts";
import {
  isSchemeQualifiedUri,
  parseComponentScheme,
} from "./component_schemes.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The three recognized listing-directive kinds. */
export type ListingKind = "references" | "glossary" | "components";

/** Per-file context passed to {@linkcode validateListingDocuments}. */
export interface ListingFileContext {
  /** Absolute or relative file path (must match entry locations). */
  readonly file: string;
  /** Raw Markdown source (for glossary AST validation). */
  readonly content: string;
  /** Entries parsed from this file. */
  readonly entries: readonly Entry[];
  /** Directives detected from this file's HTML comments. */
  readonly directives: readonly Directive[];
}

// ---------------------------------------------------------------------------
// Component-family and Unit-family sets
// ---------------------------------------------------------------------------

/** Core Component-family type names per ADR-003 §Part 2 / spec §6.3.
 *
 * SoftwareInterface and HardwareInterface are NOT included here: they
 * were re-parented from Component to Contract (interface-as-contract
 * design). A components listing accepts only true structural components.
 */
const COMPONENT_FAMILY: ReadonlySet<string> = descendantsOf("Component");

/** Core Unit-family type names per ADR-003 §Part 2. */
const UNIT_FAMILY: ReadonlySet<string> = new Set([
  "Unit",
  "SoftwareUnit",
  "HardwareUnit",
]);

// ---------------------------------------------------------------------------
// Filename-trigger detection
// ---------------------------------------------------------------------------

/** Listing kind implied by a file's basename, or null if not a listing file. */
function filenameKind(file: string): ListingKind | null {
  const name = basename(file).toLowerCase();
  if (!name.endsWith(".md")) return null;
  const base = name.replace(/\.md$/, "");
  if (base === "references") return "references";
  if (base === "glossary") return "glossary";
  if (base === "components") return "components";
  return null;
}

/** Listing kind named by a directive, or null for non-listing directives. */
function directiveKind(name: string): ListingKind | null {
  if (name === "references") return "references";
  if (name === "glossary") return "glossary";
  if (name === "components") return "components";
  return null;
}

// ---------------------------------------------------------------------------
// Type-attribute helper
// ---------------------------------------------------------------------------

/** Extract the raw `Type:` attribute value from an entry, or null. */
function rawType(entry: Entry): string | null {
  for (const attr of entry.rawAttributes) {
    if (attr.key === "Type") return attr.value.trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-file validation
// ---------------------------------------------------------------------------

function validateFile(ctx: ListingFileContext): Diagnostic[] {
  const { file, content, entries, directives } = ctx;
  const diagnostics: Diagnostic[] = [];

  // -------------------------------------------------------------------------
  // Phase 1: directive placement / conflict detection (§2.3)
  // -------------------------------------------------------------------------

  const fileKind = filenameKind(file);
  const listingDirectives = directives.filter((d) =>
    directiveKind(d.name) !== null
  );

  let resolvedKind: ListingKind | null = fileKind;

  if (listingDirectives.length >= 2) {
    // MSL-L012: multiple explicit listing directives in one file.
    diagnostics.push({
      code: "MSL-L012",
      severity: "error",
      message: `${file}:${listingDirectives[1].location.line}: ` +
        `multiple listing directives in one file ` +
        `('${listingDirectives[0].name}' and '${
          listingDirectives[1].name
        }') — ` +
        `a listing file carries exactly one directive (spec §2.3)`,
      location: listingDirectives[1].location,
    });
    // Use the first directive as the resolved kind so downstream checks run.
    resolvedKind = directiveKind(listingDirectives[0].name);
  } else if (listingDirectives.length === 1) {
    const explicitKind = directiveKind(listingDirectives[0].name)!;
    if (fileKind !== null) {
      if (fileKind === explicitKind) {
        // MSL-L010: redundant explicit directive (matches filename trigger).
        diagnostics.push({
          code: "MSL-L010",
          severity: "info",
          message: `${file}:${listingDirectives[0].location.line}: ` +
            `redundant directive '<!-- markspec:${explicitKind} -->' — ` +
            `the filename '${basename(file)}' already triggers this listing ` +
            `(spec §2.1)`,
          location: listingDirectives[0].location,
        });
        resolvedKind = explicitKind;
      } else {
        // MSL-L011: explicit directive conflicts with filename trigger.
        diagnostics.push({
          code: "MSL-L011",
          severity: "error",
          message: `${file}:${listingDirectives[0].location.line}: ` +
            `directive 'markspec:${explicitKind}' conflicts with filename ` +
            `trigger '${fileKind}' — remove the directive or rename the file ` +
            `(spec §2.3)`,
          location: listingDirectives[0].location,
        });
        // Conflict is unresolved; use the filename trigger.
        resolvedKind = fileKind;
      }
    } else {
      resolvedKind = explicitKind;
    }
  }

  // No listing kind → not a listing file, nothing more to validate.
  if (resolvedKind === null) return diagnostics;

  // -------------------------------------------------------------------------
  // Phase 2: Glossary heading-shape validation (§4.2)
  // -------------------------------------------------------------------------

  let glossaryTermCount = 0;

  if (resolvedKind === "glossary") {
    const glossaryResult = validateGlossaryStructure(content, { file });
    diagnostics.push(...glossaryResult.diagnostics);
    glossaryTermCount = glossaryResult.termCount;

    // MSL-L042: entry blocks must not appear in a glossary file.
    for (const entry of entries) {
      diagnostics.push({
        code: "MSL-L042",
        severity: "error",
        message: `${file}:${entry.location.line}: entry block ` +
          `'[${entry.displayId}]' in a glossary listing — ` +
          `the glossary shape uses headings, not entry blocks (spec §6.2)`,
        location: entry.location,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Phase 3 & 4: per-entry validation for references and components
  // -------------------------------------------------------------------------

  for (const entry of entries) {
    if (resolvedKind === "references") {
      validateReferencesEntry(entry, file, diagnostics);
    } else if (resolvedKind === "components") {
      validateComponentsEntry(entry, file, diagnostics);
    }
  }

  // -------------------------------------------------------------------------
  // Phase 4: MSL-L050 — empty listing
  // -------------------------------------------------------------------------

  const isEmpty = resolvedKind === "glossary"
    ? glossaryTermCount === 0
    : entries.length === 0;

  if (isEmpty) {
    diagnostics.push({
      code: "MSL-L050",
      severity: "info",
      message: `${file}: empty ${resolvedKind} listing — ` +
        `no items found (valid placeholder; spec §6.4)`,
      location: { file, line: 1, column: 1 },
    });
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// References listing — per-entry checks (§6.1)
// ---------------------------------------------------------------------------

function validateReferencesEntry(
  entry: Entry,
  file: string,
  diagnostics: Diagnostic[],
): void {
  // MSL-L040: Authored-shape entry in a references listing (warning).
  if (entry.shape === "Authored") {
    diagnostics.push({
      code: "MSL-L040",
      severity: "warning",
      message: `${file}:${entry.location.line}: Authored entry ` +
        `'[${entry.displayId}]' in a references listing — ` +
        `references should be Reference-shape (URI Id:); ` +
        `Authored entries are project-owned, not bibliographic (spec §6.1)`,
      location: entry.location,
    });
    return;
  }

  // MSL-L041: resolved Type is in the Unit family (warning).
  const typeVal = rawType(entry);
  if (typeVal !== null && UNIT_FAMILY.has(typeVal)) {
    diagnostics.push({
      code: "MSL-L041",
      severity: "warning",
      message: `${file}:${entry.location.line}: entry '[${entry.displayId}]' ` +
        `has Type: ${typeVal} (Unit family) in a references listing — ` +
        `references should resolve to Specification or Component (spec §6.1)`,
      location: entry.location,
    });
  }
}

// ---------------------------------------------------------------------------
// Components listing — per-entry checks (§6.3)
// ---------------------------------------------------------------------------

function validateComponentsEntry(
  entry: Entry,
  file: string,
  diagnostics: Diagnostic[],
): void {
  // MSL-L043: explicit Type: is not in the Component family.
  const typeVal = rawType(entry);
  if (typeVal !== null && !COMPONENT_FAMILY.has(typeVal)) {
    diagnostics.push({
      code: "MSL-L043",
      severity: "error",
      message: `${file}:${entry.location.line}: entry '[${entry.displayId}]' ` +
        `has Type: ${typeVal} which is not in the Component family ` +
        `(Component/SoftwareComponent/HardwareComponent) — ` +
        `only Component-family types are permitted in a components listing ` +
        `(spec §6.3)`,
      location: entry.location,
    });
    return;
  }

  // For Reference-shape entries, validate the Id: scheme (§5).
  if (entry.shape === "Reference" && entry.id) {
    validateComponentScheme(entry.id, entry, file, diagnostics);
  }
  // Authored-shape components (ULID Id:) are valid per spec §6.3 — no scheme check.
}

// ---------------------------------------------------------------------------
// Component Id-scheme validation (§5 / §6.3)
// ---------------------------------------------------------------------------

function validateComponentScheme(
  idValue: string,
  entry: Entry,
  file: string,
  diagnostics: Diagnostic[],
): void {
  const result = parseComponentScheme(idValue);

  if (result === null) {
    // No known component scheme matched. If it's a valid RFC 3986 URI →
    // MSL-L030 info (unrecognized scheme, generic fallback).
    // `isSchemeQualifiedUri` checks the RFC 3986 scheme prefix.
    if (isSchemeQualifiedUri(idValue)) {
      diagnostics.push({
        code: "MSL-L030",
        severity: "info",
        message: `${file}:${entry.location.line}: ` +
          `entry '[${entry.displayId}]' Id: '${idValue}' — ` +
          `unrecognized component Id scheme; classified by fallback ` +
          `(spec §5, MSL-L030)`,
        location: entry.location,
      });
    }
    // Not a scheme-qualified URI at all → the core validator (MSL-R004) handles it.
    return;
  }

  if (!result.ok) {
    diagnostics.push({
      code: result.code,
      severity: "error",
      message: `${file}:${entry.location.line}: ` +
        `entry '[${entry.displayId}]' Id: '${idValue}' — ${result.message}`,
      location: entry.location,
    });
  }
  // result.ok === true → valid scheme, no diagnostic needed here.
  // (MSL-L030 for unknown purl types is handled inside parsePurl returning
  // { ok: true, type: "Component" } — the caller gets no diagnostic.)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a set of files for listing-directive conformance.
 *
 * Returns diagnostics in document order (one file at a time in the order
 * `contexts` was supplied). Call this alongside `runPipeline` — both
 * operate independently.
 */
export function validateListingDocuments(
  contexts: readonly ListingFileContext[],
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const ctx of contexts) {
    diagnostics.push(...validateFile(ctx));
  }
  return diagnostics;
}
