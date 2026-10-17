import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { tauriBridge } from "./shell/bridge";

createRoot(document.getElementById("root")!).render(
  <App bridge={tauriBridge} />,
);
