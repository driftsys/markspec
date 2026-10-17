import type { ReactNode } from "react";
import { createDeskClient, type DeskClient } from "../api/client";
import type { ShellBridge } from "../shell/bridge";
import { ProductMenu } from "./ProductMenu";
import { ErrorDetails, StartScreen } from "./StartScreen";
import { ProductContext, useProduct } from "./useProduct";

/** Three-pane layout. Later tasks fill the three slots. */
export function Workspace(props: {
  header: ReactNode;
  banner?: ReactNode;
  navigator: ReactNode;
  document: ReactNode;
  assistant: ReactNode;
}) {
  return (
    <div
      className="workspace"
      style={{ display: "flex", flexDirection: "column", height: "100vh" }}
    >
      <header>{props.header}</header>
      {props.banner}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside
          className="pane-navigator"
          style={{ width: "20rem", overflow: "auto" }}
        >
          {props.navigator}
        </aside>
        <main className="pane-document" style={{ flex: 1, overflow: "auto" }}>
          {props.document}
        </main>
        <aside
          className="pane-assistant"
          style={{ width: "18rem", overflow: "auto" }}
        >
          {props.assistant}
        </aside>
      </div>
    </div>
  );
}

/** Root component: start screen until a product is open, then the workspace. */
export function App(props: {
  bridge: ShellBridge;
  createClient?: (url: string, token: string) => DeskClient;
  /** Replace the placeholder panes. Panes may call `useOpenProduct()`. */
  slots?: {
    navigator?: ReactNode;
    document?: ReactNode;
    assistant?: ReactNode;
  };
}) {
  const controller = useProduct(
    props.bridge,
    props.createClient ?? createDeskClient,
  );
  const { product, error } = controller;

  if (product === undefined) {
    return (
      <StartScreen
        recents={controller.recents}
        error={error}
        onPick={() => void controller.pickAndOpen()}
        onOpenRecent={(root) => void controller.open(root)}
        onRemoveRecent={(root) => void controller.removeRecent(root)}
      />
    );
  }

  const banner = error && (
    <div role="alert">
      <p>{error.message}</p>
      {error.kind === "lost" && (
        <button
          type="button"
          onClick={() => void controller.reopen()}
        >
          Reopen
        </button>
      )}
      <ErrorDetails details={error.details} />
    </div>
  );

  return (
    <ProductContext.Provider value={product}>
      <Workspace
        header={
          <ProductMenu
            productName={product.name}
            recents={controller.recents}
            onPick={() => void controller.pickAndOpen()}
            onOpenRecent={(root) => void controller.open(root)}
          />
        }
        banner={banner}
        navigator={props.slots?.navigator ?? <p>Navigator</p>}
        document={props.slots?.document ?? (
          <p>Select an item to start reading.</p>
        )}
        assistant={props.slots?.assistant ?? (
          <p>Set up an assistant to ask questions about this product.</p>
        )}
      />
    </ProductContext.Provider>
  );
}
