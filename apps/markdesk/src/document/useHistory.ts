import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";

/** The selection history shared by the panes. */
export interface History {
  /** The selected display ID. */
  current?: string;
  /** Select `id`. Drops the forward entries. Selecting `current` does nothing. */
  select(id: string): void;
  back(): void;
  forward(): void;
  canBack: boolean;
  canForward: boolean;
}

interface HistoryState {
  entries: readonly string[];
  index: number;
}

type HistoryStep =
  | { type: "select"; id: string }
  | { type: "back" }
  | { type: "forward" };

const EMPTY: HistoryState = { entries: [], index: -1 };

function step(state: HistoryState, action: HistoryStep): HistoryState {
  switch (action.type) {
    case "select":
      if (state.entries[state.index] === action.id) return state;
      return {
        entries: [...state.entries.slice(0, state.index + 1), action.id],
        index: state.index + 1,
      };
    case "back":
      return state.index > 0 ? { ...state, index: state.index - 1 } : state;
    case "forward":
      return state.index < state.entries.length - 1
        ? { ...state, index: state.index + 1 }
        : state;
  }
}

/**
 * Map a key press to a history move: Alt+Left and Alt+Right everywhere,
 * Cmd+[ and Cmd+] on macOS. Any other modifier cancels the move.
 */
export function historyKeyAction(
  event: Pick<
    KeyboardEvent,
    "key" | "altKey" | "metaKey" | "ctrlKey" | "shiftKey"
  >,
  mac: boolean,
): "back" | "forward" | undefined {
  if (event.shiftKey || event.ctrlKey) return undefined;
  if (event.altKey && !event.metaKey) {
    if (event.key === "ArrowLeft") return "back";
    if (event.key === "ArrowRight") return "forward";
  }
  if (mac && event.metaKey && !event.altKey) {
    if (event.key === "[") return "back";
    if (event.key === "]") return "forward";
  }
  return undefined;
}

function isMac(): boolean {
  return typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent);
}

const HistoryContext = createContext<History>({
  select: () => {},
  back: () => {},
  forward: () => {},
  canBack: false,
  canForward: false,
});

/**
 * Holds the selection history for the panes below it and binds the history
 * keys and the mouse back and forward buttons on the window. Give it a `key`
 * per product so the history starts empty when another product opens.
 */
export function HistoryProvider(
  { children, mac = isMac() }: { children: ReactNode; mac?: boolean },
) {
  const [state, dispatch] = useReducer(step, EMPTY);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const move = historyKeyAction(event, mac);
      if (move === undefined) return;
      event.preventDefault();
      dispatch({ type: move });
    };
    // Mouse buttons 3 and 4 are the back and forward side buttons.
    const onMouse = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      dispatch({ type: event.button === 3 ? "back" : "forward" });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, [mac]);

  const value = useMemo<History>(() => ({
    current: state.entries[state.index],
    select: (id) => dispatch({ type: "select", id }),
    back: () => dispatch({ type: "back" }),
    forward: () => dispatch({ type: "forward" }),
    canBack: state.index > 0,
    canForward: state.index < state.entries.length - 1,
  }), [state]);

  return createElement(HistoryContext.Provider, { value }, children);
}

/** The shared selection history. */
export function useHistory(): History {
  return useContext(HistoryContext);
}
