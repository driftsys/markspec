import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CachedTree,
  type DeskClient,
  DeskError,
  type ProductTree,
} from "../api/client";
import { RefreshProvider } from "../app/refresh";
import { ProductContext } from "../app/useProduct";
import { HistoryProvider } from "../document/useHistory";
import { Navigator, NavigatorPane } from "./Navigator";
import { buildNavigatorModel } from "./model";

afterEach(cleanup);

const tree = (
  nodes: Record<string, unknown>[],
  edges: { from: string; to: string; relation: string }[],
  roots: string[],
) => ({ apiVersion: 3, project: {}, roots, nodes, edges }) as ProductTree;

const cachedTree = (t: ProductTree, etag = '"t"'): CachedTree => ({
  view: t,
  etag,
});

function pane(tree: () => Promise<ProductTree>) {
  return mount(async () => cachedTree(await tree()));
}

/** Mount the pane over a client whose `tree` is the given function. */
function mount(tree: (cached?: CachedTree) => Promise<CachedTree>) {
  const client = { tree } as unknown as DeskClient;
  return render(
    <ProductContext.Provider value={{ root: "/p", name: "p", client }}>
      <HistoryProvider mac={false}>
        <RefreshProvider>
          <NavigatorPane />
        </RefreshProvider>
      </HistoryProvider>
    </ProductContext.Provider>,
  );
}

const focusWindow = () => globalThis.dispatchEvent(new Event("focus"));

describe("NavigatorPane", () => {
  it("renders rows on success", async () => {
    pane(async () => tree([{ displayId: "A", title: "a" }], [], ["A"]));
    expect(await screen.findByText("A")).toBeTruthy();
  });

  it("shows no pane error for a network failure", async () => {
    const tree = vi.fn(async () => {
      throw new DeskError(0, "network", "down");
    });
    pane(tree);
    await waitFor(() => expect(tree).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText("MarkDesk could not load this product."))
      .toBeNull();
  });

  it("shows the message for a server error", async () => {
    pane(async () => {
      throw new DeskError(500, "internal", "boom");
    });
    expect(await screen.findByText("MarkDesk could not load this product."))
      .toBeTruthy();
  });
});

