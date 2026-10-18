import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AssistantSettings,
  AssistantStatus,
  AssistantTestResult,
  ShellBridge,
} from "../shell/bridge";
import { BridgeContext } from "../shell/BridgeContext";
import {
  type AssistantController,
  AssistantProvider,
  useAssistants,
} from "./AssistantProvider";
import { type AssistantBridge, fakeAssistantBridge } from "./testBridge";

afterEach(cleanup);

const STATUSES: AssistantStatus[] = [
  { id: "claude-code", state: "ready", version: "2.1.0", detail: null },
  { id: "codex", state: "not-installed", version: null, detail: null },
];

const SETTINGS: AssistantSettings = {
  selected: "claude-code",
  cardDismissed: false,
  copilotConfirmed: false,
};

/** Mounts the provider and exposes the latest controller value. */
function mount(overrides: Partial<AssistantBridge> = {}) {
  const bridge = fakeFullBridge(overrides);
  const seen: { current?: AssistantController } = {};
  function Probe() {
    seen.current = useAssistants();
    return null;
  }
  render(
    <BridgeContext.Provider value={bridge}>
      <AssistantProvider>
        <Probe />
      </AssistantProvider>
    </BridgeContext.Provider>,
  );
  return { bridge, seen };
}

function fakeFullBridge(overrides: Partial<AssistantBridge>): ShellBridge {
  return {
    openProduct: vi.fn(),
    listRecents: vi.fn(),
    setProductName: vi.fn(),
    removeRecent: vi.fn(),
    pickFolder: vi.fn(),
    openExternal: vi.fn(),
    ...fakeAssistantBridge({
      detectAssistants: vi.fn(async () => STATUSES),
      getAssistantSettings: vi.fn(async () => SETTINGS),
      ...overrides,
    }),
  };
}

/** Waits until the first detection and settings load have landed. */
async function loaded(seen: { current?: AssistantController }) {
  await waitFor(() => {
    expect(seen.current?.statuses).toBeDefined();
    expect(seen.current?.settings).toBeDefined();
  });
}

describe("AssistantProvider", () => {
  it("detects and loads settings on mount", async () => {
    const { bridge, seen } = mount();
    await loaded(seen);
    expect(bridge.detectAssistants).toHaveBeenCalledTimes(1);
    expect(bridge.getAssistantSettings).toHaveBeenCalledTimes(1);
    expect(seen.current?.statuses).toEqual(STATUSES);
    expect(seen.current?.settings).toEqual(SETTINGS);
  });

  it("reports detecting until detection returns", async () => {
    let finish: (statuses: AssistantStatus[]) => void = () => {};
    const { seen } = mount({
      detectAssistants: vi.fn(() =>
        new Promise<AssistantStatus[]>((resolve) => {
          finish = resolve;
        })
      ),
    });
    expect(seen.current?.detecting).toBe(true);
    expect(seen.current?.statuses).toBeUndefined();
    await act(async () => finish(STATUSES));
    expect(seen.current?.detecting).toBe(false);
    expect(seen.current?.statuses).toEqual(STATUSES);
  });

  it("select stores the choice", async () => {
    const { bridge, seen } = mount();
    await loaded(seen);
    await act(() => seen.current!.select("codex"));
    expect(bridge.setAssistantSettings).toHaveBeenCalledWith({
      ...SETTINGS,
      selected: "codex",
    });
    expect(seen.current?.settings?.selected).toBe("codex");
  });

  it("dismissCard stores cardDismissed", async () => {
    const { bridge, seen } = mount();
    await loaded(seen);
    await act(() => seen.current!.dismissCard());
    expect(bridge.setAssistantSettings).toHaveBeenCalledWith({
      ...SETTINGS,
      cardDismissed: true,
    });
    expect(seen.current?.settings?.cardDismissed).toBe(true);
  });

  it("runTest calls testAssistant with the selected id and exposes the result", async () => {
    const result = { outcome: "ok" as const, reply: "hi", error: null };
    const { bridge, seen } = mount({
      testAssistant: vi.fn(async () => result),
    });
    await loaded(seen);
    await act(() => seen.current!.runTest());
    expect(bridge.testAssistant).toHaveBeenCalledWith("claude-code");
    expect(seen.current?.test).toEqual({ running: false, result });
  });

  it("runTest is a no-op while a test is running", async () => {
    let finish: () => void = () => {};
    const { bridge, seen } = mount({
      testAssistant: vi.fn(() =>
        new Promise<AssistantTestResult>((resolve) => {
          finish = () => resolve({ outcome: "ok", reply: "x", error: null });
        })
      ),
    });
    await loaded(seen);
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = seen.current!.runTest();
      await seen.current!.runTest();
    });
    expect(seen.current?.test.running).toBe(true);
    expect(bridge.testAssistant).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await first;
    });
    expect(seen.current?.test.running).toBe(false);
  });

  it("runTest re-reads settings and re-detects after a Copilot test", async () => {
    const { bridge, seen } = mount({
      getAssistantSettings: vi.fn(async () => ({
        ...SETTINGS,
        selected: "copilot" as const,
      })),
      testAssistant: vi.fn(async () => ({
        outcome: "ok" as const,
        reply: "hi",
        error: null,
      })),
    });
    await loaded(seen);
    await act(() => seen.current!.runTest());
    expect(bridge.getAssistantSettings).toHaveBeenCalledTimes(2);
    expect(bridge.detectAssistants).toHaveBeenCalledTimes(2);
  });

  it("cancelTest calls cancelAssistantTest", async () => {
    const { bridge, seen } = mount();
    await loaded(seen);
    await act(() => seen.current!.cancelTest());
    expect(bridge.cancelAssistantTest).toHaveBeenCalledTimes(1);
  });

  it("recheck runs detection again", async () => {
    const { bridge, seen } = mount();
    await loaded(seen);
    await act(() => seen.current!.recheck());
    expect(bridge.detectAssistants).toHaveBeenCalledTimes(2);
    expect(seen.current?.detecting).toBe(false);
  });
});
