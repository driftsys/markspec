import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useState,
} from "react";

/** The selected entry and the way to change it. */
export interface Selection {
  selected?: string;
  select(id: string): void;
}

const SelectionContext = createContext<Selection>({ select: () => {} });

/** Holds the selected display ID for the panes below it. */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, select] = useState<string>();
  return createElement(SelectionContext.Provider, {
    value: { selected, select },
  }, children);
}

/** The shared selection. */
export function useSelection(): Selection {
  return useContext(SelectionContext);
}
