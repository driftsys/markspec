import { assertEquals } from "@std/assert";
import { checkLinkTargets } from "./link_target.ts";
import type { DisplayId, Entry, Link, SourceLocation } from "../model/mod.ts";

const LOC: SourceLocation = { file: "test.md", line: 1, column: 1 };

function makeEntry(
  displayId: string,
  opts: {
    attributes?: Array<{ key: string; value: string }>;
    typedAttributes?: ReadonlyMap<string, readonly string[]>;
  } = {},
): Entry {
  return {
    displayId,
    title: displayId,
    body: "",
    attributes: opts.attributes ?? [],
    typedAttributes: opts.typedAttributes,
    shape: "identified",
    location: LOC,
    source: "markdown",
  };
}

function makeLink(from: string, to: string): Link {
  return { from, to, kind: "satisfies", location: LOC };
}

Deno.test("checkLinkTargets: active target produces no diagnostic", () => {
  const entries = new Map<DisplayId, Entry>([
    ["REQ-001", makeEntry("REQ-001")],
    ["REQ-002", makeEntry("REQ-002")],
  ]);
  const links = [makeLink("REQ-002", "REQ-001")];
  const diagnostics = checkLinkTargets(entries, links);
  assertEquals(diagnostics.length, 0);
});

Deno.test("checkLinkTargets: DRAFT target produces info", () => {
  const entries = new Map<DisplayId, Entry>([
    [
      "REQ-001",
      makeEntry("REQ-001", {
        typedAttributes: new Map([["Labels", ["DRAFT"]]]),
      }),
    ],
    ["REQ-002", makeEntry("REQ-002")],
  ]);
  const links = [makeLink("REQ-002", "REQ-001")];
  const diagnostics = checkLinkTargets(entries, links);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "MSL-T013");
  assertEquals(diagnostics[0].severity, "info");
});

Deno.test("checkLinkTargets: Deprecated target produces warning", () => {
  const entries = new Map<DisplayId, Entry>([
    [
      "REQ-001",
      makeEntry("REQ-001", {
        attributes: [{ key: "Deprecated", value: "replaced by REQ-003" }],
      }),
    ],
    ["REQ-002", makeEntry("REQ-002")],
  ]);
  const links = [makeLink("REQ-002", "REQ-001")];
  const diagnostics = checkLinkTargets(entries, links);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "MSL-T013");
  assertEquals(diagnostics[0].severity, "warning");
});

Deno.test("checkLinkTargets: Superseded-by target produces warning", () => {
  const entries = new Map<DisplayId, Entry>([
    [
      "REQ-001",
      makeEntry("REQ-001", {
        typedAttributes: new Map([["Superseded-by", ["REQ-003"]]]),
      }),
    ],
    ["REQ-002", makeEntry("REQ-002")],
  ]);
  const links = [makeLink("REQ-002", "REQ-001")];
  const diagnostics = checkLinkTargets(entries, links);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "MSL-T013");
  assertEquals(diagnostics[0].severity, "warning");
});

Deno.test("checkLinkTargets: unresolved target is skipped (handled by MSL-T005)", () => {
  const entries = new Map<DisplayId, Entry>([
    ["REQ-002", makeEntry("REQ-002")],
  ]);
  const links = [makeLink("REQ-002", "NONEXISTENT")];
  const diagnostics = checkLinkTargets(entries, links);
  assertEquals(diagnostics.length, 0);
});
