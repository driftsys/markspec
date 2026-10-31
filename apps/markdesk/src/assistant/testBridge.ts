import { vi } from "vitest";
import type { ShellBridge } from "../shell/bridge";

/** The assistant part of the shell bridge. */
export type AssistantBridge = Pick<
  ShellBridge,
  | "detectAssistants"
  | "testAssistant"
  | "cancelAssistantTest"
  | "runAssistantPrompt"
  | "cancelAssistantPrompt"
  | "getAssistantSettings"
  | "setAssistantSettings"
>;

/**
 * Test double for the assistant bridge methods. Defaults: nothing detected,
 * no choice stored, every Test succeeds, and every prompt run returns
 * "Proposed body.".
 */
export function fakeAssistantBridge(
  overrides: Partial<AssistantBridge> = {},
): AssistantBridge {
  return {
    detectAssistants: vi.fn(async () => []),
    testAssistant: vi.fn(async () => ({
      outcome: "ok" as const,
      reply: "ok",
      error: null,
    })),
    cancelAssistantTest: vi.fn(async () => {}),
    runAssistantPrompt: vi.fn(async () => ({
      outcome: "ok" as const,
      reply: "Proposed body.",
      error: null,
    })),
    cancelAssistantPrompt: vi.fn(async () => {}),
    getAssistantSettings: vi.fn(async () => ({
      selected: null,
      cardDismissed: false,
      copilotConfirmed: false,
    })),
    setAssistantSettings: vi.fn(async () => {}),
    ...overrides,
  };
}
