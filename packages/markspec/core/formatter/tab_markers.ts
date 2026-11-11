/**
 * @module formatter/tab_markers
 * Locate tab-separated entry markers and the list items that contain them.
 */
import type { ListItem, Root, RootContent } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { EntryExtent } from "./prose.ts";

const parser = unified().use(remarkParse).use(remarkGfm);

/** An entry title and the list context that controls its indentation. */
export interface EntryListItem extends EntryExtent {
  readonly column: number;
  readonly whitespace: string;
  readonly container: EntryExtent;
  readonly listContext: EntryExtent;
}

/** Find actual unordered list items, excluding code, HTML, and task lists. */
export function entryListItems(lines: readonly string[]): EntryListItem[] {
  const markers: EntryListItem[] = [];
  const visit = (
    node: Root | RootContent,
    container?: ListItem,
    enclosingList?: EntryExtent,
  ): void => {
    if (node.type === "list") {
      for (const item of node.children) {
        const outer = container ?? item;
        const start = (item.position?.start.line ?? 1) - 1;
        const column = (item.position?.start.column ?? 1) - 1;
        const match = /^[-*+]([ \t]+)\[[^\]\s]+\](?:\s|$)/.exec(
          (lines[start] ?? "").slice(column),
        );
        if (
          !node.ordered && item.checked == null && match &&
          item.children[0]?.type === "paragraph"
        ) {
          markers.push({
            start,
            end: item.position?.end.line ?? start + 1,
            column,
            whitespace: match[1],
            container: {
              start: (outer.position?.start.line ?? 1) - 1,
              end: outer.position?.end.line ?? lines.length,
            },
            listContext: enclosingList ?? {
              start: (node.position?.start.line ?? 1) - 1,
              end: node.position?.end.line ?? lines.length,
            },
          });
        }
        for (const child of item.children) {
          visit(
            child,
            outer,
            enclosingList ?? {
              start: (node.position?.start.line ?? 1) - 1,
              end: node.position?.end.line ?? lines.length,
            },
          );
        }
      }
    } else if ("children" in node) {
      for (const [index, child] of node.children.entries()) {
        let context = enclosingList;
        if (!context && child.type === "list") {
          // A marker change (for example `*` to `-`) splits adjacent
          // items into separate mdast lists. Their indentation still
          // affects admission of a tab rewrite across that boundary.
          let first = index;
          let last = index;
          while (first > 0 && node.children[first - 1].type === "list") first--;
          while (node.children[last + 1]?.type === "list") last++;
          // Indented blocks after the list can move into an entry when its
          // content column shrinks. Formatting them in isolation can remove
          // that indentation and admit a refused rewrite on the next run.
          // Keep complete blocks, including unindented lazy continuations.
          const contentColumn = Math.min(
            ...node.children.slice(first, last + 1).flatMap((sibling) =>
              sibling.type === "list"
                ? sibling.children.map((item) =>
                  (item.position?.start.column ?? 1) + 1
                )
                : []
            ),
          );
          while (
            (node.children[last + 1]?.position?.start.column ?? 0) >=
              contentColumn
          ) last++;
          context = {
            start: (node.children[first].position?.start.line ?? 1) - 1,
            end: node.children[last].position?.end.line ?? lines.length,
          };
        }
        visit(child as RootContent, container, context);
      }
    }
  };
  visit(parser.parse(lines.join("\n")));
  return markers;
}

/** Find entry list items with a tab in the whitespace after the marker. */
export function tabMarkers(lines: readonly string[]): EntryListItem[] {
  if (!lines.some((line) => /[-*+][ \t]*\t[ \t]*\[/.test(line))) return [];
  return entryListItems(lines).filter((marker) =>
    marker.whitespace.includes("\t")
  );
}

/** Ranges kept out of every formatter pass after a tab rewrite is refused. */
export function protectedTabRanges(
  lines: readonly string[],
  preserveListContext = false,
): EntryExtent[] {
  return tabMarkers(lines).map((marker) => {
    // A prose rewrite of a neighbouring item can make a refused marker
    // eligible on the next run. Keep the containing list and the following
    // indented blocks stable, even when CommonMark puts them outside it.
    const range = preserveListContext ? marker.listContext : marker;
    let end = range.end;
    while (end < lines.length && lines[end].trim() === "") end++;
    return { start: range.start, end };
  });
}
