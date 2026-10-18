import type { RecentProduct } from "../shell/bridge";
import type { ProductError } from "./useProduct";

/** Technical details behind an error, collapsed by default. */
export function ErrorDetails({ details }: { details?: string }) {
  if (!details) return null;
  return (
    <details>
      <summary>Details</summary>
      <pre>{details}</pre>
    </details>
  );
}

/** Shown when no product is open. */
export function StartScreen(props: {
  recents: RecentProduct[];
  error?: ProductError;
  onPick(): void;
  onOpenRecent(root: string): void;
  onRemoveRecent(root: string): void;
}) {
  const { recents, error } = props;
  return (
    <main className="start-screen">
      <h1>MarkDesk</h1>
      <p>Open a product to start reading and writing requirements.</p>
      <button type="button" onClick={props.onPick}>
        Open a product folder…
      </button>
      {error && (
        <div role="alert">
          <p>{error.message}</p>
          <ErrorDetails details={error.details} />
        </div>
      )}
      {recents.length > 0 && (
        <section>
          <h2>Recent</h2>
          <ul>
            {recents.map((recent) => (
              <li key={recent.root}>
                {recent.exists
                  ? (
                    <button
                      type="button"
                      onClick={() => props.onOpenRecent(recent.root)}
                    >
                      {recent.name ?? recent.root}
                    </button>
                  )
                  : (
                    <>
                      <span>{recent.name ?? recent.root}</span>{" "}
                      <span>folder not found</span>{" "}
                      <button
                        type="button"
                        onClick={() => props.onRemoveRecent(recent.root)}
                      >
                        Remove from list
                      </button>
                    </>
                  )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
