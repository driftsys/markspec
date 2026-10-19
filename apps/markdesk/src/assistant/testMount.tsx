import { render } from "@testing-library/react";
import { vi } from "vitest";
import type { ReactNode } from "react";
import { BridgeContext } from "../shell/BridgeContext";
import type {
  AssistantSettings,
  AssistantStatus,
  ShellBridge,
} from "../shell/bridge";
import { AssistantProvider } from "./AssistantProvider";
import { fakeAssistantBridge } from "./testBridge";

/** Renders `ui` inside the assistant provider with a fake bridge. */
export function mountWithAssistants(
  ui: ReactNode,
  options: {
    statuses: AssistantStatus[];
    settings?: Partial<AssistantSettings>;
  },
) {
  const setAssistantSettings = vi.fn(async () => {});
  const bridge = fakeAssistantBridge({
    detectAssistants: vi.fn(async () => options.statuses),
    getAssistantSettings: vi.fn(async () => ({
      selected: null,
      cardDismissed: false,
      copilotConfirmed: false,
      ...options.settings,
    })),
    setAssistantSettings,
  }) as unknown as ShellBridge;
  render(
    <BridgeContext.Provider value={bridge}>
      <AssistantProvider>{ui}</AssistantProvider>
    </BridgeContext.Provider>,
  );
  return { setAssistantSettings };
}
