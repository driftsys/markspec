import type { JSX, KeyboardEvent } from "react";
import { usePrompt } from "./usePrompt";
import { diffWords } from "./wordDiff";

/** The current and the proposed body, with the changed words marked. */
function ProposalView(props: { currentBody: string; proposedBody: string }) {
  const parts = diffWords(props.currentBody, props.proposedBody);
  return (
    <div className="proposal">
      <h4>Current</h4>
      <p className="proposal-body">
        {parts.map((part, index) =>
          part.kind === "same"
            ? <span key={index}>{part.text}</span>
            : part.kind === "removed"
            ? <del key={index}>{part.text}</del>
            : null
        )}
      </p>
      <h4>Proposed</h4>
      <p className="proposal-body">
        {parts.map((part, index) =>
          part.kind === "same"
            ? <span key={index}>{part.text}</span>
            : part.kind === "added"
            ? <ins key={index}>{part.text}</ins>
            : null
        )}
      </p>
    </div>
  );
}

/**
 * The prompt box of the assistant column: the instruction, the running
 * state, the proposal with Accept and Reject, and the error sentence.
 * Enter submits, Shift+Enter inserts a line break, Escape rejects a shown
 * proposal.
 */
export function PromptPanel(): JSX.Element {
  const prompt = usePrompt();
  const { phase, disabledReason } = prompt;
  const busy = phase.kind === "running" || phase.kind === "proposal" ||
    phase.kind === "applying";
  const boxDisabled = disabledReason !== undefined || busy;

  const onBoxKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    void prompt.submit();
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && phase.kind === "proposal") {
      event.preventDefault();
      prompt.reject();
    }
  };

  return (
    <div className="prompt-panel" onKeyDown={onPanelKeyDown}>
      <textarea
        aria-label="Prompt"
        disabled={boxDisabled}
        placeholder={disabledReason ??
          "Ask the assistant to change this entry's body"}
        value={prompt.instruction}
        onChange={(event) => prompt.setInstruction(event.target.value)}
        onKeyDown={onBoxKeyDown}
      />
      {disabledReason !== undefined && (
        <p className="prompt-reason">{disabledReason}</p>
      )}
      {!busy && (
        <button
          type="button"
          disabled={disabledReason !== undefined ||
            prompt.instruction.trim() === ""}
          onClick={() => void prompt.submit()}
        >
          Send
        </button>
      )}
      {phase.kind === "running" && (
        <div className="prompt-running">
          <p>Waiting for {prompt.assistantName}…</p>
          <button type="button" onClick={() => void prompt.cancel()}>
            Cancel
          </button>
        </div>
      )}
      {(phase.kind === "proposal" || phase.kind === "applying") && (
        <>
          <ProposalView
            currentBody={phase.currentBody}
            proposedBody={phase.proposedBody}
          />
          <div className="prompt-actions">
            <button
              type="button"
              disabled={phase.kind === "applying"}
              onClick={() => void prompt.accept()}
            >
              Accept
            </button>
            <button
              type="button"
              disabled={phase.kind === "applying"}
              onClick={() => prompt.reject()}
            >
              Reject
            </button>
          </div>
        </>
      )}
      {phase.kind === "error" && (
        <p role="alert" className="prompt-error">{phase.message}</p>
      )}
    </div>
  );
}
