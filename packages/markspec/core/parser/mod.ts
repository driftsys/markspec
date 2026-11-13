/**
 * @module parser
 *
 * MarkSpec parser — file → Entry[].
 *
 * Three sub-modules:
 * - markdown: CommonMark AST walk, entry block detection, attribute extraction
 * - captions: table and figure caption detection
 * - directives: HTML comment directive extraction
 * - source: doc comment extraction from Rust, Kotlin, C, C++, Java
 */

import { basename as pathBasename, extname } from "@std/path";
import type { Caption, Diagnostic, Document, Entry } from "../model/mod.ts";
import { normalizeLineEndings } from "../util/line_endings.ts";
import { type GherkinApi, loadGherkin } from "../gherkin/load.ts";
import { hasFeatureHeaderLine, parseFeatureFile } from "./feature_file.ts";
import { parseMarkdown } from "./markdown.ts";
import {
  isSupportedExtension,
  languageIdForExtension,
  loadGrammar,
} from "./grammars.ts";
import { parseSource } from "./source.ts";
import { extractFrontMatter } from "./frontmatter.ts";
import {
  detectCaptions as detectCaptionsImpl,
  type DetectCaptionsOptions,
} from "./captions.ts";

export type { DetectCaptionsOptions } from "./captions.ts";

export { detectDirectives } from "./directives.ts";
export type { DetectDirectivesOptions } from "./directives.ts";

export { extractFrontMatter } from "./frontmatter.ts";
export type {
  ExtractFrontMatterOptions,
  FrontMatterResult,
} from "./frontmatter.ts";

export { detectInlineRefs } from "./references.ts";
export type { DetectInlineRefsOptions } from "./references.ts";

export { parseSource } from "./source.ts";
export type { ParseSourceOptions, ParseSourceResult } from "./source.ts";
export {
  stripBlockCommentPrefix,
  stripLineCommentPrefix,
  wrapAsListItem,
} from "./source.ts";

export { isSupportedExtension, loadGrammar } from "./grammars.ts";

export type { DocCommentBlockMeta, LineMap } from "./line_map.ts";
export { buildBlockLineMap } from "./line_map.ts";
export type {
  LanguageDocCommentSpec,
  SupportedLanguage,
} from "./language_spec.ts";
export { LANGUAGE_SPECS, languageIdForExtension } from "./language_spec.ts";

/** Options for {@linkcode parse}. */
export interface ParseOptions {
  /** File path used in source locations. */
  readonly file?: string;
}

/**
 * Parse a Markdown string and return all MarkSpec entries found.
 *
 * @param markdown - Markdown source text
 * @param options - Parse options
 * @returns Array of parsed entries
 */
export function parse(
  markdown: string,
  options?: ParseOptions,
): Entry[] {
  const file = options?.file;
  const normalised = normalizeLineEndings(markdown);
  return parseMarkdown(normalised, {
    ...options,
    isReferencesDoc: file !== undefined ? isReferencesDocument(file) : false,
  }).entries;
}

