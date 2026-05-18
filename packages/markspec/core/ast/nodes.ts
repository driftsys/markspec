/**
 * @module core/ast/nodes
 *
 * Canonical body-AST node taxonomy. Authoritative spec:
 * `docs/specs/markspec-core-data-model.md` §2.4 (closed 10-block
 * catalogue), §2.5 (inline markers), §2.6 (captions).
 *
 * PR 1 of the canonical-body-AST plan: pure type contract, zero
 * behaviour. The builder (`build.ts`) and renderer (`render.ts`)
 * land in later PRs.
 */

import type { EntityRefConvention } from "../model/mod.ts";

/** Body-relative source span. 1-based line/column, matching the
 * codebase's {@link SourceLocation} convention. No `file`: that
 * lives on the owning {@link Entry}. */
export interface SourceRange {
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}

/** RFC 2119 vs EARS modal class (spec §2.5.1). */
export type ModalMarkerClass = "rfc2119" | "ears";

/** A recognised modal keyword occurrence in prose (spec §2.5.1). */
export interface ModalMarker {
  readonly kind: "modal";
  readonly cls: ModalMarkerClass;
  /** Canonical (lowercased RFC 2119 / case-preserved EARS) form. */
  readonly canonical: string;
  /**
   * Original source text as it appears in the body (may differ from
   * `canonical` for RFC 2119 keywords written in uppercase, e.g.
   * `"SHALL"` vs `canonical = "shall"`). Used by the MSL-M060 validator
   * to report the exact uppercase form in the diagnostic message and to
   * detect whether the keyword deviates from canonical form.
   *
   * Populated by {@link extractMarkersFromText} in `core/ast/build.ts`.
   * Absent only for `ModalMarker` values constructed outside the builder
   * (e.g. in tests that predate this field).
   */
  readonly raw?: string;
  readonly range: SourceRange;
}

/** An inline `$Identifier` entity reference (spec §2.5.2). Reuses
 * the existing {@link EntityRefConvention}. */
export interface EntityRefMarker {
  readonly kind: "entity";
  /** Identifier including the leading `$`. */
  readonly ident: string;
  readonly convention: EntityRefConvention;
  readonly range: SourceRange;
}

/** Inline marker union (spec §2.5). */
export type InlineMarker = ModalMarker | EntityRefMarker;

/**
 * Prose text plus the inline markers recognised within it.
 *
 * `text` is the **verbatim source prose** (markup-preserving — emphasis,
 * strong, links, autolinks, hard line breaks survive byte-identically per
 * spec §5.1). `markers` are recognised from the flattened projection so
 * modal / $Identifier detection is unaffected by surrounding markup.
 * Marker `range` columns are best-effort relative to the verbatim text.
 */
export interface InlineContent {
  readonly text: string;
  readonly markers: readonly InlineMarker[];
}

/** A list item: a sequence of blocks (spec §2.4 `List`). */
export interface ListItemNode {
  readonly blocks: readonly BodyBlock[];
  /**
   * GFM task-list checkbox state for this item, when present:
   * `false` = `[ ]`, `true` = `[x]`. Absent for non-task items.
   * Round-tripped by the renderer; `ListNode.hasTaskItems` (used by
   * MSL-B042) is derived independently and unaffected.
   */
  readonly checked?: boolean;
  /**
   * True when this item is "loose" (mdast `listItem.spread`): its blocks
   * are separated by blank lines in source. Drives inter-block blank-line
   * emission in the renderer. Distinct from `ListNode.spread`, which is
   * the list-level item-separation signal.
   */
  readonly spread?: boolean;
  readonly range: SourceRange;
}

/** One `Term : definition` pair (spec §2.4 `DefinitionList`). */
export interface DefinitionPair {
  readonly term: InlineContent;
  readonly definition: InlineContent;
}

/** GitHub-style admonition kinds (spec §2.4 `Note`). */
export type AdmonitionKind =
  | "NOTE"
  | "TIP"
  | "IMPORTANT"
  | "WARNING"
  | "CAUTION";

/** CommonMark paragraph; carries inline markers (spec §2.4). */
export interface ParagraphNode {
  readonly kind: "paragraph";
  readonly content: InlineContent;
  readonly range: SourceRange;
}

