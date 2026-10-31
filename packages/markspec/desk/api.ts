/**
 * @module desk/api
 *
 * The MarkDesk HTTP API — `schemas/desk-api.json` — as a pure
 * `Request → Response` handler over a compiled project graph. Web APIs only
 * (no `Deno.*`), so the handler is unit-testable without a socket and stays
 * portable; `desk/server.ts` owns the listener, the nonce token, and project
 * loading.
 *
 * No WebSocket. The only write is an accepted proposal (ADR-035: agents
 * propose, the author accepts), and it changes one entry body.
 *
 *   GET  /api/v1/tree               → {@linkcode ProductTree}
 *   GET  /api/v1/entries/{id}       → {@linkcode EntryView} (display ID or Id)
 *   GET  /api/v1/entries/{id}/html  → {@linkcode EntryHtmlView}
 *   GET  /api/v1/documents?path=P   → {@linkcode DocumentView}
 *   GET  /api/v1/files?path=P       → {@linkcode SourceText}
 *   POST /api/v1/proposals/preview  → {@linkcode ProposalPreview} (no write)
 *   POST /api/v1/proposals/apply    → {@linkcode ProposalApplied} (writes)
 *
 * Proposals: the request body is {@linkcode ProposalRequest}, exactly one
 * change of kind `body` for a project entry (no `origin`) in a `.md` file.
 * Both routes require an `If-Match` header that names the current
 * `/documents` ETag of the entry's file with the strong comparison
 * (RFC 9110 §13.1.1): missing is 428 `precondition-required`; a tag that
 * does not name the current one, a `W/` tag, and `*` are 412
 * `precondition-failed`. The proposal passes the `markspec fmt` formatter
 * (`desk/proposals.ts`); apply writes the file text with only the target
 * body replaced, through {@linkcode DeskSource.writeFile}, and answers the
 * new document ETag. Applies run one at a time, so a second apply with the
 * same tag answers 412 and writes nothing.
 *
 * A `path` is served only when it names a Markdown or source file that holds
 * at least one project entry (an entry with no `origin`); `/documents`
 * additionally requires a `.md` path. The path must also be project-relative,
 * and its real path (symlinks resolved) must lie inside the real project
 * root. Any other path is 404 `not-found`.
 *
 * Revalidation: a `/documents` 200 carries a strong `ETag`
 * ({@linkcode documentEtag}). A request whose `If-None-Match` names the
 * current tag gets 304 with no body, and the document is not rendered. The
 * client keeps the render it has and sends its tag on each later request, so
 * an edit on disk shows on the next request, while an unchanged document
 * costs one file read and no render. A `/tree` 200 carries a strong `ETag`
 * too, the digest of the serialized tree, which embeds the API version: a
 * matching `If-None-Match` gets 304 with no body, so the UI can revalidate
 * the navigator on window focus without receiving the tree again while the
 * graph is unchanged (#842). The tree and its tag are built once per
 * compiled graph.
 *
 * Every request must carry a loopback `Host` header (DNS-rebinding guard),
 * and every request except an allowed-origin CORS preflight must carry
 * `Authorization: Bearer <token>`. Errors are `{ error: { code, message } }`.
 *
 * Origin policy (CORS): a request with no `Origin` header (CLI tools, curl)
 * is unaffected. A request with an `Origin` header must name an allowed
 * origin — {@linkcode TAURI_ORIGINS} plus `allowedOrigins` — or it gets 403
 * `forbidden-origin`. An `OPTIONS` preflight from an allowed origin gets 204
 * before the bearer check, because browsers send no `Authorization` header on
 * a preflight; it allows the `GET` and `POST` methods and the
 * `Authorization`, `Content-Type`, `If-Match`, and `If-None-Match` request
 * headers. Each response produced after the Origin check for an allowed origin
 * (200, 304, 400, 401, 404, 405, 409, 412, 422, 428, 500) carries
 * `Access-Control-Allow-Origin`, `Access-Control-Expose-Headers: ETag`, and
 * `Vary: Origin`, so the UI can read error bodies and the entity tag too.
 * The 403 responses (`forbidden-host`, `forbidden-origin`) carry no CORS
 * headers.
 *
 * The `Origin` check is not an authentication boundary. The per-launch nonce
 * token is the only credential. The check only limits which browser pages can
 * call the API: `tauri://localhost` is shared by every Tauri app on the
 * machine, a non-browser local process can send any `Origin` value, and
 * `--allow-origin http://localhost:5173` admits any page served on that port.
 * Never relax the token check because the `Origin` check passed.
 */