/** Result of parsing a file (entries + optional document + diagnostics). */
export interface ParseFileResult {
  /** Parsed entries. */
  readonly entries: Entry[];
  /**
   * Document-level metadata parsed from YAML front matter. `undefined` for
   * source files (Rust/Kotlin/C/...) and for Markdown files without front
   * matter; present otherwise so downstream consumers can resolve
   * `{{document.*}}` inline references.
   */
  readonly document?: Document;
  /**
   * Parse-level diagnostics (forbidden front-matter keys, malformed YAML).
   * Merged into the compile result's diagnostics.
   */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Detect if a file is a references document.
 * References context enables recognition of reference entries (slugs).
 * @param file - File path
 */
function isReferencesDocument(file: string): boolean {
  if (pathBasename(file) === "references.md") return true;
  // Detect a `/references/` (or `\references\`) directory anywhere in the
  // path, in a separator-agnostic way so Windows checkouts behave the
  // same as POSIX.
  return /[\\/]references[\\/]/.test(file);
}

/**
 * A fenced code block whose info string starts with the word `gherkin` or
 * `feature`, followed by whitespace or the end of the line (so
 * `gherkin-json` does not match). The fence has three or more backticks or
 * tildes. Before the fence, the line may hold spaces, tabs, blockquote
 * markers and doc-comment prefixes (`>`, `///`, `//!`, ` *`, `#`), and list
 * markers (`-`, `*`, `+`, `1.`, `1)`) followed by a space or tab. The
 * prefix holds no newline, so the match never spans lines, and each
 * prefix character matches only one alternative, so the scan stays linear.
 *
 * @internal Exported for tests.
 */
export const GHERKIN_FENCE_RE =
  /^(?:[ \t/*#!>]|[-+][ \t]|\d{1,9}[.)][ \t])*(`{3,}|~{3,})[ \t]*(gherkin|feature)(?=[ \t]|$)/m;

/** Loads the Gherkin parser; replaced in tests. */
type GherkinLoader = () => Promise<GherkinApi>;

/**
 * Parse a file and return entries, annotation links, and (for Markdown
 * files) a Document with front-matter attributes.
 *
 * Source files (`.rs`, `.java`, `.c`, `.cpp`, etc.) are parsed with
 * tree-sitter to extract doc comment entries; no front matter is
 * recognized on source files.
 */
export async function parseFile(
  content: string,
  options: {
    readonly file: string;
    /** @internal Replaces the Gherkin parser loader in tests. */
    readonly gherkinLoader?: GherkinLoader;
  },
): Promise<ParseFileResult> {
  const ext = extname(options.file);
  const lowerExt = ext.toLowerCase();
  const normalised = normalizeLineEndings(content);
  // A `.feature` file always needs the parser (ADR-038): entries come from
  // its `# [ID]` header comments. A load failure gives no entries and one
  // MSL-B062 when the file has a header line, and never throws.
  if (lowerExt === ".feature") {
    let api: GherkinApi;
    try {
      api = await (options.gherkinLoader ?? loadGherkin)();
    } catch (err) {
      const diagnostics: Diagnostic[] = hasFeatureHeaderLine(normalised)
        ? [{
          code: "MSL-B062",
          severity: "warning",
          message: `Gherkin file not parsed: the Gherkin parser failed to ` +
            `load (${err instanceof Error ? err.message : String(err)})`,
          location: { file: options.file, line: 1, column: 1 },
        }]
        : [];
      return { entries: [], diagnostics };
    }
    return parseFeatureFile(normalised, { file: options.file, api });
  }

  // Load the Gherkin parser before the synchronous parse, and only when the
  // text holds a gherkin or feature fence (the load is cached). A failed
  // load is not fatal: parsing continues without the Gherkin AST, and the
  // criteria come from the line scanner. The loader does not cache the
  // failure, so a later file tries again.
  if (GHERKIN_FENCE_RE.test(normalised)) {
    try {
      await (options.gherkinLoader ?? loadGherkin)();
    } catch {
      // Continue without the parser (ADR-038 Decision 4).
    }
  }

  if (isSupportedExtension(ext)) {
    const language = await loadGrammar(ext);
    const languageId = languageIdForExtension(ext);
    if (!languageId) {
      // Defensive — isSupportedExtension and languageIdForExtension are kept
      // in sync via their shared extension lists, so this branch should be
      // unreachable. Throwing surfaces the drift immediately rather than
      // silently falling through to wrong grammar dispatch.
      throw new Error(
        `internal: no languageId for supported extension '${ext}'`,
      );
    }
    const result = parseSource(normalised, {
      file: options.file,
      language,
      languageId,
    });
    return { entries: result.entries, diagnostics: [] };
  }

  const fm = extractFrontMatter(normalised, { file: options.file });
  // Replace the stripped front matter with blank lines so every location
  // the Markdown parser reports stays file-relative (CommonMark ignores
  // leading blank lines).
  const body = fm.hadFrontMatter
    ? "\n".repeat(
      normalised.slice(0, normalised.length - fm.markdown.length)
        .split("\n").length - 1,
    ) + fm.markdown
    : normalised;
  const isReferencesDoc = isReferencesDocument(options.file);
  const { entries, diagnostics: parseDiagnostics } = parseMarkdown(body, {
    file: options.file,
    isReferencesDoc,
  });

  const document: Document | undefined = fm.hadFrontMatter
    ? {
      file: options.file,
      attributes: fm.attributes,
      properties: {},
    }
    : undefined;

  return {
    entries,
    document,
    diagnostics: [...fm.diagnostics, ...parseDiagnostics],
  };
}

/**
 * Detect table and figure captions in a Markdown string.
 *
 * @param markdown - Markdown source text
 * @param options - Detection options (file path for source locations)
 * @returns Array of detected captions
 */
export function detectCaptions(
  markdown: string,
  options?: DetectCaptionsOptions,
): Caption[] {
  return detectCaptionsImpl(markdown, options);
}
