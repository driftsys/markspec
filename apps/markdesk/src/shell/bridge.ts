import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Connection details of a running product server. */
export interface OpenedProduct {
  url: string;
  token: string;
  apiVersion: number;
  root: string;
}

/** A product folder remembered from an earlier session. */
export interface RecentProduct {
  root: string;
  /**
   * Project name, or folder name when the project has none. Derived on each
   * open and overwritten; `null` until the product was opened once.
   */
  name: string | null;
  exists: boolean;
}

/** Rejection value of `openProduct`. */
export interface OpenProductFailure {
  kind: "not-a-product" | "spawn-failed" | "version-mismatch";
  details: string;
}

/** An AI assistant CLI that MarkDesk can use. */
export type AssistantId = "claude-code" | "codex" | "copilot";

/** How far an assistant CLI is from being usable. */
export type AssistantState = "not-installed" | "needs-sign-in" | "ready";

/** Detection result for one assistant CLI. */
export interface AssistantStatus {
  id: AssistantId;
  state: AssistantState;
  version: string | null;
  detail: string | null;
  /**
   * Whether the shell can run a prompt on this assistant with every tool
   * switched off. Only Claude Code qualifies in this version.
   */
  promptsAvailable: boolean;
}

/** How a Test of an assistant ended. */
export type TestOutcome = "ok" | "usage" | "timeout" | "cancelled" | "failed";

/** Result of running a short test prompt on an assistant. */
export interface AssistantTestResult {
  outcome: TestOutcome;
  reply: string | null;
  error: string | null;
}

/** One entry, and the author's instruction, sent to an assistant. */
export interface AssistantPromptRequest {
  title: string;
  body: string;
  instruction: string;
  /** Trailer attributes, sent as read-only context. */
  attributes: { key: string; value: string }[];
}

/** How a prompt run ended. */
export type PromptOutcome =
  | "ok"
  | "timeout"
  | "cancelled"
  | "failed"
  | "unavailable"
  | "prompt-too-long"
  | "reply-too-long";

/** Result of a prompt run: the trimmed reply, or why there is none. */
export interface AssistantPromptResult {
  outcome: PromptOutcome;
  reply: string | null;
  error: string | null;
}

/** The stored assistant choice and its related flags. */
export interface AssistantSettings {
  selected: AssistantId | null;
  cardDismissed: boolean;
  copilotConfirmed: boolean;
}

/**
 * The only module that talks to the desktop shell. Everything else depends
 * on this interface, so tests can supply a fake.
 */
export interface ShellBridge {
  openProduct(path: string): Promise<OpenedProduct>;
  listRecents(): Promise<RecentProduct[]>;
  /** Store the derived name (project name, or folder name) of a recent product. */
  setProductName(root: string, name: string): Promise<void>;
  removeRecent(root: string): Promise<void>;
  /** Show the folder picker. Resolves to `null` when the user cancels. */
  pickFolder(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  /** Look for the supported assistant CLIs on this machine. */
  detectAssistants(): Promise<AssistantStatus[]>;
  /** Run a short test prompt on the given assistant. */
  testAssistant(id: AssistantId): Promise<AssistantTestResult>;
  /** Stop the running Test, if any. */
  cancelAssistantTest(): Promise<void>;
  /** Run one prompt on the given assistant, with every tool switched off. */
  runAssistantPrompt(
    id: AssistantId,
    request: AssistantPromptRequest,
  ): Promise<AssistantPromptResult>;
  /** Stop the running prompt run, if any. */
  cancelAssistantPrompt(): Promise<void>;
  getAssistantSettings(): Promise<AssistantSettings>;
  setAssistantSettings(settings: AssistantSettings): Promise<void>;
}

/** The bridge backed by the Tauri commands and plugins. */
export const tauriBridge: ShellBridge = {
  openProduct: (path) => invoke<OpenedProduct>("open_product", { path }),
  listRecents: () => invoke<RecentProduct[]>("list_recents"),
  setProductName: (root, name) =>
    invoke<void>("set_product_name", { root, name }),
  removeRecent: (root) => invoke<void>("remove_recent", { root }),
  pickFolder: async () => {
    const picked = await open({ directory: true });
    return typeof picked === "string" ? picked : null;
  },
  openExternal: (url) => openUrl(url),
  detectAssistants: () => invoke<AssistantStatus[]>("detect_assistants"),
  testAssistant: (id) => invoke<AssistantTestResult>("test_assistant", { id }),
  cancelAssistantTest: () => invoke<void>("cancel_assistant_test"),
  runAssistantPrompt: (id, request) =>
    invoke<AssistantPromptResult>("run_assistant_prompt", { id, request }),
  cancelAssistantPrompt: () => invoke<void>("cancel_assistant_prompt"),
  getAssistantSettings: () =>
    invoke<AssistantSettings>("get_assistant_settings"),
  setAssistantSettings: (settings) =>
    invoke<void>("set_assistant_settings", { settings }),
};
