/**
 * @module desk/api
 *
 * The MarkDesk HTTP API — `schemas/desk-api.json` — as a pure
 * `Request → Response` handler over a compiled project graph. Web APIs only
 * (no `Deno.*`), so the handler is unit-testable without a socket and stays
 * portable; `desk/server.ts` owns the listener, the nonce token, and project
 * loading.
 *
 * Read-only (ADR-035), no WebSocket, no writes.
 *
 *   GET /api/v1/tree               → {@linkcode ProductTree}
 *   GET /api/v1/entries/{id}       → {@linkcode EntryView} (display ID or Id)
 *   GET /api/v1/entries/{id}/html  → {@linkcode EntryHtmlView}
 *   GET /api/v1/documents?path=P   → {@linkcode DocumentView}
 *   GET /api/v1/files?path=P       → {@linkcode SourceText}
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
 * costs one file read and no render.
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
 * a preflight; it allows the `Authorization` and `If-None-Match` request
 * headers. Each response produced after the Origin check for an allowed origin
 * (200, 304, 400, 401, 404, 405) carries `Access-Control-Allow-Origin`,
 * `Access-Control-Expose-Headers: ETag`, and `Vary: Origin`, so the UI can
 * read error bodies and the entity tag too. The 403 responses
 * (`forbidden-host`, `forbidden-origin`) carry no CORS headers.
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
  makeDisplayId,
} from "../core/mod.ts";
import {
  buildDocumentView,
  buildEntryHtmlView,
  documentEtag,
  projectEntriesOf,
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
   * Resolve an absolute path to its canonical, symlink-free form;
   * `undefined` when the path does not exist or cannot be resolved.
   */
  realPath(absolutePath: string): Promise<string | undefined>;
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

/**
 * Create the desk API request handler. The handler authenticates every
 * request before routing, so an unauthenticated probe learns nothing about
 * which paths exist.
 */
export function createDeskHandler(
  options: DeskHandlerOptions,
): (request: Request) => Promise<Response> {
  const { source, token } = options;
  const allowedOrigins: ReadonlySet<string> = new Set([
    ...TAURI_ORIGINS,
    ...(options.allowedOrigins ?? []),
  ]);
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
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "Authorization, If-None-Match",
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
      return new Response(null, {
        status: 304,
        headers: { etag, "cache-control": "no-store" },
      });
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

  /** Bearer check, method check, and routing — the policy after Origin. */
  async function route(request: Request, url: URL): Promise<Response> {
    if (!hasBearer(request, token)) {
      return errorResponse(401, "unauthorized", "Missing or invalid token");
    }
    if (request.method !== "GET") {
      return errorResponse(405, "method-not-allowed", "Only GET is supported");
    }

    if (url.pathname === "/api/v1/tree") {
      const compiled = await source.getCompiled();
      return jsonResponse(
        200,
        buildProductTree(compiled, source.profile, source.projectName),
      );
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
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
