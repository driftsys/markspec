import type { ReactNode } from "react";
import { createDeskClient, type DeskClient } from "../api/client";
import type { ShellBridge } from "../shell/bridge";
import { ProductMenu } from "./ProductMenu";
import { ErrorDetails, StartScreen } from "./StartScreen";
import { MESSAGES, ProductContext, useProduct } from "./useProduct";

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

/** Neutral view shown while a product opens and none is open yet. */
function OpeningView({ path }: { path?: string }) {
  const folder = path?.split(/[\\/]/).filter((part) => part.length > 0).pop();
  return (
    <main className="opening">
      <p>Opening product…</p>
      {folder && <small>{folder}</small>}
    </main>
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

  const busy = controller.status === "launching" ||
    controller.status === "opening";

  if (product === undefined && busy) {
    return <OpeningView path={controller.openingPath} />;
  }

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

  const banner = (error || controller.lost) && (
    <div role="alert">
      {error && <p>{error.message}</p>}
      {error && <ErrorDetails details={error.details} />}
      {controller.lost && (
        <>
          <p>{MESSAGES.lostConnection}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void controller.reopen()}
          >
            Reopen
          </button>
        </>
      )}
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
            disabled={busy}
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