/** Ordered or unordered list, nestable (spec §2.4). */
export interface ListNode {
  readonly kind: "list";
  readonly ordered: boolean;
  /** True when the list is "loose" (items separated by blank lines in
   * source). Controls whether items are joined with `\n\n` vs `\n` on
   * render. Corresponds to the mdast `list.spread` property. */
  readonly spread: boolean;
  readonly items: readonly ListItemNode[];
  /**
   * True when at least one item is a GFM task-list item (checked or
   * unchecked). Used by the body-block exclusion validator (MSL-B042)
   * to flag task lists inside entry bodies without re-scanning the
   * body string.
   */
  readonly hasTaskItems?: boolean;
  readonly range: SourceRange;
}

/** GFM pipe table (spec §2.4). */
export interface TableNode {
  readonly kind: "table";
  readonly header: readonly InlineContent[];
  readonly rows: readonly (readonly InlineContent[])[];
  /** Verbatim source substring of the table (preserves author column
   * widths for byte-identical round-trip; header/rows are the parsed
   * view for validators). */
  readonly raw: string;
  readonly range: SourceRange;
}

/** Image link `![alt](path)` (spec §2.4). */
export interface FigureNode {
  readonly kind: "figure";
  readonly alt: string;
  readonly path: string;
  readonly range: SourceRange;
}

/** Fenced code block; info-string language tag, or none (spec §2.4). */
export interface CodeNode {
  readonly kind: "code";
  /** Info-string language tag, or `undefined` for a bare fence. */
  readonly lang: string | undefined;
  readonly text: string;
  readonly range: SourceRange;
}

/** Fenced code with info-string `gherkin`. Gherkin is kept verbatim
 * for now; structured scenario parsing is deferred to a later PR
 * (see the canonical-body-AST plan). */
export interface FeatureNode {
  readonly kind: "feature";
  readonly source: string;
  readonly range: SourceRange;
}

/** `$$ … $$` math block (spec §2.4). */
export interface MathNode {
  readonly kind: "math";
  readonly tex: string;
  readonly range: SourceRange;
}

/** `Term` / `: definition` list, GLFM (spec §2.4). */
export interface DefinitionListNode {
  readonly kind: "definition-list";
  readonly items: readonly DefinitionPair[];
  readonly range: SourceRange;
}

/** GitHub-style admonition blockquote (spec §2.4). */
export interface NoteNode {
  readonly kind: "note";
  readonly admonition: AdmonitionKind;
  readonly content: InlineContent;
  /**
   * True when the admonition body began on the marker line in source
   * (`> [!NOTE] text`) rather than its own quoted line. Round-tripped by
   * the renderer. Absent ⇒ own-line form (the canonical default).
   */
  readonly markerInline?: boolean;
  readonly range: SourceRange;
}

/** Plain `>` blockquote, for external citation excerpts (spec §2.4). */
export interface BlockquoteNode {
  readonly kind: "blockquote";
  readonly content: InlineContent;
  readonly range: SourceRange;
}

/** §2.6 caption. Distinct from the render-pipeline `Caption`
 * (model/mod.ts) — unrelated concept. `block` (resolved owner) is
 * populated by the builder/validator in later PRs. */
export interface CaptionNode {
  readonly kind: "caption";
  readonly keyword:
    | "Figure"
    | "Table"
    | "Listing"
    | "Feature"
    | "Equation"
    | "List";
  readonly text: string;
  readonly position: "above" | "below";
  readonly block?: BodyBlock;
  readonly range: SourceRange;
}

/** Fallback for malformed / excluded constructs so content is never
 * lost (spec §5.4). Excluded constructs still emit MSL-B040–B043. */
export interface UnknownNode {
  readonly kind: "unknown";
  /** Carries the verbatim source slice (spec §5.4 lossless preservation). */
  readonly raw: string;
  /**
   * Sub-kind for constructs the body-block exclusion validator (MSL-B040–B043)
   * needs to distinguish. Absent for truly unknown nodes; set for the three
   * categories the validator checks:
   *
   *   - `"heading"` — CommonMark ATX/setext heading (`#`, `##`, …, underline)
   *   - `"thematic-break"` — horizontal rule (`---`, `***`, `___`)
   *   - `"html"` — raw block-level HTML (comment or tag)
   *
   * Note: GFM task-list items are detected via `ListNode.hasTaskItems` and
   * never assigned this subkind.
   */
  readonly subkind?: "heading" | "thematic-break" | "html";
  readonly range: SourceRange;
}

/** The closed body-block union (spec §2.4) + `caption` + `unknown`. */
export type BodyBlock =
  | ParagraphNode
  | ListNode
  | TableNode
  | FigureNode
  | CodeNode
  | FeatureNode
  | MathNode
  | DefinitionListNode
  | NoteNode
  | BlockquoteNode
  | CaptionNode
  | UnknownNode;
