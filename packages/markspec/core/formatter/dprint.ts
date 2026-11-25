/**
 * @module formatter/dprint
 *
 * Loader for the embedded dprint-markdown WASM plugin (ADR-029).
 * `markspec fmt` formats whole Markdown documents with one canonical
 * style; this module owns that style and the (cached)
 * WASM instantiation. Dynamic imports keep the plugin off every code
 * path except formatting (`fmt`, the `check` MSL-F010 drift gate, LSP
 * documentFormatting).
 *
 * Node-compatible: `node:fs/promises` + WebAssembly only, no `Deno.*`.
 *
 * Packaging note: `@dprint/formatter` and `@dprint/markdown` are dynamically
 * imported bare npm specifiers, and their `plugin.wasm` ships inside the npm
 * package — no vendored copy in this repo. `deno compile` only embeds the
 * resolved npm tree (and thus the wasm) when the compile entry point itself
 * lives inside this workspace member (`packages/markspec/`); an entry point
 * outside that tree can't resolve the import map at runtime. The project's
 * one real compile target (`packages/markspec/main.ts`) already satisfies
 * this, so it's a non-issue in production — it only bites a from-scratch
 * smoke test placed elsewhere.
 */

import { processor } from "../parser/remark.ts";
import { DEFAULT_MARKDOWN_LINE_WIDTH } from "../config/editorconfig.ts";

/** Per-call options for a {@linkcode ProseFormatter}. */
export interface ProseFormatOptions {
  /** Override the effective line width for this fragment. Used by the
   * entry-body polish: bodies are formatted dedented and re-indented
   * afterwards, so the budget must shrink by the indent width to stay
   * in agreement with a whole-file dprint view of the same content. */
  readonly lineWidth?: number;
}

/** Formats a Markdown fragment to the canonical MarkSpec style. */
export type ProseFormatter = (
  markdown: string,
  options?: ProseFormatOptions,
) => string;

/**
 * The default MarkSpec Markdown style (ADR-029). `lineWidth` is the
 * default only: `format()` passes the width resolved from `.editorconfig`
 * (`FormatOptions.lineWidth`) on every call. `newLineKind` is "lf" because
 * `format()` operates on a pure-LF buffer and applies the line ending on
 * output (`FormatOptions.endOfLine`, else the file's detected one).
 */
export const MARKSPEC_MARKDOWN_GLOBAL_CONFIG: Readonly<{
  lineWidth: number;
  newLineKind: "lf";
}> = Object.freeze({
  lineWidth: DEFAULT_MARKDOWN_LINE_WIDTH,
  newLineKind: "lf",
});

/** Plugin-level style knobs. See ADR-029 for the rationale per value.
 *
 * Frozen: this is the single canonical MarkSpec style, exported through the
 * public barrel. Freezing stops a consumer from mutating the shared object
 * after the formatter has already baked these values in at `instantiate()`
 * (which would drift the entry-body width budget from the whole-document
 * formatter — see `emitBodyViaAst`). */
export const MARKSPEC_MARKDOWN_PLUGIN_CONFIG: Readonly<
  Record<string, unknown>
> = Object.freeze({
  textWrap: "always",
  emphasisKind: "underscores",
  strongKind: "asterisks",
  unorderedListKind: "dashes",
});

let cached: Promise<ProseFormatter> | undefined;

/**
 * Load the dprint-markdown WASM plugin (once — subsequent calls return
 * the cached instance) and return a synchronous prose formatter.
 *
 * A failed instantiation is NOT cached: the rejected promise is cleared
 * before it propagates, so the next call retries from scratch instead of
 * replaying the same failure forever. This matters for the long-lived LSP
 * session, where a transient WASM-load failure must not permanently
 * disable formatting for the rest of the process.
 */
export function loadMarkdownFormatter(): Promise<ProseFormatter> {
  cached ??= instantiate().catch((err) => {
    cached = undefined;
    throw err;
  });
  return cached;
}

