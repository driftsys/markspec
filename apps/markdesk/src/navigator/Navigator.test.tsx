import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductTree } from "../api/client";
import { Navigator } from "./Navigator";
import { buildNavigatorModel, compareDisplayIds } from "./model";

afterEach(cleanup);

const node = (displayId: string, extra = {}) => ({
  displayId,
  title: `T ${displayId}`,
  ...extra,
});
const tree = (
  ids: string[],
  roots: string[],
  edges: [string, string, string][],
  nodes = ids.map((id) => node(id)),
): ProductTree =>
  ({
    apiVersion: 3,
    project: {},
    roots,
    nodes,
    edges: edges.map(([from, to, relation]) => ({ from, to, relation })),
  }) as ProductTree;

describe("model", () => {
  it("sorts naturally", () => {
    expect(["SRS_10", "SRS_2"].sort(compareDisplayIds)).toEqual([
      "SRS_2",
      "SRS_10",
    ]);
  });

  it("groups refining before verifying and sorts each", () => {
    const m = buildNavigatorModel(tree(
      ["P", "C10", "C2", "V1"],
      ["P"],
      [["C10", "P", "satisfies"], ["V1", "P", "verifies"], [
        "C2",
        "P",
        "derived-from",
      ]],
    ));
    expect(m.children("P")).toEqual({
      refining: ["C2", "C10"],
      verifying: ["V1"],
    });
  });

  it("lists a multi-parent node under both parents", () => {
    const m = buildNavigatorModel(tree(
      ["A", "B", "X"],
      ["A", "B"],
      [["X", "A", "satisfies"], ["X", "B", "satisfies"]],
    ));
    expect(m.children("A").refining).toEqual(["X"]);
    expect(m.children("B").refining).toEqual(["X"]);
  });
});

describe("Navigator", () => {
  it("expands a cycle one level per click", () => {
    const m = buildNavigatorModel(tree(
      ["A", "B", "R"],
      ["A", "R"],
      [["B", "A", "satisfies"], ["A", "B", "satisfies"]],
    ));
    render(<Navigator model={m} onSelect={() => {}} />);
    expect(screen.getAllByText("A")).toHaveLength(1);
    fireEvent.click(screen.getByText("A"));
    expect(screen.getAllByText("B")).toHaveLength(1);
    fireEvent.click(screen.getByText("B"));
    expect(screen.getAllByText("A")).toHaveLength(2);
    expect(screen.getAllByText("B")).toHaveLength(1);
  });

  it("selects with the raw display ID including a slash", () => {
    const onSelect = vi.fn();
    const m = buildNavigatorModel(tree(["SRS/1"], ["SRS/1"], []));
    render(<Navigator model={m} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("SRS/1"));
    expect(onSelect).toHaveBeenCalledWith("SRS/1");
  });

  it("shows the origin badge and the empty message", () => {
    const m = buildNavigatorModel(
      tree(["A"], ["A"], [], [node("A", { origin: "p@1" })]),
    );
    const { unmount } = render(<Navigator model={m} onSelect={() => {}} />);
    expect(screen.getByText("p@1")).toBeTruthy();
    unmount();
    render(
      <Navigator
        model={buildNavigatorModel(tree([], [], []))}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("This product has no requirements yet."))
      .toBeTruthy();
  });
});
