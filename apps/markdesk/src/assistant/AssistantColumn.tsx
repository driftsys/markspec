import { useState } from "react";
import { useAssistants } from "./AssistantProvider";
import { assistantName } from "./catalog";
import { PromptPanel } from "./PromptPanel";
import { SetupCard } from "./SetupCard";

const STATE_PHRASES = {
  "needs-sign-in": "needs sign-in",
  "not-installed": "is not installed",
} as const;

/** Assistant column: the setup card, the setup pointer, or the selected assistant. */
export function AssistantColumn(props: {
  onOpenSettings(focus?: "install"): void;
}) {
  const { settings, statuses } = useAssistants();
  // Leaving the column during a write would unmount the prompt panel and
  // drop the write's result, so Settings waits for the write to end.
  const [applying, setApplying] = useState(false);

  // Neutral empty column until the stored settings are read.
  if (settings === undefined) return <div className="assistant-column" />;

  const selected = settings.selected;

  if (selected === null) {
    return (
      <div className="assistant-column">
        {settings.cardDismissed
          ? (
            <>
              <p className="assistant-empty">
                Set up an assistant to ask questions about this product.
              </p>
              <textarea
                disabled
                aria-label="Prompt"
                placeholder="Set up an assistant first"
              />
              <button type="button" onClick={() => props.onOpenSettings()}>
                Set up
              </button>
            </>
          )
          : <SetupCard onOpenSettings={props.onOpenSettings} />}
      </div>
    );
  }

  const name = assistantName(selected);
  const state = statuses?.find((s) => s.id === selected)?.state;
  const heading = state === undefined
    ? name
    : state === "ready"
    ? `${name} · Ready`
    : `${name} ${STATE_PHRASES[state]}`;

  return (
    <div className="assistant-column">
      <p className="assistant-empty">{heading}</p>
      <PromptPanel onApplyingChange={setApplying} />
      <button
        type="button"
        disabled={applying}
        onClick={() => props.onOpenSettings()}
      >
        Settings
      </button>
    </div>
  );
}
