/**
 * State machine of the prompt flow in the assistant column: read the
 * selected entry, run one prompt on the selected assistant, preview the
 * reply through the desk server, then accept (one write) or reject
 * (nothing written).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { DeskError, type EntryView, type ProposalChange } from "../api/client";
import { useRefresh } from "../app/refresh";
import { useSelection } from "../app/selection";
import { useOpenProduct } from "../app/useProduct";
import { useBridge } from "../shell/BridgeContext";
import type { AssistantPromptResult } from "../shell/bridge";
import { useAssistants } from "./AssistantProvider";
import { assistantName } from "./catalog";
import {
  ENTRY_REASONS,
  type PromptContext,
  promptDisabledReason,
} from "./promptReason";
import { stripOneFence } from "./reply";

/** Exact sentences the prompt flow shows, one per failure. */
export const PROMPT_MESSAGES = {
  assistantFailed: (firstLine: string) => `The assistant failed: ${firstLine}`,
  timeout: "The assistant did not answer within 120 seconds.",
  noProposal: "The assistant returned no proposal.",
  promptTooLong: "This entry is too long to send to the assistant.",
  replyTooLong: "The assistant's reply is longer than 20 000 characters.",
  couldNotFormat: "MarkDesk could not format this proposal.",
  changesEntries:
    "The proposal changes more than this entry's body. Ask again.",
  trailerInvalid:
    "This entry's trailer has a problem. Run markspec check and fix it first.",
  readFailed: "MarkDesk could not read this entry.",
  fileChanged: "This file changed since the proposal. Ask again.",
  writeFailed: "MarkDesk could not write this file.",
  writeUnknown:
    "MarkDesk lost the connection during the write. The file may have changed.",
  proposalTooLong: "The proposal is longer than 20 000 characters.",
  readOnly: "This entry is read-only.",
  notUtf8: "This file is not valid UTF-8. MarkDesk cannot write it.",
} as const;

/** What the prompt flow shows. `etag` is the document ETag read at submit. */
export type PromptPhase =
  | { kind: "idle" }
  | { kind: "running" }
  | {
    kind: "proposal";
    displayId: string;
    etag: string;
    currentBody: string;
    proposedBody: string;
  }
  | {
    kind: "applying";
    displayId: string;
    etag: string;
    currentBody: string;
    proposedBody: string;
  }
  | { kind: "error"; message: string };

/** Result of {@linkcode usePrompt}. */
export interface PromptController {
  /** One-line reason the prompt box is disabled; undefined when enabled. */
  disabledReason: string | undefined;
  /** Display name of the selected assistant. */
  assistantName: string;
  instruction: string;
  setInstruction(value: string): void;
  phase: PromptPhase;
  /** Run the instruction on the selected entry. No-op unless enabled and idle. */
  submit(): Promise<void>;
  /** Stop the running prompt, if any. */
  cancel(): Promise<void>;
  /** Write the shown proposal. No-op unless a proposal is shown. */
  accept(): Promise<void>;
  /** Remove the shown proposal. Nothing is written. */
  reject(): void;
}

type LoadedEntry = EntryView | "loading" | "missing" | undefined;

