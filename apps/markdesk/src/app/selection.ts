import { HistoryProvider, useHistory } from "../document/useHistory";

/** The selected entry and the way to change it. */
export interface Selection {
  selected?: string;
  select(id: string): void;
}

/**
 * Holds the selected display ID for the panes below it. The selection is the
 * current item of the history kept by {@linkcode HistoryProvider}.
 */
export const SelectionProvider = HistoryProvider;

/** The shared selection. */
export function useSelection(): Selection {
  const { current, select } = useHistory();
  return { selected: current, select };
}
