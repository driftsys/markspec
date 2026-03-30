/**
 * @module compiler
 *
 * Compiler pipeline. Takes file paths, parses all entries, validates them,
 * builds a bidirectional traceability graph, and returns the compiled model.
 */

import type {
  Diagnostic,
  DisplayId,
  Entry,
  Link,
  LinkKind,
  SourceLocation,
} from "../model/mod.ts";
import { parseFile } from "../parser/mod.ts";
import { validate } from "../validator/mod.ts";

/** Options for {@linkcode compile}. */
export interface CompileOptions {
  /** File reader function. Required — no default to avoid Deno dependency in library code. */
  readonly readFile: (path: string) => Promise<string>;
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
  const annotationLinks: Link[] = [];
  const parseDiagnostics: Diagnostic[] = [];

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
    allEntries.push(...result.entries);
    annotationLinks.push(...result.links);
  }

  // Phase 2: Validate all entries.
  const validationResult = validate(allEntries);

  // Phase 3: Build traceability graph.
  // Keep first occurrence of each display ID (validator catches duplicates).
  const entries = new Map<DisplayId, Entry>();
  for (const entry of allEntries) {
    if (!entries.has(entry.displayId)) {
      entries.set(entry.displayId, entry);
    }
  }

  const links = [...extractLinks(allEntries), ...annotationLinks];
  const forward = buildAdjacency(links, (l) => l.from);
  const reverse = buildAdjacency(links, (l) => l.to);

  const diagnostics = [
    ...parseDiagnostics,
    ...validationResult.diagnostics,
  ];

  return { entries, links, forward, reverse, diagnostics };
}

/** Extract traceability links from entry attributes. */
function extractLinks(entries: readonly Entry[]): Link[] {
  const links: Link[] = [];

  for (const entry of entries) {
    for (const attr of entry.attributes) {
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

/** Map an attribute key+value to zero or more links. */
function extractLinksFromAttribute(
  from: DisplayId,
  key: string,
  value: string,
  location: SourceLocation,
): Link[] {
  const kind = ATTR_TO_LINK_KIND[key];
  if (!kind) return [];

  if (key === "Derived-from") {
    // Format: "ID §section" — extract ID part only.
    const idPart = value.split(/\s/)[0];
    if (idPart) {
      return [{ from, to: idPart, kind, location }];
    }
    return [];
  }

  // Comma-separated targets (Satisfies, Allocates, Verifies, Implements).
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((to) => ({ from, to, kind, location }));
}

/**
 * Attribute keys that produce traceability links.
 * Note: Constrains targets are component names (free text), not entry IDs,
 * so they are not included here. They would produce dangling links.
 */
const ATTR_TO_LINK_KIND: Record<string, LinkKind | undefined> = {
  "Satisfies": "satisfies",
  "Derived-from": "derived-from",
  "Allocates": "allocates",
  "Verifies": "verifies",
  "Implements": "implements",
};

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
export type { SerializedCompileResult } from "./schema.ts";
