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
  return (markdown: string, options?: ProseFormatOptions): string =>
    formatter.formatText({
      filePath: "fragment.md",
      fileText: markdown,
      overrideConfig: options?.lineWidth !== undefined
        ? { lineWidth: options.lineWidth }
        : undefined,
    });
}
