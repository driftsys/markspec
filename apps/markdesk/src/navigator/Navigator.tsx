import { useEffect, useMemo, useRef, useState } from "react";
import { type CachedTree, DeskError } from "../api/client";
import { useRefresh } from "../app/refresh";
import { useOpenProduct } from "../app/useProduct";
import { useSelection } from "../app/selection";
import { buildNavigatorModel, type NavigatorModel } from "./model";

/** Props of the presentational navigator tree. */
export interface NavigatorProps {
  model: NavigatorModel;
  selected?: string;
  onSelect(displayId: string): void;
}

/**
 * Tree of entries. Rows expand lazily, one level per click. Expansion is keyed
 * by the path of display IDs, so a link cycle never recurses on its own.
 */
export function Navigator(props: NavigatorProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  if (props.model.roots.length === 0) {
    return <p>This product has no requirements yet.</p>;
  }
  return (
    <ul role="tree" className="navigator">
      {props.model.roots.map((id) => (
        <Row
          key={id}
          id={id}
          path={id}
          {...props}
          expanded={expanded}
          toggle={toggle}
        />
      ))}
    </ul>
  );
}

function Row(
  props: NavigatorProps & {
    id: string;
    path: string;
    expanded: ReadonlySet<string>;
    toggle(path: string): void;
  },
) {
  const { id, path, model, expanded } = props;
  const node = model.node(id);
  const { refining, verifying } = model.children(id);
  const expandable = refining.length + verifying.length > 0;
  const open = expanded.has(path);
  const childRow = (child: string) => (
    <Row key={child} {...props} id={child} path={`${path}\u0000${child}`} />
  );
  return (
    <li
      role="treeitem"
      aria-expanded={expandable ? open : undefined}
      aria-selected={props.selected === id}
    >
      <div
        className="navigator-row"
        tabIndex={0}
        onClick={() => {
          props.onSelect(id);
          if (expandable) props.toggle(path);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            props.onSelect(id);
            if (expandable) props.toggle(path);
          }
        }}
      >
        <span className="type-mark" data-kind={node.kind ?? node.type} />
        <span className="display-id">{id}</span>
        <span className="title">{node.title}</span>
        {node.origin && <span className="origin-badge">{node.origin}</span>}
      </div>
      {open && expandable && (
        <ul role="group">
          {refining.map(childRow)}
          {refining.length > 0 && verifying.length > 0 && (
            <li role="separator" className="navigator-separator" />
          )}
          {verifying.map(childRow)}
        </ul>
      )}
    </li>
  );
}

/**
 * Loads the open product's tree and shows it in the navigator.
 *
 * The tree is checked with the server on every refresh (window focus): the
 * request carries the ETag of the tree held, and on 304 the held tree stays
 * as it is, so expanded rows and the selection are untouched. A changed tree
 * replaces the model in place; the `Navigator` is not remounted, so rows
 * that still exist keep their expansion. A failed check after a successful
 * load keeps the tree shown, and a successful check clears an earlier load
 * failure.
 */
export function NavigatorPane() {
  const { client } = useOpenProduct();
  const { selected, select } = useSelection();
  const { revision } = useRefresh();
  const [tree, setTree] = useState<CachedTree>();
  const [failed, setFailed] = useState(false);
  // The tree the next check sends its ETag for, with the client it came
  // from. A ref, so the check effect runs once per revision; a tree of
  // another product's client is never sent.
  const held = useRef<{ client: typeof client; tree: CachedTree }>(undefined);
  useEffect(() => {
    let current = true;
    const previous = held.current?.client === client
      ? held.current.tree
      : undefined;
    if (previous === undefined) {
      setTree(undefined);
      setFailed(false);
    }
    client.tree(previous).then((loaded) => {
      if (!current) return;
      setFailed(false);
      if (loaded === previous) return;
      held.current = { client, tree: loaded };
      setTree(loaded);
    }, (error: unknown) => {
      // Network failures are handled by the connection watcher.
      if (error instanceof DeskError && error.code === "network") return;
      if (!current) return;
      if (previous === undefined) {
        setFailed(true);
      } else {
        // Keep the shown tree; leave a trace for diagnosis.
        console.warn("MarkDesk could not refresh the product tree", error);
      }
    });
    return () => {
      current = false;
    };
  }, [client, revision]);
  const model = useMemo(() => tree && buildNavigatorModel(tree.view), [tree]);
  if (failed) return <p role="alert">MarkDesk could not load this product.</p>;
  if (!model) return <p>…</p>;
  return <Navigator model={model} selected={selected} onSelect={select} />;
}