import { join } from "@std/path";
import {
  type CompileResult,
  type EffectiveProfile,
  type Entry,
  formatEntryOrigin,
  loadMarkdownFormatter,
  makeDisplayId,
  type ProseFormatter,
} from "../core/mod.ts";
import { createSerialRunner } from "../lsp/util.ts";
import {
  applyBody,
  MAX_PROPOSAL_CHARS,
  previewBody,
  type ProposalRefusal,
} from "./proposals.ts";
import {
  buildDocumentView,
  buildEntryHtmlView,
  documentEtag,
  projectEntriesOf,
  quotedDigest,
  type SourceText,
  toApiPath,
} from "./render.ts";

export { toApiPath } from "./render.ts";
export type { DocumentView, EntryHtmlView, SourceText } from "./render.ts";

/** Version of the desk API contract. Bumped on a breaking change. */
export const DESK_API_VERSION = 3;

/**
 * Link kinds that become edges of the product graph: refinement (`Satisfies`,
 * `Derived-from`) and verification (`Verifies`). A link points from the
 * refining or verifying entry (the child) up to its target (the parent).
 */
const TREE_LINK_KINDS = ["satisfies", "derived-from", "verifies"] as const;

/** Link kinds that appear as the relation of a {@linkcode ProductEdge}. */
export type TreeLinkKind = typeof TREE_LINK_KINDS[number];

/** Whether a link kind is one of {@linkcode TREE_LINK_KINDS}. */
function isTreeLinkKind(kind: string): kind is TreeLinkKind {
  return (TREE_LINK_KINDS as readonly string[]).includes(kind);
}

/** One entry of the product graph. */
export interface ProductNode {
  readonly displayId: string;
  readonly title: string;
  /** Profile type name, when the entry is classified. */
  readonly type?: string;
  /** Core type the profile type ultimately extends (`Requirement`, `Risk`, `Test`, …). */
  readonly kind?: string;
  /** `"<id>@<version>"` for delivered-corpus (ADR-030) and upstream entries. */
  readonly origin?: string;
}

/** One tree link: the child entry refines or verifies the parent entry. */
export interface ProductEdge {
  /** Display ID of the refining or verifying entry (the child). */
  readonly from: string;
  /** Display ID of the link target (the parent). */
  readonly to: string;
  /** Link kind: `satisfies`, `derived-from`, or `verifies`. */
  readonly relation: TreeLinkKind;
}

/** `GET /api/v1/tree` response. */
export interface ProductTree {
  readonly apiVersion: number;
  readonly project: { readonly name?: string };
  /**
   * Display IDs of the entries with no parent, sorted, then for each link
   * cycle that no root reaches, its lowest display ID.
   */
  readonly roots: readonly string[];
  /** Every entry of the graph once, sorted by display ID. */
  readonly nodes: readonly ProductNode[];
  /** One edge per (child, parent) pair, grouped by parent. */
  readonly edges: readonly ProductEdge[];
}

/** One end of a trace link, as seen from the entry being viewed. */
export interface LinkView {
  readonly kind: string;
  readonly displayId: string;
  /** Title of the linked entry, when it is in the graph. */
  readonly title?: string;
}

/** `GET /api/v1/entries/{id}` response. */
export interface EntryView {
  readonly apiVersion: number;
  readonly displayId: string;
  /** The `Id:` value (ULID or URI), when stamped. */
  readonly id?: string;
  readonly title: string;
  readonly type?: string;
  readonly kind?: string;
  readonly body: string;
  readonly attributes: readonly { key: string; value: string }[];
  /** Project-relative path and 1-based position of the entry. */
  readonly location: {
    readonly file: string;
    readonly line: number;
    readonly column: number;
  };
  readonly origin?: string;
  readonly links: {
    readonly outgoing: readonly LinkView[];
    readonly incoming: readonly LinkView[];
  };
}

/** What the handler reads. `desk/server.ts` backs it with the project service. */
export interface DeskSource {
  /** Absolute project root — entry locations are reported relative to it. */
  readonly projectRoot: string;
  /** `project.yaml` `name`, when present. */
  readonly projectName?: string;
  /** Active effective profile, used to resolve each type's core kind. */
  readonly profile?: EffectiveProfile;
  /** Current compiled graph. Called once per request. */
  getCompiled(): Promise<CompileResult>;
  /** Read a file by absolute path; `undefined` when it cannot be read. */
  readFile(absolutePath: string): Promise<string | undefined>;
  /**
   * Read a file's bytes by absolute path; `undefined` when it cannot be
   * read. Proposals use it, so a file that is not valid UTF-8 is refused
   * instead of being decoded with replacement characters and written back.
   */
  readFileBytes(absolutePath: string): Promise<Uint8Array | undefined>;
  /**
   * Resolve an absolute path to its canonical, symlink-free form;
   * `undefined` when the path does not exist or cannot be resolved.
   */
  realPath(absolutePath: string): Promise<string | undefined>;
  /**
   * Replace the file at an absolute path with `text`, atomically. Called
   * only for an accepted proposal; a rejection is reported as 500
   * `write-failed`.
   */
  writeFile(absolutePath: string, text: string): Promise<void>;
}

