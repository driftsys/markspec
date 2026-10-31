import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CachedDocument,
  type DeskClient,
  DeskError,
  type DocumentView,
  type EntryView,
} from "../api/client";
import { fakeAssistantBridge } from "../assistant/testBridge";
import { ProductContext } from "../app/useProduct";
import { BridgeContext } from "../shell/BridgeContext";
import type { ShellBridge } from "../shell/bridge";
import { DocumentPane } from "./DocumentPane";
import { RefreshProvider } from "../app/refresh";
import { type History, HistoryProvider, useHistory } from "./useHistory";

afterEach(cleanup);

const scrollIntoView = vi.fn();
beforeEach(() => {
  scrollIntoView.mockClear();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});

/** A promise with its resolve and reject functions. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const ID = "SRS/brk.0001";

function entryView(
  displayId: string,
  file: string,
  extra: Partial<EntryView> = {},
): EntryView {
  return {
    apiVersion: 3,
    displayId,
    title: displayId,
    body: "",
    attributes: [],
    location: { file, line: 3, column: 1 },
    links: { outgoing: [], incoming: [] },
    ...extra,
  };
}

const DOC_HTML = `<h1>Brakes</h1>
<p>See <span class="cross-ref" data-display-id="${ID}">${ID}</span>.</p>
<p><a href="https://example.com/spec">spec</a>
<a href="other.md">other</a> <a href="#entry-B">down</a></p>
<p><img src="figures/brake.svg" alt="Brake diagram"><img src="data:image/png;base64,AA==" alt="inline"><img src="https://example.com/remote.png" alt="Remote figure"></p>
<div class="req-block hue-blue" id="entry-${ID}" data-display-id="${ID}">
  <div class="req-title"><code class="req-id">${ID}</code></div>
  <p>Body with <span class="cross-ref" data-display-id="B">B</span>.</p>
</div>
<div class="req-block hue-blue" id="entry-B" data-display-id="B">B body</div>`;

function documentView(path: string): DocumentView {
  return {
    apiVersion: 3,
    path,
    html: DOC_HTML,
    entries: [
      { displayId: ID, anchor: `entry-${ID}` },
      { displayId: "B", anchor: "entry-B" },
    ],
  };
}

/**
 * A fake `/documents` endpoint that answers like the server: a new render
 * with its ETag, or the caller's own cached render while it is current.
 * `edit` changes the document as an edit on disk would.
 */
function documentServer() {
  let html = DOC_HTML;
  let etag = '"v1"';
  let version = 1;
  const document = vi.fn(
    async (path: string, cached?: CachedDocument): Promise<CachedDocument> => {
      if (cached?.etag === etag) return cached;
      return { view: { ...documentView(path), html }, etag };
    },
  );
  const edit = (next: string) => {
    html = next;
    etag = `"v${++version}"`;
  };
  return { document, edit };
}

/** Wrap a plain document view as an uncached `/documents` answer. */
const fresh = (view: DocumentView): CachedDocument => ({ view });

function fakeClient(overrides: Partial<DeskClient> = {}): DeskClient {
  const entries: Record<string, EntryView> = {
    [ID]: entryView(ID, "docs/brakes.md"),
    B: entryView("B", "docs/brakes.md"),
    SRC: entryView("SRC", "src/brake.rs", {
      location: { file: "src/brake.rs", line: 4, column: 1 },
    }),
    EXT: entryView("EXT", ".markspec/cache/p/req.md", { origin: "acme@1.2" }),
  };
  return {
    tree: vi.fn(),
    entry: vi.fn(async (id: string) => {
      const found = entries[id];
      if (!found) throw new DeskError(404, "entry-not-found", "missing");
      return found;
    }),
    entryHtml: vi.fn(async (id: string) => ({
      apiVersion: 3 as const,
      displayId: id,
      html:
        `<div class="req-block" data-display-id="${id}">html of ${id}</div>`,
      origin: entries[id]?.origin,
    })),
    document: documentServer().document,
    file: vi.fn(async (path: string) => ({
      apiVersion: 3 as const,
      path,
      text: "line one\nline two\nline three\nline four\nline five",
    })),
    ...overrides,
  } as DeskClient;
}

function fakeBridge(): ShellBridge {
  return {
    openProduct: vi.fn(),
    listRecents: vi.fn(),
    setProductName: vi.fn(),
    removeRecent: vi.fn(),
    pickFolder: vi.fn(),
    openExternal: vi.fn(async () => {}),
    ...fakeAssistantBridge(),
  };
}

