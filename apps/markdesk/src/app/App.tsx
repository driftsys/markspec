import type { ReactNode } from "react";
import { createDeskClient, type DeskClient } from "../api/client";
import { AssistantColumn } from "../assistant/AssistantColumn";
import { DocumentPane } from "../document/DocumentPane";
import { NavigatorPane } from "../navigator/Navigator";
import { BridgeContext } from "../shell/BridgeContext";
import type { ShellBridge } from "../shell/bridge";
import { ProductMenu } from "./ProductMenu";
import { SelectionProvider } from "./selection";
import { ErrorDetails, StartScreen } from "./StartScreen";
import { MESSAGES, ProductContext, useProduct } from "./useProduct";

/** Three-pane layout: navigator, document, assistant. */
export function Workspace(props: {
  header: ReactNode;
  banner?: ReactNode;
  navigator: ReactNode;
  document: ReactNode;
  assistant: ReactNode;
}) {
  return (
    <div className="workspace">
      <header className="workspace-header">{props.header}</header>
      {props.banner}
      <div className="workspace-panes">
        <aside className="pane-navigator">{props.navigator}</aside>
        <main className="pane-document">{props.document}</main>
        <aside className="pane-assistant">{props.assistant}</aside>
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
  /**
   * Replace the default panes. Panes may call `useOpenProduct()`,
   * `useSelection()`, `useHistory()` and `useBridge()`.
   */
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
    <div role="alert" className="workspace-banner">
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

  // The bridge context lets panes open external links. The selection
  // history is keyed by the product root, so it starts empty when another
  // product opens and survives a reopen of the same product.
  return (
    <BridgeContext.Provider value={props.bridge}>
      <ProductContext.Provider value={product}>
        <SelectionProvider key={product.root}>
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
            navigator={props.slots?.navigator ?? <NavigatorPane />}
            document={props.slots?.document ?? <DocumentPane />}
            assistant={props.slots?.assistant ?? <AssistantColumn />}
          />
        </SelectionProvider>
      </ProductContext.Provider>
    </BridgeContext.Provider>
  );
}
