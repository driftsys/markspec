import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { SelectionProvider } from "./app/selection";
import { NavigatorPane } from "./navigator/Navigator";
import { tauriBridge } from "./shell/bridge";

createRoot(document.getElementById("root")!).render(
  <SelectionProvider>
    <App bridge={tauriBridge} slots={{ navigator: <NavigatorPane /> }} />
  </SelectionProvider>,
);