/** The first non-empty line of `text`, or `text` itself. */
function firstLine(text: string): string {
  return text.split(/\r\n|\r|\n/).find((line) => line.trim() !== "")?.trim() ??
    text;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The message of a shell outcome other than `ok` and `cancelled`. */
function outcomeMessage(result: AssistantPromptResult, name: string): string {
  switch (result.outcome) {
    case "timeout":
      return PROMPT_MESSAGES.timeout;
    case "prompt-too-long":
      return PROMPT_MESSAGES.promptTooLong;
    case "reply-too-long":
      return PROMPT_MESSAGES.replyTooLong;
    case "unavailable":
      return result.error ?? `Prompts are not yet available for ${name}.`;
    default:
      return PROMPT_MESSAGES.assistantFailed(
        firstLine(result.error ?? "no error message"),
      );
  }
}

/** The message of a refused preview or apply. */
function proposalMessage(error: unknown, fallback: string): string {
  if (!(error instanceof DeskError)) return fallback;
  if (error.status === 412) return PROMPT_MESSAGES.fileChanged;
  // The entry and its file existed at submit: a missing one now means the
  // file changed (the entry was renamed or removed, or the file moved).
  if (error.code === "entry-not-found" || error.code === "not-found") {
    return PROMPT_MESSAGES.fileChanged;
  }
  if (error.code === "proposal-too-large") {
    return PROMPT_MESSAGES.proposalTooLong;
  }
  if (error.code === "proposal-empty") return PROMPT_MESSAGES.noProposal;
  if (error.code === "entry-read-only") return PROMPT_MESSAGES.readOnly;
  if (error.code === "entry-file-not-utf8") return PROMPT_MESSAGES.notUtf8;
  if (error.code === "format-failed") return PROMPT_MESSAGES.couldNotFormat;
  if (error.code === "proposal-changes-entries") {
    return PROMPT_MESSAGES.changesEntries;
  }
  if (error.code === "entry-trailer-invalid") {
    return PROMPT_MESSAGES.trailerInvalid;
  }
  // The entry changed while the assistant ran.
  if (error.code === "entry-body-empty") return ENTRY_REASONS.bodyEmpty;
  if (error.code === "entry-not-markdown") return ENTRY_REASONS.sourceFile;
  return fallback;
}

/**
 * The prompt flow for the selected entry and the selected assistant.
 *
 * Each submit takes a run number. Cancel, a change of selection, or an
 * unmount moves the number on, so the late result of an earlier run is
 * ignored.
 * Every error keeps the instruction, so the author can send it again.
 */
export function usePrompt(): PromptController {
  const { client } = useOpenProduct();
  const { selected } = useSelection();
  const { revision, refresh } = useRefresh();
  const bridge = useBridge();
  const { settings, statuses, test } = useAssistants();

  const assistantId = settings?.selected ?? null;
  const name = assistantId === null ? "" : assistantName(assistantId);
  const status = statuses?.find((s) => s.id === assistantId);

  const [entry, setEntry] = useState<LoadedEntry>();
  const [instruction, setInstruction] = useState("");
  const [phase, setPhase] = useState<PromptPhase>({ kind: "idle" });
  const run = useRef(0);
  const phaseRef = useRef<PromptPhase>(phase);
  useLayoutEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  // The client of the open product now. A reopen after a lost connection
  // replaces it while a prompt runs; the preview must go to the new one.
  const clientRef = useRef(client);
  useLayoutEffect(() => {
    clientRef.current = client;
  }, [client]);

  // Load the selected entry. A new selection shows "loading"; a refresh of
  // the same selection keeps the entry shown until the new one arrives.
  const loadedId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selected === undefined) {
      loadedId.current = undefined;
      setEntry(undefined);
      return;
    }
    let active = true;
    if (loadedId.current !== selected) setEntry("loading");
    loadedId.current = selected;
    client.entry(selected).then(
      (view) => {
        if (active) setEntry(view);
      },
      () => {
        if (active) setEntry("missing");
      },
    );
    return () => {
      active = false;
    };
  }, [client, selected, revision]);

  // A proposal belongs to one entry: a selection change, or leaving the
  // column, cancels a running prompt and discards a shown proposal. On a
  // selection change, a write in progress is kept: the box stays busy until
  // it ends, and a failed write is still reported. An unmount during the
  // write drops that report. The column disables its own Settings button
  // while a write is applying; the product menu's Settings item and opening
  // another product can still unmount the panel (a known gap, ADR-035).
  useEffect(() => {
    return () => {
      if (phaseRef.current.kind === "applying") return;
      run.current++;
      if (phaseRef.current.kind === "running") {
        bridge.cancelAssistantPrompt().catch(() => {});
      }
      setPhase({ kind: "idle" });
    };
  }, [bridge, selected]);

  // The column mounts the panel only when an assistant is selected; this
  // branch guards a direct mount without one.
  const reasonFor = (value: PromptContext["entry"]) =>
    assistantId === null ? "Set up an assistant first" : promptDisabledReason({
      assistantName: name,
      state: status?.state,
      promptsAvailable: status?.promptsAvailable ?? false,
      testRunning: test.running,
      selected,
      entry: value,
    });
  const disabledReason = reasonFor(entry);

  const submit = useCallback(async () => {
    const current = phaseRef.current.kind;
    if (current === "running" || current === "applying") return;
    if (current === "proposal") return;
    if (disabledReason !== undefined || assistantId === null) return;
    if (typeof entry !== "object" || instruction.trim() === "") return;
    const mine = ++run.current;
    const isCurrent = () => run.current === mine;
    setPhase({ kind: "running" });

    // Read the ETag first, then the entry: a change between the two leaves
    // the tag stale, so the preview answers 412 and no edit is lost.
    let etag: string | undefined;
    let fresh: EntryView;
    try {
      etag = (await client.document(entry.location.file)).etag;
      fresh = await client.entry(entry.displayId);
    } catch (error) {
      if (!isCurrent()) return;
      // A lost connection is reported by the app's banner, as in the preview.
      if (error instanceof DeskError && error.status === 0) {
        setPhase({ kind: "idle" });
        return;
      }
      setPhase({ kind: "error", message: PROMPT_MESSAGES.readFailed });
      return;
    }
    if (!isCurrent()) return;
    if (etag === undefined) {
      setPhase({ kind: "error", message: PROMPT_MESSAGES.readFailed });
      return;
    }
    // The entry may have changed since it was loaded: check it again, so a
    // refused preview later does not name the wrong cause.
    const freshReason = reasonFor(fresh);
    if (freshReason !== undefined) {
      setPhase({ kind: "error", message: freshReason });
      return;
    }

    let result: AssistantPromptResult;
    try {
      result = await bridge.runAssistantPrompt(assistantId, {
        title: fresh.title,
        body: fresh.body,
        instruction,
        attributes: fresh.attributes.map(({ key, value }) => ({ key, value })),
      });
    } catch (error) {
      if (isCurrent()) {
        setPhase({
          kind: "error",
          message: PROMPT_MESSAGES.assistantFailed(firstLine(messageOf(error))),
        });
      }
      return;
    }
    if (!isCurrent()) return;
    if (result.outcome === "cancelled") {
      setPhase({ kind: "idle" });
      return;
    }
    if (result.outcome !== "ok") {
      setPhase({ kind: "error", message: outcomeMessage(result, name) });
      return;
    }
    const proposed = stripOneFence(result.reply ?? "");
    if (proposed === "") {
      setPhase({ kind: "error", message: PROMPT_MESSAGES.noProposal });
      return;
    }

    const changes: ProposalChange[] = [
      { displayId: fresh.displayId, kind: "body", body: proposed },
    ];
    try {
      const preview = await clientRef.current.previewProposal(etag, changes);
      if (!isCurrent()) return;
      const change = preview.changes[0];
      if (change === undefined) {
        setPhase({ kind: "error", message: PROMPT_MESSAGES.couldNotFormat });
        return;
      }
      setPhase({
        kind: "proposal",
        displayId: change.displayId,
        etag,
        currentBody: change.currentBody,
        proposedBody: change.body,
      });
    } catch (error) {
      if (!isCurrent()) return;
      // A lost connection is reported by the app's banner; a column
      // sentence about formatting would name the wrong cause.
      if (error instanceof DeskError && error.status === 0) {
        setPhase({ kind: "idle" });
        return;
      }
      setPhase({
        kind: "error",
        message: proposalMessage(error, PROMPT_MESSAGES.couldNotFormat),
      });
    }
  }, [
    assistantId,
    bridge,
    client,
    disabledReason,
    entry,
    instruction,
    name,
    selected,
    status,
    test.running,
  ]);

  const cancel = useCallback(async () => {
    if (phaseRef.current.kind !== "running") return;
    // Stop the run on the UI side first. The shell loses a cancel that
    // arrives before its run has started, so a submit still reading the
    // entry must not start the run, and a late result must be ignored.
    run.current++;
    const idle: PromptPhase = { kind: "idle" };
    phaseRef.current = idle;
    setPhase(idle);
    try {
      await bridge.cancelAssistantPrompt();
    } catch {
      // Nothing to cancel, or the shell is gone; the run result reports it.
    }
  }, [bridge]);

  const accept = useCallback(async () => {
    const shown = phaseRef.current;
    if (shown.kind !== "proposal") return;
    const mine = run.current;
    const applying: PromptPhase = { ...shown, kind: "applying" };
    // Set the ref at once, so a second Accept in the same tick is ignored.
    phaseRef.current = applying;
    setPhase(applying);
    try {
      await client.applyProposal(shown.etag, [
        { displayId: shown.displayId, kind: "body", body: shown.proposedBody },
      ]);
    } catch (error) {
      // A lost connection does not tell whether the server wrote the file,
      // so say that, and let every pane read the file again.
      const lost = error instanceof DeskError && error.status === 0;
      // Reported even after a selection change: a failed write must not
      // pass without a message.
      if (run.current === mine) {
        setPhase({
          kind: "error",
          message: lost
            ? PROMPT_MESSAGES.writeUnknown
            : proposalMessage(error, PROMPT_MESSAGES.writeFailed),
        });
      }
      if (lost) refresh();
      return;
    }
    if (run.current === mine) {
      setInstruction("");
      setPhase({ kind: "idle" });
    }
    // The file changed on disk: every pane reads its data again.
    refresh();
  }, [client, refresh]);

  const reject = useCallback(() => {
    if (phaseRef.current.kind !== "proposal") return;
    setPhase({ kind: "idle" });
  }, []);

  return {
    disabledReason,
    assistantName: name,
    instruction,
    setInstruction,
    phase,
    submit,
    cancel,
    accept,
    reject,
  };
}
