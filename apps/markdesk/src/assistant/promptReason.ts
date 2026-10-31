/**
 * The one-line reason the prompt box is disabled, shown in place of the
 * box so the author knows what to do next.
 */

import type { EntryView } from "../api/client";
import type { AssistantState } from "../shell/bridge";

/** Reasons about the entry itself, also used for a refused preview. */
export const ENTRY_REASONS = {
  sourceFile: "Entries in source files cannot be edited here yet.",
  bodyEmpty: "This entry has no body yet.",
} as const;

/** What the prompt box depends on. */
export interface PromptContext {
  /** Display name of the selected assistant, for example "Claude Code". */
  assistantName: string;
  /** Detected state of the selected assistant; undefined while detecting. */
  state: AssistantState | undefined;
  /** Whether the shell can run a prompt on this assistant. */
  promptsAvailable: boolean;
  /** Whether a Test of the assistant is running. */
  testRunning: boolean;
  /** Display ID of the selected entry, if any. */
  selected: string | undefined;
  /** The selected entry, or its loading state. */
  entry: EntryView | "loading" | "missing" | undefined;
}

/** One-line reason the prompt box is disabled; undefined when enabled. */
export function promptDisabledReason(
  context: PromptContext,
): string | undefined {
  const name = context.assistantName;
  if (context.state === undefined) return "Checking the assistant.";
  if (context.state === "not-installed") return `${name} is not installed.`;
  if (context.state === "needs-sign-in") return `${name} needs sign-in.`;
  if (!context.promptsAvailable) {
    return `Prompts are not yet available for ${name}.`;
  }
  if (context.testRunning) return "A Test is running.";
  const entry = context.entry;
  if (
    context.selected === undefined || entry === undefined ||
    entry === "missing"
  ) {
    return "Select an entry to send a prompt.";
  }
  if (entry === "loading") return "Loading the entry.";
  if (entry.origin !== undefined) {
    return `This entry is read-only. It comes from ${entry.origin}.`;
  }
  if (!entry.location.file.endsWith(".md")) {
    return ENTRY_REASONS.sourceFile;
  }
  if (entry.body.trim() === "") return ENTRY_REASONS.bodyEmpty;
  return undefined;
}
