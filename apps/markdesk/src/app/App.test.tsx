import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DeskClient, DeskError } from "../api/client";
import type {
  OpenedProduct,
  RecentProduct,
  ShellBridge,
} from "../shell/bridge";
import { App } from "./App";
import { useOpenProduct } from "./useProduct";

afterEach(cleanup);

function fakeBridge(
  recents: RecentProduct[],
  overrides: Partial<ShellBridge> = {},
): ShellBridge {
  return {
    openProduct: vi.fn(async (path: string): Promise<OpenedProduct> => ({
      url: "http://127.0.0.1:1",
      token: "t",
      apiVersion: 3,
      root: path,
    })),
    listRecents: vi.fn(async () => recents),
    setProductName: vi.fn(async () => {}),
    removeRecent: vi.fn(async () => {}),
    pickFolder: vi.fn(async () => null),
    openExternal: vi.fn(async () => {}),
    ...overrides,
  };
}

function fakeClient(overrides: Partial<DeskClient> = {}): DeskClient {
  return {
    tree: vi.fn(async () => ({
      apiVersion: 3 as const,
      project: { name: "Brakes" },
      roots: [],
      nodes: [],
      edges: [],
    })),
    entry: vi.fn(),
    entryHtml: vi.fn(),
    document: vi.fn(),
    file: vi.fn(),
    ...overrides,
  } as DeskClient;
}

