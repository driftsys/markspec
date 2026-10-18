import {
  act,
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
import { fakeAssistantBridge } from "../assistant/testBridge";
import { App } from "./App";
import { useSelection } from "./selection";
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
    ...fakeAssistantBridge(),
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

  it("shows a neutral view, not the start screen, while the launch open is pending", async () => {
    let finish!: (p: OpenedProduct) => void;
    const bridge = fakeBridge(
      [{ root: "/p/brakes", name: null, exists: true }],
      {
        openProduct: vi.fn(() =>
          new Promise<OpenedProduct>((r) => (finish = r))
        ),
      },
    );
    render(<App bridge={bridge} createClient={() => fakeClient()} />);
    expect(await screen.findByText("Opening product…")).toBeTruthy();
    expect(screen.queryByText("MarkDesk")).toBeNull();
    expect(screen.queryByText("Open a product folder…")).toBeNull();
    finish({ url: "u", token: "t", apiVersion: 3, root: "/p/brakes" });
    expect(await screen.findByText("Brakes")).toBeTruthy();
  });

  it("offers no start-screen actions while an open from the start screen is pending", async () => {
    let finish!: (p: OpenedProduct) => void;
    const bridge = fakeBridge([], {
      openProduct: vi.fn(() => new Promise<OpenedProduct>((r) => (finish = r))),
      pickFolder: vi.fn(async () => "/x"),
    });
    render(<App bridge={bridge} createClient={() => fakeClient()} />);
    fireEvent.click(await screen.findByText("Open a product folder…"));
    expect(await screen.findByText("Opening product…")).toBeTruthy();
    expect(screen.queryByText("Open a product folder…")).toBeNull();
    finish({ url: "u", token: "t", apiVersion: 3, root: "/x" });
    await screen.findByText("x");
  });

  it("keeps the product visible and disables the menu actions while another open is pending", async () => {
    let finish!: (p: OpenedProduct) => void;
    const openProduct = vi.fn(async (path: string): Promise<OpenedProduct> => {
      if (path === "/second") return new Promise((r) => (finish = r));
      return { url: "u", token: "t", apiVersion: 3, root: path };
    });
    const bridge = fakeBridge(
      [
        { root: "/p/brakes", name: null, exists: true },
        { root: "/second", name: "Second", exists: true },
      ],
      { openProduct },
    );
    render(<App bridge={bridge} createClient={() => fakeClient()} />);
    fireEvent.click(await screen.findByText("Brakes"));
    fireEvent.click(screen.getByText("Second"));
    await waitFor(() => expect(openProduct).toHaveBeenCalledWith("/second"));
    fireEvent.click(screen.getByText("Brakes"));
    expect((screen.getByText("Open folder…") as HTMLButtonElement).disabled)
      .toBe(true);
    finish({ url: "u", token: "t", apiVersion: 3, root: "/second" });
  });

  it("ignores a late network failure from a client of a previous open", async () => {
    const clients: DeskClient[] = [];
    const rejectLate: Array<() => void> = [];
    const createClient = () => {
      const c = fakeClient({
        entry: vi.fn(() =>
          new Promise<never>((_, reject) =>
            rejectLate.push(() => reject(new DeskError(0, "network", "x")))
          )
        ),
      });
      clients.push(c);
      return c;
    };
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
        createClient={createClient}
        slots={{ document: <Pane /> }}
      />,
    );
    fireEvent.click(await screen.findByText("load"));
    // Open the same product again; the first request is still pending.
    fireEvent.click(screen.getByText("Brakes"));
    fireEvent.click(screen.getByRole("menuitem", { name: "/p/brakes" }));
    await waitFor(() => expect(bridge.openProduct).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(clients.length).toBe(2));
    rejectLate[0]();
    await new Promise((r) => setTimeout(r, 20));
    expect(
      screen.queryByText("MarkDesk lost the connection to this product."),
    ).toBeNull();
  });

  it("still offers Reopen when a reopen fails", async () => {
    const client = fakeClient({
      entry: vi.fn(async () => {
        throw new DeskError(0, "network", "fetch failed");
      }),
    });
    let calls = 0;
    const bridge = fakeBridge(
      [{ root: "/p/brakes", name: null, exists: true }],
      {
        openProduct: vi.fn(async (path: string) => {
          if (++calls > 1) throw { kind: "spawn-failed", details: "down" };
          return { url: "u", token: "t", apiVersion: 3, root: path };
        }),
      },
    );
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
    fireEvent.click(await screen.findByText("Reopen"));
    expect(
      await screen.findByText("MarkDesk could not open this product."),
    ).toBeTruthy();
    expect(screen.getByText("Reopen")).toBeTruthy();
  });

  it("shows the generic message when removing a recent fails", async () => {
    const bridge = fakeBridge(
      [{ root: "/gone", name: "Gone", exists: false }],
      {
        removeRecent: vi.fn(async () => {
          throw "store failure";
        }),
      },
    );
    render(<App bridge={bridge} createClient={() => fakeClient()} />);
    fireEvent.click(await screen.findByText("Remove from list"));
    expect(
      await screen.findByText("MarkDesk could not open this product."),
    ).toBeTruthy();
    expect(screen.getByText("store failure")).toBeTruthy();
    expect(screen.getByText("Gone")).toBeTruthy();
  });

  it("shows the generic message when the folder picker fails", async () => {
    const bridge = fakeBridge([], {
      pickFolder: vi.fn(async () => {
        throw new Error("dialog failed");
      }),
    });
    render(<App bridge={bridge} createClient={() => fakeClient()} />);
    fireEvent.click(await screen.findByText("Open a product folder…"));
    expect(
      await screen.findByText("MarkDesk could not open this product."),
    ).toBeTruthy();
    expect(screen.getByText("dialog failed")).toBeTruthy();
  });

  it("keeps the current product when the shell reports a version mismatch", async () => {
    const clients: Record<string, DeskClient> = {};
    const openProduct = vi.fn(async (path: string): Promise<OpenedProduct> => {
      if (path === "/p/new") {
        throw { kind: "version-mismatch", details: "2" };
      }
      return { url: path, token: "t", apiVersion: 3, root: path };
    });
    const bridge = fakeBridge(
      [
        { root: "/p/brakes", name: null, exists: true },
        { root: "/p/new", name: "New", exists: true },
      ],
      { openProduct },
    );
    const createClient = (url: string) => {
      clients[url] = fakeClient({
        entry: vi.fn(async () => {
          throw new DeskError(404, "entry-not-found", url);
        }),
      });
      return clients[url];
    };
    function Pane() {
      const product = useOpenProduct();
      return (
        <button
          type="button"
          onClick={() => product.client.entry("X").catch(() => {})}
        >
          {`load ${product.root}`}
        </button>
      );
    }
    render(
      <App
        bridge={bridge}
        createClient={createClient}
        slots={{ document: <Pane /> }}
      />,
    );
    fireEvent.click(await screen.findByText("Brakes"));
    fireEvent.click(screen.getByRole("menuitem", { name: "New" }));
    expect(
      await screen.findByText(
        "This version of MarkDesk does not match the installed markspec.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Brakes")).toBeTruthy();
    fireEvent.click(screen.getByText("load /p/brakes"));
    await waitFor(() => expect(clients["/p/brakes"].entry).toHaveBeenCalled());
    expect(Object.keys(clients)).toEqual(["/p/brakes"]);
  });

  it("opens the new product even when its first tree load fails", async () => {
    const openProduct = vi.fn(async (path: string): Promise<OpenedProduct> => ({
      url: path,
      token: "t",
      apiVersion: 3,
      root: path,
    }));
    const bridge = fakeBridge(
      [
        { root: "/p/brakes", name: null, exists: true },
        { root: "/p/steering", name: "Steering", exists: true },
      ],
      { openProduct },
    );
    const createClient = (url: string) =>
      url === "/p/steering"
        ? fakeClient({
          tree: vi.fn(async () => {
            throw new DeskError(500, "internal", "compile failed");
          }),
        })
        : fakeClient();
    render(<App bridge={bridge} createClient={createClient} />);
    fireEvent.click(await screen.findByText("Brakes"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Steering" }));
    expect(await screen.findByText("steering")).toBeTruthy();
    expect(screen.getByText("/p/steering")).toBeTruthy();
    expect(screen.queryByText("Brakes")).toBeNull();
    expect(
      await screen.findByText("MarkDesk could not load this product."),
    ).toBeTruthy();
  });

  it("records the discovered product root, not the chosen folder", async () => {
    const bridge = fakeBridge([], {
      openProduct: vi.fn(async () => ({
        url: "u",
        token: "t",
        apiVersion: 3,
        root: "/p/brakes",
      })),
      pickFolder: vi.fn(async () => "/p/brakes/docs"),
    });
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
    fireEvent.click(await screen.findByText("Open a product folder…"));
    await waitFor(() =>
      expect(bridge.setProductName).toHaveBeenCalledWith("/p/brakes", "brakes")
    );
    expect(bridge.openProduct).toHaveBeenCalledWith("/p/brakes/docs");
    expect(await screen.findByText("brakes")).toBeTruthy();
    expect(screen.getByText("/p/brakes")).toBeTruthy();
  });

  it("resets the history on a product switch and keeps it on a reopen", async () => {
    const bridge = fakeBridge([
      { root: "/p/brakes", name: null, exists: true },
      { root: "/p/other", name: "Other", exists: true },
    ]);
    const seen: { selected?: string; select?: (id: string) => void } = {};
    function Pane() {
      const selection = useSelection();
      seen.selected = selection.selected;
      seen.select = selection.select;
      return null;
    }
    render(
      <App
        bridge={bridge}
        createClient={() => fakeClient()}
        slots={{ document: <Pane /> }}
      />,
    );
    fireEvent.click(await screen.findByText("Brakes"));
    act(() => seen.select!("SYS_1"));
    expect(seen.selected).toBe("SYS_1");
    fireEvent.click(screen.getByRole("menuitem", { name: "/p/brakes" }));
    await waitFor(() => expect(bridge.openProduct).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(bridge.listRecents).toHaveBeenCalledTimes(3));
    expect(seen.selected).toBe("SYS_1");
    fireEvent.click(screen.getByText("Brakes"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Other" }));
    await waitFor(() =>
      expect(bridge.openProduct).toHaveBeenLastCalledWith("/p/other")
    );
    await waitFor(() => expect(seen.selected).toBeUndefined());
  });

  it("falls back to the start screen with the error when the launch open fails", async () => {
    const bridge = fakeBridge(
      [{ root: "/p/brakes", name: null, exists: true }],
      {
        openProduct: vi.fn(async () => {
          throw { kind: "not-a-product", details: "no project.yaml" };
        }),
      },
    );
    render(<App bridge={bridge} createClient={() => fakeClient()} />);
    expect(
      await screen.findByText(
        "This folder doesn't contain a MarkSpec product.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Open a product folder…")).toBeTruthy();
    expect(screen.getByText("Recent")).toBeTruthy();
  });
});

describe("settings view", () => {
  it("opens Settings from the menu and returns with Back", async () => {
    const bridge = fakeBridge([{
      root: "/p/brakes",
      name: null,
      exists: true,
    }]);
    render(<App bridge={bridge} createClient={() => fakeClient()} />);
    fireEvent.click(await screen.findByText("Brakes"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeTruthy();
    expect(
      screen.queryByText(
        "Set up an assistant to ask questions about this product.",
      ),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      await screen.findByText(
        "Set up an assistant to ask questions about this product.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
  });
});
