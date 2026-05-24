/**
 * @module core/ast/nodes
 *
 * Canonical body-AST node taxonomy. Authoritative spec:
 * `docs/specs/markspec-core-data-model.md` §2.4 (closed 10-block
 * catalogue), §2.6 (captions).
 *
 * PR 1 of the canonical-body-AST plan: pure type contract, zero
 * behaviour. The builder (`build.ts`) and renderer (`render.ts`)
 * land in later PRs.
 *
 * ADR-016: inline-construct extraction (modal keywords, EARS triggers,
 * entity refs, Gherkin tokens) has moved to `Entry.bodyTokens` —
 * see `core/parser/body_tokens.ts`. `InlineContent` now carries only
 * verbatim source text.
 */

/** Body-relative source span. 1-based line/column, matching the
 * codebase's {@link SourceLocation} convention. No `file`: that
 * lives on the owning {@link Entry}. */
export interface SourceRange {
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}

/** Prose text. Verbatim source (markup-preserving per spec §5.1).
 *
 * `text` is the **verbatim source prose** (markup-preserving — emphasis,
 * strong, links, autolinks, hard line breaks survive byte-identically per
 * spec §5.1). Inline-construct extraction (modal keywords, EARS triggers,
 * entity refs) has moved to `Entry.bodyTokens` (ADR-016 Decision 5).
 */
export interface InlineContent {
  readonly text: string;
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

/** CommonMark paragraph (spec §2.4). */
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

/** Fenced code with info-string `gherkin` or `feature`. Content is kept verbatim
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
