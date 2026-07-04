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
import { dirname, join, normalize } from "@std/path/posix";
import type { Blockquote, Link, Root, Text } from "mdast";
import type { Caption, EffectiveProfile, Entry } from "../../core/mod.ts";
import { detectCaptions, parse, resolveEntryColor } from "../../core/mod.ts";

// ── Types ─────────────────────────────────────────────────────────────────

/** GFM alert type names. */
type AlertType = "note" | "tip" | "important" | "warning" | "caution";

/** Options for rendering a single chapter. */
export interface RenderChapterOptions {
  /** File path used in source locations (for diagnostics). */
  readonly file?: string;
  /** Active profile, if any. Drives per-entry color resolution. */
  readonly profile?: EffectiveProfile;
  /**
   * Every chapter's source path (as declared in `SUMMARY.md`, e.g.
   * `"recipes/deploy.md"`) mapped to its book-build output slug (e.g.
   * `"recipes-deploy"`, written as `recipes-deploy.html`). When supplied,
   * a Markdown link in this chapter that resolves — relative to this
   * chapter's own source directory — to another chapter's path is
   * rewritten to `<slug>.html`, preserving any `#fragment`. A link that
   * resolves to a path absent from this map (external URL, a file outside
   * the book, or an absolute path) is left untouched.
   */
  readonly chapterSlugs?: ReadonlyMap<string, string>;
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
 * - Entry blocks → `<div class="req-block hue-<name>">` (or
 *   `class="req-block uncolored"` for referenced-shape entries) with
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

  const chapterSlugs = options.chapterSlugs;
  const rewriteLink = chapterSlugs
    ? (href: string) => _resolveChapterLink(file, href, chapterSlugs)
    : undefined;

  const parts: string[] = [];
  let cursor = 0; // current position (0-based line index)
  let figCounter = 0;
  let tblCounter = 0;

  for (const region of regions) {
    // Prose before this region
    if (region.start > cursor) {
      const prose = lines.slice(cursor, region.start).join("\n");
      if (prose.trim()) parts.push(_proseToHtml(prose, rewriteLink));
    }

    if (region.kind === "entry") {
      parts.push(_entryToHtml(region.entry!, options.profile, rewriteLink));
    } else if (region.kind === "alert") {
      const raw = lines.slice(region.start, region.end);
      parts.push(_alertToHtml(region.alertType!, raw, rewriteLink));
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
    if (prose.trim()) parts.push(_proseToHtml(prose, rewriteLink));
  }

  return { html: parts.join("\n") };
}

/**
 * Resolve a Markdown link `href` found in chapter `fromChapterPath` to
 * another chapter's book-build output slug, or `undefined` when the href
 * doesn't resolve to a known chapter (external URL, absolute path, or a
 * file outside the book).
 *
 * Resolution happens against `fromChapterPath`'s own source directory —
 * not the flattened output directory every chapter is written to — so a
 * nested chapter's `../sibling.md` resolves the same way it would on
 * disk, before `chapterSlugs`' keys (also source paths) are consulted.
 */
function _resolveChapterLink(
  fromChapterPath: string,
  href: string,
  chapterSlugs: ReadonlyMap<string, string>,
): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return undefined; // scheme:// URL
  if (href.startsWith("/") || href.startsWith("#")) return undefined; // root-relative / anchor-only
  const hashIdx = href.indexOf("#");
  const pathPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const fragment = hashIdx >= 0 ? href.slice(hashIdx) : "";
  if (!pathPart) return undefined;
  const resolved = normalize(join(dirname(fromChapterPath), pathPart));
  const slug = chapterSlugs.get(resolved);
  if (!slug) return undefined;
  return `${slug}.html${fragment}`;
}

/** Recursively visit every mdast `link` node under `node`, in place. */
function _visitLinks(node: Root, visit: (link: Link) => void): void {
  const walk = (n: Root | Root["children"][number]): void => {
    if (n.type === "link") visit(n as Link);
    if ("children" in n) {
      for (const child of n.children) walk(child);
    }
  };
  walk(node);
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
    if (entry.source.kind !== "markdown") continue;
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

function _proseToHtml(
  markdown: string,
  rewriteLink?: (href: string) => string | undefined,
): string {
  if (!rewriteLink) return String(_htmlPipeline.processSync(markdown));
  // Built fresh per call (only when link rewriting is active) since the
  // rewriter closes over this chapter's own path — unlike `_htmlPipeline`,
  // it can't be a shared singleton.
  const pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(() => (tree: Root) => {
      _visitLinks(tree, (link) => {
        const rewritten = rewriteLink(link.url);
        if (rewritten !== undefined) link.url = rewritten;
      });
    })
    .use(remarkRehype)
    .use(rehypeStringify);
  return String(pipeline.processSync(markdown));
}

function _escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function _entryClass(
  entry: Entry,
  profile: EffectiveProfile | undefined,
): string {
  // Resolves `null` for referenced-shape (uncolored) and a palette hue for
  // identified entries. The CSS in theme/markspec.css defines `.hue-<hue>`
  // for the seven palette hues and `.uncolored` for the null case.
  const hue = resolveEntryColor(entry, profile);
  return hue === null ? "req-block uncolored" : `req-block hue-${hue}`;
}

function _entryToHtml(
  entry: Entry,
  profile: EffectiveProfile | undefined,
  rewriteLink?: (href: string) => string | undefined,
): string {
  const blockClass = _entryClass(entry, profile);

  const labelsAttr = entry.rawAttributes.find((a) => a.key === "Labels");
  const labels = labelsAttr
    ? labelsAttr.value.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const metaAttrs = entry.rawAttributes.filter((a) => a.key !== "Labels");

  const pillsHtml = labels.length > 0
    ? `<span class="pill-group">${
      labels
        .map((l) => `<span class="pill">${_escapeHtml(l)}</span>`)
        .join("")
    }</span>`
    : "";

  const bodyHtml = entry.body.trim()
    ? `<div class="req-body">${_proseToHtml(entry.body, rewriteLink)}</div>`
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

  return `<div class="${blockClass}">
  <div class="req-title">
    <code class="req-id">${_escapeHtml(entry.displayId)}</code>
    <span class="req-name">${_escapeHtml(entry.title)}</span>
    ${pillsHtml}
  </div>
  ${bodyHtml}
  ${metaHtml}
</div>`;
}

function _alertToHtml(
  alertType: AlertType,
  rawLines: string[],
  rewriteLink?: (href: string) => string | undefined,
): string {
  // Strip the `> [!NOTE]` first line; remove `> ` prefix from the rest
  const contentLines = rawLines
    .slice(1)
    .map((l) => l.replace(/^>\s?/, ""));
  const content = _proseToHtml(contentLines.join("\n"), rewriteLink);
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