/** One change of a proposal: a new body for one entry. */
export interface ProposalChange {
  readonly displayId: string;
  readonly kind: "body";
  readonly body: string;
}

/** `POST /api/v1/proposals/{preview,apply}` request body. */
export interface ProposalRequest {
  /** Exactly one change. */
  readonly changes: readonly ProposalChange[];
}

/** One previewed change: the formatted proposed body and the current body. */
export interface PreviewedChange extends ProposalChange {
  readonly currentBody: string;
}

/** `POST /api/v1/proposals/preview` response. */
export interface ProposalPreview {
  readonly apiVersion: number;
  readonly changes: readonly PreviewedChange[];
}

/** `POST /api/v1/proposals/apply` response. */
export interface ProposalApplied {
  readonly apiVersion: number;
  /** Project-relative path of the written file. */
  readonly path: string;
  /** The new document ETag of the written file. */
  readonly etag: string;
}

/** Options for {@linkcode createDeskHandler}. */
export interface DeskHandlerOptions {
  readonly source: DeskSource;
  /** Per-launch nonce every request must present as a bearer token. */
  readonly token: string;
  /**
   * Extra origins allowed in addition to {@linkcode TAURI_ORIGINS}, e.g. the
   * Vite dev server. Values are in `URL.origin` form.
   */
  readonly allowedOrigins?: readonly string[];
  /**
   * Load the Markdown prose formatter used on proposals. Defaults to
   * `loadMarkdownFormatter`. A rejection is reported as 422
   * `format-failed`.
   */
  readonly loadProseFormatter?: () => Promise<ProseFormatter>;
}

/**
 * Origins of the Tauri webview that hosts the MarkDesk UI, always allowed:
 * `tauri://localhost` (macOS and Linux), `http://tauri.localhost` and
 * `https://tauri.localhost` (Windows and Android).
 */
export const TAURI_ORIGINS: readonly string[] = [
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
];

/**
 * Walk a profile type's `extends:` chain to the first name the profile does
 * not declare — the core type it builds on. Returns `undefined` for an
 * unclassified entry; returns the type itself when it already is a core
 * type (no profile, or `Type: Requirement`).
 */
export function coreKindOf(
  type: string | undefined,
  profile: EffectiveProfile | undefined,
): string | undefined {
  if (type === undefined) return undefined;
  let cursor = type;
  const seen = new Set<string>();
  while (profile?.types.has(cursor)) {
    if (seen.has(cursor)) return undefined; // `extends:` cycle
    seen.add(cursor);
    const next = profile.types.get(cursor)?.value.extends;
    if (!next) return undefined; // profile type with no core ancestor
    cursor = next;
  }
  return cursor;
}

/**
 * Build the product graph: the traceability graph as flat lists, so the
 * output size is linear in entries plus tree links. `nodes` holds every entry
 * once, sorted by display ID. `edges` holds one edge per (child, parent)
 * pair for the refinement and verification links; when several links join the
 * same pair, the refinement link wins over the verification link, then the
 * lowest kind name. Edges sort by parent, then refinement before
 * verification, then child. `roots` lists the entries with no parent, sorted
 * by display ID, then the lowest display ID of each link cycle that has no
 * parent outside the cycle, sorted by display ID. Every entry is reachable
 * from a root. Edges can form a cycle (a link cycle in the project); a client
 * that walks the edges must track the entries it has already visited.
 */
