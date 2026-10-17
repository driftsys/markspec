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
 * Every request must carry `Authorization: Bearer <token>` and a loopback
 * `Host` header (DNS-rebinding guard). Errors are `{ error: { code, message } }`.
 *
 * Origin policy (CORS): a request with no `Origin` header (CLI tools, curl)
 * is unaffected. A request with an `Origin` header must name an allowed
 * origin — {@linkcode TAURI_ORIGINS} plus `allowedOrigins` — or it gets 403
 * `forbidden-origin`. An `OPTIONS` preflight from an allowed origin gets 204
 * before the bearer check, because browsers send no `Authorization` header on
 * a preflight. Every other response to an allowed origin carries
 * `Access-Control-Allow-Origin` and `Vary: Origin`, so the UI can read error
 * bodies too.
 *
 * The `Origin` check is not an authentication boundary. The per-launch nonce
 * token is the only credential. The check only limits which browser pages can
 * call the API: `tauri://localhost` is shared by every Tauri app on the
 * machine, a non-browser local process can send any `Origin` value, and
 * `--allow-origin http://localhost:5173` admits any page served on that port.
 * Never relax the token check on the strength of the `Origin` check.
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
export const DESK_API_VERSION = 1;

/**
 * Link kinds that place an entry *under* its target in the product tree:
 * refinement (`Satisfies`, `Derived-from`) and verification (`Verifies`).
 * Links point from the refining/verifying entry up to its target, so a
 * node's children are its incoming links of these kinds.
 */
const TREE_LINK_KINDS: ReadonlySet<string> = new Set([
  "satisfies",
  "derived-from",
  "verifies",
]);

/** One node of the product tree. */
export interface TreeNode {
  readonly displayId: string;
  readonly title: string;
  /** Profile type name, when the entry is classified. */
  readonly type?: string;
  /** Core type the profile type ultimately extends (`Requirement`, `Risk`, `Test`, …). */
  readonly kind?: string;
  /** Link kind that places this node under its parent. Absent on roots. */
  readonly relation?: string;
  /** `"<profile-id>@<version>"` for delivered-corpus entries (ADR-030). */
  readonly origin?: string;
  readonly children: readonly TreeNode[];
}

/** `GET /api/v1/tree` response. */
export interface ProductTree {
  readonly apiVersion: number;
  readonly project: { readonly name?: string };
  readonly nodes: readonly TreeNode[];
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
 * Build the product tree: the traceability graph read top-down. Roots are
 * entries with no refinement or verification link to another entry in the
 * graph (stakeholder needs, hazards, orphans), plus one entry per link cycle
 * that no root reaches; each node's children are the
 * entries that satisfy, derive from, or verify it. The graph is a DAG, so
 * an entry with two parents appears under both. A link cycle is cut at the
 * repeat. Siblings sort refinement-before-verification, then by display ID,
 * so the output is deterministic.
 */
export function buildProductTree(
  compiled: CompileResult,
  profile: EffectiveProfile | undefined,
  projectName?: string,
): ProductTree {
  const treeLinks = (links: readonly Link[] | undefined) =>
    (links ?? []).filter((l) =>
      TREE_LINK_KINDS.has(l.kind) && compiled.entries.has(l.from) &&
      compiled.entries.has(l.to) && l.from !== l.to
    );

  const kindRank = (kind: string) => kind === "verifies" ? 1 : 0;

  const toNode = (
    entry: Entry,
    relation: string | undefined,
    ancestors: ReadonlySet<string>,
  ): TreeNode => {
    const path = new Set(ancestors).add(entry.displayId);
    const seenChildren = new Set<string>();
    const childLinks = treeLinks(compiled.reverse.get(entry.displayId))
      .filter((l) => !path.has(l.from))
      .sort((a, b) =>
        kindRank(a.kind) - kindRank(b.kind) || compareIds(a.from, b.from)
      )
      .filter((l) => {
        if (seenChildren.has(l.from)) return false;
        seenChildren.add(l.from);
        return true;
      });
    const children = childLinks.map((l) =>
      toNode(compiled.entries.get(l.from)!, l.kind, path)
    );
    return compact({
      displayId: entry.displayId,
      title: entry.title,
      type: entry.type,
      kind: coreKindOf(entry.type, profile),
      relation,
      origin: entry.origin ? formatEntryOrigin(entry.origin) : undefined,
      children,
    });
  };

  const byId = (a: Entry, b: Entry) => compareIds(a.displayId, b.displayId);
  const roots = [...compiled.entries.values()]
    .filter((e) => treeLinks(compiled.forward.get(e.displayId)).length === 0)
    .sort(byId);
  const nodes = roots.map((e) => toNode(e, undefined, new Set()));

  // An entry whose every parent chain loops back on itself (a link cycle)
  // has no root above it. Surface each unreached entry as a root, lowest
  // display ID first, so no entry silently drops out of the tree.
  const reached = new Set<string>();
  const markReached = (node: TreeNode) => {
    reached.add(node.displayId);
    node.children.forEach(markReached);
  };
  nodes.forEach(markReached);
  for (const entry of [...compiled.entries.values()].sort(byId)) {
    if (reached.has(entry.displayId)) continue;
    const node = toNode(entry, undefined, new Set());
    markReached(node);
    nodes.push(node);
  }

  return {
    apiVersion: DESK_API_VERSION,
    project: compact({ name: projectName }),
    nodes,
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
