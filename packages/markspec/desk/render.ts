/**
 * @module desk/render
 *
 * Read-path helpers for the desk API: the project-file allowlist, and the
 * HTML views of a document and of one entry. Pure over a compiled graph and
 * a file reader, so `desk/api.ts` stays free of `Deno.*` calls.
 *
 * Only `markspec desk` loads this module: it is reachable from `desk/api.ts`,
 * which `desk/server.ts` imports lazily. The book renderer it imports is
 * shared with `markspec book build`.
 */

import type { CompileResult, EffectiveProfile, Entry } from "../core/mod.ts";
import { formatEntryOrigin, sha256String } from "../core/mod.ts";
import { renderChapterHtml, renderEntryHtml } from "../book/mod.ts";

/** `GET /api/v1/documents` response. */
export interface DocumentView {
  readonly apiVersion: number;
  /** Project-relative path with `/` separators. */
  readonly path: string;
  /** Rendered HTML fragment. */
  readonly html: string;
  /** Entries of the file in source order, with the element id of each block. */
  readonly entries: readonly { displayId: string; anchor: string }[];
}

/** `GET /api/v1/entries/{id}/html` response. */
export interface EntryHtmlView {
  readonly apiVersion: number;
  readonly displayId: string;
  readonly html: string;
  /** `"<id>@<version>"` when the entry is not authored in the project. */
  readonly origin?: string;
}

/** `GET /api/v1/files` response. */
export interface SourceText {
  readonly apiVersion: number;
  readonly path: string;
  readonly text: string;
}

/**
 * Convert a file path from the compiled graph to the API path form:
 * relative to `projectRoot`, with `/` separators. Accepts POSIX and Windows
 * separators on either argument, whatever the host platform. A path outside
 * the root, or one that is already relative, is returned with only its
 * separators normalised.
 */
export function toApiPath(projectRoot: string, file: string): string {
  const root = projectRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalised = file.replace(/\\/g, "/");
  return normalised.startsWith(`${root}/`)
    ? normalised.slice(root.length + 1)
    : normalised;
}

/** Whether an entry is authored in the project (no delivered or upstream origin). */
function isProjectEntry(entry: Entry): boolean {
  return entry.origin === undefined;
}

/**
 * The project entries located in `path`, in source order. An empty result
 * means the path is not on the allowlist: the file holds no project entry.
 */
export function projectEntriesOf(
  compiled: CompileResult,
  projectRoot: string,
  path: string,
): Entry[] {
  return [...compiled.entries.values()]
    .filter((e) =>
      isProjectEntry(e) && toApiPath(projectRoot, e.location.file) === path
    )
    .sort((a, b) => a.location.line - b.location.line);
}

/** Build the `DocumentView` of one allowed Markdown file. */
export function buildDocumentView(
  apiVersion: number,
  compiled: CompileResult,
  profile: EffectiveProfile | undefined,
  path: string,
  entries: readonly Entry[],
  text: string,
): DocumentView {
  const { html } = renderChapterHtml(text, {
    file: path,
    profile,
    knownDisplayIds: knownDisplayIds(compiled),
  });
  return {
    apiVersion,
    path,
    html,
    entries: entries.map((e) => ({
      displayId: e.displayId,
      anchor: `entry-${e.displayId}`,
    })),
  };
}

/**
 * The strong entity tag of the `DocumentView` that {@linkcode buildDocumentView}
 * builds from the same arguments: a quoted SHA-256 hex digest of the inputs
 * that can change the view.
 *
 * The render reads the document text, the profile, and the set of known
 * display IDs. Titles of entries in other files are not inputs, so editing
 * them keeps the tag. The profile is loaded once per server session, so a
 * profile edit does not change the tag until the product is opened again.
 * The whole known-ID set is hashed, not only the IDs found in the raw text:
 * the renderer links an ID after Markdown unescaping (`STK\_0001` renders as
 * `STK_0001`), so a text search would miss some links. Adding or removing any
 * entry therefore changes the tag of every document.
 */
export async function documentEtag(
  apiVersion: number,
  compiled: CompileResult,
  path: string,
  entries: readonly Entry[],
  text: string,
): Promise<string> {
  // Each field is length-prefixed, so two fields can never run into each
  // other whatever characters they contain.
  const input = [
    String(apiVersion),
    path,
    entries.map((e) => e.displayId).join("\n"),
    await knownIdsDigest(compiled),
    text,
  ].map((field) => `${field.length}:${field}`).join("");
  // `sha256String` returns `sha256:<hex>`; the tag is the quoted hex alone.
  const digest = await sha256String(input);
  return `"${digest.slice(digest.indexOf(":") + 1)}"`;
}

/** Digest of the sorted known display IDs, computed once per graph. */
const knownIdsDigests = new WeakMap<CompileResult, Promise<string>>();

function knownIdsDigest(compiled: CompileResult): Promise<string> {
  let digest = knownIdsDigests.get(compiled);
  if (digest === undefined) {
    digest = sha256String([...knownDisplayIds(compiled)].sort().join("\n"));
    knownIdsDigests.set(compiled, digest);
  }
  return digest;
}

/** Build the `EntryHtmlView` of one entry. */
export function buildEntryHtmlView(
  apiVersion: number,
  compiled: CompileResult,
  profile: EffectiveProfile | undefined,
  entry: Entry,
): EntryHtmlView {
  const html = renderEntryHtml(entry, {
    profile,
    knownDisplayIds: knownDisplayIds(compiled),
  });
  return {
    apiVersion,
    displayId: entry.displayId,
    html,
    ...(entry.origin ? { origin: formatEntryOrigin(entry.origin) } : {}),
  };
}

/** Every display ID in the graph, so references to them render as links. */
function knownDisplayIds(compiled: CompileResult): ReadonlySet<string> {
  return new Set<string>(compiled.entries.keys());
}
