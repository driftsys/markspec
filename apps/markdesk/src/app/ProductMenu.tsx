import { useEffect, useRef, useState } from "react";
import type { RecentProduct } from "../shell/bridge";

/** Menu of the open product: recent products and `Open folder…`. */
export function ProductMenu(props: {
  productName: string;
  /** Absolute path of the open product, shown beside the name. */
  productRoot: string;
  recents: RecentProduct[];
  onPick(): void;
  onOpenRecent(root: string): void;
  /** Disables the open actions while an open is in progress. */
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const close = () => setExpanded(false);
  const root = useRef<HTMLElement>(null);

  // Close on Escape and on a press outside the menu while it is open.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    const onPress = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPress);
    };
  }, [expanded]);

  return (
    <nav className="product-menu" ref={root}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span aria-hidden="true">▾</span> <span>{props.productName}</span>
        <small className="product-path">{props.productRoot}</small>
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
