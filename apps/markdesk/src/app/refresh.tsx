import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/** The shared refresh signal of an open product. */
export interface Refresh {
  /** Bumped on each refresh. Panes read their data again when it changes. */
  revision: number;
  /**
   * Ask every pane to check its data with the server. Window focus calls it,
   * and the prompt flow calls it after an accepted proposal is written.
   */
  refresh(): void;
}

const RefreshContext = createContext<Refresh>({
  revision: 0,
  refresh() {},
});

/**
 * Holds one refresh counter for the panes below it. The counter is bumped
 * when the window receives focus, because the author may have edited the
 * product's files in another application. The navigator and the document
 * pane both revalidate on it, so they show the same state of the files.
 */
export function RefreshProvider(props: { children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((count) => count + 1), []);
  useEffect(() => {
    globalThis.addEventListener("focus", refresh);
    return () => globalThis.removeEventListener("focus", refresh);
  }, [refresh]);
  const value = useMemo(() => ({ revision, refresh }), [revision, refresh]);
  return (
    <RefreshContext.Provider value={value}>
      {props.children}
    </RefreshContext.Provider>
  );
}

/** The shared refresh signal. Without a provider, nothing ever refreshes. */
export function useRefresh(): Refresh {
  return useContext(RefreshContext);
}
