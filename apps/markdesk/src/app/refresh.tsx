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
  /** Ask every pane to check its data with the server. */
  refresh(): void;
}

const RefreshContext = createContext<Refresh>({
  revision: 0,
  refresh() {},
});

/**
 * Holds one refresh counter for the panes below it. The counter is bumped
 * when the window receives focus, because the author may have edited the
 * product's files in another application, and by {@linkcode Refresh.refresh}
 * after a write made by MarkDesk itself. The navigator and the document pane
 * both revalidate on it, so the two panes never disagree for long.
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
