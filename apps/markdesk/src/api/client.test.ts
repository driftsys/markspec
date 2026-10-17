import { describe, expect, it, vi } from "vitest";
import { createDeskClient, DeskError, EXPECTED_API_VERSION } from "./client";

function stub(response: Response | Error) {
  const fetchMock = vi.fn(async (_req: Request) => {
    if (response instanceof Error) throw response;
    return response;
  });
  return fetchMock;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("createDeskClient", () => {
  it("exposes the expected API version", () => {
    expect(EXPECTED_API_VERSION).toBe(3);
  });

  it("sends the bearer token", async () => {
    const f = stub(json({ nodes: [], edges: [], roots: [] }));
    await createDeskClient("http://127.0.0.1:1", "tok", f).tree();
    const req = f.mock.calls[0][0];
    expect(req.headers.get("Authorization")).toBe("Bearer tok");
    expect(new URL(req.url).pathname).toBe("/api/v1/tree");
  });

  it("encodes the entry id as one path segment", async () => {
    const f = stub(json({ displayId: "A/B" }));
    await createDeskClient("http://127.0.0.1:1", "t", f).entry("A/B");
    expect(new URL(f.mock.calls[0][0].url).pathname).toBe(
      "/api/v1/entries/A%2FB",
    );
  });

  it("requests the entry html endpoint", async () => {
    const f = stub(json({ html: "" }));
    await createDeskClient("http://127.0.0.1:1", "t", f).entryHtml("X");
    expect(new URL(f.mock.calls[0][0].url).pathname).toBe(
      "/api/v1/entries/X/html",
    );
  });

  it("encodes the document path query", async () => {
    const f = stub(json({}));
    await createDeskClient("http://127.0.0.1:1", "t", f).document(
      "docs/a b.md",
    );
    const url = new URL(f.mock.calls[0][0].url);
    expect(url.pathname).toBe("/api/v1/documents");
    expect(url.searchParams.get("path")).toBe("docs/a b.md");
    expect(url.search).not.toContain(" ");
  });

  it("requests a source file by path query", async () => {
    const f = stub(json({}));
    await createDeskClient("http://127.0.0.1:1", "t", f).file("src/x.rs");
    const url = new URL(f.mock.calls[0][0].url);
    expect(url.pathname).toBe("/api/v1/files");
    expect(url.searchParams.get("path")).toBe("src/x.rs");
  });

  it("maps a 404 error body to DeskError", async () => {
    const f = stub(
      json({ error: { code: "not-found", message: "no such entry" } }, 404),
    );
    const err = await createDeskClient("http://127.0.0.1:1", "t", f)
      .entry("Z").catch((e) => e);
    expect(err).toBeInstanceOf(DeskError);
    expect(err).toMatchObject({
      status: 404,
      code: "not-found",
      message: "no such entry",
    });
  });

  it("maps a fetch failure to a network DeskError", async () => {
    const f = stub(new TypeError("boom"));
    const err = await createDeskClient("http://127.0.0.1:1", "t", f)
      .tree().catch((e) => e);
    expect(err).toBeInstanceOf(DeskError);
    expect(err).toMatchObject({ status: 0, code: "network" });
  });
});
