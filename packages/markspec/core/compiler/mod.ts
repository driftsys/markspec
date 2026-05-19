/**
 * @module compiler
 *
 * Compiler pipeline. Takes file paths, parses all entries, validates them,
 * builds a bidirectional traceability graph, and returns the compiled model.
 */

import type {
  Diagnostic,
  DisplayId,
  Document,
  EffectiveProfile,
  Entry,
  Link,
  SourceLocation,
} from "../model/mod.ts";
import { parseFile } from "../parser/mod.ts";
import { classifyEntriesStage, validate } from "../validator/mod.ts";
import { ATTR_TO_LINK_KIND } from "./constants.ts";
import { generateInverses } from "./inverses.ts";
import { checkLinkTargets } from "./link_target.ts";

/** Options for {@linkcode compile}. */
export interface CompileOptions {
  /** File reader function. Required — no default to avoid Deno dependency in library code. */
  readonly readFile: (path: string) => Promise<string>;
  /** Active profile for inverse attribute generation. Optional — when absent, inverses are skipped. */
  readonly profile?: EffectiveProfile;
  /**
   * Optional. Called once per source file to obtain its mtime.
   * Returns undefined when stat is unavailable (remote, test mock, etc.).
   * When absent, `entry.properties.file.mtime` is left undefined.
   */
  readonly statFile?: (
    path: string,
  ) => Promise<{ mtime: Date | null } | undefined>;
}

/** Compiled project output with resolved traceability graph. */
export interface CompileResult {
  /** All entries keyed by display ID. */
  readonly entries: ReadonlyMap<DisplayId, Entry>;
  /** All traceability links. */
  readonly links: readonly Link[];
  /** Outgoing links per entry (entry → targets). */
  readonly forward: ReadonlyMap<DisplayId, readonly Link[]>;
  /** Incoming links per entry (entry → sources pointing to it). */
  readonly reverse: ReadonlyMap<DisplayId, readonly Link[]>;
  /** Documents keyed by file path. A file appears here only when it carried YAML front matter per ADR-007. */
  readonly documents: ReadonlyMap<string, Document>;
  /** Diagnostics from parsing and validation. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Compile MarkSpec files from the given paths into a resolved
 * traceability graph.
 *
 * @param paths - File paths to compile
 * @param options - Compile options
 * @returns Compiled entries, links, and diagnostics
 */
export async function compile(
  paths: readonly string[],
  options: CompileOptions,
): Promise<CompileResult> {
  const read = options.readFile;
  const allEntries: Entry[] = [];
  const parseDiagnostics: Diagnostic[] = [];
  const documents = new Map<string, Document>();

  // Phase 1: Read and parse all files.
  for (const filePath of paths) {
    let content: string;
    try {
      content = await read(filePath);
    } catch {
      parseDiagnostics.push({
        code: "MSL-E000",
        severity: "error",
        message: `failed to read file: ${filePath}`,
        location: undefined,
      });
      continue;
    }
    const result = await parseFile(content, { file: filePath });
    const stat = options.statFile
      ? await options.statFile(filePath)
      : undefined;
    const mtimeStr = stat?.mtime ? stat.mtime.toISOString() : undefined;
    const annotatedEntries = result.entries.map((entry) => ({
      ...entry,
      properties: {
        ...entry.properties,
        file: {
          path: filePath,
          line: entry.location.line,
          column: entry.location.column,
          mtime: mtimeStr,
        },
      },
    }));
    allEntries.push(...annotatedEntries);
    parseDiagnostics.push(...result.diagnostics);
    if (result.document) documents.set(filePath, result.document);
  }

  // Phase 2: Validate all entries.
  const validationResult = validate(allEntries);

  // Phase 2.5: Classify entries when a profile is loaded.
  let classifiedEntries: readonly Entry[] = allEntries;
  if (options.profile) {
    const stage2 = classifyEntriesStage(allEntries, options.profile);
    classifiedEntries = stage2.entries;
    parseDiagnostics.push(...stage2.diagnostics);
  }

  // Phase 3: Build traceability graph.
  // Keep first occurrence of each display ID (validator catches duplicates).
  const entries = new Map<DisplayId, Entry>();
  for (const entry of classifiedEntries) {
    if (!entries.has(entry.displayId)) {
      entries.set(entry.displayId, entry);
    }
  }

  // Phase 3.5: Generate inverse attributes from profile declarations.
  let generatedLinks: readonly Link[] = [];
  if (options.profile) {
    const inverseResult = generateInverses(
      [...entries.values()],
      options.profile,
    );
    parseDiagnostics.push(...inverseResult.diagnostics);
    generatedLinks = inverseResult.links;
    entries.clear();
    for (const entry of inverseResult.entries) {
      if (!entries.has(entry.displayId)) {
        entries.set(entry.displayId, entry);
      }
    }
  }

  const authoredLinks = extractLinks([...entries.values()]);
  const links = [...authoredLinks, ...generatedLinks];

  // MSL-T013: check link targets for draft/retired state.
  const linkTargetDiags = checkLinkTargets(entries, links);

  const forward = buildAdjacency(links, (l) => l.from);
  const reverse = buildAdjacency(links, (l) => l.to);

  const diagnostics = [
    ...parseDiagnostics,
    ...validationResult.diagnostics,
    ...linkTargetDiags,
  ];

  return { entries, links, forward, reverse, documents, diagnostics };
}

/** Extract traceability links from entry attributes. */
function extractLinks(entries: readonly Entry[]): Link[] {
  const links: Link[] = [];

  for (const entry of entries) {
    for (const attr of entry.rawAttributes) {
      const extracted = extractLinksFromAttribute(
        entry.displayId,
        attr.key,
        attr.value,
        entry.location,
      );
      links.push(...extracted);
    }
  }

  return links;
}

/**
 * Attributes whose value is `slug + optional free-text locator` per
 * ADR-002 §2.6 (citation type + legacy Derived-from tolerance). The link
 * target is the leading non-whitespace token only.
 */
const LOCATOR_BEARING_ATTRS: ReadonlySet<string> = new Set([
  "Derived-from",
  "References",
]);

/** Map an attribute key+value to zero or more links. */
function extractLinksFromAttribute(
  from: DisplayId,
  key: string,
  value: string,
  location: SourceLocation,
): Link[] {
  const kind = ATTR_TO_LINK_KIND[key];
  if (!kind) return [];

  if (LOCATOR_BEARING_ATTRS.has(key)) {
    // Format: "ID §section" — extract ID part only.
    const idPart = value.split(/\s/)[0];
    if (idPart) {
      return [{ from, to: idPart, kind, location }];
    }
    return [];
  }

  // Comma-separated targets for id-list attributes.
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((to) => ({ from, to, kind, location }));
}

/** Build an adjacency map from links using a key selector. */
function buildAdjacency(
  links: readonly Link[],
  keyFn: (link: Link) => DisplayId,
): Map<DisplayId, Link[]> {
  const map = new Map<DisplayId, Link[]>();
  for (const link of links) {
    const key = keyFn(link);
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push(link);
  }
  return map;
}

// Re-export serialization helper.
export { serializeCompileResult } from "./schema.ts";
export type { SerializedCompileResult, SerializedEntry } from "./schema.ts";

// Re-export inverse generation.
export { generateInverses } from "./inverses.ts";
export type { GenerateInversesResult } from "./inverses.ts";
