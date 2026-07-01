/**
 * @module formatter/dprint
 *
 * Loader for the embedded dprint-markdown WASM plugin (ADR-029).
 * `markspec fmt` formats whole Markdown documents with one canonical,
 * zero-config style; this module owns that style and the (cached)
 * WASM instantiation. Dynamic imports keep the plugin off every code
 * path except formatting (`fmt`, the `check` MSL-F010 drift gate, LSP
 * documentFormatting).
 *
 * Node-compatible: `node:fs/promises` + WebAssembly only, no `Deno.*`.
 */

/** Formats a Markdown fragment to the canonical MarkSpec style. */
export type ProseFormatter = (markdown: string) => string;

/**
 * The fixed MarkSpec Markdown style (ADR-029). Zero configuration by
 * design — one canonical form across every project. `newLineKind` is
 * "lf" because `format()` operates on a pure-LF buffer and re-applies
 * the file's detected line ending on output.
 */
export const MARKSPEC_MARKDOWN_GLOBAL_CONFIG: {
  lineWidth: number;
  newLineKind: "lf";
} = {
  lineWidth: 80,
  newLineKind: "lf",
};

/** Plugin-level style knobs. See ADR-029 for the rationale per value. */
export const MARKSPEC_MARKDOWN_PLUGIN_CONFIG: Record<string, unknown> = {
  textWrap: "always",
  emphasisKind: "underscores",
  strongKind: "asterisks",
  unorderedListKind: "dashes",
};

let cached: Promise<ProseFormatter> | undefined;

/**
 * Load the dprint-markdown WASM plugin (once — subsequent calls return
 * the cached instance) and return a synchronous prose formatter.
 */
export function loadMarkdownFormatter(): Promise<ProseFormatter> {
  cached ??= instantiate();
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
  return (markdown: string): string =>
    formatter.formatText({ filePath: "fragment.md", fileText: markdown });
}