describe("open flow", () => {
  it("shows the start screen when there are no recents", async () => {
    render(<App bridge={fakeBridge([])} createClient={() => fakeClient()} />);
    expect(await screen.findByText("MarkDesk")).toBeTruthy();
    expect(
      screen.getByText(
        "Open a product to start reading and writing requirements.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Open a product folder…")).toBeTruthy();
    expect(screen.queryByText("Recent")).toBeNull();
  });

  it("opens the first recent at launch and stores the product name", async () => {
    const bridge = fakeBridge([{
      root: "/p/brakes",
      name: null,
      exists: true,
    }]);
    render(<App bridge={bridge} createClient={() => fakeClient()} />);
    expect(await screen.findByText("Brakes")).toBeTruthy();
    expect(screen.queryByText("Open a product folder…")).toBeNull();
    expect(bridge.openProduct).toHaveBeenCalledWith("/p/brakes");
    expect(bridge.setProductName).toHaveBeenCalledWith("/p/brakes", "Brakes");
    expect(
      screen.getByText(
        "Set up an assistant to ask questions about this product.",
      ),
    ).toBeTruthy();
  });

  it("falls back to the folder name when the project has no name", async () => {
    const bridge = fakeBridge([{
      root: "/p/brakes",
      name: null,
      exists: true,
    }]);
    const client = fakeClient({
      tree: vi.fn(async () => ({
        apiVersion: 3 as const,
        project: {},
        roots: [],
        nodes: [],
        edges: [],
      })),
    });
    render(<App bridge={bridge} createClient={() => client} />);
    await waitFor(() =>
      expect(bridge.setProductName).toHaveBeenCalledWith("/p/brakes", "brakes")
    );
  });

  it("shows a missing first recent with a remove action", async () => {
    const recents = [{ root: "/gone", name: "Gone", exists: false }];
    const bridge = fakeBridge(recents);
    render(<App bridge={bridge} createClient={() => fakeClient()} />);
    expect(await screen.findByText("Recent")).toBeTruthy();
    expect(screen.getByText("folder not found")).toBeTruthy();
    expect(bridge.openProduct).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Remove from list"));
    await waitFor(() =>
      expect(bridge.removeRecent).toHaveBeenCalledWith("/gone")
    );
    await waitFor(() => expect(bridge.listRecents).toHaveBeenCalledTimes(2));
  });

  it("reports a folder that is not a product, with details", async () => {
    const bridge = fakeBridge([], {
      openProduct: vi.fn(async () => {
        throw { kind: "not-a-product", details: "no project.yaml" };
      }),
      pickFolder: vi.fn(async () => "/x"),
    });
    render(<App bridge={bridge} createClient={() => fakeClient()} />);
    fireEvent.click(await screen.findByText("Open a product folder…"));
    expect(
      await screen.findByText(
        "This folder doesn't contain a MarkSpec product.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Details")).toBeTruthy();
    expect(screen.getByText("no project.yaml")).toBeTruthy();
  });

  it("reports a generic failure for a spawn error", async () => {
    const bridge = fakeBridge([], {
      openProduct: vi.fn(async () => {
        throw { kind: "spawn-failed", details: "boom" };
      }),
      pickFolder: vi.fn(async () => "/x"),
    });
    render(<App bridge={bridge} createClient={() => fakeClient()} />);
    fireEvent.click(await screen.findByText("Open a product folder…"));
    expect(
      await screen.findByText("MarkDesk could not open this product."),
    ).toBeTruthy();
  });

  it("keeps the current product open when opening another fails", async () => {
    const openProduct = vi.fn(async (path: string): Promise<OpenedProduct> => {
      if (path === "/bad") throw { kind: "not-a-product", details: "nope" };
      return { url: "u", token: "t", apiVersion: 3, root: path };
    });
    const bridge = fakeBridge(
      [{ root: "/p/brakes", name: null, exists: true }],
      { openProduct, pickFolder: vi.fn(async () => "/bad") },
    );
    render(<App bridge={bridge} createClient={() => fakeClient()} />);
    fireEvent.click(await screen.findByText("Brakes"));
    fireEvent.click(screen.getByText("Open folder…"));
    expect(
      await screen.findByText(
        "This folder doesn't contain a MarkSpec product.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Brakes")).toBeTruthy();
    expect(screen.getByText("Details")).toBeTruthy();
  });

  it("refuses a different API version without using the client", async () => {
    const client = fakeClient();
    const bridge = fakeBridge([{ root: "/p", name: null, exists: true }], {
      openProduct: vi.fn(async () => ({
        url: "u",
        token: "t",
        apiVersion: 2,
        root: "/p",
      })),
    });
    render(<App bridge={bridge} createClient={() => client} />);
    expect(
      await screen.findByText(
        "This version of MarkDesk does not match the installed markspec.",
      ),
    ).toBeTruthy();
    expect(client.tree).not.toHaveBeenCalled();
  });

  it("offers Reopen after a network failure and reopens the product", async () => {
    const client = fakeClient({
      entry: vi.fn(async () => {
        throw new DeskError(0, "network", "fetch failed");
      }),
    });
    const bridge = fakeBridge([{
      root: "/p/brakes",
      name: null,
      exists: true,
    }]);
    function Pane() {
      const product = useOpenProduct();
      return (
        <button
          type="button"
          onClick={() => product.client.entry("X").catch(() => {})}
        >
          load
        </button>
      );
    }
    render(
      <App
        bridge={bridge}
        createClient={() => client}
        slots={{ document: <Pane /> }}
      />,
    );
    fireEvent.click(await screen.findByText("load"));
    expect(
      await screen.findByText("MarkDesk lost the connection to this product."),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Reopen"));
    await waitFor(() => expect(bridge.openProduct).toHaveBeenCalledTimes(2));
    expect(bridge.openProduct).toHaveBeenLastCalledWith("/p/brakes");
    await waitFor(() =>
      expect(
        screen.queryByText("MarkDesk lost the connection to this product."),
      ).toBeNull()
    );
  });

  it("lists recents and Open folder… in the product menu", async () => {
    const pickFolder = vi.fn(async () => null);
    const bridge = fakeBridge(
      [
        { root: "/p/brakes", name: null, exists: true },
        { root: "/p/other", name: "Other", exists: true },
      ],
      { pickFolder },
    );
    render(<App bridge={bridge} createClient={() => fakeClient()} />);
    fireEvent.click(await screen.findByText("Brakes"));
    expect(screen.getByText("Other")).toBeTruthy();
    fireEvent.click(screen.getByText("Open folder…"));
    await waitFor(() => expect(pickFolder).toHaveBeenCalled());
  });
});