describe("NavigatorPane refresh", () => {
  const parent = { displayId: "P", title: "p" };
  const child = { displayId: "R1", title: "r" };
  const edge = { from: "R1", to: "P", relation: "satisfies" };

  it("shows an entry added on disk when the window gets focus", async () => {
    const trees = [
      cachedTree(tree([parent], [], ["P"]), '"1"'),
      cachedTree(tree([parent, child], [edge], ["P"]), '"2"'),
    ];
    const client = vi.fn(async (_cached?: CachedTree) => trees.shift()!);
    mount(client);
    expect(await screen.findByText("P")).toBeTruthy();
    focusWindow();
    await waitFor(() => expect(client).toHaveBeenCalledTimes(2));
    expect(client.mock.calls[1][0]?.etag).toBe('"1"');
    fireEvent.click(screen.getByText("P"));
    expect(await screen.findByText("R1")).toBeTruthy();
  });

  it("drops a removed entry, even when it is selected", async () => {
    const trees = [
      cachedTree(tree([parent, child], [edge], ["P"]), '"1"'),
      cachedTree(tree([parent], [], ["P"]), '"2"'),
    ];
    const client = vi.fn(async () => trees.shift()!);
    mount(client);
    fireEvent.click(await screen.findByText("P"));
    fireEvent.click(await screen.findByText("R1"));
    expect(screen.getByText("R1").closest("[role=treeitem]")!
      .getAttribute("aria-selected")).toBe("true");
    focusWindow();
    await waitFor(() => expect(screen.queryByText("R1")).toBeNull());
    expect(screen.getByText("P")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps expanded rows and the selection when the tree is unchanged", async () => {
    const first = cachedTree(tree([parent, child], [edge], ["P"]), '"1"');
    const client = vi.fn(async (cached?: CachedTree) =>
      cached?.etag === '"1"' ? cached : first
    );
    mount(client);
    fireEvent.click(await screen.findByText("P"));
    fireEvent.click(await screen.findByText("R1"));
    focusWindow();
    await waitFor(() => expect(client).toHaveBeenCalledTimes(2));
    expect(client.mock.calls[1][0]).toBe(first);
    expect(screen.getByText("R1")).toBeTruthy();
    expect(screen.getByText("R1").closest("[role=treeitem]")!
      .getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the shown tree when a refresh fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    const client = vi.fn(async () => {
      if (calls++ === 0) return cachedTree(tree([parent], [], ["P"]));
      throw new DeskError(500, "internal", "boom");
    });
    mount(client);
    expect(await screen.findByText("P")).toBeTruthy();
    focusWindow();
    // The failed check is reported once it has settled.
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(screen.getByText("P")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    warn.mockRestore();
  });

  it("clears a load failure when a later refresh succeeds", async () => {
    let calls = 0;
    const client = vi.fn(async () => {
      if (calls++ === 0) throw new DeskError(500, "internal", "boom");
      return cachedTree(tree([parent], [], ["P"]));
    });
    mount(client);
    expect(await screen.findByText("MarkDesk could not load this product."))
      .toBeTruthy();
    focusWindow();
    expect(await screen.findByText("P")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  type TreeCall = (cached?: CachedTree) => Promise<CachedTree>;
  const view = (tree: TreeCall) => (
    <ProductContext.Provider
      value={{
        root: "/p",
        name: "p",
        client: { tree } as unknown as DeskClient,
      }}
    >
      <HistoryProvider mac={false}>
        <RefreshProvider>
          <NavigatorPane />
        </RefreshProvider>
      </HistoryProvider>
    </ProductContext.Provider>
  );
  const deferredTree = () => {
    let resolve!: (t: CachedTree) => void;
    const promise = new Promise<CachedTree>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("never sends the tree of another product's client", async () => {
    const one = vi.fn(async (_cached?: CachedTree) =>
      cachedTree(tree([parent], [], ["P"]), '"1"')
    );
    const two = vi.fn(async (_cached?: CachedTree) =>
      cachedTree(tree([child], [], ["R1"]), '"2"')
    );
    const { rerender } = render(view(one));
    expect(await screen.findByText("P")).toBeTruthy();
    rerender(view(two));
    expect(await screen.findByText("R1")).toBeTruthy();
    expect(two).toHaveBeenCalledTimes(1);
    expect(two.mock.calls[0][0]).toBeUndefined();
  });

  it("clears the old tree and its failure when the client changes", async () => {
    const pending = deferredTree();
    const failing = vi.fn(async (_cached?: CachedTree): Promise<CachedTree> => {
      throw new DeskError(500, "internal", "boom");
    });
    const { rerender } = render(view(failing));
    expect(await screen.findByText("MarkDesk could not load this product."))
      .toBeTruthy();
    rerender(view(() => pending.promise));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText("…")).toBeTruthy();
    await act(async () => {
      pending.resolve(cachedTree(tree([parent], [], ["P"])));
    });
    expect(await screen.findByText("P")).toBeTruthy();
    const later = deferredTree();
    rerender(view(() => later.promise));
    await waitFor(() => expect(screen.queryByText("P")).toBeNull());
    expect(screen.getByText("…")).toBeTruthy();
  });

  it("ignores a late tree from the previous client", async () => {
    const late = deferredTree();
    const { rerender } = render(view(() => late.promise));
    rerender(view(async () => cachedTree(tree([child], [], ["R1"]))));
    expect(await screen.findByText("R1")).toBeTruthy();
    await act(async () => {
      late.resolve(cachedTree(tree([parent], [], ["P"])));
    });
    expect(screen.queryByText("P")).toBeNull();
    expect(screen.getByText("R1")).toBeTruthy();
  });

  it("keeps rows expanded when the tree changes around them", async () => {
    const other = { displayId: "R2", title: "r2" };
    const trees = [
      cachedTree(tree([parent, child], [edge], ["P"]), '"1"'),
      cachedTree(
        tree([parent, child, other], [edge, {
          from: "R2",
          to: "P",
          relation: "satisfies",
        }], ["P"]),
        '"2"',
      ),
    ];
    const client = vi.fn(async (_cached?: CachedTree) => trees.shift()!);
    mount(client);
    fireEvent.click(await screen.findByText("P"));
    expect(screen.getByText("R1")).toBeTruthy();
    focusWindow();
    expect(await screen.findByText("R2")).toBeTruthy();
    expect(screen.getByText("R1")).toBeTruthy();
  });
});

describe("Navigator behaviour", () => {
  const t = tree(
    [
      { displayId: "P", title: "p" },
      { displayId: "R1", title: "r", type: "swe" },
      { displayId: "V1", title: "v", kind: "Test", type: "x" },
    ],
    [
      { from: "R1", to: "P", relation: "satisfies" },
      { from: "V1", to: "P", relation: "verifies" },
    ],
    ["P"],
  );

  it("orders refining, separator, verifying and toggles aria-expanded", () => {
    render(
      <Navigator model={buildNavigatorModel(t)} onSelect={() => {}} />,
    );
    const item = screen.getByText("P").closest("[role=treeitem]")!;
    expect(item.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByText("P"));
    expect(item.getAttribute("aria-expanded")).toBe("true");
    const group = item.querySelector("[role=group]")!;
    const kinds = [...group.children].map((c) =>
      c.getAttribute("role") === "separator"
        ? "sep"
        : c.querySelector(".display-id")!.textContent
    );
    expect(kinds).toEqual(["R1", "sep", "V1"]);
    fireEvent.click(screen.getByText("P"));
    expect(item.getAttribute("aria-expanded")).toBe("false");
  });

  it("Enter and Space select and toggle", () => {
    const onSelect = vi.fn();
    render(<Navigator model={buildNavigatorModel(t)} onSelect={onSelect} />);
    const row = screen.getByText("P").closest(".navigator-row")!;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("P");
    expect(screen.getByText("R1")).toBeTruthy();
    fireEvent.keyDown(row, { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("R1")).toBeNull();
  });

  it("type mark falls back to type when kind is absent", () => {
    render(<Navigator model={buildNavigatorModel(t)} onSelect={() => {}} />);
    fireEvent.click(screen.getByText("P"));
    const mark = (id: string) =>
      screen.getByText(id).closest(".navigator-row")!
        .querySelector(".type-mark")!.getAttribute("data-kind");
    expect(mark("R1")).toBe("swe");
    expect(mark("V1")).toBe("Test");
  });

  it("ignores dangling edges", () => {
    const m = buildNavigatorModel(
      tree(
        [{ displayId: "P", title: "p" }],
        [{ from: "GONE", to: "P", relation: "satisfies" }],
        ["P"],
      ),
    );
    expect(m.children("P").refining).toEqual([]);
  });
});
