import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantStatus } from "../shell/bridge";
import { SetupCard } from "./SetupCard";
import { mountWithAssistants } from "./testMount";

afterEach(cleanup);

const row = (
  id: AssistantStatus["id"],
  state: AssistantStatus["state"],
): AssistantStatus => ({
  id,
  state,
  version: null,
  detail: null,
  promptsAvailable: id === "claude-code",
});

function mount(statuses: AssistantStatus[]) {
  const onOpenSettings = vi.fn();
  const view = mountWithAssistants(
    <SetupCard onOpenSettings={onOpenSettings} />,
    { statuses },
  );
  return { onOpenSettings, ...view };
}

it("shows Looking for assistants… while detecting", () => {
  mount([]);
  expect(screen.getByText("Looking for assistants…")).toBeTruthy();
});

it("offers Use for each ready assistant", async () => {
  const { setAssistantSettings } = mount([
    row("claude-code", "ready"),
    row("codex", "ready"),
    row("copilot", "not-installed"),
  ]);
  const uses = await screen.findAllByRole("button", { name: "Use" });
  expect(uses.length).toBe(2);
  fireEvent.click(uses[1]);
  await waitFor(() =>
    expect(setAssistantSettings).toHaveBeenCalledWith(
      expect.objectContaining({ selected: "codex" }),
    )
  );
});

it("offers Use for an installed Copilot that needs sign-in", async () => {
  mount([
    row("claude-code", "not-installed"),
    row("codex", "not-installed"),
    row("copilot", "needs-sign-in"),
  ]);
  expect(await screen.findByRole("button", { name: "Use" })).toBeTruthy();
  expect(
    screen.getByText("Sign-in not confirmed. Sign in, then press Test."),
  ).toBeTruthy();
});

it("shows the sign-in command and Re-check for a signed-out Claude Code or Codex", async () => {
  mount([
    row("claude-code", "needs-sign-in"),
    row("codex", "needs-sign-in"),
    row("copilot", "not-installed"),
  ]);
  expect(await screen.findByText("claude auth login")).toBeTruthy();
  expect(screen.getByText("codex login")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Re-check" }).length).toBe(2);
  expect(screen.queryByRole("button", { name: "Use" })).toBeNull();
});

it("links Install… to the install guide", async () => {
  const { onOpenSettings } = mount([
    row("claude-code", "ready"),
    row("codex", "not-installed"),
    row("copilot", "not-installed"),
  ]);
  const installs = await screen.findAllByRole("button", { name: "Install…" });
  fireEvent.click(installs[0]);
  expect(onOpenSettings).toHaveBeenCalledWith("install");
});

it("leads with No assistant found when none is installed", async () => {
  const { onOpenSettings } = mount([
    row("claude-code", "not-installed"),
    row("codex", "not-installed"),
    row("copilot", "not-installed"),
  ]);
  expect(await screen.findByText("No assistant found. Set one up"))
    .toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open install guide" }));
  expect(onOpenSettings).toHaveBeenCalledWith("install");
});

it("Not now dismisses the card", async () => {
  const { setAssistantSettings } = mount([row("claude-code", "ready")]);
  fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
  await waitFor(() =>
    expect(setAssistantSettings).toHaveBeenCalledWith(
      expect.objectContaining({ cardDismissed: true }),
    )
  );
});

it("shows the state label on each row", async () => {
  mount([
    row("claude-code", "ready"),
    row("codex", "needs-sign-in"),
    row("copilot", "not-installed"),
  ]);
  const rows = await screen.findAllByRole("listitem");
  expect(within(rows[0]).getByText("Ready")).toBeTruthy();
  expect(within(rows[1]).getByText("Needs sign-in")).toBeTruthy();
  expect(within(rows[2]).getByText("Not installed")).toBeTruthy();
});
