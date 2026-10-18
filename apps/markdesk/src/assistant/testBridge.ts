import { vi } from "vitest";
import type { ShellBridge } from "../shell/bridge";

/** The assistant part of the shell bridge. */
export type AssistantBridge = Pick<
  ShellBridge,
  | "detectAssistants"
  | "testAssistant"
  | "cancelAssistantTest"
  | "getAssistantSettings"
  | "setAssistantSettings"
>;

/**
 * Test double for the assistant bridge methods. Defaults: nothing detected,
 * no choice stored, and every Test succeeds.
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
    getAssistantSettings: vi.fn(async () => ({
      selected: null,
      cardDismissed: false,
      copilotConfirmed: false,
    })),
    setAssistantSettings: vi.fn(async () => {}),
    ...overrides,
  };
}
