import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildUxCompletionItems,
  extractUxRefPartial,
  formatUxHoverContent,
  isUxRefTrigger,
  resolveUxRef,
  uxRefTokenAtPosition,
} from "./uxil.ts";
import type {
  SurfaceRecord,
  UxElement,
  UxRef,
  UxRegistry,
} from "../core/uxil/mod.ts";

// ---------------------------------------------------------------------------
// uxRefTokenAtPosition
// ---------------------------------------------------------------------------

Deno.test("uxRefTokenAtPosition: detects ux: ref with cursor in middle", () => {
  const l = "See `ux:media.home` here";
  const want = "ux:media.home";
  assertEquals(uxRefTokenAtPosition(l, l.indexOf("ux:")), want); // on 'u'
  assertEquals(uxRefTokenAtPosition(l, l.indexOf("media")), want); // mid segment
  assertEquals(uxRefTokenAtPosition(l, l.indexOf("home") + 2), want); // near end
});

Deno.test("uxRefTokenAtPosition: returns undefined on whitespace", () => {
  const l = "See `ux:media.home` here";
  assertEquals(uxRefTokenAtPosition(l, l.indexOf(" here")), undefined);
});

Deno.test("uxRefTokenAtPosition: returns undefined off a non-ux: token", () => {
  assertEquals(uxRefTokenAtPosition("Satisfies: STK_001", 12), undefined);
});

Deno.test("uxRefTokenAtPosition: spans an element/verb ref", () => {
  const l = "`ux:media.home/play!activate`";
  const want = "ux:media.home/play!activate";
  assertEquals(uxRefTokenAtPosition(l, l.indexOf("play")), want);
  assertEquals(uxRefTokenAtPosition(l, l.indexOf("activate") + 3), want);
});

Deno.test("uxRefTokenAtPosition: trims a trailing sentence period", () => {
  const l = "cite ux:media.home.";
  assertEquals(uxRefTokenAtPosition(l, l.indexOf("home")), "ux:media.home");
});

Deno.test("uxRefTokenAtPosition: unrelated text fused to ux: is rejected", () => {
  const l = "seeux:media.home";
  // Cursor on the unrelated "see" prefix must not resolve to a ref.
  assertEquals(uxRefTokenAtPosition(l, 0), undefined);
  // Cursor on the actual ref portion still resolves.
  assertEquals(uxRefTokenAtPosition(l, l.indexOf("media")), "ux:media.home");
});

// ---------------------------------------------------------------------------
// isUxRefTrigger / extractUxRefPartial
// ---------------------------------------------------------------------------

Deno.test("isUxRefTrigger: triggers on ux: and a partial surface path", () => {
  assertEquals(isUxRefTrigger("See `ux:"), true);
  assertEquals(isUxRefTrigger("See `ux:media"), true);
  assertEquals(isUxRefTrigger("See `ux:media.h"), true);
});

Deno.test("isUxRefTrigger: does not trigger mid-identifier or on unrelated colons", () => {
  assertEquals(isUxRefTrigger("Satisfies:"), false);
  assertEquals(isUxRefTrigger("fluxux:media"), false);
});

Deno.test("isUxRefTrigger: stops matching past the surface-path segment", () => {
  // Element/state/verb completion is out of scope for this story — once a
  // `/`, `@`, or `!` has been typed, the trigger no longer fires.
  assertEquals(isUxRefTrigger("`ux:media.home/"), false);
});

