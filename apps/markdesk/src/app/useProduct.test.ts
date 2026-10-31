import { describe, expect, it, vi } from "vitest";
import {
  type CachedDocument,
  type CachedTree,
  type DeskClient,
  DeskError,
} from "../api/client";
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
    previewProposal: vi.fn(),
    applyProposal: vi.fn(),
    ...overrides,
  } as DeskClient;
}

describe("watchConnection", () => {
  it("passes the cached tree through to the client", async () => {
    const held = {
      view: { apiVersion: 3, project: {}, roots: [], nodes: [], edges: [] },
      etag: '"t1"',
    } as CachedTree;
    const tree = vi.fn(async (given?: CachedTree) => given!);
    const watched = watchConnection(client({ tree }), () => {});
    expect(await watched.tree(held)).toBe(held);
    expect(tree).toHaveBeenCalledWith(held);
  });

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

  it("passes proposal calls through and reports a lost connection", async () => {
    const changes = [{ displayId: "A_1", kind: "body" as const, body: "x" }];
    const preview = { apiVersion: 3 as const, changes: [] };
    const previewProposal = vi.fn(async () => preview);
    const applyProposal = vi.fn(async () => {
      throw new DeskError(0, "network", "down");
    });
    const onLost = vi.fn();
    const watched = watchConnection(
      client({ previewProposal, applyProposal }),
      onLost,
    );
    expect(await watched.previewProposal('"e1"', changes)).toBe(preview);
    expect(previewProposal).toHaveBeenCalledWith('"e1"', changes);
    expect(onLost).not.toHaveBeenCalled();
    await expect(watched.applyProposal('"e1"', changes)).rejects.toThrow(
      "down",
    );
    expect(applyProposal).toHaveBeenCalledWith('"e1"', changes);
    expect(onLost).toHaveBeenCalledOnce();
  });
});
