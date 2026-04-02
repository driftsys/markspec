/**
 * @module book/site
 *
 * MarkSpec-aware Markdown → HTML rendering pipeline for book chapters.
 *
 * Uses a line-based splicing strategy (mirroring the Typst pipeline in
 * `render/typst/template.ts`): prose passes through remark-rehype for
 * standard CommonMark rendering; entry blocks, GFM alerts, and figure/table
 * captions are intercepted and emitted as structured HTML with MarkSpec CSS
 * classes from `markspec.css`.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { Blockquote, Root, Text } from "mdast";
import type { Caption, Entry } from "../../core/mod.ts";
import { detectCaptions, parse } from "../../core/mod.ts";

// ── Types ─────────────────────────────────────────────────────────────────

/** GFM alert type names. */
type AlertType = "note" | "tip" | "important" | "warning" | "caution";

/** Options for rendering a single chapter. */
export interface RenderChapterOptions {
  /** File path used in source locations (for diagnostics). */
  readonly file?: string;
}

/** Result of rendering a chapter to HTML. */
export interface RenderChapterResult {
  /** Full HTML string for the chapter body (no surrounding `<html>` shell). */
  readonly html: string;
}

// ── Processors ────────────────────────────────────────────────────────────

/** Full remark → HTML pipeline for prose chunks. */
const _htmlPipeline = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeStringify);

/** AST-only processor for position-based detection. */
const _astParser = unified().use(remarkParse).use(remarkGfm);

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Render a Markdown chapter to an HTML string.
 *
 * Intercepts MarkSpec-extended elements at their line boundaries:
 * - Entry blocks → `<div class="req-block" data-entry-type="...">` with
 *   ID, title, label pills, body, and attribute metadata
 * - GFM alerts (`> [!NOTE]`) → `<div class="alert note|tip|...">` with
 *   full border and tint background (Tol vibrant via `markspec.css`)
 * - Captions (`*Figure: text*`, `*Table: text*`) → `<p class="caption">`
 *   with auto-incremented counter
 *
 * Prose between intercepted regions passes through the remark-rehype
 * pipeline unchanged.
 *
 * @param markdown - Chapter Markdown source
 * @param options - Render options
 * @returns Rendered HTML for the chapter body
 */
export function renderChapterHtml(
  markdown: string,
  options: RenderChapterOptions = {},
): RenderChapterResult {
  const file = options.file ?? "<unknown>";
  const lines = markdown.split("\n");

  // Parse entries and captions via core
  const entries = parse(markdown, { file });
  const captions = detectCaptions(markdown, { file });

  // Detect alert line ranges from the AST
  const tree = _astParser.parse(markdown) as Root;
  const alertRegions = _detectAlertRegions(tree);

  // Merge all special regions, sorted by start line (0-based)
  const regions = _buildRegions(lines, entries, alertRegions, captions);

  const parts: string[] = [];
  let cursor = 0; // current position (0-based line index)
  let figCounter = 0;
  let tblCounter = 0;

  for (const region of regions) {
    // Prose before this region
    if (region.start > cursor) {
      const prose = lines.slice(cursor, region.start).join("\n");
      if (prose.trim()) parts.push(_proseToHtml(prose));
    }

    if (region.kind === "entry") {
      parts.push(_entryToHtml(region.entry!));
    } else if (region.kind === "alert") {
      const raw = lines.slice(region.start, region.end);
      parts.push(_alertToHtml(region.alertType!, raw));
    } else if (region.kind === "caption") {
      const cap = region.caption!;
      const counter = cap.kind === "figure" ? ++figCounter : ++tblCounter;
      parts.push(_captionToHtml(cap, counter));
    }

    cursor = region.end;
  }

  // Trailing prose
  if (cursor < lines.length) {
    const prose = lines.slice(cursor).join("\n");
    if (prose.trim()) parts.push(_proseToHtml(prose));
  }

  return { html: parts.join("\n") };
}

// ── Region detection ──────────────────────────────────────────────────────

interface _AlertRegion {
  readonly alertType: AlertType;
  readonly startLine: number; // 1-based
  readonly endLine: number; // 1-based, inclusive
}

interface _Region {
  readonly kind: "entry" | "alert" | "caption";
  readonly start: number; // 0-based, inclusive
  readonly end: number; // 0-based, exclusive
  readonly entry?: Entry;
  readonly alertType?: AlertType;
  readonly caption?: Caption;
}

const _ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;

