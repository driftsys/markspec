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

/** Prose text plus the inline markers recognised within it. */
export interface InlineContent {
  readonly text: string;
  readonly markers: readonly InlineMarker[];
}

/** A list item: a sequence of blocks (spec §2.4 `List`). */
export interface ListItemNode {
  readonly blocks: readonly BodyBlock[];
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
  readonly items: readonly ListItemNode[];
  readonly range: SourceRange;
}

/** GFM pipe table (spec §2.4). */
export interface TableNode {
  readonly kind: "table";
  readonly header: readonly InlineContent[];
  readonly rows: readonly (readonly InlineContent[])[];
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
  readonly raw: string;
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
