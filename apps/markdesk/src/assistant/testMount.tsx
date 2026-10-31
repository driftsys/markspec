import { render } from "@testing-library/react";
import { vi } from "vitest";
import type { ReactNode } from "react";
import type { DeskClient, EntryView, ProposalChange } from "../api/client";
import { App } from "../app/App";
import { useSelection } from "../app/selection";
import { BridgeContext } from "../shell/BridgeContext";
import type {
  AssistantSettings,
  AssistantStatus,
  ShellBridge,
} from "../shell/bridge";
import { AssistantProvider } from "./AssistantProvider";
import { type AssistantBridge, fakeAssistantBridge } from "./testBridge";

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

/** An entry view for prompt tests: a Markdown requirement with a body. */
export function entryFixture(
  id: string,
  overrides: Partial<EntryView> = {},
): EntryView {
  return {
    apiVersion: 3,
    displayId: id,
    id: "01JAAAAAAAAAAAAAAAAAAAAAAA",
    title: "Brake latency",
    body: "The system shall brake within 200 ms.",
    attributes: [{ key: "Satisfies", value: "STK_BRK_0001" }],
    location: { file: "docs/system.md", line: 3, column: 1 },
    links: { outgoing: [], incoming: [] },
    ...overrides,
  };
}

/** A fake desk client for prompt tests. Every method is a `vi.fn`. */
export function fakePromptClient(
  overrides: Partial<DeskClient> = {},
): DeskClient {
  return {
    tree: vi.fn(async () => ({
      view: {
        apiVersion: 3 as const,
        project: { name: "Brakes" },
        roots: [],
        nodes: [],
        edges: [],
      },
    })),
    entry: vi.fn(async (id: string) => entryFixture(id)),
    entryHtml: vi.fn(),
    document: vi.fn(async (path: string) => ({
      view: { apiVersion: 3 as const, path, html: "", entries: [] },
      etag: '"e1"',
    })),
    file: vi.fn(),
    previewProposal: vi.fn(
      async (_etag: string, changes: ProposalChange[]) => ({
        apiVersion: 3 as const,
        changes: changes.map((change) => ({
          ...change,
          currentBody: "The system shall brake within 200 ms.",
        })),
      }),
    ),
    applyProposal: vi.fn(async () => ({
      apiVersion: 3 as const,
      path: "docs/system.md",
      etag: '"e2"',
    })),
    ...overrides,
  } as DeskClient;
}

/** Selects an entry when clicked: stands in for the navigator. */
function Picker() {
  const { select } = useSelection();
  return (
    <>
      <button type="button" onClick={() => select("SYS_BRK_0001")}>
        Pick first
      </button>
      <button type="button" onClick={() => select("SYS_BRK_0002")}>
        Pick second
      </button>
    </>
  );
}

/**
 * Renders the whole `App` with an open product, a fake desk client, and a
 * fake bridge, so desk calls go through `watchConnection`. The navigator is
 * replaced by two buttons that select `SYS_BRK_0001` and `SYS_BRK_0002`.
 */
export function mountApp(options: {
  client?: DeskClient;
  assistant?: Partial<AssistantBridge>;
  statuses?: AssistantStatus[];
  settings?: Partial<AssistantSettings>;
} = {}) {
  const client = options.client ?? fakePromptClient();
  const bridge: ShellBridge = {
    openProduct: vi.fn(async (path: string) => ({
      url: "http://127.0.0.1:1",
      token: "t",
      apiVersion: 3,
      root: path,
    })),
    listRecents: vi.fn(async () => [{ root: "/p", name: null, exists: true }]),
    setProductName: vi.fn(async () => {}),
    removeRecent: vi.fn(async () => {}),
    pickFolder: vi.fn(async () => null),
    openExternal: vi.fn(async () => {}),
    ...fakeAssistantBridge({
      detectAssistants: vi.fn(async () => options.statuses ?? READY_STATUSES),
      getAssistantSettings: vi.fn(async () => ({
        selected: "claude-code" as const,
        cardDismissed: false,
        copilotConfirmed: false,
        ...options.settings,
      })),
      ...options.assistant,
    }),
  };
  render(
    <App
      bridge={bridge}
      createClient={() => client}
      slots={{ navigator: <Picker />, document: <div /> }}
    />,
  );
  return { client, bridge };
}

/** Claude Code ready and prompt-capable; Codex ready but not; Copilot absent. */
export const READY_STATUSES: AssistantStatus[] = [
  {
    id: "claude-code",
    state: "ready",
    version: null,
    detail: null,
    promptsAvailable: true,
  },
  {
    id: "codex",
    state: "ready",
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
