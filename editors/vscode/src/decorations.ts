/**
 * MarkSpec source-view decorations.
 *
 * Owns three TextEditorDecorationType instances (trailer dim, valid
 * label pill, invalid label pill) and refreshes them on demand
 * against the LSP server's `markspec/entryRanges` response.
 */

import {
  type DecorationOptions,
  type Disposable,
  MarkdownString,
  Range,
  type TextEditor,
  type TextEditorDecorationType,
  ThemeColor,
  window,
} from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

interface LspPosition {
  line: number;
  character: number;
}
interface LspRange {
  start: LspPosition;
  end: LspPosition;
}
interface LspLabelRange {
  range: LspRange;
  valid: boolean;
  diagnostic?: string;
}
type BlockquoteKind =
  | "note"
  | "tip"
  | "important"
  | "warning"
  | "caution"
  | "plain";
interface LspBlockquoteRange {
  range: LspRange;
  kind: BlockquoteKind;
  markerRange?: LspRange;
}
interface EntryRangesResponse {
  entries: Array<{
    entryRange?: LspRange;
    titleRange: LspRange;
    trailerDimRanges: LspRange[];
    labelRanges: LspLabelRange[];
    blockquoteRanges?: LspBlockquoteRange[];
  }>;
}

function toVsRange(r: LspRange): Range {
  return new Range(
    r.start.line,
    r.start.character,
    r.end.line,
    r.end.character,
  );
}

const BLOCKQUOTE_KINDS: readonly BlockquoteKind[] = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
  "plain",
];

/** Admonition kinds that carry a `[!KIND]` marker (everything but plain). */
const MARKER_KINDS = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
] as const;
type MarkerKind = (typeof MARKER_KINDS)[number];

export class DecorationManager implements Disposable {
  private entryBorder: TextEditorDecorationType;
  private trailerDim: TextEditorDecorationType;
  private titleBold: TextEditorDecorationType;
  private labelPillValid: TextEditorDecorationType;
  private labelPillInvalid: TextEditorDecorationType;
  private blockquotes: Map<BlockquoteKind, TextEditorDecorationType>;
  private markerPills: Map<MarkerKind, TextEditorDecorationType>;

  constructor(private client: LanguageClient) {
    // 3px left-bar at column 0 spanning every entry line (title
    // through last trailer line). Materialises the entry boundary
    // without a background fill so prose colours stay intact.
    this.entryBorder = window.createTextEditorDecorationType({
      borderColor: new ThemeColor("markspec.entry.border"),
      borderStyle: "solid",
      borderWidth: "0 0 0 3px",
      isWholeLine: true,
    });
    this.trailerDim = window.createTextEditorDecorationType({
      opacity: "0.6",
    });
    // Title gets the same semantic-token colour as the bracketed ID
    // (both `*.declaration`); bold here provides the visual weight that
    // sets the title apart from the ID without changing the colour.
    this.titleBold = window.createTextEditorDecorationType({
      fontWeight: "bold",
    });
    // Label pill decorations: deliberately omit `color` so the label
    // text keeps its semantic-token color (an `enumMember` token from
    // semantic_tokens.ts). Forcing a foreground here would fight the
    // theme and hide the text when the override didn't resolve cleanly.
    this.labelPillValid = window.createTextEditorDecorationType({
      backgroundColor: new ThemeColor("markspec.label.background"),
      borderColor: new ThemeColor("markspec.label.border"),
      border: "1px solid",
      borderRadius: "4px",
    });
    this.labelPillInvalid = window.createTextEditorDecorationType({
      backgroundColor: new ThemeColor("markspec.label.background"),
      borderColor: new ThemeColor("markspec.label.invalidBorder"),
      border: "1px solid",
      borderRadius: "4px",
    });
    // Blockquote decoration per kind — left-border bar only. No
    // background fill: the entry-background decoration provides the
    // card-style tint, and the admonition is identified by the
    // coloured left bar plus the marker pill on the first line.
    this.blockquotes = new Map();
    for (const kind of BLOCKQUOTE_KINDS) {
      this.blockquotes.set(
        kind,
        window.createTextEditorDecorationType({
          borderColor: new ThemeColor(`markspec.admonition.${kind}.border`),
          borderStyle: "solid",
          borderWidth: "0 0 0 3px",
          isWholeLine: true,
        }),
      );
    }
    // Marker pill per admonition kind — coloured pill around the
    // `[!NOTE]` / `[!TIP]` / etc. text on the blockquote's first line,
    // sharing the same border/background colours as the kind's left
    // bar and tokens.alerts palette.
    this.markerPills = new Map();
    for (const kind of MARKER_KINDS) {
      this.markerPills.set(
        kind,
        window.createTextEditorDecorationType({
          backgroundColor: new ThemeColor(
            `markspec.admonition.${kind}.background`,
          ),
          borderColor: new ThemeColor(`markspec.admonition.${kind}.border`),
          border: "1px solid",
          borderRadius: "4px",
        }),
      );
    }
  }

