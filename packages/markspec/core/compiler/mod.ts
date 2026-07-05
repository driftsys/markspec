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
  EntryProperties,
  Link,
  SourceLocation,
} from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";
import { parseFile } from "../parser/mod.ts";
import {
  attributeCorpusDiagnostics,
  classifyEntriesStage,
  detectCorpusCollisions,
  suppressDeclaredAttrR010,
  validate,
} from "../validator/mod.ts";
import { validateUxilFamily } from "../validator/uxil_family.ts";
import { buildTypeRegistry, type TypeRegistry } from "../typl/mod.ts";
import { buildEffectiveDisciplineRegistry } from "../profile/discipline_registry.ts";
import { ATTR_TO_LINK_KIND } from "./constants.ts";
import { classifyDiscipline } from "./discipline_classifier.ts";
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
  /**
   * Optional. Called once per source file to obtain its version-control
   * history. Returns undefined when git is unavailable, the file is
   * untracked, or the host is non-Deno. When absent — or when it returns
   * undefined — `entry.properties.git` is left undefined.
   *
   * The callback keeps git I/O out of `core/` so the compiler stays
   * Node-safe. Contributor names are PII-adjacent (ADR-006) and only
   * retained when {@linkcode CompileOptions.withContributors} is true.
   */
  readonly gitFile?: (
    path: string,
  ) => Promise<
    {
      createdAt?: string;
      modifiedAt?: string;
      contributors?: readonly string[];
      revision?: string;
    } | undefined
  >;
  /**
   * Opt-in retention of `git.contributors`. Default false: contributor
   * names are dropped even when {@linkcode CompileOptions.gitFile}
   * returns them, because they are PII-adjacent (ADR-006). When true the
   * list is deduplicated and sorted for deterministic output.
   */
  readonly withContributors?: boolean;
  /**
   * Profile-delivered corpus entries (ADR-030), pre-loaded and
   * origin-stamped by `loadDeliveredCorpus`. Injected AHEAD of project
   * entries so first-entry-wins graph slots resolve to the corpus
   * deterministically. Optional — absent means no corpus.
   */
  readonly corpusEntries?: readonly Entry[];
}

/**
 * Shape the raw git observations from {@linkcode CompileOptions.gitFile}
 * into an entry's `properties.git`. Enforces the PII gate (contributors
 * dropped unless `withContributors`) and makes the contributor list
 * deterministic (deduplicated + sorted). Returns undefined when there is
 * no git data, so absent history leaves `properties.git` unset rather
 * than emitting an empty object.
 */
function resolveGit(
  raw:
    | {
      createdAt?: string;
      modifiedAt?: string;
      contributors?: readonly string[];
      revision?: string;
    }
    | undefined,
  withContributors: boolean,
): NonNullable<EntryProperties["git"]> | undefined {
  if (!raw) return undefined;
  const git: {
    createdAt?: string;
    modifiedAt?: string;
    contributors?: readonly string[];
    revision?: string;
  } = {};
  if (raw.createdAt) git.createdAt = raw.createdAt;
  if (raw.modifiedAt) git.modifiedAt = raw.modifiedAt;
  if (raw.revision) git.revision = raw.revision;
  if (withContributors && raw.contributors && raw.contributors.length > 0) {
    git.contributors = [...new Set(raw.contributors)].sort();
  }
  return Object.keys(git).length > 0 ? git : undefined;
}

/**
 * Project `Entry.source` onto `EntryProperties.source`. Always returns a
 * non-empty object — every entry has a known source category. Markdown
 * entries get `{ type: "markdown" }`; doc-comment entries get the full
 * code-source fan-out (adapter, language, function, rule).
 */
function resolveSource(
  source: Entry["source"],
): NonNullable<EntryProperties["source"]> {
  if (source.kind === "markdown") {
    return { type: "markdown" };
  }
  if (source.kind === "doc-comment") {
    return {
      type: "code",
      adapter: "tree-sitter",
      language: source.language,
      function: source.function,
      rule: source.rule,
    };
  }
  // Exhaustiveness check — adding a third EntrySource variant becomes a
  // compile-time error here, forcing a deliberate decision about its
  // properties.source projection rather than silently inheriting the
  // tree-sitter branch's defaults.
  const _exhaustive: never = source;
  throw new Error(`unhandled EntrySource: ${JSON.stringify(_exhaustive)}`);
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
  /**
   * Corpus-wide index of typl bindings and typedefs across all entries.
   * See ADR-019. Built by validateTypl during compile.
   */
  readonly typeRegistry: TypeRegistry;
}

/**
 * Semaphore for bounded concurrency — limits simultaneous file reads to
 * avoid exhausting OS file-descriptor limits on large projects.
 *
 * Private to this module; not exported.
 */
