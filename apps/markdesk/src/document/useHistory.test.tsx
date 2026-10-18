import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  type History,
  historyKeyAction,
  HistoryProvider,
  useHistory,
} from "./useHistory";

afterEach(cleanup);

function harness(mac = false) {
  const seen: { history?: History } = {};
  function Probe() {
    seen.history = useHistory();
    return null;
  }
  render(
    <HistoryProvider mac={mac}>
      <Probe />
    </HistoryProvider>,
  );
  return () => seen.history!;
}

describe("useHistory", () => {
  it("starts empty", () => {
    const history = harness();
    expect(history().current).toBeUndefined();
    expect(history().canBack).toBe(false);
    expect(history().canForward).toBe(false);
  });

  it("walks back and forward through selections", () => {
    const history = harness();
    act(() => history().select("A"));
    act(() => history().select("B"));
    act(() => history().select("C"));
    expect(history().current).toBe("C");
    act(() => history().back());
    expect(history().current).toBe("B");
    act(() => history().back());
    expect(history().current).toBe("A");
    expect(history().canBack).toBe(false);
    act(() => history().back());
    expect(history().current).toBe("A");
    act(() => history().forward());
    expect(history().current).toBe("B");
    expect(history().canForward).toBe(true);
  });

  it("drops the forward entries when a new item is selected", () => {
    const history = harness();
    act(() => history().select("A"));
    act(() => history().select("B"));
    act(() => history().back());
    act(() => history().select("C"));
    expect(history().canForward).toBe(false);
    act(() => history().back());
    expect(history().current).toBe("A");
  });

  it("ignores selecting the current item again", () => {
    const history = harness();
    act(() => history().select("A"));
    act(() => history().select("A"));
    expect(history().canBack).toBe(false);
  });

  it("Alt+Left and Alt+Right walk the history", () => {
    const history = harness();
    act(() => history().select("A"));
    act(() => history().select("B"));
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    expect(history().current).toBe("A");
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    expect(history().current).toBe("B");
  });

  it("Cmd+[ and Cmd+] walk the history on macOS", () => {
    const history = harness(true);
    act(() => history().select("A"));
    act(() => history().select("B"));
    fireEvent.keyDown(window, { key: "[", metaKey: true });
    expect(history().current).toBe("A");
    fireEvent.keyDown(window, { key: "]", metaKey: true });
    expect(history().current).toBe("B");
  });

  it("mouse back and forward buttons walk the history", () => {
    const history = harness();
    act(() => history().select("A"));
    act(() => history().select("B"));
    fireEvent.mouseUp(window, { button: 3 });
    expect(history().current).toBe("A");
    fireEvent.mouseUp(window, { button: 4 });
    expect(history().current).toBe("B");
  });
});

describe("historyKeyAction", () => {
  const key = (init: Partial<KeyboardEvent>) =>
    ({
      key: "",
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      ...init,
    }) as KeyboardEvent;

  it("maps Cmd+[ only on macOS", () => {
    expect(historyKeyAction(key({ key: "[", metaKey: true }), true))
      .toBe("back");
    expect(historyKeyAction(key({ key: "[", metaKey: true }), false))
      .toBeUndefined();
  });

  it("ignores arrows without Alt or with other modifiers", () => {
    expect(historyKeyAction(key({ key: "ArrowLeft" }), false)).toBeUndefined();
    expect(
      historyKeyAction(
        key({ key: "ArrowLeft", altKey: true, shiftKey: true }),
        false,
      ),
    ).toBeUndefined();
  });

  it("ignores the history keys while typing in a text field", () => {
    const history = harness();
    act(() => history().select("A"));
    act(() => history().select("B"));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowLeft", altKey: true });
    expect(history().current).toBe("B");
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    expect(history().current).toBe("A");
    input.remove();
  });
});