export function buildProductTree(
  compiled: CompileResult,
  profile: EffectiveProfile | undefined,
  projectName?: string,
): ProductTree {
  const kindRank = (kind: TreeLinkKind) => kind === "verifies" ? 1 : 0;
  // Chooses the edge kept when several links join one (child, parent) pair.
  const compareRelations = (a: TreeLinkKind, b: TreeLinkKind) =>
    kindRank(a) - kindRank(b) || compareIds(a, b);

  const entries = [...compiled.entries.values()].sort((a, b) =>
    compareIds(a.displayId, b.displayId)
  );
  const nodes: ProductNode[] = entries.map((entry) =>
    compact({
      displayId: entry.displayId,
      title: entry.title,
      type: entry.type,
      kind: coreKindOf(entry.type, profile),
      origin: entry.origin ? formatEntryOrigin(entry.origin) : undefined,
    })
  );

  // One pass over all links. Keep the best edge per (child, parent).
  const best = new Map<string, ProductEdge>();
  const hasParent = new Set<string>();
  for (const l of compiled.links) {
    if (
      !isTreeLinkKind(l.kind) || !compiled.entries.has(l.from) ||
      !compiled.entries.has(l.to) || l.from === l.to
    ) continue;
    hasParent.add(l.from);
    const key = `${l.from}\u0000${l.to}`;
    const current = best.get(key);
    if (!current || compareRelations(l.kind, current.relation) < 0) {
      best.set(key, { from: l.from, to: l.to, relation: l.kind });
    }
  }
  const edges = [...best.values()].sort((a, b) =>
    compareIds(a.to, b.to) || kindRank(a.relation) - kindRank(b.relation) ||
    compareIds(a.from, b.from)
  );

  const roots: string[] = entries.map((e) => e.displayId as string).filter(
    (id) => !hasParent.has(id),
  );
  roots.push(...sourceCycleRoots(entries.map((e) => e.displayId), edges));

  return {
    apiVersion: DESK_API_VERSION,
    project: compact({ name: projectName }),
    roots,
    nodes,
    edges,
  };
}

/**
 * Look up one entry by display ID, falling back to its `Id:` (ULID or URI)
 * so a client holding either can address it. Returns `undefined` when
 * neither matches.
 */
export function findEntry(
  compiled: CompileResult,
  idOrDisplayId: string,
): Entry | undefined {
  const byDisplayId = compiled.entries.get(makeDisplayId(idOrDisplayId));
  if (byDisplayId) return byDisplayId;
  for (const entry of compiled.entries.values()) {
    if (entry.id === idOrDisplayId) return entry;
  }
  return undefined;
}

/** Project one entry and its links into the API's {@linkcode EntryView}. */
export function buildEntryView(
  compiled: CompileResult,
  entry: Entry,
  profile: EffectiveProfile | undefined,
  projectRoot: string,
): EntryView {
  const linkView = (kind: string, displayId: string): LinkView =>
    compact({
      kind,
      displayId,
      title: compiled.entries.get(makeDisplayId(displayId))?.title,
    });
  const byKindThenId = (a: LinkView, b: LinkView) =>
    compareIds(a.kind, b.kind) || compareIds(a.displayId, b.displayId);
  const file = entry.location.file;
  return compact({
    apiVersion: DESK_API_VERSION,
    displayId: entry.displayId,
    id: entry.id,
    title: entry.title,
    type: entry.type,
    kind: coreKindOf(entry.type, profile),
    body: entry.body,
    attributes: entry.rawAttributes.map((a) => ({
      key: a.key,
      value: a.value,
    })),
    location: {
      file: toApiPath(projectRoot, file),
      line: entry.location.line,
      column: entry.location.column,
    },
    origin: entry.origin ? formatEntryOrigin(entry.origin) : undefined,
    links: {
      outgoing: (compiled.forward.get(entry.displayId) ?? [])
        .map((l) => linkView(l.kind, l.to))
        .sort(byKindThenId),
      incoming: (compiled.reverse.get(entry.displayId) ?? [])
        .map((l) => linkView(l.kind, l.from))
        .sort(byKindThenId),
    },
  });
}

/** Hosts a loopback client sends. Anything else is a rebinding attempt. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
]);

const ENTRY_PATH_RE = /^\/api\/v1\/entries\/([^/]+)$/;
const ENTRY_HTML_PATH_RE = /^\/api\/v1\/entries\/([^/]+)\/html$/;
const PROPOSAL_PREVIEW_PATH = "/api/v1/proposals/preview";
const PROPOSAL_APPLY_PATH = "/api/v1/proposals/apply";

/** HTTP status and message of each proposal refusal. */
const REFUSALS: Readonly<
  Record<ProposalRefusal, { status: number; message: string }>
> = {
  "entry-not-found": { status: 404, message: "The entry is not in the file" },
  "entry-body-empty": { status: 409, message: "The entry has no body" },
  "entry-trailer-invalid": {
    status: 409,
    message: "The entry's trailer did not parse",
  },
  "proposal-empty": { status: 422, message: "The proposed body is empty" },
  "proposal-too-large": {
    status: 422,
    message: `The proposed body is over ${MAX_PROPOSAL_CHARS} characters`,
  },
  "proposal-changes-entries": {
    status: 422,
    message: "The proposed body changes the entries of the file",
  },
  "format-failed": {
    status: 422,
    message: "The proposed body could not be formatted",
  },
};

/**
 * Create the desk API request handler. The handler authenticates every
 * request before routing, so an unauthenticated probe learns nothing about
 * which paths exist.
 */
