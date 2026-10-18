import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Connection details of a running product server. */
export interface OpenedProduct {
  url: string;
  token: string;
  apiVersion: number;
  root: string;
}

/** A product folder remembered from an earlier session. */
export interface RecentProduct {
  root: string;
  /**
   * Project name, or folder name when the project has none. Derived on each
   * open and overwritten; `null` until the product was opened once.
   */
  name: string | null;
  exists: boolean;
}

/** Rejection value of `openProduct`. */
export interface OpenProductFailure {
  kind: "not-a-product" | "spawn-failed" | "version-mismatch";
  details: string;
}

/**
 * The only module that talks to the desktop shell. Everything else depends
 * on this interface, so tests can supply a fake.
 */
export interface ShellBridge {
  openProduct(path: string): Promise<OpenedProduct>;
  listRecents(): Promise<RecentProduct[]>;
  /** Store the derived name (project name, or folder name) of a recent product. */
  setProductName(root: string, name: string): Promise<void>;
  removeRecent(root: string): Promise<void>;
  /** Show the folder picker. Resolves to `null` when the user cancels. */
  pickFolder(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
}

/** The bridge backed by the Tauri commands and plugins. */
export const tauriBridge: ShellBridge = {
  openProduct: (path) => invoke<OpenedProduct>("open_product", { path }),
  listRecents: () => invoke<RecentProduct[]>("list_recents"),
  setProductName: (root, name) =>
    invoke<void>("set_product_name", { root, name }),
  removeRecent: (root) => invoke<void>("remove_recent", { root }),
  pickFolder: async () => {
    const picked = await open({ directory: true });
    return typeof picked === "string" ? picked : null;
  },
  openExternal: (url) => openUrl(url),
};
