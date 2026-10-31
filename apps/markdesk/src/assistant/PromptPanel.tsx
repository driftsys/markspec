import {
  type JSX,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { usePrompt } from "./usePrompt";
import { diffWords } from "./wordDiff";

/** The current and the proposed body, with the changed words marked. */
function ProposalView(props: { currentBody: string; proposedBody: string }) {
  // The diff can reach a million cells; compute it once per proposal, not
  // on every re-render of the panel.
  const parts = useMemo(
    () => diffWords(props.currentBody, props.proposedBody),
    [props.currentBody, props.proposedBody],
  );
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
 *
 * Focus follows the flow: the box is disabled while busy, and a browser
 * moves focus off a disabled control, so focus moves to Cancel while the
 * assistant runs and to Accept when the proposal appears. Escape then
 * reaches the panel. When the flow ends, focus returns to the box, unless
 * the author has moved it outside the panel.
 */
export function PromptPanel(): JSX.Element {
  const prompt = usePrompt();
  const { phase, disabledReason } = prompt;
  const busy = phase.kind === "running" || phase.kind === "proposal" ||
    phase.kind === "applying";
  const boxDisabled = disabledReason !== undefined || busy;

  const panelRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const previousKind = useRef(phase.kind);
  useEffect(() => {
    const before = previousKind.current;
    previousKind.current = phase.kind;
    if (before === phase.kind) return;
    const active = document.activeElement;
    const focusInPanel = active === null || active === document.body ||
      (panelRef.current?.contains(active) ?? false);
    if (!focusInPanel) return;
    if (phase.kind === "running") cancelRef.current?.focus();
    else if (phase.kind === "proposal") acceptRef.current?.focus();
    else if (phase.kind === "idle" || phase.kind === "error") {
      boxRef.current?.focus();
    }
  }, [phase.kind]);

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
    <div className="prompt-panel" ref={panelRef} onKeyDown={onPanelKeyDown}>
      <textarea
        ref={boxRef}
        aria-label="Prompt"
        disabled={boxDisabled}
        placeholder={disabledReason ??
          "Ask the assistant to change this entry's body"}
        value={prompt.instruction}
        onChange={(event) =>
          prompt.setInstruction(event.target.value)}
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
          <button
            type="button"
            ref={cancelRef}
            onClick={() => void prompt.cancel()}
          >
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
              ref={acceptRef}
              disabled={phase.kind === "applying"}
              onClick={() => void prompt.accept()}
            >
              Accept
            </button>
            <button
              type="button"
              disabled={phase.kind === "applying"}
              onClick={() =>
                prompt.reject()}
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
