import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export type ProductTree = components["schemas"]["ProductTree"];
export type ProductNode = components["schemas"]["ProductNode"];
export type ProductEdge = components["schemas"]["ProductEdge"];
export type EntryView = components["schemas"]["EntryView"];
export type LinkView = components["schemas"]["LinkView"];
export type EntryHtmlView = components["schemas"]["EntryHtmlView"];
export type DocumentView = components["schemas"]["DocumentView"];
export type SourceText = components["schemas"]["SourceText"];

/** The desk API version this client was generated against. */
export const EXPECTED_API_VERSION = 3;

/** Failure of a desk API call. `status` is 0 for a network failure. */
export class DeskError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "DeskError";
    this.status = status;
    this.code = code;
  }
}

/** Typed access to the `markspec desk --serve` API. */
export interface DeskClient {
  tree(): Promise<ProductTree>;
  entry(id: string): Promise<EntryView>;
  entryHtml(id: string): Promise<EntryHtmlView>;
  document(path: string): Promise<DocumentView>;
  file(path: string): Promise<SourceText>;
}

interface Outcome<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

function errorFrom(outcome: { error?: unknown; response: Response }) {
  const body = outcome.error as
    | { error?: { code?: string; message?: string } }
    | undefined;
  return new DeskError(
    outcome.response.status,
    body?.error?.code ?? "http",
    body?.error?.message ?? outcome.response.statusText,
  );
}

/**
 * Create a client for the desk API at `baseUrl`, authenticated with the
 * bearer `token`. `fetchImpl` defaults to the global `fetch`.
 */
export function createDeskClient(
  baseUrl: string,
  token: string,
  fetchImpl?: (request: Request) => Promise<Response>,
): DeskClient {
  const client = createClient<paths>({
    baseUrl,
    headers: { Authorization: `Bearer ${token}` },
    fetch: fetchImpl ?? ((request) => fetch(request)),
  });

  async function run<T>(call: () => Promise<Outcome<T>>): Promise<T> {
    let outcome: Outcome<T>;
    try {
      outcome = await call();
    } catch (cause) {
      throw new DeskError(
        0,
        "network",
        cause instanceof Error ? cause.message : String(cause),
      );
    }
    if (!outcome.response.ok || outcome.data === undefined) {
      throw errorFrom(outcome);
    }
    return outcome.data;
  }

  return {
    tree: () => run(() => client.GET("/api/v1/tree")),
    entry: (id) =>
      run(() =>
        client.GET("/api/v1/entries/{id}", { params: { path: { id } } })
      ),
    entryHtml: (id) =>
      run(() =>
        client.GET("/api/v1/entries/{id}/html", { params: { path: { id } } })
      ),
    document: (path) =>
      run(() =>
        client.GET("/api/v1/documents", { params: { query: { path } } })
      ),
    file: (path) =>
      run(() => client.GET("/api/v1/files", { params: { query: { path } } })),
  };
}
