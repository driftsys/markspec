/**
 * @module mcp/resources/entries_test
 *
 * Unit tests for the markspec://entries index renderer.
 */

import { assertStringIncludes } from "@std/assert";
import type { Entry } from "../../core/mod.ts";
import { renderEntriesIndex } from "./entries.ts";

function mkEntry(displayId: string, title: string, type?: string): Entry {
  return {
    displayId,
    title,
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    type,
    shape: "Authored",
    location: { file: "/proj/x.md", line: 1, column: 1 },
    source: "markdown",
  };
}

Deno.test("renderEntriesIndex: groups by type, sorted alphabetically", () => {
  const md = renderEntriesIndex([
    mkEntry("STK_AEB_0001", "Stop on collision", "stakeholder-requirement"),
    mkEntry("SRS_AEB_0010", "Sensor debouncing", "software-requirement"),
    mkEntry("STK_AEB_0002", "Driver override", "stakeholder-requirement"),
  ]);
  assertStringIncludes(md, "# Entries (3)");
  assertStringIncludes(md, "## software-requirement (1)");
  assertStringIncludes(md, "## stakeholder-requirement (2)");
});

Deno.test("renderEntriesIndex: renders entries as Markdown links", () => {
  const md = renderEntriesIndex([
    mkEntry("STK_AEB_0001", "Stop on collision", "stakeholder-requirement"),
  ]);
  assertStringIncludes(
    md,
    "- [STK_AEB_0001](markspec://entry/STK_AEB_0001) — Stop on collision",
  );
});

Deno.test("renderEntriesIndex: groups untyped entries under 'untyped'", () => {
  const md = renderEntriesIndex([
    mkEntry("FREEFORM_0001", "Untyped entry"),
  ]);
  assertStringIncludes(md, "## untyped (1)");
});

Deno.test("renderEntriesIndex: empty corpus", () => {
  const md = renderEntriesIndex([]);
  assertStringIncludes(md, "# Entries (0)");
  assertStringIncludes(md, "No entries in this project");
});