function mount(client = fakeClient(), bridge = fakeBridge()) {
  const seen: { history?: History } = {};
  function Probe() {
    seen.history = useHistory();
    return null;
  }
  render(
    <BridgeContext.Provider value={bridge}>
      <ProductContext.Provider value={{ root: "/p", name: "p", client }}>
        <HistoryProvider mac={false}>
          <RefreshProvider>
            <Probe />
            <DocumentPane />
          </RefreshProvider>
        </HistoryProvider>
      </ProductContext.Provider>
    </BridgeContext.Provider>,
  );
  const select = (id: string) => act(() => seen.history!.select(id));
  return { client, bridge, select, history: () => seen.history! };
}

describe("DocumentPane", () => {
  it("shows the empty state before a selection", () => {
    mount();
    expect(
      screen.getByText("Select a requirement in the navigator to read it."),
    ).toBeTruthy();
  });

  it("renders the document and highlights the selected entry block", async () => {
    const { client, select } = mount();
    select(ID);
    expect(await screen.findByText("Brakes")).toBeTruthy();
    expect(client.document).toHaveBeenCalledWith("docs/brakes.md", undefined);
    const highlighted = document.querySelectorAll(".is-selected");
    expect(highlighted.length).toBe(1);
    expect(highlighted[0].id).toBe(`entry-${ID}`);
    expect(highlighted[0].classList.contains("req-block")).toBe(true);
  });

  it("moves the highlight within a cached document", async () => {
    const { client, select } = mount();
    select(ID);
    await screen.findByText("Brakes");
    select("B");
    await waitFor(() =>
      expect(document.querySelector(".is-selected")?.id).toBe("entry-B")
    );
    expect(document.querySelectorAll(".is-selected").length).toBe(1);
    // The second selection revalidates the cached render with its ETag.
    expect(client.document).toHaveBeenCalledTimes(2);
    expect(client.document).toHaveBeenLastCalledWith(
      "docs/brakes.md",
      expect.objectContaining({ etag: '"v1"' }),
    );
  });

  it("shows the new render when the window gets focus after an edit on disk", async () => {
    const server = documentServer();
    const { select } = mount(fakeClient({ document: server.document }));
    select(ID);
    await screen.findByText("Brakes");
    server.edit(
      `<h1>Brakes edited</h1><div class="req-block" id="entry-${ID}" data-display-id="${ID}">x</div>`,
    );
    act(() => {
      globalThis.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByText("Brakes edited")).toBeTruthy();
    expect(document.querySelector(".is-selected")?.id).toBe(`entry-${ID}`);
  });

  it("shows the new render on the next selection after an edit on disk", async () => {
    const server = documentServer();
    const { select } = mount(fakeClient({ document: server.document }));
    select(ID);
    await screen.findByText("Brakes");
    server.edit(
      `<h1>Brakes edited</h1><div class="req-block" id="entry-B" data-display-id="B">x</div>`,
    );
    select("B");
    expect(await screen.findByText("Brakes edited")).toBeTruthy();
  });

  it("keeps the shown render and its scroll position when focus finds no change", async () => {
    const server = documentServer();
    const { select } = mount(fakeClient({ document: server.document }));
    select(ID);
    await screen.findByText("Brakes");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    const content = document.querySelector(".document-content");
    scrollIntoView.mockClear();
    act(() => {
      globalThis.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(server.document).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelector(".document-content")).toBe(content);
  });

  it("uses the rendered entry for a source-file entry", async () => {
    const { client, select } = mount();
    select("SRC");
    expect(await screen.findByText("html of SRC")).toBeTruthy();
    expect(client.entryHtml).toHaveBeenCalledWith("SRC");
    expect(client.document).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Source" })).toBeTruthy();
  });

  it("shows an external entry read-only without the Source toggle", async () => {
    const { client, select } = mount();
    select("EXT");
    expect(await screen.findByText("From acme@1.2, read-only.")).toBeTruthy();
    expect(screen.getByText("html of EXT")).toBeTruthy();
    expect(client.document).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
  });

  it("falls back to the rendered entry and hides Source when the document cannot be served", async () => {
    const client = fakeClient({
      document: vi.fn(async () => {
        throw new DeskError(404, "not-found", "no");
      }),
    });
    const { select } = mount(client);
    select(ID);
    expect(await screen.findByText(`html of ${ID}`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
  });

  it("clicking a cross-ref selects it, and Back and Forward walk the selections", async () => {
    const { select, history } = mount();
    select(ID);
    await screen.findByText("Brakes");
    fireEvent.click(screen.getByText("B", { selector: ".cross-ref" }));
    expect(history().current).toBe("B");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(history().current).toBe(ID);
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(history().current).toBe("B");
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    expect(history().current).toBe(ID);
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    expect(history().current).toBe("B");
  });

  it("opens http(s) links externally and never navigates the webview", async () => {
    const { bridge, select } = mount();
    select(ID);
    await screen.findByText("Brakes");
    const external = screen.getByText("spec");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    external.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(bridge.openExternal).toHaveBeenCalledWith(
      "https://example.com/spec",
    );
    const relative = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    screen.getByText("other").dispatchEvent(relative);
    expect(relative.defaultPrevented).toBe(true);
    expect(bridge.openExternal).toHaveBeenCalledTimes(1);
    const anchor = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByText("down").dispatchEvent(anchor);
    expect(anchor.defaultPrevented).toBe(true);
  });

  it("replaces a relative image with its alt text", async () => {
    const { select } = mount();
    select(ID);
    await screen.findByText("Brakes");
    const pane = document.querySelector(".document-content")!;
    expect(pane.querySelector('img[src="figures/brake.svg"]')).toBeNull();
    expect(screen.getByText("Brake diagram").className).toBe(
      "image-placeholder",
    );
    expect(pane.querySelector('img[src^="data:"]')).not.toBeNull();
  });

  it("replaces an http(s) image with its alt text", async () => {
    const { select } = mount();
    select(ID);
    await screen.findByText("Brakes");
    const pane = document.querySelector(".document-content")!;
    expect(pane.querySelector('img[src^="https:"]')).toBeNull();
    expect(screen.getByText("Remote figure").className).toBe(
      "image-placeholder",
    );
  });

  it("makes cross-references keyboard focusable and follows them on Enter", async () => {
    const { select, history } = mount();
    select(ID);
    await screen.findByText("Brakes");
    const ref = screen.getByText("B", { selector: ".cross-ref" });
    expect(ref.getAttribute("tabindex")).toBe("0");
    expect(ref.getAttribute("role")).toBe("link");
    fireEvent.keyDown(ref, { key: "Enter" });
    expect(history().current).toBe("B");
  });

  it("handles a failed external link so no rejection is left unhandled", async () => {
    const bridge = fakeBridge();
    // A promise that records whether anything handles its rejection.
    const handled = vi.fn();
    const failure = {
      then: (_ok: unknown, onRejected?: unknown) => {
        if (typeof onRejected === "function") handled();
        return failure;
      },
      catch: () => {
        handled();
        return failure;
      },
    } as unknown as Promise<void>;
    bridge.openExternal = (() => failure) as ShellBridge["openExternal"];
    const { select } = mount(fakeClient(), bridge);
    select(ID);
    await screen.findByText("Brakes");
    fireEvent.click(screen.getByText("spec"));
    await new Promise((r) => setTimeout(r, 10));
    expect(handled).toHaveBeenCalled();
  });

  it("opens the source drawer with line numbers at the entry line", async () => {
    const { client, select } = mount();
    select(ID);
    await screen.findByText("Brakes");
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(await screen.findByText("line three")).toBeTruthy();
    expect(client.file).toHaveBeenCalledWith("docs/brakes.md");
    const rows = document.querySelectorAll(".source-line");
    expect(rows.length).toBe(5);
    expect(rows[2].querySelector(".source-gutter")!.textContent).toBe("3");
    expect(rows[2].classList.contains("is-target")).toBe(true);
  });

  it("reloads the open source drawer when focus finds an edited document", async () => {
    const server = documentServer();
    let source = "old text";
    const client = fakeClient({
      document: server.document,
      file: vi.fn(async (path: string) => ({
        apiVersion: 3 as const,
        path,
        text: source,
      })),
    });
    const { select } = mount(client);
    select(ID);
    await screen.findByText("Brakes");
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(await screen.findByText("old text")).toBeTruthy();
    source = "new text";
    server.edit(
      `<h1>Brakes edited</h1><div class="req-block" id="entry-${ID}" data-display-id="${ID}">x</div>`,
    );
    act(() => {
      globalThis.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByText("new text")).toBeTruthy();
  });

  it("reloads the open source drawer on focus when the render is unchanged", async () => {
    let source = "old text";
    const client = fakeClient({
      file: vi.fn(async (path: string) => ({
        apiVersion: 3 as const,
        path,
        text: source,
      })),
    });
    const { select } = mount(client);
    // A source-file entry: its single-entry HTML does not change when lines
    // are inserted above it.
    select("SRC");
    await screen.findByText("html of SRC");
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(await screen.findByText("old text")).toBeTruthy();
    source = "new text";
    act(() => {
      globalThis.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByText("new text")).toBeTruthy();
  });

  it("shows no pane error for a network failure", async () => {
    const client = fakeClient({
      entry: vi.fn(async () => {
        throw new DeskError(0, "network", "down");
      }),
    });
    const { select } = mount(client);
    select(ID);
    await waitFor(() => expect(client.entry).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("scrolls the selected entry block into view", async () => {
    const { select } = mount();
    select(ID);
    await screen.findByText("Brakes");
    await waitFor(() =>
      expect(
        scrollIntoView.mock.contexts.some((el) =>
          (el as HTMLElement).id === `entry-${ID}`
        ),
      ).toBe(true)
    );
  });

  it("scrolls the target of a #fragment link into view", async () => {
    const { select } = mount();
    select(ID);
    await screen.findByText("Brakes");
    scrollIntoView.mockClear();
    fireEvent.click(screen.getByText("down"));
    expect(scrollIntoView.mock.contexts.map((el) => (el as HTMLElement).id))
      .toEqual(["entry-B"]);
  });

  it("scrolls the source drawer to the entry line", async () => {
    const { select } = mount();
    select(ID);
    await screen.findByText("Brakes");
    scrollIntoView.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    await screen.findByText("line three");
    await waitFor(() =>
      expect(
        scrollIntoView.mock.contexts.some((el) =>
          (el as HTMLElement).classList.contains("is-target")
        ),
      ).toBe(true)
    );
    const target = scrollIntoView.mock.contexts.find((el) =>
      (el as HTMLElement).classList.contains("is-target")
    ) as HTMLElement;
    expect(target.textContent).toContain("line three");
  });

  it("shows the latest selection when an earlier response arrives last", async () => {
    const pending: Record<string, ReturnType<typeof deferred<EntryView>>> = {
      [ID]: deferred<EntryView>(),
      B: deferred<EntryView>(),
    };
    const client = fakeClient({
      entry: vi.fn((id: string) => pending[id].promise),
    });
    const { select } = mount(client);
    select(ID);
    select("B");
    await act(async () => {
      pending.B.resolve(entryView("B", "docs/brakes.md"));
    });
    await waitFor(() =>
      expect(document.querySelector(".is-selected")?.id).toBe("entry-B")
    );
    await act(async () => {
      pending[ID].resolve(entryView(ID, "docs/brakes.md"));
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(document.querySelectorAll(".is-selected").length).toBe(1);
    expect(document.querySelector(".is-selected")?.id).toBe("entry-B");
  });

  it("never shows the previous entry while a new selection loads or fails", async () => {
    const loading = deferred<EntryView>();
    const base = fakeClient();
    const client = fakeClient({
      entry: vi.fn((id: string) =>
        id === "SLOW" ? loading.promise : base.entry(id)
      ),
    });
    const { select } = mount(client);
    select(ID);
    await screen.findByText("Brakes");
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    await screen.findByText("line three");
    select("SLOW");
    await waitFor(() => expect(screen.queryByText("Brakes")).toBeNull());
    expect(screen.queryByText("line three")).toBeNull();
    expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
    select("MISSING");
    expect(await screen.findByText("MISSING is not in this product."))
      .toBeTruthy();
    expect(screen.queryByText("Brakes")).toBeNull();
    expect(document.querySelector(".document-content")).toBeNull();
  });

  it("retries a failed document load on a later selection", async () => {
    let calls = 0;
    const client = fakeClient({
      document: vi.fn(async (path: string) => {
        if (++calls === 1) throw new DeskError(500, "internal", "boom");
        return fresh(documentView(path));
      }),
    });
    const { select } = mount(client);
    select(ID);
    expect(await screen.findByText(`html of ${ID}`)).toBeTruthy();
    select("B");
    expect(await screen.findByText("Brakes")).toBeTruthy();
    expect(client.document).toHaveBeenCalledTimes(2);
  });

  it("passes a network failure of the document on without a fallback", async () => {
    const client = fakeClient({
      document: vi.fn(async () => {
        throw new DeskError(0, "network", "down");
      }),
    });
    const { select } = mount(client);
    select(ID);
    await waitFor(() => expect(client.document).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(client.entryHtml).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a message for a server error", async () => {
    const { select } = mount(fakeClient({
      entry: vi.fn(async () => {
        throw new DeskError(500, "internal", "boom");
      }),
    }));
    select(ID);
    expect(
      await screen.findByText("MarkDesk could not show this requirement."),
    ).toBeTruthy();
  });

  it("keeps the error alert for a 404 that is not entry-not-found", async () => {
    const { select } = mount(fakeClient({
      entry: vi.fn(async () => {
        throw new DeskError(404, "not-found", "no route");
      }),
    }));
    select(ID);
    expect(
      await screen.findByText("MarkDesk could not show this requirement."),
    ).toBeTruthy();
    expect(screen.queryByText(`${ID} is not in this product.`)).toBeNull();
  });

  it("shows no error when the selected entry is removed on disk", async () => {
    let removed = false;
    const base = fakeClient();
    const client = fakeClient({
      entry: vi.fn(async (id: string) => {
        if (removed && id === ID) {
          throw new DeskError(404, "entry-not-found", "missing");
        }
        return base.entry(id);
      }),
    });
    const { select, history } = mount(client);
    select(ID);
    await screen.findByText("Brakes");
    removed = true;
    act(() => {
      globalThis.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByText(`${ID} is not in this product.`))
      .toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Brakes")).toBeNull();
    expect(history().current).toBe(ID);
  });
});