class Semaphore {
  private queue: Array<() => void> = [];
  constructor(private maxConcurrent: number) {}
  async acquire(): Promise<void> {
    if (this.maxConcurrent > 0) {
      this.maxConcurrent--;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }
  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.maxConcurrent++;
    }
  }
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
  const allEntries: Entry[] = [...(options.corpusEntries ?? [])];
  const parseDiagnostics: Diagnostic[] = [];
  const documents = new Map<string, Document>();

  // Phase 1: Read and parse all files with bounded concurrency (16 slots).
  // Using Promise.all avoids sequential I/O latency on large projects while
  // the semaphore prevents exhausting OS file-descriptor limits.
  const sem = new Semaphore(16);

  type FileResult = {
    filePath: string;
    entries: Entry[];
    diagnostics: Diagnostic[];
    document: Document | undefined;
  } | null;

  const fileResults = await Promise.all(
    [...paths].map(async (filePath): Promise<FileResult> => {
      await sem.acquire();
      try {
        let content: string;
        try {
          content = await read(filePath);
        } catch {
          return {
            filePath,
            entries: [],
            diagnostics: [{
              code: "MSL-E000",
              severity: "error",
              message: `failed to read file: ${filePath}`,
              location: undefined,
            }],
            document: undefined,
          };
        }
        const result = await parseFile(content, { file: filePath });
        const stat = options.statFile
          ? await options.statFile(filePath)
          : undefined;
        const mtimeStr = stat?.mtime ? stat.mtime.toISOString() : undefined;
        const git = resolveGit(
          options.gitFile ? await options.gitFile(filePath) : undefined,
          options.withContributors ?? false,
        );
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
            ...(git ? { git } : {}),
            source: resolveSource(entry.source), // NEW — always set
          },
        }));
        return {
          filePath,
          entries: annotatedEntries,
          diagnostics: [...result.diagnostics],
          document: result.document,
        };
      } finally {
        sem.release();
      }
    }),
  );

  for (const res of fileResults) {
    if (!res) continue;
    allEntries.push(...res.entries);
    parseDiagnostics.push(...res.diagnostics);
    if (res.document) documents.set(res.filePath, res.document);
  }

  // Phase 2: Validate all entries. When a profile is loaded, suppress the
  // core-only MSL-R010 "unknown attribute" warnings for attributes the profile
  // declares — mirrors runPipeline's Stage 1 so LSP/MCP diagnostics match the
  // `validate` command instead of flooding the editor with false positives.
  const validationResult = validate(allEntries);
  const validationDiagnostics = suppressDeclaredAttrR010(
    validationResult.diagnostics,
    allEntries,
    options.profile ?? null,
  );

  // Phase 2.5: Classify entries when a profile is loaded.
  let classifiedEntries: readonly Entry[] = allEntries;
  if (options.profile) {
    const stage2 = classifyEntriesStage(allEntries, options.profile);
    classifiedEntries = stage2.entries;
    parseDiagnostics.push(...stage2.diagnostics);
  }

  // Phase 2.6: uxil diagnostics family (S9 #727) — profile-gated (inert
  // without a `declares: ux-surface` designation), mirroring runPipeline's
  // Stage 5 so compile-backed surfaces (CLI compile/export/show, the MCP
  // server) agree with `check` and the LSP on designated corpora. No
  // file-local filter here: the requested path set IS the corpus being
  // compiled — the same full-set semantics MSL-L006 assumes in compile.
  const uxilDiagnostics = validateUxilFamily(
    classifiedEntries,
    options.profile ?? null,
  );

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

  // Phase 4: Classify each entry's discipline per ADR-017 Invariant 1
  // (channels 3 + 4 + default — override and freeze ship in Slice 3).
  // The effective registry is built once per compile() from the active
  // profile chain; null falls back to the core seed.
  {
    const registry = buildEffectiveDisciplineRegistry(options.profile ?? null);
    const classified: Entry[] = [];
    for (const entry of entries.values()) {
      const discipline = classifyDiscipline(entry, entries, registry);
      classified.push({ ...entry, derivedDiscipline: discipline });
    }
    entries.clear();
    for (const entry of classified) {
      entries.set(entry.displayId, entry);
    }
  }

  const authoredLinks = extractLinks([...entries.values()]);
  const links = [...authoredLinks, ...generatedLinks];

  // MSL-T013: check link targets for draft/retired state.
  const linkTargetDiags = checkLinkTargets(entries, links);

  const forward = buildAdjacency(links, (l) => l.from);
  const reverse = buildAdjacency(links, (l) => l.to);

  // Build the corpus typl registry directly — validate() (called above)
  // already ran the full validateTypl pass (citation resolution, TYPL-009,
  // etc.) for validationDiagnostics; re-running it here just to get
  // `.registry` would redo that work a second time per compile/show/
  // context/report/export/MCP call.
  const typeRegistry = buildTypeRegistry([...entries.values()]);

  let diagnostics: Diagnostic[] = [
    ...parseDiagnostics,
    ...validationDiagnostics,
    ...uxilDiagnostics,
    ...linkTargetDiags,
  ];

  // Phase 5: Corpus-aware diagnostic post-pass (ADR-030). A project entry
  // that reuses a display ID or Id already delivered by a corpus is
  // MSL-R014, not the generic MSL-R005/R006/I007/I008 duplicate codes —
  // and findings located inside a corpus file are downgraded to
  // attributed warnings so consumer builds don't go red over upstream
  // bugs they cannot fix. No-op (and zero allocation beyond the spread
  // above) when no corpus was injected.
  if (options.corpusEntries && options.corpusEntries.length > 0) {
    const collisions = detectCorpusCollisions(allEntries);
    diagnostics = [
      ...attributeCorpusDiagnostics(
        diagnostics,
        allEntries,
        collisions.collidedTokens,
      ),
      ...collisions.diagnostics,
    ];
  }

  return {
    entries,
    links,
    forward,
    reverse,
    documents,
    diagnostics,
    typeRegistry,
  };
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
    // Comma-separated targets, each "ID §section": split the list (these
    // attributes are 0..N), then take the leading ID token of each value,
    // dropping the optional free-text locator.
    return value
      .split(",")
      .map((s) => s.trim().split(/\s/)[0])
      .filter((s) => s.length > 0)
      .map((to) => ({ from, to: makeDisplayId(to), kind, location }));
  }

  // Comma-separated targets for id-list attributes.
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((to) => ({ from, to: makeDisplayId(to), kind, location }));
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
export type {
  SerializedCompileResult,
  SerializedEntry,
  SerializedTypeRegistry,
} from "./schema.ts";

// Re-export inverse generation.
export { generateInverses } from "./inverses.ts";
export type { GenerateInversesResult } from "./inverses.ts";