export function createDeskHandler(
  options: DeskHandlerOptions,
): (request: Request) => Promise<Response> {
  const { source, token } = options;
  const loadProseFormatter = options.loadProseFormatter ??
    loadMarkdownFormatter;

  // Applies run one after another, so the check-then-write of one apply
  // never interleaves with another (a second apply sees the new text).
  const serialized = createSerialRunner();
  const allowedOrigins: ReadonlySet<string> = new Set([
    ...TAURI_ORIGINS,
    ...(options.allowedOrigins ?? []),
  ]);

  // The serialized tree and its tag, built once per compiled graph. The
  // profile and project name are fixed for the server session, so the graph
  // object alone decides the tree.
  const trees = new WeakMap<
    CompileResult,
    Promise<{ body: string; etag: string }>
  >();
  function treeOf(
    compiled: CompileResult,
  ): Promise<{ body: string; etag: string }> {
    let tree = trees.get(compiled);
    if (tree === undefined) {
      const body = JSON.stringify(
        buildProductTree(compiled, source.profile, source.projectName),
      );
      // The body embeds `apiVersion`, so the tag changes with the version.
      tree = quotedDigest(body).then((etag) => ({ body, etag }));
      trees.set(compiled, tree);
    }
    return tree;
  }

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const host = (request.headers.get("host") ?? url.host).replace(
      /:\d+$/,
      "",
    );
    if (!LOOPBACK_HOSTS.has(host)) {
      return errorResponse(403, "forbidden-host", "Host is not loopback");
    }

    const origin = request.headers.get("origin");
    if (origin === null) return await route(request, url);
    if (!allowedOrigins.has(origin)) {
      return errorResponse(403, "forbidden-origin", "Origin is not allowed");
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(origin),
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers":
            "Authorization, Content-Type, If-Match, If-None-Match",
          "access-control-max-age": "600",
          "cache-control": "no-store",
        },
      });
    }
    const response = await route(request, url);
    for (const [name, value] of Object.entries(corsHeaders(origin))) {
      response.headers.set(name, value);
    }
    return response;
  };

  /** `/documents` and `/files`: allowlisted project paths only. */
  async function servePath(request: Request, url: URL): Promise<Response> {
    const path = url.searchParams.get("path");
    if (!path) {
      return errorResponse(400, "bad-request", "Missing 'path' parameter");
    }
    const asDocument = url.pathname === "/api/v1/documents";
    const notFound = () =>
      errorResponse(404, "not-found", `No project file '${path}'`);
    if (asDocument && !path.endsWith(".md")) return notFound();
    const compiled = await source.getCompiled();
    const entries = projectEntriesOf(compiled, source.projectRoot, path);
    if (entries.length === 0) return notFound();
    if (!isProjectRelative(path)) return notFound();
    const target = join(source.projectRoot, path);
    const [realRoot, realTarget] = await Promise.all([
      source.realPath(source.projectRoot),
      source.realPath(target),
    ]);
    if (
      realRoot === undefined || realTarget === undefined ||
      !isInside(realRoot, realTarget)
    ) {
      return notFound();
    }
    // Read the checked real path, not `target`: a symlink swapped after the
    // check must not lead the read outside the root.
    const text = await source.readFile(realTarget);
    if (text === undefined) return notFound();
    if (!asDocument) {
      const body: SourceText = { apiVersion: DESK_API_VERSION, path, text };
      return jsonResponse(200, body);
    }
    const etag = await documentEtag(
      DESK_API_VERSION,
      compiled,
      path,
      entries,
      text,
    );
    if (matchesEtag(request.headers.get("if-none-match"), etag)) {
      // The client's cached render is current: skip rendering.
      return notModified(etag);
    }
    const response = jsonResponse(
      200,
      buildDocumentView(
        DESK_API_VERSION,
        compiled,
        source.profile,
        path,
        entries,
        text,
      ),
    );
    response.headers.set("etag", etag);
    return response;
  }

  /**
   * `/proposals/preview` and `/proposals/apply`. Checks, in order: the
   * `If-Match` header is present (428), the request size (422
   * `proposal-too-large`), the request shape (400), the entry
   * exists (404), it has no `origin` (409), it is in a `.md` file (409), the
   * file is an allowed project path (404), the file is valid UTF-8 (409),
   * `If-Match` names the current document ETag (412), then the proposal
   * pipeline. Apply reads the file again, answers 412 when its bytes
   * changed, else writes the new text to the checked real path and answers
   * the new ETag.
   */
  async function serveProposal(
    request: Request,
    apply: boolean,
  ): Promise<Response> {
    const ifMatch = request.headers.get("if-match");
    if (ifMatch === null) {
      return errorResponse(
        428,
        "precondition-required",
        "If-Match with the document ETag is required",
      );
    }
    const requestBody = await readBody(request);
    if (requestBody.tooLarge) return refusalResponse("proposal-too-large");
    const change = parseProposalRequest(requestBody.text);
    if (change === undefined) {
      return errorResponse(
        400,
        "bad-request",
        "Expected { changes: [{ displayId, kind: 'body', body }] }",
      );
    }
    const compiled = await source.getCompiled();
    const entry = findEntry(compiled, change.displayId);
    if (!entry) {
      return errorResponse(
        404,
        "entry-not-found",
        `No entry '${change.displayId}'`,
      );
    }
    if (entry.origin) {
      return errorResponse(
        409,
        "entry-read-only",
        `Entry '${entry.displayId}' comes from ${
          formatEntryOrigin(entry.origin)
        } and is read-only`,
      );
    }
    const path = toApiPath(source.projectRoot, entry.location.file);
    if (!path.endsWith(".md")) {
      return errorResponse(
        409,
        "entry-not-markdown",
        `Entry '${entry.displayId}' is not in a Markdown file`,
      );
    }
    const notFound = () =>
      errorResponse(404, "not-found", `No project file '${path}'`);
    const entries = projectEntriesOf(compiled, source.projectRoot, path);
    if (entries.length === 0 || !isProjectRelative(path)) return notFound();
    const target = join(source.projectRoot, path);
    const [realRoot, realTarget] = await Promise.all([
      source.realPath(source.projectRoot),
      source.realPath(target),
    ]);
    if (
      realRoot === undefined || realTarget === undefined ||
      !isInside(realRoot, realTarget)
    ) {
      return notFound();
    }
    // Read and write the checked real path, as `servePath` reads it.
    const bytes = await source.readFileBytes(realTarget);
    if (bytes === undefined) return notFound();
    const text = decodeUtf8Strict(bytes);
    if (text === undefined) {
      return errorResponse(
        409,
        "entry-file-not-utf8",
        `'${path}' is not valid UTF-8`,
      );
    }
    const etag = await documentEtag(
      DESK_API_VERSION,
      compiled,
      path,
      entries,
      text,
    );
    if (!namesEtagStrongly(ifMatch, etag)) {
      return errorResponse(
        412,
        "precondition-failed",
        "The file changed since the given ETag",
      );
    }
    let formatProse: ProseFormatter;
    try {
      formatProse = await loadProseFormatter();
    } catch {
      return refusalResponse("format-failed");
    }

    if (!apply) {
      const outcome = await previewBody(
        text,
        target,
        entry.displayId,
        change.body,
        formatProse,
      );
      if (!outcome.ok) return refusalResponse(outcome.refusal);
      const body: ProposalPreview = {
        apiVersion: DESK_API_VERSION,
        changes: [{
          displayId: entry.displayId,
          kind: "body",
          body: outcome.value.body,
          currentBody: outcome.value.currentBody,
        }],
      };
      return jsonResponse(200, body);
    }

    const outcome = await applyBody(
      text,
      target,
      entry.displayId,
      change.body,
      formatProse,
    );
    if (!outcome.ok) return refusalResponse(outcome.refusal);
    // The pipeline formats the whole file, which takes time on a large
    // file. Read the file again just before the write, so an edit saved by
    // another application in that time is not overwritten.
    const onDisk = await source.readFileBytes(realTarget);
    if (onDisk === undefined || !sameBytes(onDisk, bytes)) {
      return errorResponse(
        412,
        "precondition-failed",
        "The file changed since the given ETag",
      );
    }
    try {
      await source.writeFile(realTarget, outcome.value);
    } catch {
      return errorResponse(500, "write-failed", `Could not write '${path}'`);
    }
    // The pipeline guarantees the same entries, so the pre-write graph and
    // the new text give the tag a fresh compile gives.
    const newEtag = await documentEtag(
      DESK_API_VERSION,
      compiled,
      path,
      entries,
      outcome.value,
    );
    const body: ProposalApplied = {
      apiVersion: DESK_API_VERSION,
      path,
      etag: newEtag,
    };
    const response = jsonResponse(200, body);
    response.headers.set("etag", newEtag);
    return response;
  }

  /** Bearer check, method check, and routing — the policy after Origin. */
  async function route(request: Request, url: URL): Promise<Response> {
    if (!hasBearer(request, token)) {
      return errorResponse(401, "unauthorized", "Missing or invalid token");
    }
    const isProposal = url.pathname === PROPOSAL_PREVIEW_PATH ||
      url.pathname === PROPOSAL_APPLY_PATH;
    const method = isProposal ? "POST" : "GET";
    if (request.method !== method) {
      return errorResponse(
        405,
        "method-not-allowed",
        `Only ${method} is supported`,
      );
    }
    if (isProposal) {
      return url.pathname === PROPOSAL_APPLY_PATH
        ? await serialized(() => serveProposal(request, true))
        : await serveProposal(request, false);
    }

    if (url.pathname === "/api/v1/tree") {
      const { body, etag } = await treeOf(await source.getCompiled());
      if (matchesEtag(request.headers.get("if-none-match"), etag)) {
        // The client's tree is current: send no body.
        return notModified(etag);
      }
      const response = jsonTextResponse(200, body);
      response.headers.set("etag", etag);
      return response;
    }

    const entryMatch = ENTRY_PATH_RE.exec(url.pathname);
    if (entryMatch) {
      let id: string;
      try {
        id = decodeURIComponent(entryMatch[1]);
      } catch {
        return errorResponse(400, "bad-request", "Malformed entry id");
      }
      const compiled = await source.getCompiled();
      const entry = findEntry(compiled, id);
      if (!entry) {
        return errorResponse(404, "entry-not-found", `No entry '${id}'`);
      }
      return jsonResponse(
        200,
        buildEntryView(compiled, entry, source.profile, source.projectRoot),
      );
    }

    if (
      url.pathname === "/api/v1/documents" || url.pathname === "/api/v1/files"
    ) {
      return await servePath(request, url);
    }

    const htmlMatch = ENTRY_HTML_PATH_RE.exec(url.pathname);
    if (htmlMatch) {
      let id: string;
      try {
        id = decodeURIComponent(htmlMatch[1]);
      } catch {
        return errorResponse(400, "bad-request", "Malformed entry id");
      }
      const compiled = await source.getCompiled();
      const entry = findEntry(compiled, id);
      if (!entry) {
        return errorResponse(404, "entry-not-found", `No entry '${id}'`);
      }
      return jsonResponse(
        200,
        buildEntryHtmlView(
          DESK_API_VERSION,
          compiled,
          source.profile,
          entry,
        ),
      );
    }

    return errorResponse(404, "not-found", `No route for ${url.pathname}`);
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Whether an API path is relative to the project root: not absolute on any
 * platform (`/x`, `\x`, `C:x`) and free of `..` segments.
 */
function isProjectRelative(path: string): boolean {
  if (/^[\\/]/.test(path) || /^[A-Za-z]:/.test(path)) return false;
  return !path.split(/[\\/]/).includes("..");
}

/** Whether `target` is `root` itself or lies below it. Both are real paths. */
function isInside(root: string, target: string): boolean {
  const base = root.replace(/[\\/]+$/, "");
  if (target === base) return true;
  return target.startsWith(`${base}/`) || target.startsWith(`${base}\\`);
}

/** Headers that let a browser on `origin` read the response. */
function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    // Without this a browser hides `ETag` from the page's script.
    "access-control-expose-headers": "ETag",
    vary: "Origin",
  };
}

