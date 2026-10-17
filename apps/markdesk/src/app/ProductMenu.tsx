import { useState } from "react";
import type { RecentProduct } from "../shell/bridge";

/** Menu of the open product: recent products and `Open folder…`. */
export function ProductMenu(props: {
  productName: string;
  recents: RecentProduct[];
  onPick(): void;
  onOpenRecent(root: string): void;
  /** Disables the open actions while an open is in progress. */
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const close = () => setExpanded(false);
  return (
    <nav className="product-menu">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {props.productName}
      </button>
      {expanded && (
        <ul role="menu">
          {props.recents.filter((recent) => recent.exists).map((recent) => (
            <li key={recent.root} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={props.disabled}
                onClick={() => {
                  close();
                  props.onOpenRecent(recent.root);
                }}
              >
                {recent.name ?? recent.root}
              </button>
            </li>
          ))}
          <li role="none">
            <button
              type="button"
              role="menuitem"
              disabled={props.disabled}
              onClick={() => {
                close();
                props.onPick();
              }}
            >
              Open folder…
            </button>
          </li>
        </ul>
      )}
    </nav>
  );
}
