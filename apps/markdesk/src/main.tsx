import { createRoot } from "react-dom/client";
import "../../../theme/markspec.css";
import "./styles/app.css";
import { App } from "./app/App";
import { tauriBridge } from "./shell/bridge";
import { followColorScheme } from "./theme";

followColorScheme();

createRoot(document.getElementById("root")!).render(
  <App bridge={tauriBridge} />,
);