  async refresh(editor: TextEditor): Promise<void> {
    if (editor.document.languageId !== "markdown") return;
    let result: EntryRangesResponse;
    try {
      result = await this.client.sendRequest<EntryRangesResponse>(
        "markspec/entryRanges",
        { uri: editor.document.uri.toString() },
      );
    } catch {
      // Server not ready or doesn't support the request — bail silently.
      return;
    }
    const entryBorders: Range[] = [];
    const dim: Range[] = [];
    const titleBold: Range[] = [];
    const validPills: DecorationOptions[] = [];
    const invalidPills: DecorationOptions[] = [];
    const blockquoteBuckets = new Map<BlockquoteKind, Range[]>();
    for (const kind of BLOCKQUOTE_KINDS) blockquoteBuckets.set(kind, []);
    const markerBuckets = new Map<MarkerKind, Range[]>();
    for (const kind of MARKER_KINDS) markerBuckets.set(kind, []);
    for (const e of result.entries) {
      if (e.entryRange) entryBorders.push(toVsRange(e.entryRange));
      titleBold.push(toVsRange(e.titleRange));
      for (const r of e.trailerDimRanges) dim.push(toVsRange(r));
      for (const l of e.labelRanges) {
        const opt: DecorationOptions = {
          range: toVsRange(l.range),
          hoverMessage: l.diagnostic
            ? new MarkdownString(l.diagnostic)
            : undefined,
        };
        (l.valid ? validPills : invalidPills).push(opt);
      }
      for (const b of e.blockquoteRanges ?? []) {
        const bucket = blockquoteBuckets.get(b.kind);
        if (!bucket) continue;
        // One decoration per blockquote line so the left-border bar
        // renders on each visual line, not just the first/last.
        for (
          let line = b.range.start.line;
          line <= b.range.end.line;
          line++
        ) {
          if (line < 0 || line >= editor.document.lineCount) continue;
          bucket.push(new Range(line, 0, line, 0));
        }
        if (b.markerRange && b.kind !== "plain") {
          markerBuckets.get(b.kind as MarkerKind)?.push(
            toVsRange(b.markerRange),
          );
        }
      }
    }
    editor.setDecorations(this.entryBorder, entryBorders);
    editor.setDecorations(this.trailerDim, dim);
    editor.setDecorations(this.titleBold, titleBold);
    editor.setDecorations(this.labelPillValid, validPills);
    editor.setDecorations(this.labelPillInvalid, invalidPills);
    for (const kind of BLOCKQUOTE_KINDS) {
      const type = this.blockquotes.get(kind);
      const ranges = blockquoteBuckets.get(kind) ?? [];
      if (type) editor.setDecorations(type, ranges);
    }
    for (const kind of MARKER_KINDS) {
      const type = this.markerPills.get(kind);
      const ranges = markerBuckets.get(kind) ?? [];
      if (type) editor.setDecorations(type, ranges);
    }
  }

  dispose(): void {
    this.entryBorder.dispose();
    this.trailerDim.dispose();
    this.titleBold.dispose();
    this.labelPillValid.dispose();
    this.labelPillInvalid.dispose();
    for (const type of this.blockquotes.values()) type.dispose();
    for (const type of this.markerPills.values()) type.dispose();
  }
}
