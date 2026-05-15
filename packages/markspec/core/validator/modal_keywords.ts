/**
 * @module core/validator/modal_keywords
 *
 * MSL-M060 validator — uppercase RFC 2119 modal keyword (`SHALL`,
 * `SHOULD`, `MAY`, `MUST`, optionally `… NOT`) in entry-body prose.
 * The formatter normalises these to lowercase per spec §3.4.1; this
 * validator surfaces the deviation in a lint-only flow. Profiles may
 * promote the severity. Each prose-bearing node's `InlineContent.markers`
 * carries pre-extracted `ModalMarker` objects from the builder; an
 * uppercase match is detected where `marker.raw` differs from
 * `marker.canonical`. EARS markers are not flagged — MSL-M060 targets
 * RFC 2119 only. Code, Feature, and Math blocks are automatically
 * excluded because the builder does not extract markers from verbatim
 * content.
 */

import type { Diagnostic, Entry } from "../model/mod.ts";
import type {
  BodyBlock,
  InlineContent,
  ListItemNode,
  ModalMarker,
} from "../ast/nodes.ts";
import { resolvedCoreType } from "./type_resolution.ts";

// ---------------------------------------------------------------------------
// Marker collection from bodyAst
// ---------------------------------------------------------------------------

/** Collect all modal markers from an InlineContent object. */
function modalsFromInline(content: InlineContent): readonly ModalMarker[] {
  return content.markers.filter(
    (m): m is ModalMarker => m.kind === "modal",
  );
}

/** Recursively collect modal markers from a list item's blocks. */
function modalsFromListItem(item: ListItemNode): ModalMarker[] {
  const out: ModalMarker[] = [];
  for (const block of item.blocks) {
    out.push(...modalsFromBlock(block));
  }
  return out;
}

/** Collect all modal markers from a single BodyBlock (recursively). */
function modalsFromBlock(block: BodyBlock): ModalMarker[] {
  const out: ModalMarker[] = [];
  switch (block.kind) {
    case "paragraph":
      out.push(...modalsFromInline(block.content));
      break;
    case "list":
      for (const item of block.items) {
        out.push(...modalsFromListItem(item));
      }
      break;
    case "table":
      for (const cell of block.header) {
        out.push(...modalsFromInline(cell));
      }
      for (const row of block.rows) {
        for (const cell of row) {
          out.push(...modalsFromInline(cell));
        }
      }
      break;
    case "note":
      out.push(...modalsFromInline(block.content));
      break;
    case "blockquote":
      out.push(...modalsFromInline(block.content));
      break;
    case "definition-list":
      for (const item of block.items) {
        out.push(...modalsFromInline(item.term));
        out.push(...modalsFromInline(item.definition));
      }
      break;
    case "code":
    case "feature":
    case "math":
    case "figure":
    case "caption":
    case "unknown":
      // Verbatim / structural nodes: no modal markers.
      break;
    default:
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan an entry's body for uppercase modal keywords and emit MSL-M060
 * for each occurrence. Severity is `warning`; the formatter rewrites
 * them on the next run.
 */
export function validateModalKeywords(entry: Entry): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let anyModalSeen = false;

  const blocks = entry.bodyAst ?? [];
  for (const block of blocks) {
    for (const marker of modalsFromBlock(block)) {
      anyModalSeen = true;
      // MSL-M060: RFC 2119 keywords in non-canonical (uppercase) form.
      // `marker.raw` is the original source text; `marker.canonical` is
      // always lowercase. When they differ, the keyword is uppercase.
      // EARS markers (cls = "ears") are always case-preserved and
      // are not subject to MSL-M060.
      if (marker.cls !== "rfc2119") continue;
      const raw = marker.raw ?? marker.canonical;
      if (raw === marker.canonical) continue; // already lowercase — OK
      diagnostics.push({
        code: "MSL-M060",
        severity: "warning",
        message: `${entry.displayId}: modal keyword '${raw}' in body ` +
          `prose is uppercase (spec §3.4.1 canonical form is lowercase; ` +
          `'markspec format' will rewrite it)`,
        location: {
          file: entry.location.file,
          // marker.range.start.line is body-relative 1-based.
          // entry.location.line is the title line (0-based offset 0).
          // Body line 1 → file line entry.location.line + 0, etc.
          line: entry.location.line + (marker.range.start.line - 1),
          column: marker.range.start.column,
        },
      });
    }
  }

  // MSL-M061 — Requirement-type entry contains no modal keyword
  // (info; style hint). Gated on the resolved core type being
  // `Requirement` so non-requirement entries (Tests, Contracts, etc.)
  // are not flagged. The hint stays at info severity so it doesn't
  // affect exit codes; profiles may promote.
  if (!anyModalSeen && resolvedCoreType(entry) === "Requirement") {
    diagnostics.push({
      code: "MSL-M061",
      severity: "info",
      message: `${entry.displayId}: Requirement entry contains no modal ` +
        `keyword (shall / should / may / must) — consider declaring one ` +
        `to make the obligation explicit (spec §3.4.1 "Modal keywords")`,
      location: entry.location,
    });
  }
  return diagnostics;
}
