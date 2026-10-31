import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type CachedDocument,
  type DeskClient,
  DeskError,
  type EntryView,
} from "../api/client";
import { useRefresh } from "../app/refresh";
import { useOpenProduct } from "../app/useProduct";
import { useBridge } from "../shell/BridgeContext";
import { SourceDrawer } from "./SourceDrawer";
import { useHistory } from "./useHistory";

/** What the pane shows for the selected entry. */
interface Reading {
  entry: EntryView;
  /** Server-rendered HTML: the whole document, or the entry alone. */
  html: string;
  /** `true` when `html` is the entry's whole Markdown document. */
  wholeDocument: boolean;
  /** Set for an entry that comes from outside the product. */
  origin?: string;
  /** File the Source drawer shows; absent when it cannot be served. */
  sourcePath?: string;
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof DeskError && error.code === "network";
}

/**
 * Load what to show for `id`: the entry, then its rendered document when it
 * lives in a Markdown file, or the entry rendered alone otherwise.
 *
 * A cached document is never reused unchecked: the request carries its ETag,
 * and the server answers 304 while the file and the graph's display IDs are
 * unchanged, so an edit on disk shows on the next read.
 */
async function read(
  client: DeskClient,
  documents: Map<string, Promise<CachedDocument>>,
  id: string,
): Promise<Reading> {
  const entry = await client.entry(id);
  if (entry.origin !== undefined) {
    const rendered = await client.entryHtml(id);
    return {
      entry,
      html: rendered.html,
      wholeDocument: false,
      origin: rendered.origin ?? entry.origin,
    };
  }
  const path = entry.location.file;
  if (path.endsWith(".md")) {
    const previous = documents.get(path);
    const cached = previous && await previous.catch(() => undefined);
    const loading = client.document(path, cached);
    documents.set(path, loading);
    // Do not keep a failed load, so a later read tries again.
    loading.catch(() => {
      if (documents.get(path) === loading) documents.delete(path);
    });
    try {
      const { view } = await loading;
      return {
        entry,
        html: view.html,
        wholeDocument: true,
        sourcePath: path,
      };
    } catch (error) {
      if (isNetworkFailure(error)) throw error;
      // The document cannot be served: show the entry alone, without Source.
      const rendered = await client.entryHtml(id);
      return { entry, html: rendered.html, wholeDocument: false };
    }
  }
  const rendered = await client.entryHtml(id);
  return {
    entry,
    html: rendered.html,
    wholeDocument: false,
    sourcePath: path,
  };
}

/**
 * Replace each `<img>` whose source is not a `data:` URI with a neutral
 * placeholder that shows its alt text. The app cannot load files from the
 * product folder, and the content security policy blocks remote images.
 */
export function withImagePlaceholders(html: string): string {
  // A <template> parses the markup without loading any image.
  const template = document.createElement("template");
  template.innerHTML = html;
  // Cross-references act as links, so give them keyboard access.
  for (const ref of template.content.querySelectorAll(".cross-ref")) {
    ref.setAttribute("tabindex", "0");
    ref.setAttribute("role", "link");
  }
  for (const image of template.content.querySelectorAll("img")) {
    const source = image.getAttribute("src") ?? "";
    if (/^data:/i.test(source)) continue;
    const placeholder = document.createElement("span");
    placeholder.className = "image-placeholder";
    placeholder.setAttribute("role", "img");
    const alt = image.getAttribute("alt") ?? "";
    placeholder.setAttribute("aria-label", alt);
    placeholder.textContent = alt.length > 0 ? alt : "Image";
    image.replaceWith(placeholder);
  }
  return template.innerHTML;
}

/** The entry block for `id`, compared by attribute, never by selector. */
function findEntryBlock(
  container: HTMLElement,
  id: string,
): HTMLElement | undefined {
  for (
    const element of container.querySelectorAll<HTMLElement>(
      "[data-display-id]",
    )
  ) {
    if (element.classList.contains("cross-ref")) continue;
    if (element.dataset.displayId === id) return element;
  }
  return undefined;
}

/** The element with the given `id` attribute inside `container`. */
function findById(
  container: HTMLElement,
  id: string,
): HTMLElement | undefined {
  for (const element of container.querySelectorAll<HTMLElement>("[id]")) {
    if (element.id === id) return element;
  }
  return undefined;
}

/**
 * Document pane: Back and Forward, the rendered document of the selected
 * entry with the entry highlighted, and the Source drawer.
 */
