/** A command shown as text with a Copy button. MarkDesk never runs it. */
export function CopyableCommand(props: { label?: string; command: string }) {
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
