import { useEffect, useState } from "react";
import type { ProductTree } from "../api/client";
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

/** Loads the open product's tree and shows it in the navigator. */
export function NavigatorPane() {
  const { client } = useOpenProduct();
  const { selected, select } = useSelection();
  const [tree, setTree] = useState<ProductTree>();
  useEffect(() => {
    let current = true;
    client.tree().then((loaded) => {
      if (current) setTree(loaded);
    }, () => {
      // Network failures are handled by the connection watcher.
    });
    return () => {
      current = false;
    };
  }, [client]);
  if (!tree) return <p>…</p>;
  return (
    <Navigator
      model={buildNavigatorModel(tree)}
      selected={selected}
      onSelect={select}
    />
  );
}