/**
 * Whether an `If-None-Match` header value names `etag` (RFC 9110 §13.1.2):
 * `*`, or a comma-separated list of tags compared with the weak comparison,
 * so a `W/` prefix is ignored.
 */
function matchesEtag(header: string | null, etag: string): boolean {
  if (header === null) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((tag) =>
    tag.trim().replace(/^W\//, "") === etag
  );
}

/**
 * Whether an `If-Match` header value names `etag` with the strong
 * comparison (RFC 9110 §13.1.1): one of its comma-separated tags is exactly
 * `etag`. A `W/` tag and `*` never match, because neither names the
 * current tag.
 */
function namesEtagStrongly(header: string, etag: string): boolean {
  return header.split(",").some((tag) => tag.trim() === etag);
}

/**
 * `bytes` decoded as strict UTF-8; `undefined` when they are not valid
 * UTF-8. A leading BOM is kept as U+FEFF, as `Deno.readTextFile` keeps it,
 * so the text and its ETag agree with what `/documents` reads.
 */
function decodeUtf8Strict(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
      .decode(bytes);
  } catch {
    return undefined;
  }
}

/** Whether two byte arrays hold the same bytes. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/**
 * Largest proposal request body the handler reads, in bytes. A body at
 * {@linkcode MAX_PROPOSAL_CHARS} with every UTF-16 code unit written as a
 * six-byte JSON escape (`\uXXXX`) fits, with 4 KiB for the rest of the
 * request.
 */