Deno.test("extractUxRefPartial: extracts text typed after ux:", () => {
  assertEquals(extractUxRefPartial("See `ux:"), "");
  assertEquals(extractUxRefPartial("See `ux:media.h"), "media.h");
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function element(
  name: string,
  opts: {
    verbs?: string[];
    states?: string[];
    eventDictionary?: string;
    navTarget?: string;
  } = {},
): UxElement {
  return {
    name,
    verbs: opts.verbs ?? ["activate"],
    states: opts.states ?? [],
    eventDictionary: opts.eventDictionary ?? "logs a tap event",
    ...(opts.navTarget !== undefined ? { navTarget: opts.navTarget } : {}),
    location: { file: "docs/product/sad.md", line: 4, column: 3 },
  };
}

function surfaceRecord(
  path: string,
  opts: {
    kind?: string;
    states?: string[];
    owningEntryDisplayId?: string;
    owningEntryFile?: string;
    elements?: UxElement[];
  } = {},
): SurfaceRecord {
  const file = opts.owningEntryFile ?? "docs/product/sad.md";
  return {
    path,
    kind: opts.kind ?? "screen",
    states: opts.states ?? [],
    owningEntryDisplayId: opts.owningEntryDisplayId ?? "SAD_MEDIA_0001",
    owningEntryFile: file,
    elements: opts.elements ?? [],
    location: { file, line: 3, column: 1 },
  };
}

function registry(records: SurfaceRecord[]): UxRegistry {
  const surfaces = new Map<string, SurfaceRecord[]>();
  for (const r of records) {
    const list = surfaces.get(r.path);
    if (list) list.push(r);
    else surfaces.set(r.path, [r]);
  }
  return { surfaces };
}

function ref(
  surface: string,
  opts: { element?: string; state?: string; verb?: string } = {},
): UxRef {
  return {
    hasScheme: true,
    surface: surface.split("."),
    ...(opts.element !== undefined ? { element: opts.element } : {}),
    ...(opts.state !== undefined ? { state: opts.state } : {}),
    ...(opts.verb !== undefined ? { verb: opts.verb } : {}),
    position: { line: 1, column: 1 },
  };
}

// ---------------------------------------------------------------------------
// resolveUxRef
// ---------------------------------------------------------------------------

Deno.test("resolveUxRef: finds the declaration by path", () => {
  const r = registry([surfaceRecord("media.home")]);
  assertEquals(resolveUxRef(ref("media.home"), r)?.path, "media.home");
});

Deno.test("resolveUxRef: returns undefined for an unknown surface", () => {
  const r = registry([surfaceRecord("media.home")]);
  assertEquals(resolveUxRef(ref("media.other"), r), undefined);
});

Deno.test("resolveUxRef: first-declaration-wins on a duplicate path", () => {
  const first = surfaceRecord("media.home", {
    owningEntryDisplayId: "SAD_0001",
  });
  const dup = surfaceRecord("media.home", { owningEntryDisplayId: "SAD_0002" });
  const r = registry([first, dup]);
  assertEquals(
    resolveUxRef(ref("media.home"), r)?.owningEntryDisplayId,
    "SAD_0001",
  );
});

// ---------------------------------------------------------------------------
// formatUxHoverContent
// ---------------------------------------------------------------------------

Deno.test("formatUxHoverContent: surface-only ref shows kind, states, owning entry", () => {
  const r = registry([
    surfaceRecord("media.home", {
      states: ["idle", "playing"],
      owningEntryDisplayId: "SAD_MEDIA_0007",
    }),
  ]);
  const content = formatUxHoverContent(ref("media.home"), r);
  assertStringIncludes(content!, "ux:media.home");
  assertStringIncludes(content!, "**Kind:** screen");
  assertStringIncludes(content!, "idle, playing");
  assertStringIncludes(content!, "SAD_MEDIA_0007");
});

Deno.test("formatUxHoverContent: element ref shows verbs and description", () => {
  const r = registry([
    surfaceRecord("media.home", {
      elements: [element("play", {
        verbs: ["activate"],
        eventDictionary: "logs media_play_tapped",
      })],
    }),
  ]);
  const content = formatUxHoverContent(
    ref("media.home", { element: "play" }),
    r,
  );
  assertStringIncludes(content!, "ux:media.home/play");
  assertStringIncludes(content!, "**Verbs:** activate");
  assertStringIncludes(content!, "logs media_play_tapped");
});

Deno.test("formatUxHoverContent: unknown surface returns undefined", () => {
  assertEquals(
    formatUxHoverContent(ref("media.home"), registry([])),
    undefined,
  );
});

Deno.test("formatUxHoverContent: unknown element on a known surface returns undefined", () => {
  const r = registry([surfaceRecord("media.home")]);
  assertEquals(
    formatUxHoverContent(ref("media.home", { element: "missing" }), r),
    undefined,
  );
});

Deno.test("formatUxHoverContent: unknown state on a known surface returns undefined", () => {
  const r = registry([surfaceRecord("media.home", { states: ["idle"] })]);
  assertEquals(
    formatUxHoverContent(ref("media.home", { state: "playing" }), r),
    undefined,
  );
});

Deno.test("formatUxHoverContent: unknown state on a known element returns undefined", () => {
  const r = registry([
    surfaceRecord("media.home", {
      elements: [element("play", { states: ["idle"] })],
    }),
  ]);
  assertEquals(
    formatUxHoverContent(
      ref("media.home", { element: "play", state: "playing" }),
      r,
    ),
    undefined,
  );
});

// ---------------------------------------------------------------------------
// buildUxCompletionItems
// ---------------------------------------------------------------------------

Deno.test("buildUxCompletionItems: one item per known surface path", () => {
  const r = registry([
    surfaceRecord("media.home", {
      kind: "screen",
      owningEntryDisplayId: "SAD_0001",
    }),
    surfaceRecord("media.queue", {
      kind: "panel",
      owningEntryDisplayId: "SAD_0002",
    }),
  ]);
  const items = buildUxCompletionItems(r, "");
  assertEquals(items.map((i) => i.label).sort(), ["media.home", "media.queue"]);
  const home = items.find((i) => i.label === "media.home");
  assertEquals(home?.detail, "screen · SAD_0001");
});

Deno.test("buildUxCompletionItems: filters by prefix (case-insensitive)", () => {
  const r = registry([
    surfaceRecord("media.home"),
    surfaceRecord("controls.hvac"),
  ]);
  const items = buildUxCompletionItems(r, "Media");
  assertEquals(items.map((i) => i.label), ["media.home"]);
});

Deno.test("buildUxCompletionItems: empty registry yields no items", () => {
  assertEquals(buildUxCompletionItems(registry([]), "").length, 0);
});