function _detectAlertRegions(tree: Root): _AlertRegion[] {
  const regions: _AlertRegion[] = [];

  for (const node of tree.children) {
    if (node.type !== "blockquote" || !node.position) continue;

    const blockquote = node as Blockquote;
    const firstPara = blockquote.children[0];
    if (firstPara?.type !== "paragraph") continue;

    const firstText = firstPara.children[0];
    if (firstText?.type !== "text") continue;

    const match = _ALERT_RE.exec((firstText as Text).value);
    if (!match) continue;

    regions.push({
      alertType: match[1].toLowerCase() as AlertType,
      startLine: node.position.start.line,
      endLine: node.position.end.line,
    });
  }

  return regions;
}

function _buildRegions(
  lines: string[],
  entries: readonly Entry[],
  alerts: readonly _AlertRegion[],
  captions: readonly Caption[],
): _Region[] {
  const regions: _Region[] = [];

  for (const entry of entries) {
    if (entry.source !== "markdown") continue;
    const start = entry.location.line - 1; // 0-based
    const end = _findEntryEnd(lines, start);
    regions.push({ kind: "entry", start, end, entry });
  }

  for (const alert of alerts) {
    regions.push({
      kind: "alert",
      start: alert.startLine - 1, // 0-based
      end: alert.endLine, // 1-based inclusive → 0-based exclusive
      alertType: alert.alertType,
    });
  }

  for (const caption of captions) {
    const start = caption.location.line - 1; // 0-based
    regions.push({ kind: "caption", start, end: start + 1, caption });
  }

  // Sort by start line, then drop any region that overlaps the previous one
  regions.sort((a, b) => a.start - b.start);
  return _deoverlap(regions);
}

function _deoverlap(regions: _Region[]): _Region[] {
  const result: _Region[] = [];
  let lastEnd = -1;
  for (const r of regions) {
    if (r.start >= lastEnd) {
      result.push(r);
      lastEnd = r.end;
    }
  }
  return result;
}

/**
 * Find the exclusive end line (0-based) of an entry list item.
 * Mirrors the algorithm in `render/typst/template.ts`.
 */
function _findEntryEnd(lines: readonly string[], start: number): number {
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j < lines.length && /^\s{2,}/.test(lines[j])) {
        i = j;
        continue;
      }
      i++;
      break;
    }
    if (/^\s{2,}/.test(line)) {
      i++;
      continue;
    }
    break;
  }
  return i;
}

// ── Renderers ─────────────────────────────────────────────────────────────

function _proseToHtml(markdown: string): string {
  return String(_htmlPipeline.processSync(markdown));
}

function _escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function _entryCategory(entryType: string | undefined): string {
  if (!entryType) return "req";
  if (["ARC", "SAD", "ICD"].includes(entryType)) return "spec";
  if (["TST", "VAL", "SIT", "SWT"].includes(entryType)) return "test";
  return "req";
}

function _entryToHtml(entry: Entry): string {
  const category = _entryCategory(entry.entryType);

  const labelsAttr = entry.attributes.find((a) => a.key === "Labels");
  const labels = labelsAttr
    ? labelsAttr.value.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const metaAttrs = entry.attributes.filter((a) => a.key !== "Labels");

  const pillsHtml = labels.length > 0
    ? `<span class="pill-group">${
      labels
        .map((l) => `<span class="pill">${_escapeHtml(l)}</span>`)
        .join("")
    }</span>`
    : "";

  const bodyHtml = entry.body.trim()
    ? `<div class="req-body">${_proseToHtml(entry.body)}</div>`
    : "";

  const metaHtml = metaAttrs.length > 0
    ? `<div class="req-meta">${
      metaAttrs
        .map(
          (a) =>
            `<span>${_escapeHtml(a.key)}: <code>${
              _escapeHtml(a.value)
            }</code></span>`,
        )
        .join(" · ")
    }</div>`
    : "";

  return `<div class="req-block" data-entry-type="${category}">
  <div class="req-title">
    <code class="req-id">${_escapeHtml(entry.displayId)}</code>
    <span class="req-name">${_escapeHtml(entry.title)}</span>
    ${pillsHtml}
  </div>
  ${bodyHtml}
  ${metaHtml}
</div>`;
}

function _alertToHtml(alertType: AlertType, rawLines: string[]): string {
  // Strip the `> [!NOTE]` first line; remove `> ` prefix from the rest
  const contentLines = rawLines
    .slice(1)
    .map((l) => l.replace(/^>\s?/, ""));
  const content = _proseToHtml(contentLines.join("\n"));
  const label = alertType.charAt(0).toUpperCase() + alertType.slice(1);
  return `<div class="alert ${alertType}">
  <strong class="alert-label">${label}</strong>
  ${content}
</div>`;
}

function _captionToHtml(caption: Caption, counter: number): string {
  const prefix = caption.kind === "figure" ? "Figure" : "Table";
  return `<p class="caption">${prefix} ${counter}: ${
    _escapeHtml(caption.text)
  }</p>`;
}
