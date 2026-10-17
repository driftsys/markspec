import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  createDeskClient,
  type DeskClient,
  DeskError,
  EXPECTED_API_VERSION,
} from "../api/client";
import type {
  OpenedProduct,
  OpenProductFailure,
  RecentProduct,
  ShellBridge,
} from "../shell/bridge";

/** Exact user-facing messages of the open flow. */
export const MESSAGES = {
  notAProduct: "This folder doesn't contain a MarkSpec product.",
  openFailed: "MarkDesk could not open this product.",
  versionMismatch:
    "This version of MarkDesk does not match the installed markspec.",
  lostConnection: "MarkDesk lost the connection to this product.",
} as const;

/** The product that is currently open. */
export interface OpenProduct {
  root: string;
  name: string;
  /** Client wrapped with {@linkcode watchConnection}. */
  client: DeskClient;
}

/** An error to show to the user, with optional technical details. */
export interface ProductError {
  kind: "not-a-product" | "failed" | "version";
  message: string;
  details?: string;
}

/** State of the open flow. */
export interface ProductState {
  /**
   * `launching` lasts until the recent list is read and the launch open, if
   * any, has started. `opening` lasts while an open is in progress.
   */
  status: "launching" | "start" | "opening" | "open" | "error";
  /** Kept while an error is shown or the connection is lost. */
  product?: OpenProduct;
  error?: ProductError;
  /** `true` when the connection to `product` was lost. Independent of `error`. */
  lost?: boolean;
  /** Folder being opened, while `status` is `opening`. */
  openingPath?: string;
}

/** Result of {@linkcode useProduct}. */
export interface ProductController extends ProductState {
  recents: RecentProduct[];
  /** Open the product folder at `path`. A failure keeps the current product. */
  open(path: string): Promise<void>;
  /** Open the current product again, for example after a lost connection. */
  reopen(): Promise<void>;
  /** Remove a recent folder from the list, then refresh the list. */
  removeRecent(root: string): Promise<void>;
  /** Show the folder picker and open the chosen folder, if any. */
  pickAndOpen(): Promise<void>;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
}

/**
 * Wrap `client` so that a call rejecting with a `DeskError` of code
 * "network" calls `onLost` before the rejection is passed on. Panes read
 * data only through the client of the current product (`product.client`),
 * which is already wrapped, so they need no connection handling of their
 * own.
 */
export function watchConnection(
  client: DeskClient,
  onLost: () => void,
): DeskClient {
  const watch = <A extends unknown[], R>(
    call: (...args: A) => Promise<R>,
  ) =>
  async (...args: A): Promise<R> => {
    try {
      return await call(...args);
    } catch (error) {
      if (error instanceof DeskError && error.code === "network") onLost();
      throw error;
    }
  };
  return {
    tree: watch(() => client.tree()),
    entry: watch((id: string) => client.entry(id)),
    entryHtml: watch((id: string) => client.entryHtml(id)),
    document: watch((path: string) => client.document(path)),
    file: watch((path: string) => client.file(path)),
  };
}

function describeFailure(failure: unknown): ProductError {
  const known = failure as Partial<OpenProductFailure> | null;
  if (
    known !== null && typeof known === "object" &&
    typeof known.details === "string"
  ) {
    return known.kind === "not-a-product"
      ? {
        kind: "not-a-product",
        message: MESSAGES.notAProduct,
        details: known.details,
      }
      : {
        kind: "failed",
        message: MESSAGES.openFailed,
        details: known.details,
      };
  }
  const details = failure instanceof Error ? failure.message : String(failure);
  return { kind: "failed", message: MESSAGES.openFailed, details };
}

/**
 * State machine of the open flow. At mount it opens the most recent
 * product, if its folder still exists.
 */
export function useProduct(
  bridge: ShellBridge,
  createClient: (url: string, token: string) => DeskClient = createDeskClient,
): ProductController {
  const [state, setState] = useState<ProductState>({ status: "launching" });
  const [recents, setRecents] = useState<RecentProduct[]>([]);
  const productRef = useRef<OpenProduct | undefined>(undefined);
  const busyRef = useRef(false);

  const refreshRecents = useCallback(async () => {
    try {
      setRecents(await bridge.listRecents());
    } catch {
      setRecents([]);
    }
  }, [bridge]);

  const open = useCallback(async (path: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const previous = productRef.current;
    setState((current) => ({
      status: "opening",
      product: previous,
      lost: current.lost,
      openingPath: path,
    }));
    try {
      let opened: OpenedProduct;
      try {
        opened = await bridge.openProduct(path);
      } catch (failure) {
        setState((current) => ({
          status: "error",
          product: previous,
          lost: current.lost,
          error: describeFailure(failure),
        }));
        return;
      }
      if (opened.apiVersion !== EXPECTED_API_VERSION) {
        setState((current) => ({
          status: "error",
          product: previous,
          lost: current.lost,
          error: { kind: "version", message: MESSAGES.versionMismatch },
        }));
        return;
      }
      const raw = createClient(opened.url, opened.token);
      let name: string;
      try {
        const tree = await raw.tree();
        name = tree.project.name ?? basename(opened.root);
      } catch (failure) {
        setState((current) => ({
          status: "error",
          product: previous,
          lost: current.lost,
          error: describeFailure(failure),
        }));
        return;
      }
      try {
        await bridge.setProductName(opened.root, name);
      } catch {
        // The recent list is a convenience; opening still succeeds.
      }
      const product: OpenProduct = {
        root: opened.root,
        name,
        client: watchConnection(raw, () => {
          // Ignore a late failure from a client of an earlier open.
          if (productRef.current !== product) return;
          setState((current) => ({ ...current, lost: true }));
        }),
      };
      productRef.current = product;
      setState({ status: "open", product, lost: false });
      await refreshRecents();
    } finally {
      busyRef.current = false;
    }
  }, [bridge, createClient, refreshRecents]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let list: RecentProduct[] = [];
      try {
        list = await bridge.listRecents();
      } catch {
        // No recents: show the start screen.
      }
      if (cancelled) return;
      setRecents(list);
      if (list[0]?.exists) await open(list[0].root);
      else setState({ status: "start" });
    })();
    return () => {
      cancelled = true;
    };
    // Launch runs once.
  }, []);

  const reopen = useCallback(async () => {
    const root = productRef.current?.root;
    if (root !== undefined) await open(root);
  }, [open]);

  const showFailure = useCallback((failure: unknown) => {
    setState((current) => ({
      ...current,
      status: "error",
      error: describeFailure(failure),
    }));
  }, []);

  const removeRecent = useCallback(async (root: string) => {
    try {
      await bridge.removeRecent(root);
    } catch (failure) {
      showFailure(failure);
      return;
    }
    await refreshRecents();
  }, [bridge, refreshRecents, showFailure]);

  const pickAndOpen = useCallback(async () => {
    try {
      const picked = await bridge.pickFolder();
      if (picked !== null) await open(picked);
    } catch (failure) {
      showFailure(failure);
    }
  }, [bridge, open, showFailure]);

  return { ...state, recents, open, reopen, removeRecent, pickAndOpen };
}

/** Context carrying the open product for the panes of the workspace. */
export const ProductContext = createContext<OpenProduct | undefined>(
  undefined,
);

/** The open product. Throws when used outside an open workspace. */
export function useOpenProduct(): OpenProduct {
  const product = useContext(ProductContext);
  if (product === undefined) throw new Error("No product is open.");
  return product;
}
