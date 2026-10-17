/**
 * @module desk/api
 *
 * The MarkDesk HTTP API — `schemas/desk-api.json` — as a pure
 * `Request → Response` handler over a compiled project graph. Web APIs only
 * (no `Deno.*`), so the handler is unit-testable without a socket and stays
 * portable; `desk/server.ts` owns the listener, the nonce token, and project
 * loading.
 *
 * Walking skeleton (ADR-035): two read endpoints, no WebSocket, no writes.
 *
 *   GET /api/v1/tree               → {@linkcode ProductTree}
 *   GET /api/v1/entries/{id}       → {@linkcode EntryView} (display ID or Id)
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
 * a preflight. Each response produced after the Origin check for an allowed origin
 * (200, 400, 401, 404, 405) carries `Access-Control-Allow-Origin` and
 * `Vary: Origin`, so the UI can read error bodies too. The 403 responses
 * (`forbidden-host`, `forbidden-origin`) carry no CORS headers.
 *
 * The `Origin` check is not an authentication boundary. The per-launch nonce
 * token is the only credential. The check only limits which browser pages can
 * call the API: `tauri://localhost` is shared by every Tauri app on the
 * machine, a non-browser local process can send any `Origin` value, and
 * `--allow-origin http://localhost:5173` admits any page served on that port.
 * Never relax the token check because the `Origin` check passed.
 */

import { isAbsolute, relative } from "@std/path";
import {
  type CompileResult,
  type EffectiveProfile,
  type Entry,
  formatEntryOrigin,
  type Link,
  makeDisplayId,
} from "../core/mod.ts";

/** Version of the desk API contract. Bumped on a breaking change. */
export const DESK_API_VERSION = 2;

/**
 * Link kinds that place an entry *under* its target in the product tree:
 * refinement (`Satisfies`, `Derived-from`) and verification (`Verifies`).
 * Links point from the refining/verifying entry up to its target, so a
 * node's children are its incoming links of these kinds.
 */
const TREE_LINK_KINDS: ReadonlySet<string> = new Set<string>([
  "satisfies",
  "derived-from",
  "verifies",
]);

/** One entry of the product graph. */
export interface ProductNode {
  readonly displayId: string;
  readonly title: string;
  /** Profile type name, when the entry is classified. */
  readonly type?: string;
  /** Core type the profile type ultimately extends (`Requirement`, `Risk`, `Test`, …). */
  readonly kind?: string;
  /** `"<profile-id>@<version>"` for delivered-corpus entries (ADR-030). */
  readonly origin?: string;
}

/** Link kinds that appear as the relation of a {@linkcode ProductEdge}. */
export type TreeLinkKind = "satisfies" | "derived-from" | "verifies";

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
  /** Display IDs of the entries that have no parent, then cycle roots. */
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
 * verification, then child, then relation. `roots` lists the entries with no
 * parent, then one entry per link cycle that no root reaches (lowest display
 * ID first), so no entry drops out of the graph. Edges can form a cycle (a
 * link cycle in the project); a client that walks the edges must track the
 * entries it has already visited. A client expands the graph
 * lazily from `roots` through the edges.
 */
export function buildProductTree(
  compiled: CompileResult,
  profile: EffectiveProfile | undefined,
  projectName?: string,
): ProductTree {
  const kindRank = (kind: string) => kind === "verifies" ? 1 : 0;
  // True when link `a` ranks before link `b`: kind rank, then kind name.
  const outranks = (a: Link, b: Link) =>
    (kindRank(a.kind) - kindRank(b.kind) || compareIds(a.kind, b.kind)) < 0;

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

  // One pass over the forward links. Keep the best link per (child, parent).
  const best = new Map<string, Link>();
  const hasParent = new Set<string>();
  for (const links of compiled.forward.values()) {
    for (const l of links) {
      if (
        !TREE_LINK_KINDS.has(l.kind) || !compiled.entries.has(l.from) ||
        !compiled.entries.has(l.to) || l.from === l.to
      ) continue;
      hasParent.add(l.from);
      const key = `${l.from}\u0000${l.to}`;
      const current = best.get(key);
      if (!current || outranks(l, current)) best.set(key, l);
    }
  }
  const chosen = [...best.values()].sort((a, b) =>
    compareIds(a.to, b.to) || kindRank(a.kind) - kindRank(b.kind) ||
    compareIds(a.from, b.from) || compareIds(a.kind, b.kind)
  );
  const edges: ProductEdge[] = chosen.map((l) => ({
    from: l.from,
    to: l.to,
    // TREE_LINK_KINDS filtering above guarantees one of the three kinds.
    relation: l.kind as TreeLinkKind,
  }));

  // Children by parent, in edge order, for the reachability walk.
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    const list = childrenOf.get(e.to);
    if (list) list.push(e.from);
    else childrenOf.set(e.to, [e.from]);
  }
  const reached = new Set<string>();
  const markReached = (rootId: string) => {
    const stack = [rootId];
    reached.add(rootId);
    while (stack.length > 0) {
      for (const child of childrenOf.get(stack.pop()!) ?? []) {
        if (reached.has(child)) continue;
        reached.add(child);
        stack.push(child);
      }
    }
  };
  const roots = entries.map((e) => e.displayId as string).filter((id) =>
    !hasParent.has(id)
  );
  roots.forEach(markReached);
  // An entry whose every parent chain loops back on itself has no root above
  // it. Walk in display-ID order and promote each unreached entry to a root.
  for (const entry of entries) {
    if (reached.has(entry.displayId)) continue;
    roots.push(entry.displayId);
    markReached(entry.displayId);
  }

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
      file: isAbsolute(file) ? relative(projectRoot, file) : file,
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
          "access-control-allow-headers": "Authorization",
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

    return errorResponse(404, "not-found", `No route for ${url.pathname}`);
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** Headers that let a browser on `origin` read the response. */
function corsHeaders(origin: string): Record<string, string> {
  return { "access-control-allow-origin": origin, vary: "Origin" };
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
