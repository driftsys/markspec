import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeskError, type EntryView } from "../api/client";
import { MESSAGES } from "../app/useProduct";
import type { AssistantPromptResult, AssistantStatus } from "../shell/bridge";
import { PROMPT_MESSAGES } from "./usePrompt";
import {
  entryFixture,
  fakePromptClient,
  mountApp,
  READY_STATUSES,
} from "./testMount";

afterEach(cleanup);

const BODY = "The system shall brake within 200 ms.";

/** Waits for the prompt box and returns it. */
async function promptBox(): Promise<HTMLTextAreaElement> {
  return await screen.findByRole("textbox", { name: "Prompt" });
}

/** Selects the first entry and waits until the prompt box is enabled. */
async function pickReady(): Promise<HTMLTextAreaElement> {
  fireEvent.click(await screen.findByRole("button", { name: "Pick first" }));
  const box = await promptBox();
  await waitFor(() => expect(box.disabled).toBe(false));
  return box;
}

/** Types `text` in the box and presses Enter. */
async function send(box: HTMLTextAreaElement, text: string) {
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
}

/** A promise with its resolver, for holding a call open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function statusesWith(change: Partial<AssistantStatus>): AssistantStatus[] {
  return READY_STATUSES.map((status) =>
    status.id === "claude-code" ? { ...status, ...change } : status
  );
}

it.each<
  [
    string,
    {
      state?: AssistantStatus["state"];
      selectedAssistant?: "codex";
      entry?: Partial<EntryView>;
      noPick?: boolean;
    },
    string,
  ]
>([
  ["no selection", { noPick: true }, "Select an entry to send a prompt."],
  ["needs sign-in", { state: "needs-sign-in" }, "Claude Code needs sign-in."],
  [
    "not prompt-capable",
    { selectedAssistant: "codex" },
    "Prompts are not yet available for Codex.",
  ],
  [
    "read-only entry",
    { entry: { origin: "up@1.0.0" } },
    "This entry is read-only. It comes from up@1.0.0.",
  ],
  [
    "source-file entry",
    { entry: { location: { file: "src/a.rs", line: 1, column: 1 } } },
    "Entries in source files cannot be edited here yet.",
  ],
  ["empty body", { entry: { body: "" } }, "This entry has no body yet."],
])("disables the prompt box: %s", async (_, context, reason) => {
  mountApp({
    client: fakePromptClient({
      entry: vi.fn(async (id: string) => entryFixture(id, context.entry)),
    }),
    statuses: context.state
      ? statusesWith({ state: context.state })
      : undefined,
    settings: context.selectedAssistant
      ? { selected: context.selectedAssistant }
      : undefined,
  });
  if (!context.noPick) {
    fireEvent.click(await screen.findByRole("button", { name: "Pick first" }));
  }
  expect(await screen.findByText(reason)).toBeTruthy();
  const box = await promptBox();
  expect(box.disabled).toBe(true);
  expect(box.getAttribute("placeholder")).toBe(reason);
});

it("submits with Enter and shows the proposal with a word diff", async () => {
  const { client, bridge } = mountApp();
  const box = await pickReady();
  await send(box, "make it 150 ms");
  await screen.findByRole("heading", { name: "Proposed" });
  expect(bridge.runAssistantPrompt).toHaveBeenCalledWith("claude-code", {
    title: "Brake latency",
    body: BODY,
    instruction: "make it 150 ms",
    attributes: [{ key: "Satisfies", value: "STK_BRK_0001" }],
  });
  expect(vi.mocked(client.document).mock.calls[0][0]).toBe("docs/system.md");
  expect(client.previewProposal).toHaveBeenCalledWith('"e1"', [
    { displayId: "SYS_BRK_0001", kind: "body", body: "Proposed body." },
  ]);
  expect(screen.getByRole("heading", { name: "Current" })).toBeTruthy();
  expect(document.querySelector("del")).not.toBeNull();
  expect(document.querySelector("ins")).not.toBeNull();
  expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
});

it("says so when a proposal changes only line breaks or spacing", async () => {
  mountApp({
    client: fakePromptClient({
      previewProposal: vi.fn(async () => ({
        apiVersion: 3 as const,
        changes: [{
          displayId: "SYS_BRK_0001",
          kind: "body" as const,
          body: "The system shall brake\n\nwithin 200 ms.",
          currentBody: BODY,
        }],
      })),
    }),
  });
  await send(await pickReady(), "split it");
  await screen.findByRole("heading", { name: "Proposed" });
  expect(screen.getByText("Only line breaks or spacing change.")).toBeTruthy();
  expect(document.querySelector("ins.whitespace")).not.toBeNull();
});

it("shows no spacing note when words change", async () => {
  mountApp();
  await send(await pickReady(), "rewrite");
  await screen.findByRole("heading", { name: "Proposed" });
  expect(screen.queryByText("Only line breaks or spacing change.")).toBeNull();
});

it("submits with the Send button", async () => {
  const { bridge } = mountApp();
  const box = await pickReady();
  fireEvent.change(box, { target: { value: "shorter" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByRole("heading", { name: "Proposed" });
  expect(bridge.runAssistantPrompt).toHaveBeenCalledTimes(1);
});

it("inserts a line break with Shift+Enter instead of submitting", async () => {
  const { bridge } = mountApp();
  const box = await pickReady();
  fireEvent.change(box, { target: { value: "first line" } });
  const notPrevented = fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
  expect(notPrevented).toBe(true);
  expect(bridge.runAssistantPrompt).not.toHaveBeenCalled();
});

it("strips a fence around the reply before the preview", async () => {
  const { client } = mountApp({
    assistant: {
      runAssistantPrompt: vi.fn(async () => ({
        outcome: "ok" as const,
        reply: "```\nX\n```",
        error: null,
      })),
    },
  });
  await send(await pickReady(), "rewrite");
  await screen.findByRole("heading", { name: "Proposed" });
  expect(client.previewProposal).toHaveBeenCalledWith('"e1"', [
    { displayId: "SYS_BRK_0001", kind: "body", body: "X" },
  ]);
});

it("shows the no-proposal error for an empty reply", async () => {
  const { client } = mountApp({
    assistant: {
      runAssistantPrompt: vi.fn(async () => ({
        outcome: "ok" as const,
        reply: "  ",
        error: null,
      })),
    },
  });
  await send(await pickReady(), "rewrite");
  expect((await screen.findByRole("alert")).textContent).toBe(
    PROMPT_MESSAGES.noProposal,
  );
  expect(client.previewProposal).not.toHaveBeenCalled();
});

it("shows the running state and cancels the assistant", async () => {
  const run = deferred<AssistantPromptResult>();
  const cancelAssistantPrompt = vi.fn(async () => {
    run.resolve({ outcome: "cancelled", reply: null, error: null });
  });
  const { client } = mountApp({
    assistant: {
      runAssistantPrompt: vi.fn(() => run.promise),
      cancelAssistantPrompt,
    },
  });
  const box = await pickReady();
  await send(box, "keep me");
  expect(await screen.findByText("Waiting for Claude Code…")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(cancelAssistantPrompt).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.queryByText("Waiting for Claude Code…")).toBeNull()
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect((await promptBox()).value).toBe("keep me");
  expect(client.previewProposal).not.toHaveBeenCalled();
});

it.each<[string, AssistantPromptResult, string]>([
  [
    "timeout",
    { outcome: "timeout", reply: null, error: null },
    PROMPT_MESSAGES.timeout,
  ],
  [
    "assistant failed",
    { outcome: "failed", reply: null, error: "auth expired" },
    "The assistant failed: auth expired",
  ],
  [
    "prompt too long",
    { outcome: "prompt-too-long", reply: null, error: null },
    PROMPT_MESSAGES.promptTooLong,
  ],
  [
    "reply too long",
    { outcome: "reply-too-long", reply: null, error: null },
    PROMPT_MESSAGES.replyTooLong,
  ],
  [
    "unavailable",
    { outcome: "unavailable", reply: null, error: null },
    "Prompts are not yet available for Claude Code.",
  ],
])("shows the %s error", async (_, result, message) => {
  mountApp({
    assistant: { runAssistantPrompt: vi.fn(async () => result) },
  });
  const box = await pickReady();
  await send(box, "keep me");
  expect((await screen.findByRole("alert")).textContent).toBe(message);
  expect(box.value).toBe("keep me");
});

it("rejects with the button and with Escape, and writes nothing", async () => {
  const { client } = mountApp();
  const box = await pickReady();
  await send(box, "rewrite");
  fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
  expect(screen.queryByRole("heading", { name: "Proposed" })).toBeNull();
  await send(box, "rewrite");
  const accept = await screen.findByRole("button", { name: "Accept" });
  fireEvent.keyDown(accept, { key: "Escape" });
  expect(screen.queryByRole("heading", { name: "Proposed" })).toBeNull();
  expect(client.applyProposal).not.toHaveBeenCalled();
  expect(box.value).toBe("rewrite");
});

it("accepts: applies with the submit ETag, then refreshes", async () => {
  // The document ETag changes after the first read, so an apply that read
  // the document again would send '"e2"' instead of the submit ETag.
  let documentReads = 0;
  const { client } = mountApp({
    client: fakePromptClient({
      document: vi.fn(async (path: string) => ({
        view: { apiVersion: 3 as const, path, html: "", entries: [] },
        etag: documentReads++ === 0 ? '"e1"' : '"e2"',
      })),
      previewProposal: vi.fn(async () => ({
        apiVersion: 3 as const,
        changes: [{
          displayId: "SYS_BRK_0001",
          kind: "body" as const,
          body: "Formatted body.",
          currentBody: BODY,
        }],
      })),
    }),
  });
  const box = await pickReady();
  await send(box, "rewrite");
  const accept = await screen.findByRole("button", { name: "Accept" });
  // Decision 21: the document (ETag) is read before the submit-time entry.
  const entryMock = vi.mocked(client.entry).mock;
  const documentOrder = vi.mocked(client.document).mock.invocationCallOrder[0];
  const freshEntryOrder = entryMock.invocationCallOrder.find((order) =>
    order > documentOrder
  );
  expect(freshEntryOrder).toBeDefined();
  // Counted after the proposal is shown, so only a refresh raises it.
  const entryCalls = entryMock.calls.length;
  fireEvent.click(accept);
  await waitFor(() =>
    expect(client.applyProposal).toHaveBeenCalledWith('"e1"', [
      { displayId: "SYS_BRK_0001", kind: "body", body: "Formatted body." },
    ])
  );
  await waitFor(() =>
    expect(entryMock.calls.length).toBeGreaterThan(entryCalls)
  );
  await waitFor(() => expect(box.value).toBe(""));
  expect(screen.queryByRole("heading", { name: "Proposed" })).toBeNull();
  // Focus goes back to the enabled prompt box.
  await waitFor(() => expect(document.activeElement).toBe(box));
});

it("moves focus to the proposal, so Escape from the focused element rejects", async () => {
  const { client } = mountApp();
  const box = await pickReady();
  box.focus();
  await send(box, "rewrite");
  const accept = await screen.findByRole("button", { name: "Accept" });
  const proposal = document.querySelector(".prompt-proposal");
  await waitFor(() => expect(document.activeElement).toBe(proposal));
  // Focus never lands on the write button by itself.
  expect(document.activeElement).not.toBe(accept);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("heading", { name: "Proposed" })).toBeNull();
  expect(client.applyProposal).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(box));
});

it("moves focus to Cancel while the assistant runs", async () => {
  const run = deferred<AssistantPromptResult>();
  mountApp({
    assistant: { runAssistantPrompt: vi.fn(() => run.promise) },
  });
  const box = await pickReady();
  box.focus();
  await send(box, "rewrite");
  const cancel = await screen.findByRole("button", { name: "Cancel" });
  await waitFor(() => expect(document.activeElement).toBe(cancel));
});

it("cancels before the shell run starts: the run never starts", async () => {
  const read = deferred<void>();
  const runAssistantPrompt = vi.fn(async () => ({
    outcome: "ok" as const,
    reply: "Late body.",
    error: null,
  }));
  const { client } = mountApp({
    client: fakePromptClient({
      document: vi.fn(async (path: string) => {
        await read.promise;
        return {
          view: { apiVersion: 3 as const, path, html: "", entries: [] },
          etag: '"e1"',
        };
      }),
    }),
    assistant: { runAssistantPrompt },
  });
  const box = await pickReady();
  await send(box, "keep me");
  await screen.findByText("Waiting for Claude Code…");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByText("Waiting for Claude Code…")).toBeNull()
  );
  await act(async () => {
    read.resolve();
  });
  expect(runAssistantPrompt).not.toHaveBeenCalled();
  expect(client.previewProposal).not.toHaveBeenCalled();
  expect(screen.queryByRole("heading", { name: "Proposed" })).toBeNull();
  expect(box.value).toBe("keep me");
});

it("reports a failed apply that ends after the selection changed", async () => {
  const apply = deferred<{ apiVersion: 3; path: string; etag: string }>();
  mountApp({
    client: fakePromptClient({ applyProposal: vi.fn(() => apply.promise) }),
  });
  await send(await pickReady(), "rewrite");
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  fireEvent.click(screen.getByRole("button", { name: "Pick second" }));
  // The write is still pending: the box stays busy.
  expect((await promptBox()).disabled).toBe(true);
  await act(async () => {
    apply.reject(new DeskError(500, "write-failed", "m"));
  });
  expect((await screen.findByRole("alert")).textContent).toBe(
    PROMPT_MESSAGES.writeFailed,
  );
});

it("does not claim the write failed when the connection is lost during apply", async () => {
  const { client } = mountApp({
    client: fakePromptClient({
      applyProposal: vi.fn(async () => {
        throw new DeskError(0, "network", "down");
      }),
    }),
  });
  await send(await pickReady(), "rewrite");
  const accept = await screen.findByRole("button", { name: "Accept" });
  const entryCalls = vi.mocked(client.entry).mock.calls.length;
  fireEvent.click(accept);
  expect(await screen.findByText(PROMPT_MESSAGES.writeUnknown)).toBeTruthy();
  expect(screen.queryByText(PROMPT_MESSAGES.writeFailed)).toBeNull();
  // The server may have written the file: every pane reads it again.
  await waitFor(() =>
    expect(vi.mocked(client.entry).mock.calls.length).toBeGreaterThan(
      entryCalls,
    )
  );
});

it("disables Accept while applying", async () => {
  const apply = deferred<
    { apiVersion: 3; path: string; etag: string }
  >();
  const { client } = mountApp({
    client: fakePromptClient({ applyProposal: vi.fn(() => apply.promise) }),
  });
  await send(await pickReady(), "rewrite");
  const accept = await screen.findByRole("button", { name: "Accept" });
  fireEvent.click(accept);
  await waitFor(() =>
    expect((accept as HTMLButtonElement).disabled).toBe(true)
  );
  const reject = screen.getByRole("button", { name: "Reject" });
  expect((reject as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(accept);
  expect(client.applyProposal).toHaveBeenCalledTimes(1);
  await act(async () => {
    apply.resolve({ apiVersion: 3, path: "docs/system.md", etag: '"e2"' });
  });
  expect(client.applyProposal).toHaveBeenCalledTimes(1);
});

it("keeps the instruction and says the file changed on 412", async () => {
  mountApp({
    client: fakePromptClient({
      applyProposal: vi.fn(async () => {
        throw new DeskError(412, "precondition-failed", "m");
      }),
    }),
  });
  const box = await pickReady();
  await send(box, "make it 150 ms");
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    PROMPT_MESSAGES.fileChanged,
  );
  expect(box.value).toBe("make it 150 ms");
});

it("says the file changed on a 412 preview", async () => {
  mountApp({
    client: fakePromptClient({
      previewProposal: vi.fn(async () => {
        throw new DeskError(412, "precondition-failed", "m");
      }),
    }),
  });
  await send(await pickReady(), "rewrite");
  expect((await screen.findByRole("alert")).textContent).toBe(
    PROMPT_MESSAGES.fileChanged,
  );
});

it.each<[string, DeskError, string]>([
  [
    "format-failed",
    new DeskError(422, "format-failed", "m"),
    PROMPT_MESSAGES.couldNotFormat,
  ],
  [
    "proposal-changes-entries",
    new DeskError(422, "proposal-changes-entries", "m"),
    PROMPT_MESSAGES.changesEntries,
  ],
  [
    "entry-trailer-invalid",
    new DeskError(409, "entry-trailer-invalid", "m"),
    PROMPT_MESSAGES.trailerInvalid,
  ],
  [
    "entry-body-empty",
    new DeskError(409, "entry-body-empty", "m"),
    "This entry has no body yet.",
  ],
  [
    "proposal-too-large",
    new DeskError(422, "proposal-too-large", "m"),
    PROMPT_MESSAGES.proposalTooLong,
  ],
  [
    "proposal-empty",
    new DeskError(422, "proposal-empty", "m"),
    PROMPT_MESSAGES.noProposal,
  ],
  [
    "entry-not-found",
    new DeskError(404, "entry-not-found", "m"),
    PROMPT_MESSAGES.fileChanged,
  ],
  [
    "not-found",
    new DeskError(404, "not-found", "m"),
    PROMPT_MESSAGES.fileChanged,
  ],
  [
    "entry-read-only",
    new DeskError(409, "entry-read-only", "m"),
    PROMPT_MESSAGES.readOnly,
  ],
  [
    "entry-file-not-utf8",
    new DeskError(409, "entry-file-not-utf8", "m"),
    PROMPT_MESSAGES.notUtf8,
  ],
  [
    "another preview error",
    new DeskError(400, "bad-request", "m"),
    PROMPT_MESSAGES.couldNotFormat,
  ],
])("maps a %s preview to its message", async (_, error, message) => {
  mountApp({
    client: fakePromptClient({
      previewProposal: vi.fn(async () => {
        throw error;
      }),
    }),
  });
  await send(await pickReady(), "rewrite");
  expect((await screen.findByRole("alert")).textContent).toBe(message);
});

it.each<[string, DeskError, string]>([
  [
    "entry-not-found",
    new DeskError(404, "entry-not-found", "m"),
    PROMPT_MESSAGES.fileChanged,
  ],
  [
    "not-found",
    new DeskError(404, "not-found", "m"),
    PROMPT_MESSAGES.fileChanged,
  ],
])("says the file changed on a %s apply", async (_, error, message) => {
  mountApp({
    client: fakePromptClient({
      applyProposal: vi.fn(async () => {
        throw error;
      }),
    }),
  });
  const box = await pickReady();
  await send(box, "rewrite");
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  expect((await screen.findByRole("alert")).textContent).toBe(message);
  expect(box.value).toBe("rewrite");
});

it("shows write-failed for another apply error", async () => {
  mountApp({
    client: fakePromptClient({
      applyProposal: vi.fn(async () => {
        throw new DeskError(500, "write-failed", "m");
      }),
    }),
  });
  await send(await pickReady(), "rewrite");
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    PROMPT_MESSAGES.writeFailed,
  );
});

it("discards the proposal when the selection changes", async () => {
  const { client } = mountApp();
  await send(await pickReady(), "rewrite");
  await screen.findByRole("heading", { name: "Proposed" });
  fireEvent.click(screen.getByRole("button", { name: "Pick second" }));
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Proposed" })).toBeNull()
  );
  expect(client.applyProposal).not.toHaveBeenCalled();
});

it("cancels a running prompt when the selection changes", async () => {
  const run = deferred<AssistantPromptResult>();
  const cancelAssistantPrompt = vi.fn(async () => {});
  const { client } = mountApp({
    assistant: {
      runAssistantPrompt: vi.fn(() => run.promise),
      cancelAssistantPrompt,
    },
  });
  await send(await pickReady(), "rewrite");
  await screen.findByText("Waiting for Claude Code…");
  fireEvent.click(screen.getByRole("button", { name: "Pick second" }));
  await waitFor(() => expect(cancelAssistantPrompt).toHaveBeenCalled());
  await act(async () => {
    run.resolve({ outcome: "ok", reply: "Late body.", error: null });
  });
  expect(screen.queryByText("Waiting for Claude Code…")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Proposed" })).toBeNull();
  expect(client.previewProposal).not.toHaveBeenCalled();
});

it("reports a lost connection from a proposal call", async () => {
  mountApp({
    client: fakePromptClient({
      previewProposal: vi.fn(async () => {
        throw new DeskError(0, "network", "down");
      }),
    }),
  });
  const box = await pickReady();
  await send(box, "rewrite");
  expect(await screen.findByText(MESSAGES.lostConnection)).toBeTruthy();
  // The banner names the cause; the column shows no wrong sentence.
  await waitFor(() =>
    expect(screen.queryByText("Waiting for Claude Code…")).toBeNull()
  );
  expect(screen.queryByText(PROMPT_MESSAGES.couldNotFormat)).toBeNull();
  expect(box.value).toBe("rewrite");
});

it("never puts focus on Accept when focus left the panel during the run", async () => {
  const run = deferred<AssistantPromptResult>();
  mountApp({
    assistant: { runAssistantPrompt: vi.fn(() => run.promise) },
  });
  const box = await pickReady();
  box.focus();
  await send(box, "rewrite");
  const cancel = await screen.findByRole("button", { name: "Cancel" });
  await waitFor(() => expect(document.activeElement).toBe(cancel));
  // The author clicks a non-focusable area: focus goes to the body.
  cancel.blur();
  expect(document.activeElement).toBe(document.body);
  await act(async () => {
    run.resolve({ outcome: "ok", reply: "Proposed body.", error: null });
  });
  const accept = await screen.findByRole("button", { name: "Accept" });
  expect(document.activeElement).not.toBe(accept);
});

it("ignores a second Accept in the same tick", async () => {
  const apply = deferred<{ apiVersion: 3; path: string; etag: string }>();
  const { client } = mountApp({
    client: fakePromptClient({ applyProposal: vi.fn(() => apply.promise) }),
  });
  await send(await pickReady(), "rewrite");
  const accept = await screen.findByRole("button", { name: "Accept" });
  act(() => {
    fireEvent.click(accept);
    fireEvent.click(accept);
  });
  expect(client.applyProposal).toHaveBeenCalledTimes(1);
  await act(async () => {
    apply.resolve({ apiVersion: 3, path: "docs/system.md", etag: '"e2"' });
  });
});

it.each<[string, Record<string, unknown>]>([
  ["isComposing", { isComposing: true }],
  ["keyCode 229", { keyCode: 229 }],
])("does not submit the Enter that ends an IME composition (%s)", async (
  _,
  init,
) => {
  const { bridge } = mountApp();
  const box = await pickReady();
  fireEvent.change(box, { target: { value: "partial" } });
  const notPrevented = fireEvent.keyDown(box, { key: "Enter", ...init });
  expect(notPrevented).toBe(true);
  expect(screen.queryByText("Waiting for Claude Code…")).toBeNull();
  await act(async () => {});
  expect(bridge.runAssistantPrompt).not.toHaveBeenCalled();
});

it("checks the entry read at submit against the disabled reasons", async () => {
  let entryReads = 0;
  const { bridge } = mountApp({
    client: fakePromptClient({
      entry: vi.fn(async (id: string) =>
        entryFixture(id, entryReads++ === 0 ? {} : { body: "" })
      ),
    }),
  });
  const box = await pickReady();
  await send(box, "rewrite");
  expect((await screen.findByRole("alert")).textContent).toBe(
    "This entry has no body yet.",
  );
  expect(bridge.runAssistantPrompt).not.toHaveBeenCalled();
  expect(box.value).toBe("rewrite");
});

it("shows no read-failed sentence for a lost connection at submit", async () => {
  mountApp({
    client: fakePromptClient({
      document: vi.fn(async () => {
        throw new DeskError(0, "network", "down");
      }),
    }),
  });
  const box = await pickReady();
  await send(box, "rewrite");
  expect(await screen.findByText(MESSAGES.lostConnection)).toBeTruthy();
  await waitFor(() =>
    expect(screen.queryByText("Waiting for Claude Code…")).toBeNull()
  );
  expect(screen.queryByText(PROMPT_MESSAGES.readFailed)).toBeNull();
  expect(box.value).toBe("rewrite");
});

it("links the disabled reason to the prompt box", async () => {
  mountApp();
  const box = await promptBox();
  const reason = await screen.findByText("Select an entry to send a prompt.");
  expect(reason.id).not.toBe("");
  expect(box.getAttribute("aria-describedby")).toBe(reason.id);
});

it("disables the column's Settings button while a write is applying", async () => {
  const apply = deferred<{ apiVersion: 3; path: string; etag: string }>();
  mountApp({
    client: fakePromptClient({ applyProposal: vi.fn(() => apply.promise) }),
  });
  await send(await pickReady(), "rewrite");
  const settings = screen.getByRole("button", { name: "Settings" });
  expect((settings as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  await waitFor(() =>
    expect((settings as HTMLButtonElement).disabled).toBe(true)
  );
  await act(async () => {
    apply.resolve({ apiVersion: 3, path: "docs/system.md", etag: '"e2"' });
  });
  await waitFor(() =>
    expect((settings as HTMLButtonElement).disabled).toBe(false)
  );
});
