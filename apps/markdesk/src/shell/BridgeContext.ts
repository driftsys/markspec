import { createContext, useContext } from "react";
import type { ShellBridge } from "./bridge";

/**
 * Carries the shell bridge to the panes. `App` provides it from its `bridge`
 * prop, so panes never import the Tauri-backed bridge themselves.
 */
export const BridgeContext = createContext<ShellBridge | undefined>(
  undefined,
);

/** The shell bridge. Throws when used outside `App`. */
export function useBridge(): ShellBridge {
  const bridge = useContext(BridgeContext);
  if (bridge === undefined) throw new Error("No shell bridge is provided.");
  return bridge;
}