export function DocumentPane() {
  const { client } = useOpenProduct();
  const bridge = useBridge();
  const history = useHistory();
  const selected = history.current;
  // What was loaded, tagged with the display ID it was loaded for, so a
  // result never shows for another selection.
  const [loaded, setLoaded] = useState<
    { id: string; reading?: Reading; failed?: boolean; gone?: boolean }
  >();
  const reading = loaded?.id === selected ? loaded?.reading : undefined;
  const failed = loaded?.id === selected && loaded?.failed === true;
  // The entry is not in the product, for example after it was removed on
  // disk. This is a state of the files, not a failure, so it is no alert.
  const gone = loaded?.id === selected && loaded?.gone === true;
  const [sourceOpen, setSourceOpen] = useState(false);
  // Bumped when the window gets focus, so the selection is read again: the
  // product's files may have changed in another application.
  const { revision } = useRefresh();
  const content = useRef<HTMLDivElement>(null);
  // Rendered documents of the current product with their ETags, by path.
  const documents = useMemo(
    () => new Map<string, Promise<CachedDocument>>(),
    [client],
  );

  useEffect(() => {
    setLoaded(undefined);
  }, [client]);

  useEffect(() => {
    if (selected === undefined) return;
    let current = true;
    read(client, documents, selected).then((next) => {
      if (current) setLoaded({ id: selected, reading: next });
    }, (error: unknown) => {
      // Network failures are handled by the connection watcher.
      if (isNetworkFailure(error)) return;
      if (!current) return;
      if (error instanceof DeskError && error.code === "entry-not-found") {
        setLoaded({ id: selected, gone: true });
      } else {
        setLoaded({ id: selected, failed: true });
      }
    });
    return () => {
      current = false;
    };
  }, [client, documents, selected, revision]);

  const html = useMemo(
    () => reading && withImagePlaceholders(reading.html),
    [reading?.html],
  );
  const wholeDocument = reading?.wholeDocument === true;

  useLayoutEffect(() => {
    const container = content.current;
    if (!container) return;
    for (const old of container.querySelectorAll(".is-selected")) {
      old.classList.remove("is-selected");
    }
    if (!wholeDocument || selected === undefined) return;
    const block = findEntryBlock(container, selected);
    if (!block) return;
    block.classList.add("is-selected");
    block.scrollIntoView?.({ block: "start" });
    // Keyed on the HTML string, not on the reading: a read that finds the
    // render unchanged must not move the author's scroll position.
  }, [html, wholeDocument, selected]);

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    const crossRef = target.closest<HTMLElement>(".cross-ref");
    if (crossRef?.dataset.displayId) {
      event.preventDefault();
      history.select(crossRef.dataset.displayId);
      return;
    }
    const link = target.closest("a[href]");
    if (!link) return;
    // Never let a link navigate the app window.
    event.preventDefault();
    const href = link.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      // A failure to open the link is ignored.
      bridge.openExternal(href).catch(() => {});
    } else if (href.startsWith("#") && content.current) {
      let id = href.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // Keep the raw fragment.
      }
      findById(content.current, id)?.scrollIntoView?.({ block: "start" });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter") return;
    const crossRef = (event.target as Element).closest<HTMLElement>(
      ".cross-ref",
    );
    if (!crossRef?.dataset.displayId) return;
    event.preventDefault();
    history.select(crossRef.dataset.displayId);
  };

  const toolbar = (
    <div className="document-toolbar">
      <button
        type="button"
        aria-label="Back"
        title="Back"
        disabled={!history.canBack}
        onClick={history.back}
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="Forward"
        title="Forward"
        disabled={!history.canForward}
        onClick={history.forward}
      >
        ›
      </button>
      <span className="document-toolbar-spacer" />
      {reading?.sourcePath !== undefined && (
        <button
          type="button"
          aria-pressed={sourceOpen}
          onClick={() => setSourceOpen(!sourceOpen)}
        >
          Source
        </button>
      )}
    </div>
  );

  if (selected === undefined) {
    return (
      <div className="document-pane">
        {toolbar}
        <p className="document-empty">
          Select a requirement in the navigator to read it.
        </p>
      </div>
    );
  }

  return (
    <div className="document-pane">
      {toolbar}
      {failed && (
        <p role="alert" className="document-error">
          MarkDesk could not show this requirement.
        </p>
      )}
      {gone && (
        <p role="status" className="document-empty">
          {`${selected} is not in this product.`}
        </p>
      )}
      <div className="document-body">
        <div className="document-scroll">
          {reading?.origin !== undefined && (
            <p className="document-readonly">
              {`From ${reading.origin}, read-only.`}
            </p>
          )}
          {html !== undefined && (
            <article className="document-sheet">
              {
                /* The HTML comes from the local sidecar's book renderer, which
                  does not pass raw HTML from Markdown through. */
              }
              <div
                ref={content}
                className="document-content"
                onClick={onClick}
                onKeyDown={onKeyDown}
                onAuxClick={(event) => {
                  if ((event.target as Element).closest("a[href]")) {
                    event.preventDefault();
                  }
                }}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </article>
          )}
        </div>
        {sourceOpen && reading?.sourcePath !== undefined && (
          <SourceDrawer
            path={reading.sourcePath}
            line={reading.entry.location.line}
            revision={revision}
          />
        )}
      </div>
    </div>
  );
}
