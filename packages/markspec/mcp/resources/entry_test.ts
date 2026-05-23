/**
 * @module mcp/resources/entry_test
 *
 * Unit tests for the markspec://entry/{id} Markdown renderer.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Entry, Link } from "../../core/mod.ts";
import { makeDisplayId } from "../../core/mod.ts";
import { renderEntry } from "./entry.ts";

const ENTRY: Entry = {
  displayId: makeDisplayId("STK_AEB_0001"),
  title: "Stop on imminent collision",
  body:
    "When the system detects an imminent collision with a stationary object,\nit shall command emergency braking.",
  rawAttributes: [
    { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
    { key: "Labels", value: "ASIL-B" },
  ],
  typedAttributes: new Map(),
  id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
  type: "stakeholder-requirement",
  shape: "Authored",
  location: {
    file: "/proj/docs/product/stakeholder-requirements.md",
    line: 42,
    column: 1,
  },
  source: "markdown",
};

const FORWARD: Link[] = [
  {
    from: makeDisplayId("STK_AEB_0001"),
    to: makeDisplayId("SYS_AEB_0012"),
    kind: "satisfies",
    location: {
      file: "/proj/docs/product/stakeholder-requirements.md",
      line: 47,
      column: 1,
    },
  },
];

const REVERSE: Link[] = [
  {
    from: makeDisplayId("VAL_AEB_0001"),
    to: makeDisplayId("STK_AEB_0001"),
    kind: "verifies",
    location: { file: "/proj/tests/val_aeb.rs", line: 12, column: 1 },
  },
];

const TITLES = new Map<string, string>([
  ["SYS_AEB_0012", "Object threat assessment"],
  ["VAL_AEB_0001", "Vehicle stops before collision"],
]);

Deno.test("renderEntry: includes title and type", () => {
  const md = renderEntry(ENTRY, [], [], TITLES);
  assertStringIncludes(md, "# STK_AEB_0001 — Stop on imminent collision");
  assertStringIncludes(md, "**Type**: stakeholder-requirement");
  assertStringIncludes(md, "**Shape**: Authored");
});

Deno.test("renderEntry: includes ULID and location", () => {
  const md = renderEntry(ENTRY, [], [], TITLES);
  assertStringIncludes(md, "**Id**: `01HGW2Q8MNP3RSTVWXYZABCDEF`");
  assertStringIncludes(md, "stakeholder-requirements.md:42");
});

Deno.test("renderEntry: renders location relative to projectRoot", {
  ignore: Deno.build.os === "windows",
}, () => {
  const md = renderEntry(ENTRY, [], [], TITLES, "/proj");
  assertStringIncludes(
    md,
    "**Location**: docs/product/stakeholder-requirements.md:42",
  );
  assertEquals(
    md.includes("/proj/docs/product/stakeholder-requirements.md"),
    false,
  );
});

Deno.test("renderEntry: includes body paragraph", () => {
  const md = renderEntry(ENTRY, [], [], TITLES);
  assertStringIncludes(md, "When the system detects an imminent collision");
});

Deno.test("renderEntry: includes non-Id attributes", () => {
  const md = renderEntry(ENTRY, [], [], TITLES);
  assertStringIncludes(md, "## Attributes");
  assertStringIncludes(md, "- **Labels**: ASIL-B");
});

Deno.test("renderEntry: includes outgoing links with target titles", () => {
  const md = renderEntry(ENTRY, FORWARD, [], TITLES);
  assertStringIncludes(md, "## Outgoing links");
  assertStringIncludes(
    md,
    "**satisfies** → [SYS_AEB_0012](markspec://entry/SYS_AEB_0012) — Object threat assessment",
  );
});

Deno.test("renderEntry: includes incoming links with source titles", () => {
  const md = renderEntry(ENTRY, [], REVERSE, TITLES);
  assertStringIncludes(md, "## Incoming links");
  assertStringIncludes(
    md,
    "**verifies** ← [VAL_AEB_0001](markspec://entry/VAL_AEB_0001) — Vehicle stops before collision",
  );
});

Deno.test("renderEntry: omits Outgoing/Incoming sections when empty", () => {
  const md = renderEntry(ENTRY, [], [], TITLES);
  assertEquals(md.includes("## Outgoing links"), false);
  assertEquals(md.includes("## Incoming links"), false);
});

Deno.test("renderEntry: omits Attributes section when only Id present", () => {
  const idOnly: Entry = {
    ...ENTRY,
    rawAttributes: [{ key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" }],
  };
  const md = renderEntry(idOnly, [], [], TITLES);
  assertEquals(md.includes("## Attributes"), false);
});