const MAX_PROPOSAL_REQUEST_BYTES = MAX_PROPOSAL_CHARS * 6 + 4096;

/**
 * The request body as text (UTF-8, invalid bytes replaced, as
 * `Request.text()` decodes it). `text` is `undefined` when the body cannot
 * be read or is larger than {@linkcode MAX_PROPOSAL_REQUEST_BYTES}; then
 * `tooLarge` says which. Reading stops at the cap, so an oversized body is
 * never held in memory as a whole.
 */
async function readBody(
  request: Request,
): Promise<{ readonly text: string | undefined; readonly tooLarge: boolean }> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_PROPOSAL_REQUEST_BYTES) {
    await request.body?.cancel().catch(() => {});
    return { text: undefined, tooLarge: true };
  }
  if (request.body === null) return { text: "", tooLarge: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PROPOSAL_REQUEST_BYTES) {
        await reader.cancel().catch(() => {});
        return { text: undefined, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { text: undefined, tooLarge: false };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), tooLarge: false };
}

/**
 * The single change of a {@linkcode ProposalRequest}, or `undefined` when
 * the text is not JSON of that shape: an object with only `changes`,
 * holding exactly one object with only a non-empty string `displayId`,
 * `kind: "body"`, and a string `body`.
 */
function parseProposalRequest(
  text: string | undefined,
): ProposalChange | undefined {
  if (text === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["changes"])) {
    return undefined;
  }
  const changes = value.changes;
  if (!Array.isArray(changes) || changes.length !== 1) return undefined;
  const [change] = changes;
  if (
    !isPlainObject(change) ||
    !hasOnlyKeys(change, ["displayId", "kind", "body"]) ||
    typeof change.displayId !== "string" || change.displayId.length === 0 ||
    change.kind !== "body" || typeof change.body !== "string"
  ) {
    return undefined;
  }
  return { displayId: change.displayId, kind: "body", body: change.body };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((k) => keys.includes(k));
}

