import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DeskClient,
  DeskError,
  type DocumentView,
  type EntryView,
} from "../api/client";
import { ProductContext } from "../app/useProduct";
import { BridgeContext } from "../shell/BridgeContext";
import type { ShellBridge } from "../shell/bridge";
import { DocumentPane } from "./DocumentPane";
import { type History, HistoryProvider, useHistory } from "./useHistory";

afterEach(cleanup);

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
<p><img src="figures/brake.svg" alt="Brake diagram"><img src="data:image/png;base64,AA==" alt="inline"></p>
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
    document: vi.fn(async (path: string) => documentView(path)),
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
          <Probe />
          <DocumentPane />
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
    expect(client.document).toHaveBeenCalledWith("docs/brakes.md");
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
    expect(client.document).toHaveBeenCalledTimes(1);
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

  it("shows a message for a server error", async () => {
    const { select } = mount();
    select("MISSING");
    expect(
      await screen.findByText("MarkDesk could not show this requirement."),
    ).toBeTruthy();
  });
});
