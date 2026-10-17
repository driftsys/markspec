import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DeskClient, DeskError, type ProductTree } from "../api/client";
import { ProductContext } from "../app/useProduct";
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
  return render(
    <ProductContext.Provider value={{ root: "/p", name: "p", client }}>
      <NavigatorPane />
    </ProductContext.Provider>,
  );
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
