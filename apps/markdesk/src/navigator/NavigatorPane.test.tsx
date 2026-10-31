import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DeskClient, DeskError, type ProductTree } from "../api/client";
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

function pane(tree: () => Promise<ProductTree>) {
  const client = { tree } as unknown as DeskClient;
  const view = (current: DeskClient) => (
    <ProductContext.Provider
      value={{ root: "/p", name: "p", client: current }}
    >
      <HistoryProvider mac={false}>
        <NavigatorPane />
      </HistoryProvider>
    </ProductContext.Provider>
  );
  const result = render(view(client));
  // Open another product in the same pane.
  const reopen = (other: () => Promise<ProductTree>) =>
    result.rerender(view({ tree: other } as unknown as DeskClient));
  return { ...result, reopen };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => {
    resolve = ok;
  });
  return { promise, resolve };
}

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

describe("NavigatorPane refresh on window focus", () => {
  const focus = () =>
    act(() => {
      globalThis.dispatchEvent(new Event("focus"));
    });

  it("shows an entry added on disk after the window gets focus", async () => {
    const trees = [
      tree([{ displayId: "A", title: "a" }], [], ["A"]),
      tree(
        [{ displayId: "A", title: "a" }, { displayId: "B", title: "b" }],
        [],
        ["A", "B"],
      ),
    ];
    const load = vi.fn(async () => trees.shift() ?? trees[0]);
    pane(load);
    await screen.findByText("A");
    expect(screen.queryByText("B")).toBeNull();
    await focus();
    expect(await screen.findByText("B")).toBeTruthy();
  });

  it("drops an entry removed on disk after the window gets focus", async () => {
    let shown = [{ displayId: "A", title: "a" }, {
      displayId: "B",
      title: "b",
    }];
    pane(async () => tree(shown, [], shown.map((n) => n.displayId)));
    await screen.findByText("B");
    shown = [{ displayId: "A", title: "a" }];
    await focus();
    await waitFor(() => expect(screen.queryByText("B")).toBeNull());
    expect(screen.getByText("A")).toBeTruthy();
  });

  it("keeps expanded nodes and the selection when focus finds a new entry", async () => {
    const nodes = [{ displayId: "P", title: "p" }, {
      displayId: "R1",
      title: "r",
    }];
    const edges = [{ from: "R1", to: "P", relation: "satisfies" }];
    let added = false;
    const load = vi.fn(async () =>
      added
        ? tree([...nodes, { displayId: "Q", title: "q" }], edges, ["P", "Q"])
        : tree(nodes, edges, ["P"])
    );
    pane(load);
    fireEvent.click(await screen.findByText("P"));
    fireEvent.click(screen.getByText("R1"));
    added = true;
    await focus();
    await screen.findByText("Q");
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 10));
    const item = (id: string) =>
      screen.getByText(id).closest("[role=treeitem]")!;
    expect(item("P").getAttribute("aria-expanded")).toBe("true");
    expect(item("R1").getAttribute("aria-selected")).toBe("true");
    expect(item("P").getAttribute("aria-selected")).toBe("false");
  });

  it("ignores an older load that resolves after a newer one", async () => {
    const one = (id: string) =>
      tree([{ displayId: id, title: `title of ${id}` }], [], [id]);
    const slow = deferred<ProductTree>();
    const answers = [
      Promise.resolve(one("FIRST")),
      slow.promise,
      Promise.resolve(one("NEWEST")),
    ];
    const load = vi.fn(() => answers.shift()!);
    pane(load);
    await screen.findByText("FIRST");
    await focus();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await focus();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    await screen.findByText("NEWEST");
    await act(async () => slow.resolve(one("STALE")));
    expect(screen.queryByText("STALE")).toBeNull();
    expect(screen.getByText("NEWEST")).toBeTruthy();
  });

  it("clears a load failure of the previous product when another opens", async () => {
    const { reopen } = pane(async () => {
      throw new DeskError(500, "internal", "boom");
    });
    await screen.findByRole("alert");
    reopen(() => new Promise<ProductTree>(() => {}));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("ignores a late failure of the previous product", async () => {
    let fail!: (error: unknown) => void;
    const { reopen } = pane(() =>
      new Promise<ProductTree>((_, reject) => {
        fail = reject;
      })
    );
    let show!: (loaded: ProductTree) => void;
    reopen(() =>
      new Promise<ProductTree>((resolve) => {
        show = resolve;
      })
    );
    // The new product is still loading when the old load fails.
    await act(async () => fail(new DeskError(500, "internal", "boom")));
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () =>
      show(tree([{ displayId: "NEW", title: "n" }], [], ["NEW"]))
    );
    expect(screen.getByText("NEW")).toBeTruthy();
  });

  it("drops the previous product's tree when another product opens", async () => {
    const { reopen } = pane(async () =>
      tree([{ displayId: "OLD", title: "o" }], [], ["OLD"])
    );
    await screen.findByText("OLD");
    const pending = deferred<ProductTree>();
    reopen(() => pending.promise);
    await waitFor(() => expect(screen.queryByText("OLD")).toBeNull());
    await act(async () =>
      pending.resolve(tree([{ displayId: "NEW", title: "n" }], [], ["NEW"]))
    );
    expect(screen.getByText("NEW")).toBeTruthy();
  });

  it("keeps the shown tree when a refresh fails", async () => {
    let fail = false;
    const load = vi.fn(async () => {
      if (fail) throw new DeskError(500, "internal", "boom");
      return tree([{ displayId: "A", title: "a" }], [], ["A"]);
    });
    pane(load);
    await screen.findByText("A");
    fail = true;
    await focus();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
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
