import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RefreshProvider, useRefresh } from "./refresh";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("stops counting window focus after unmount", () => {
  const added = vi.spyOn(globalThis, "addEventListener");
  const removed = vi.spyOn(globalThis, "removeEventListener");
  function Probe() {
    return <output>{useRefresh().revision}</output>;
  }
  const { unmount } = render(
    <RefreshProvider>
      <Probe />
    </RefreshProvider>,
  );
  expect(screen.getByRole("status").textContent).toBe("0");
  act(() => globalThis.dispatchEvent(new Event("focus")));
  expect(screen.getByRole("status").textContent).toBe("1");
  const listener = added.mock.calls.find(([type]) => type === "focus")![1];
  expect(listener).toBeTypeOf("function");
  unmount();
  expect(removed).toHaveBeenCalledWith("focus", listener);
});