/** The error response of a proposal refusal. */
function refusalResponse(refusal: ProposalRefusal): Response {
  const { status, message } = REFUSALS[refusal];
  return errorResponse(status, refusal, message);
}

/** Constant-time bearer-token comparison. */
function hasBearer(request: Request, token: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;
  const given = new TextEncoder().encode(match[1]);
  const expected = new TextEncoder().encode(token);
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given[i] ^ expected[i];
  return diff === 0;
}

/** A 304 response that names the current `etag`. */
function notModified(etag: string): Response {
  return new Response(null, {
    status: 304,
    headers: { etag, "cache-control": "no-store" },
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return jsonTextResponse(status, JSON.stringify(body));
}

/** A JSON response from an already serialized body. */
function jsonTextResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse(status, { error: { code, message } });
}

/**
 * The lowest display ID of each link cycle that has no parent outside the
 * cycle, sorted by display ID. A link cycle is a strongly connected component
 * of more than one entry, found with an iterative Tarjan pass (linear, no
 * recursion). An edge runs from child to parent, so a parent outside the
 * component of an edge's `from` is a parent outside that cycle.
 */
function sourceCycleRoots(
  ids: readonly string[],
  edges: readonly ProductEdge[],
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    const list = childrenOf.get(e.to);
    if (list) list.push(e.from);
    else childrenOf.set(e.to, [e.from]);
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const component = new Map<string, number>();
  const members: string[][] = [];
  for (const start of ids) {
    if (index.has(start)) continue;
    const frames: { id: string; next: number }[] = [{ id: start, next: 0 }];
    index.set(start, index.size);
    low.set(start, index.get(start)!);
    stack.push(start);
    onStack.add(start);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const children = childrenOf.get(frame.id) ?? [];
      if (frame.next < children.length) {
        const child = children[frame.next++];
        if (!index.has(child)) {
          index.set(child, index.size);
          low.set(child, index.get(child)!);
          stack.push(child);
          onStack.add(child);
          frames.push({ id: child, next: 0 });
        } else if (onStack.has(child)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(child)!));
        }
        continue;
      }
      frames.pop();
      if (frames.length > 0) {
        const parent = frames[frames.length - 1].id;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.id)!));
      }
      if (low.get(frame.id) === index.get(frame.id)) {
        const group: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.set(member, members.length);
          group.push(member);
        } while (member !== frame.id);
        members.push(group);
      }
    }
  }
  const hasOutsideParent = new Set<number>();
  for (const e of edges) {
    if (component.get(e.from) !== component.get(e.to)) {
      hasOutsideParent.add(component.get(e.from)!);
    }
  }
  return members
    .filter((group, c) => group.length > 1 && !hasOutsideParent.has(c))
    .map((group) =>
      group.reduce((low, id) => compareIds(id, low) < 0 ? id : low)
    )
    .sort(compareIds);
}

/** Locale-independent display-ID ordering, so output never varies by host. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Drop `undefined` fields so optional properties are absent, not `null`. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}
