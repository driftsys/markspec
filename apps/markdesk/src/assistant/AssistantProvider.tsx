import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AssistantId,
  AssistantSettings,
  AssistantStatus,
  AssistantTestResult,
} from "../shell/bridge";
import { useBridge } from "../shell/BridgeContext";

/**
 * Assistant detection, the stored choice, and the Test state. No method
 * rejects: bridge failures become state (a failed Test result, not-installed
 * statuses with a detail) or leave the state unchanged.
 */
export interface AssistantController {
  /** `undefined` until the first detection returns. */
  statuses: AssistantStatus[] | undefined;
  detecting: boolean;
  /** `undefined` until the stored settings are read. */
  settings: AssistantSettings | undefined;
  test: { running: boolean; result: AssistantTestResult | undefined };
  recheck(): Promise<void>;
  select(id: AssistantId | null): Promise<void>;
  dismissCard(): Promise<void>;
  /** Tests the selected assistant. No-op when none is selected or a Test runs. */
  runTest(): Promise<void>;
  cancelTest(): Promise<void>;
}

const ASSISTANT_IDS: AssistantId[] = ["claude-code", "codex", "copilot"];

const DEFAULT_SETTINGS: AssistantSettings = {
  selected: null,
  cardDismissed: false,
  copilotConfirmed: false,
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const AssistantContext = createContext<AssistantController | undefined>(
  undefined,
);

/** Provides the assistant state to the Settings view and the assistant column. */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const bridge = useBridge();
  const [statuses, setStatuses] = useState<AssistantStatus[]>();
  const [detecting, setDetecting] = useState(true);
  const [settings, setSettings] = useState<AssistantSettings>();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AssistantTestResult>();
  // The Rust side shares one cancel flag across Tests, so a second Test must
  // never start while one runs. A ref is read synchronously, unlike state.
  const runningRef = useRef(false);
  const settingsRef = useRef<AssistantSettings | undefined>(undefined);
  settingsRef.current = settings;

  const recheck = useCallback(async () => {
    setDetecting(true);
    try {
      setStatuses(await bridge.detectAssistants());
    } catch (error) {
      setStatuses(ASSISTANT_IDS.map((id) => ({
        id,
        state: "not-installed" as const,
        version: null,
        detail: `Detection failed: ${messageOf(error)}`,
      })));
    } finally {
      setDetecting(false);
    }
  }, [bridge]);

  useEffect(() => {
    let active = true;
    void recheck();
    bridge.getAssistantSettings().then(
      (stored) => {
        if (active) setSettings(stored);
      },
      () => {
        if (active) setSettings(DEFAULT_SETTINGS);
      },
    );
    return () => {
      active = false;
    };
  }, [bridge, recheck]);

  const store = useCallback(async (next: AssistantSettings) => {
    try {
      await bridge.setAssistantSettings(next);
      setSettings(next);
    } catch {
      // The stored choice did not change, so the local state stays as it is.
    }
  }, [bridge]);

  const select = useCallback(async (id: AssistantId | null) => {
    const current = settingsRef.current;
    if (current) await store({ ...current, selected: id });
  }, [store]);

  const dismissCard = useCallback(async () => {
    const current = settingsRef.current;
    if (current) await store({ ...current, cardDismissed: true });
  }, [store]);

  const runTest = useCallback(async () => {
    const id = settingsRef.current?.selected;
    if (!id || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setResult(undefined);
    try {
      try {
        setResult(await bridge.testAssistant(id));
      } catch (error) {
        setResult({ outcome: "failed", reply: null, error: messageOf(error) });
      }
      if (id === "copilot") {
        // A Copilot Test can confirm Copilot on the Rust side, which changes
        // both the stored settings and the detected state. A failed re-read
        // keeps the Test result.
        try {
          setSettings(await bridge.getAssistantSettings());
        } catch {
          // Keep the settings read earlier.
        }
        await recheck();
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [bridge, recheck]);

  const cancelTest = useCallback(async () => {
    try {
      await bridge.cancelAssistantTest();
    } catch {
      // Nothing to cancel, or the shell is gone; the Test result reports it.
    }
  }, [bridge]);

  const value = useMemo<AssistantController>(() => ({
    statuses,
    detecting,
    settings,
    test: { running, result },
    recheck,
    select,
    dismissCard,
    runTest,
    cancelTest,
  }), [
    statuses,
    detecting,
    settings,
    running,
    result,
    recheck,
    select,
    dismissCard,
    runTest,
    cancelTest,
  ]);

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
}

/** The assistant controller. Throws when used outside `AssistantProvider`. */
export function useAssistants(): AssistantController {
  const controller = useContext(AssistantContext);
  if (controller === undefined) {
    throw new Error("No assistant provider is available.");
  }
  return controller;
}
