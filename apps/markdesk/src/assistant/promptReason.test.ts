import { describe, expect, it } from "vitest";
import type { EntryView } from "../api/client";
import { type PromptContext, promptDisabledReason } from "./promptReason";

const ENTRY: EntryView = {
  apiVersion: 3,
  displayId: "SAD_0001",
  title: "Brake pressure",
  body: "The brake controller shall apply full pressure within 200 ms.",
  attributes: [],
  location: {
    file: "docs/product/software-architecture.md",
    line: 3,
    column: 1,
  },
  links: { outgoing: [], incoming: [] },
};

const READY: PromptContext = {
  assistantName: "Claude Code",
  state: "ready",
  promptsAvailable: true,
  testRunning: false,
  selected: "SAD_0001",
  entry: ENTRY,
};

describe("promptDisabledReason", () => {
  it.each<[string, PromptContext, string]>([
    ["detecting", { ...READY, state: undefined }, "Checking the assistant."],
    [
      "not installed",
      { ...READY, state: "not-installed" },
      "Claude Code is not installed.",
    ],
    [
      "needs sign-in",
      { ...READY, state: "needs-sign-in" },
      "Claude Code needs sign-in.",
    ],
    [
      "prompts unavailable",
      { ...READY, assistantName: "Codex", promptsAvailable: false },
      "Prompts are not yet available for Codex.",
    ],
    ["test running", { ...READY, testRunning: true }, "A Test is running."],
    [
      "no selection",
      { ...READY, selected: undefined, entry: undefined },
      "Select an entry to send a prompt.",
    ],
    [
      "missing entry",
      { ...READY, entry: "missing" },
      "Select an entry to send a prompt.",
    ],
    ["loading entry", { ...READY, entry: "loading" }, "Loading the entry."],
    [
      "read-only entry",
      { ...READY, entry: { ...ENTRY, origin: "acme-profile@1.2.0" } },
      "This entry is read-only. It comes from acme-profile@1.2.0.",
    ],
    [
      "source-file entry",
      {
        ...READY,
        entry: {
          ...ENTRY,
          location: { file: "src/brake.rs", line: 1, column: 1 },
        },
      },
      "Entries in source files cannot be edited here yet.",
    ],
    [
      "empty body",
      { ...READY, entry: { ...ENTRY, body: "  \n " } },
      "This entry has no body yet.",
    ],
  ])("disables the box: %s", (_, context, reason) => {
    expect(promptDisabledReason(context)).toBe(reason);
  });

  it("checks the reasons in order", () => {
    expect(
      promptDisabledReason({
        ...READY,
        state: "needs-sign-in",
        promptsAvailable: false,
        testRunning: true,
        entry: "loading",
      }),
    ).toBe("Claude Code needs sign-in.");
    expect(
      promptDisabledReason({ ...READY, testRunning: true, entry: "loading" }),
    ).toBe("A Test is running.");
  });

  it("enables the box for a ready, prompt-capable assistant on a Markdown entry with a body", () => {
    expect(promptDisabledReason(READY)).toBeUndefined();
  });
});
