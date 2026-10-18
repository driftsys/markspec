import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantProvider } from "../assistant/AssistantProvider";
import { fakeAssistantBridge } from "../assistant/testBridge";
import { BridgeContext } from "../shell/BridgeContext";
import type {
  AssistantSettings,
  AssistantStatus,
  AssistantTestResult,
  ShellBridge,
} from "../shell/bridge";
import { SettingsView } from "./SettingsView";

afterEach(cleanup);

const STATUSES: AssistantStatus[] = [
  {
    id: "claude-code",
    state: "ready",
    version: "2.1.292 (Claude Code)",
    detail: null,
  },
  { id: "codex", state: "needs-sign-in", version: "0.5.0", detail: null },
  { id: "copilot", state: "not-installed", version: null, detail: null },
];

function mount(
  options: {
    statuses?: AssistantStatus[];
    settings?: Partial<AssistantSettings>;
    testResult?: AssistantTestResult;
    testAssistant?: ShellBridge["testAssistant"];
  } = {},
) {
  const bridge = {
    openExternal: vi.fn(async () => {}),
    ...fakeAssistantBridge({
      detectAssistants: vi.fn(async () => options.statuses ?? STATUSES),
      getAssistantSettings: vi.fn(async () => ({
        selected: null,
        cardDismissed: false,
        copilotConfirmed: false,
        ...options.settings,
      })),
      ...(options.testAssistant
        ? { testAssistant: options.testAssistant }
        : options.testResult
        ? { testAssistant: vi.fn(async () => options.testResult!) }
        : {}),
    }),
  } as unknown as ShellBridge;
  const onBack = vi.fn();
  render(
    <BridgeContext.Provider value={bridge}>
      <AssistantProvider>
        <SettingsView onBack={onBack} />
      </AssistantProvider>
    </BridgeContext.Provider>,
  );
  return { bridge, onBack };
}

function assistantSection(): HTMLElement {
  return screen.getByRole("region", { name: "Assistant" });
}

describe("SettingsView", () => {
  it("lists the three assistants with their state", async () => {
    mount();
    expect(await screen.findByText("Ready")).toBeTruthy();
    expect(screen.getByText("Needs sign-in")).toBeTruthy();
    expect(screen.getByText("Not installed")).toBeTruthy();
    expect(screen.getByText("2.1.292 (Claude Code)")).toBeTruthy();
  });

  it("shows the Copilot sign-in note when Copilot needs sign-in", async () => {
    mount({
      statuses: [
        { id: "copilot", state: "needs-sign-in", version: "1.0", detail: null },
      ],
    });
    expect(
      await screen.findByText(
        "Sign-in not confirmed. Sign in, then press Test.",
      ),
    ).toBeTruthy();
  });

  it("offers a radio per installed assistant plus None", async () => {
    mount();
    await screen.findByText("Ready");
    const names = within(assistantSection()).getAllByRole("radio").map(
      (radio) => radio.getAttribute("aria-label"),
    );
    expect(names).toEqual(["Claude Code", "Codex", "None"]);
  });

  it("selecting a radio stores the choice", async () => {
    const { bridge } = mount();
    await screen.findByText("Ready");
    fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
    await waitFor(() =>
      expect(bridge.setAssistantSettings).toHaveBeenCalledWith({
        selected: "codex",
        cardDismissed: false,
        copilotConfirmed: false,
      })
    );
  });

  it("Re-check runs detection again", async () => {
    const { bridge } = mount();
    await screen.findByText("Ready");
    fireEvent.click(
      within(assistantSection()).getByRole("button", { name: "Re-check" }),
    );
    await waitFor(() =>
      expect(bridge.detectAssistants).toHaveBeenCalledTimes(2)
    );
  });

  it("Test is disabled when no assistant is selected", async () => {
    mount();
    await screen.findByText("Ready");
    const test = screen.getByRole("button", {
      name: "Test",
    }) as HTMLButtonElement;
    expect(test.disabled).toBe(true);
  });

  it("Test shows Testing… and Cancel, then the reply", async () => {
    let finish: (result: AssistantTestResult) => void = () => {};
    const { bridge } = mount({
      settings: { selected: "claude-code" },
      testAssistant: vi.fn(() =>
        new Promise<AssistantTestResult>((resolve) => {
          finish = resolve;
        })
      ),
    });
    await screen.findByText("Ready");
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Test" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false)
    );
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("Testing…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(bridge.cancelAssistantTest).toHaveBeenCalled());
    finish({ outcome: "ok", reply: "ready", error: null });
    expect(await screen.findByText("Reply: ready")).toBeTruthy();
  });

  async function runTest(result: AssistantTestResult) {
    mount({ settings: { selected: "claude-code" }, testResult: result });
    await screen.findByText("Ready");
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Test" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false)
    );
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
  }

  it("Test shows the usage message", async () => {
    await runTest({ outcome: "usage", reply: null, error: "unknown option" });
    expect(
      await screen.findByText(
        "This version of Claude Code does not support the test command. Update it and try again.",
      ),
    ).toBeTruthy();
  });

  it("Test shows the timeout message", async () => {
    await runTest({ outcome: "timeout", reply: null, error: null });
    expect(
      await screen.findByText("Claude Code did not answer within 60 seconds."),
    ).toBeTruthy();
  });

  it("Test shows the failure with its error", async () => {
    await runTest({
      outcome: "failed",
      reply: null,
      error: "exit code 1 boom",
    });
    expect(await screen.findByText("Test failed: exit code 1 boom"))
      .toBeTruthy();
  });

  it("Test shows the cancelled message", async () => {
    await runTest({ outcome: "cancelled", reply: null, error: null });
    expect(await screen.findByText("Test cancelled.")).toBeTruthy();
  });

  it("Back calls onBack", async () => {
    const { onBack } = mount();
    await screen.findByText("Ready");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("install guide shows each assistant's commands, page link, and sign-in step", async () => {
    const { bridge } = mount();
    await screen.findByText("Ready");
    const guide = screen.getByRole("region", { name: "Install an assistant" });
    expect(guide.id).toBe("install-guide");
    expect(within(guide).getByText("brew install --cask claude-code"))
      .toBeTruthy();
    expect(within(guide).getByText("npm install -g @openai/codex"))
      .toBeTruthy();
    expect(within(guide).getByText("claude auth login")).toBeTruthy();
    expect(within(guide).getByText("Then type /login.")).toBeTruthy();
    const links = within(guide).getAllByText("Official install page");
    expect(links).toHaveLength(3);
    fireEvent.click(links[0]);
    expect(bridge.openExternal).toHaveBeenCalledWith(
      "https://code.claude.com/docs/en/setup",
    );
  });

  it("each install block has its own Re-check", async () => {
    const { bridge } = mount();
    await screen.findByText("Ready");
    const block = screen.getByRole("group", { name: "Codex install" });
    fireEvent.click(within(block).getByRole("button", { name: "Re-check" }));
    await waitFor(() =>
      expect(bridge.detectAssistants).toHaveBeenCalledTimes(2)
    );
  });

  it("Copy writes the command to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    mount();
    await screen.findByText("Ready");
    const block = screen.getByRole("group", { name: "Codex install" });
    fireEvent.click(within(block).getAllByRole("button", { name: "Copy" })[1]);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("npm install -g @openai/codex")
    );
  });
});
