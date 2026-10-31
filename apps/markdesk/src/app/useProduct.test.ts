import { describe, expect, it, vi } from "vitest";
import { type CachedDocument, type DeskClient, DeskError } from "../api/client";
import { watchConnection } from "./useProduct";

const cached: CachedDocument = {
  view: { apiVersion: 3, path: "d.md", html: "<p>x</p>", entries: [] },
  etag: '"e1"',
};

function client(overrides: Partial<DeskClient>): DeskClient {
  return {
    tree: vi.fn(),
    entry: vi.fn(),
    entryHtml: vi.fn(),
    document: vi.fn(),
    file: vi.fn(),
    ...overrides,
  } as DeskClient;
}

describe("watchConnection", () => {
  it("passes the cached render through to the client", async () => {
    const document = vi.fn(async (_path: string, given?: CachedDocument) =>
      given!
    );
    const watched = watchConnection(client({ document }), () => {});
    expect(await watched.document("d.md", cached)).toBe(cached);
    expect(document).toHaveBeenCalledWith("d.md", cached);
  });

  it("reports a lost connection on a network failure", async () => {
    const onLost = vi.fn();
    const watched = watchConnection(
      client({
        document: vi.fn(async () => {
          throw new DeskError(0, "network", "down");
        }),
      }),
      onLost,
    );
    await expect(watched.document("d.md")).rejects.toThrow("down");
    expect(onLost).toHaveBeenCalledOnce();
  });
});
