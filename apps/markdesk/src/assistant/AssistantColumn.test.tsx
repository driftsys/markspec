import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantStatus } from "../shell/bridge";
import { AssistantColumn } from "./AssistantColumn";
import { mountWithAssistants } from "./testMount";

afterEach(cleanup);

const STATUSES: AssistantStatus[] = [
  { id: "claude-code", state: "ready", version: null, detail: null },
  { id: "codex", state: "not-installed", version: null, detail: null },
  { id: "copilot", state: "not-installed", version: null, detail: null },
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

it("shows the selected assistant when it is ready", async () => {
  const onOpenSettings = mount({ selected: "claude-code" });
  expect(await screen.findByText("Claude Code · Ready")).toBeTruthy();
  const box = screen.getByRole("textbox");
  expect(box.hasAttribute("disabled")).toBe(true);
  expect(box.getAttribute("placeholder")).toBe(
    "Prompts arrive in a later release",
  );
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(onOpenSettings).toHaveBeenCalled();
});

it("shows the state when the selected assistant needs sign-in", async () => {
  mount({ selected: "claude-code" }, [
    { id: "claude-code", state: "needs-sign-in", version: null, detail: null },
    ...STATUSES.slice(1),
  ]);
  expect(await screen.findByText("Claude Code needs sign-in")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
});
