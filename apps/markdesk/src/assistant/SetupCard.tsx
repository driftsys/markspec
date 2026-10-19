import { useAssistants } from "./AssistantProvider";
import { assistantName, ASSISTANTS, STATE_LABELS } from "./catalog";
import { CopyableCommand } from "./CopyableCommand";

const COPILOT_NOTE = "Sign-in not confirmed. Sign in, then press Test.";

/** First-run card: pick an assistant, finish sign-in, or open the install guide. */
export function SetupCard(props: { onOpenSettings(focus?: "install"): void }) {
  const { statuses, detecting, recheck, select, dismissCard } = useAssistants();

  if (detecting || statuses === undefined) {
    return <p className="assistant-empty">Looking for assistants…</p>;
  }

  const noneInstalled = statuses.every((s) => s.state === "not-installed");

  return (
    <div className="setup-card">
      {noneInstalled && (
        <>
          <p>No assistant found. Set one up</p>
          <button type="button" onClick={() => props.onOpenSettings("install")}>
            Open install guide
          </button>
        </>
      )}
      <ul className="settings-rows">
        {statuses.map((status) => {
          const info = ASSISTANTS.find((a) => a.id === status.id);
          const name = assistantName(status.id);
          const isCopilot = status.id === "copilot";
          const canUse = status.state === "ready" ||
            (isCopilot && status.state === "needs-sign-in");
          return (
            <li key={status.id} className="setup-row">
              <strong>{name}</strong> <span>{STATE_LABELS[status.state]}</span>
              {canUse && (
                <button
                  type="button"
                  onClick={() => void select(status.id)}
                >
                  Use
                </button>
              )}
              {status.state === "needs-sign-in" && info && (
                <>
                  {isCopilot && <p>{COPILOT_NOTE}</p>}
                  <CopyableCommand command={info.signInCommand} />
                  {info.signInNote && <p>{info.signInNote}</p>}
                  <button type="button" onClick={() => void recheck()}>
                    Re-check
                  </button>
                </>
              )}
              {status.state === "not-installed" && (
                <button
                  type="button"
                  onClick={() => props.onOpenSettings("install")}
                >
                  Install…
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={() => void dismissCard()}>Not now</button>
    </div>
  );
}
