import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductMenu } from "./ProductMenu";

afterEach(cleanup);

function mount(onSettings = vi.fn()) {
  return render(
    <div>
      <ProductMenu
        productName="Brakes"
        productRoot="/p/brakes"
        recents={[{ root: "/p/other", name: "Other", exists: true }]}
        onPick={vi.fn()}
        onOpenRecent={vi.fn()}
        onSettings={onSettings}
      />
      <p>outside</p>
    </div>,
  );
}

describe("ProductMenu", () => {
  it("Settings calls onSettings and closes the menu", () => {
    const onSettings = vi.fn();
    mount(onSettings);
    fireEvent.click(screen.getByText("Brakes"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Open folder…")).toBeNull();
  });

  it("shows the name with a caret and the path in small text", () => {
    mount();
    const trigger = screen.getByRole("button", { expanded: false });
    expect(trigger.textContent).toContain("▾");
    expect(trigger.textContent).toContain("Brakes");
    const path = screen.getByText("/p/brakes");
    expect(path.className).toBe("product-path");
  });

  it("closes on Escape", () => {
    mount();
    fireEvent.click(screen.getByText("Brakes"));
    expect(screen.getByText("Open folder…")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Open folder…")).toBeNull();
  });

  it("closes on a click outside the menu", () => {
    mount();
    fireEvent.click(screen.getByText("Brakes"));
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.queryByText("Open folder…")).toBeNull();
  });

  it("stays open on a click inside the menu", () => {
    mount();
    fireEvent.click(screen.getByText("Brakes"));
    fireEvent.mouseDown(screen.getByText("Other"));
    expect(screen.getByText("Open folder…")).toBeTruthy();
  });
});
