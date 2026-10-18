import { useEffect, useRef } from "react";
import { useAssistants } from "../assistant/AssistantProvider";
import {
  type AssistantInfo,
  assistantName,
  ASSISTANTS,
} from "../assistant/catalog";
import { useBridge } from "../shell/BridgeContext";
import type {
  AssistantId,
  AssistantState,
  AssistantTestResult,
} from "../shell/bridge";

const STATE_LABELS: Record<AssistantState, string> = {
  "ready": "Ready",
  "needs-sign-in": "Needs sign-in",
  "not-installed": "Not installed",
};

const COPILOT_NOTE = "Sign-in not confirmed. Sign in, then press Test.";

/** One line describing how a Test ended. */
function testMessage(result: AssistantTestResult, id: AssistantId): string {
  const name = assistantName(id);
  switch (result.outcome) {
    case "ok":
      return `Reply: ${result.reply ?? ""}`;
    case "usage":
      return `This version of ${name} does not support the test command. Update it and try again.`;
    case "timeout":
      return `${name} did not answer within 60 seconds.`;
    case "cancelled":
      return "Test cancelled.";
    case "failed":
      return `Test failed: ${result.error ?? "unknown error"}`;
  }
}

function CopyableCommand(props: { label?: string; command: string }) {
  return (
    <div className="settings-command">
      {props.label && (
        <span className="settings-command-label">{props.label}</span>
      )}
      <code>{props.command}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(props.command)?.catch(() => {});
        }}
      >
        Copy
      </button>
    </div>
  );
}

function InstallBlock({ info }: { info: AssistantInfo }) {
  const bridge = useBridge();
  const { recheck } = useAssistants();
  return (
    <div
      role="group"
      aria-label={`${info.name} install`}
      className="settings-install"
    >
      <h4>{info.name}</h4>
      <p>{info.description}</p>
      <button
        type="button"
        className="settings-link"
        onClick={() =>
          void bridge.openExternal(info.installPage).catch(() => {})}
      >
        Official install page
      </button>
      {info.installCommands.map((item) => (
        <CopyableCommand key={item.command} {...item} />
      ))}
      <p>Sign in:</p>
      <CopyableCommand command={info.signInCommand} />
      {info.signInNote && <p>{info.signInNote}</p>}
      <button type="button" onClick={() => void recheck()}>Re-check</button>
    </div>
  );
}

/** Settings: the assistant choice and Test, plus the install guide. */
export function SettingsView(props: { onBack(): void; focus?: "install" }) {
  const { statuses, settings, test, recheck, select, runTest, cancelTest } =
    useAssistants();
  const guide = useRef<HTMLElement>(null);

  useEffect(() => {
    if (props.focus === "install") guide.current?.scrollIntoView?.();
  }, [props.focus]);

  const selected = settings?.selected ?? null;
  const installed = (statuses ?? []).filter((s) => s.state !== "not-installed");

  return (
    <main className="settings">
      <header className="settings-header">
        <button type="button" onClick={props.onBack}>Back</button>
        <h2>Settings</h2>
      </header>
      <section aria-labelledby="settings-assistant">
        <h3 id="settings-assistant">Assistant</h3>
        <ul className="settings-rows">
          {(statuses ?? []).map((status) => (
            <li key={status.id}>
              <strong>{assistantName(status.id)}</strong>{" "}
              <span>{STATE_LABELS[status.state]}</span>
              {status.version && <small>{status.version}</small>}
              {status.id === "copilot" && status.state === "needs-sign-in" && (
                <p>{COPILOT_NOTE}</p>
              )}
            </li>
          ))}
        </ul>
        <div role="radiogroup" aria-label="Selected assistant">
          {installed.map((status) => (
            <label key={status.id}>
              <input
                type="radio"
                name="assistant"
                aria-label={assistantName(status.id)}
                checked={selected === status.id}
                onChange={() => void select(status.id)}
              />
              {assistantName(status.id)}
            </label>
          ))}
          <label>
            <input
              type="radio"
              name="assistant"
              aria-label="None"
              checked={selected === null}
              onChange={() => void select(null)}
            />
            None
          </label>
        </div>
        <div className="settings-actions">
          <button type="button" onClick={() => void recheck()}>Re-check</button>
          <button
            type="button"
            disabled={selected === null || test.running}
            onClick={() => void runTest()}
          >
            Test
          </button>
          {test.running && (
            <>
              <span>Testing…</span>
              <button type="button" onClick={() => void cancelTest()}>
                Cancel
              </button>
            </>
          )}
        </div>
        {!test.running && test.result && selected && (
          <p role="status">{testMessage(test.result, selected)}</p>
        )}
      </section>
      <section
        id="install-guide"
        ref={guide}
        aria-labelledby="settings-install"
      >
        <h3 id="settings-install">Install an assistant</h3>
        {ASSISTANTS.map((info) => <InstallBlock key={info.id} info={info} />)}
      </section>
    </main>
  );
}
