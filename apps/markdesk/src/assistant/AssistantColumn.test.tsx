import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantStatus } from "../shell/bridge";
import { AssistantColumn } from "./AssistantColumn";
import { mountApp, mountWithAssistants, READY_STATUSES } from "./testMount";

afterEach(cleanup);

const STATUSES: AssistantStatus[] = [
  {
    id: "claude-code",
    state: "ready",
    version: null,
    detail: null,
    promptsAvailable: true,
  },
  {
    id: "codex",
    state: "not-installed",
    version: null,
    detail: null,
    promptsAvailable: false,
  },
  {
    id: "copilot",
    state: "not-installed",
    version: null,
    detail: null,
    promptsAvailable: false,
  },
];

function mount(
  settings: { selected?: "claude-code" | null; cardDismissed?: boolean },
  statuses = STATUSES,
) {
  const onOpenSettings = vi.fn();
  mountWithAssistants(<AssistantColumn onOpenSettings={onOpenSettings} />, {
    statuses,
    settings,
  });
  return onOpenSettings;
}

it("shows the setup card when nothing is selected and the card is not dismissed", async () => {
  mount({});
  expect(await screen.findByRole("button", { name: "Not now" })).toBeTruthy();
});

it("shows the setup pointer when nothing is selected and the card is dismissed", async () => {
  const onOpenSettings = mount({ cardDismissed: true });
  expect(
    await screen.findByText(
      "Set up an assistant to ask questions about this product.",
    ),
  ).toBeTruthy();
  expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Set up" }));
  expect(onOpenSettings).toHaveBeenCalledWith();
});

it("shows the selected assistant and the prompt box reason when it is ready", async () => {
  mountApp();
  expect(await screen.findByText("Claude Code · Ready")).toBeTruthy();
  const box = await screen.findByRole("textbox", { name: "Prompt" });
  expect(box.hasAttribute("disabled")).toBe(true);
  expect(await screen.findByText("Select an entry to send a prompt."))
    .toBeTruthy();
  expect(box.getAttribute("placeholder")).toBe(
    "Select an entry to send a prompt.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(await screen.findByRole("heading", { name: "Settings" }))
    .toBeTruthy();
});

it("shows the state when the selected assistant needs sign-in", async () => {
  mountApp({
    statuses: READY_STATUSES.map((status) =>
      status.id === "claude-code"
        ? { ...status, state: "needs-sign-in" as const }
        : status
    ),
  });
  expect(await screen.findByText("Claude Code needs sign-in")).toBeTruthy();
  expect(await screen.findByText("Claude Code needs sign-in.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
});