async function instantiate(): Promise<ProseFormatter> {
  const { createFromBuffer } = await import("@dprint/formatter");
  const { getPath } = await import("@dprint/markdown");
  const { readFile } = await import("node:fs/promises");
  const wasm = await readFile(getPath());
  // `readFile` returns a Node `Buffer`, whose `buffer` property is typed
  // `ArrayBufferLike` (may be a `SharedArrayBuffer`) — not assignable to
  // `BufferSource`'s `ArrayBuffer`-backed view. Copy into a plain
  // `Uint8Array` so the type is unambiguous; this runs once per process
  // (the result is cached by `loadMarkdownFormatter`).
  const formatter = createFromBuffer(Uint8Array.from(wasm));
  formatter.setConfig(
    MARKSPEC_MARKDOWN_GLOBAL_CONFIG,
    MARKSPEC_MARKDOWN_PLUGIN_CONFIG,
  );
  return withHiddenMarkdownFenceTags(
    (markdown: string, options?: ProseFormatOptions): string =>
      formatter.formatText({
        filePath: "fragment.md",
        fileText: markdown,
        overrideConfig: options?.lineWidth !== undefined
          ? { lineWidth: options.lineWidth }
          : undefined,
      }),
  );
}

/** Prefix of the placeholder tag that replaces a hidden fence tag. The
 * full placeholder is `<prefix><nonce>-<index>`. */
const HIDDEN_TAG_PREFIX = "markspec-hidden-fence-tag-";

/** Matches a placeholder tag; group 1 is the nonce, group 2 the index. */
const HIDDEN_TAG_RE = /markspec-hidden-fence-tag-(\d+)-(\d+)/g;

/** The fence tags whose content dprint-markdown would format. */
const MARKDOWN_TAG_RE = /^(?:md|markdown)$/i;

/** A CommonMark AST node, reduced to what the fence walk reads. */
interface AstNode {
  readonly type: string;
  readonly lang?: string | null;
  readonly position?: { readonly start: { readonly offset?: number } };
  readonly children?: readonly AstNode[];
}

/** Source offsets of the `md` / `markdown` tags of every fenced code
 * block, at any nesting depth, found with the CommonMark parser. */
function markdownFenceTagOffsets(markdown: string): number[] {
  const offsets: number[] = [];
  const visit = (node: AstNode): void => {
    if (node.type === "code" && node.lang && MARKDOWN_TAG_RE.test(node.lang)) {
      const start = node.position?.start.offset;
      if (start !== undefined) {
        // The node starts at the fence characters; the tag follows them
        // and optional spaces or tabs. An indented code block has no tag.
        const match = /^(?:`{3,}|~{3,})[ \t]*/.exec(markdown.slice(start));
        const at = match ? start + match[0].length : -1;
        if (
          at >= 0 &&
          markdown.slice(at, at + node.lang.length).toLowerCase() ===
            node.lang.toLowerCase()
        ) offsets.push(at);
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(processor.parse(markdown) as unknown as AstNode);
  return offsets;
}

/**
 * Wrap `format` so that it does not format the content of a code fence
 * tagged `md` or `markdown`. dprint-markdown formats such content as
 * Markdown; the GFM-semantic gate then rejects the change and the
 * whole prose segment stays unformatted (MSL-F012). The wrapper replaces
 * each tag with a placeholder tag that dprint does not know, calls
 * `format`, and puts the original tags back. prim does the same. The
 * placeholder carries a nonce that does not occur in the input, so text
 * the author wrote is never replaced.
 */
export function withHiddenMarkdownFenceTags(
  format: ProseFormatter,
): ProseFormatter {
  return (markdown, options) => {
    if (!/```|~~~/.test(markdown)) return format(markdown, options);
    const offsets = markdownFenceTagOffsets(markdown);
    if (offsets.length === 0) return format(markdown, options);
    let nonce = 0;
    while (markdown.includes(`${HIDDEN_TAG_PREFIX}${nonce}-`)) nonce++;
    const tags: string[] = [];
    let hidden = "";
    let cursor = 0;
    for (const at of offsets.sort((a, b) => a - b)) {
      const tag = /^[A-Za-z]+/.exec(markdown.slice(at))![0];
      hidden += markdown.slice(cursor, at) +
        `${HIDDEN_TAG_PREFIX}${nonce}-${tags.length}`;
      tags.push(tag);
      cursor = at + tag.length;
    }
    hidden += markdown.slice(cursor);
    const formatted = format(hidden, options);
    return formatted.replace(
      HIDDEN_TAG_RE,
      (match, found: string, index: string) =>
        Number(found) === nonce ? tags[Number(index)] ?? match : match,
    );
  };
}
