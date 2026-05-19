/**
 * @module lsp/workspace_test
 *
 * Unit tests for WorkspaceIndex — the in-memory entry index.
 */

import { assertEquals } from "@std/assert";
import { WorkspaceIndex } from "./workspace.ts";
import type { Entry, SourceLocation } from "../core/mod.ts";

/** Helper to create a minimal identified entry. */
function entry(
  displayId: string,
  opts: { file?: string; title?: string; id?: string } = {},
): Entry {
  const file = opts.file ?? "test.md";
  const location: SourceLocation = { file, line: 1, column: 1 };
  return {
    displayId,
    title: opts.title ?? displayId,
    body: "",
    rawAttributes: opts.id ? [{ key: "Id", value: opts.id }] : [],
    id: opts.id,
    shape: "Authored",
    location,
    source: "markdown",
    typedAttributes: new Map(),
  };
}

Deno.test("WorkspaceIndex: updateFile adds entries to index", () => {
  const index = new WorkspaceIndex();
  const entries = [
    entry("STK_AEB_0001", { file: "reqs.md", title: "Braking", id: "01AAA" }),
    entry("STK_AEB_0002", {
      file: "reqs.md",
      title: "Steering",
      id: "01BBB",
    }),
  ];
  index.updateFile("reqs.md", entries);

  assertEquals(index.getAllEntries().length, 2);
  assertEquals(index.getEntryByDisplayId("STK_AEB_0001")?.title, "Braking");
  assertEquals(index.getEntryByDisplayId("STK_AEB_0002")?.title, "Steering");
});

Deno.test("WorkspaceIndex: updateFile replaces entries for same file", () => {
  const index = new WorkspaceIndex();
  index.updateFile("reqs.md", [entry("STK_001", { file: "reqs.md" })]);
  assertEquals(index.getAllEntries().length, 1);

  index.updateFile("reqs.md", [
    entry("STK_002", { file: "reqs.md" }),
    entry("STK_003", { file: "reqs.md" }),
  ]);
  assertEquals(index.getAllEntries().length, 2);
  assertEquals(index.getEntryByDisplayId("STK_001"), undefined);
  assertEquals(index.getEntryByDisplayId("STK_002")?.displayId, "STK_002");
});

Deno.test("WorkspaceIndex: removeFile removes entries", () => {
  const index = new WorkspaceIndex();
  index.updateFile("a.md", [entry("STK_001", { file: "a.md" })]);
  index.updateFile("b.md", [entry("STK_002", { file: "b.md" })]);
  assertEquals(index.getAllEntries().length, 2);

  index.removeFile("a.md");
  assertEquals(index.getAllEntries().length, 1);
  assertEquals(index.getEntryByDisplayId("STK_001"), undefined);
  assertEquals(index.getEntryByDisplayId("STK_002")?.displayId, "STK_002");
});

Deno.test("WorkspaceIndex: getEntriesForFile returns file-scoped entries", () => {
  const index = new WorkspaceIndex();
  index.updateFile("a.md", [entry("STK_001", { file: "a.md" })]);
  index.updateFile("b.md", [entry("STK_002", { file: "b.md" })]);

  assertEquals(index.getEntriesForFile("a.md").length, 1);
  assertEquals(index.getEntriesForFile("a.md")[0].displayId, "STK_001");
  assertEquals(index.getEntriesForFile("c.md").length, 0);
});

Deno.test("WorkspaceIndex: getDisplayIdsByPrefix filters by prefix", () => {
  const index = new WorkspaceIndex();
  index.updateFile("reqs.md", [
    entry("STK_AEB_0001", { file: "reqs.md" }),
    entry("STK_AEB_0002", { file: "reqs.md" }),
    entry("SAD_AEB_0001", { file: "reqs.md" }),
  ]);

  const stkIds = index.getDisplayIdsByPrefix("STK");
  assertEquals(stkIds.length, 2);
  const sadIds = index.getDisplayIdsByPrefix("SAD");
  assertEquals(sadIds.length, 1);
  const sysIds = index.getDisplayIdsByPrefix("SYS");
  assertEquals(sysIds.length, 0);
});

Deno.test("WorkspaceIndex: getAllDisplayIds returns all IDs with titles", () => {
  const index = new WorkspaceIndex();
  index.updateFile("reqs.md", [
    entry("STK_001", { file: "reqs.md", title: "Braking" }),
    entry("SAD_001", { file: "reqs.md", title: "Architecture" }),
  ]);

  const all = index.getAllDisplayIds();
  assertEquals(all.length, 2);
  assertEquals(all.find((e) => e.displayId === "STK_001")?.title, "Braking");
});

Deno.test("WorkspaceIndex: getNextDisplayIdNumber computes next number", () => {
  const index = new WorkspaceIndex();
  index.updateFile("reqs.md", [
    entry("STK_AEB_0001", { file: "reqs.md" }),
    entry("STK_AEB_0003", { file: "reqs.md" }),
    entry("STK_AEB_0010", { file: "reqs.md" }),
  ]);

  assertEquals(index.getNextDisplayIdNumber("STK_AEB_"), 11);
});

Deno.test("WorkspaceIndex: getNextDisplayIdNumber returns 1 for empty prefix", () => {
  const index = new WorkspaceIndex();
  assertEquals(index.getNextDisplayIdNumber("STK_AEB_"), 1);
});

Deno.test("WorkspaceIndex: updateFile promotes survivor when owner loses a display ID", () => {
  const index = new WorkspaceIndex();

  // Index both files — a.md wins the display ID (indexed first).
  index.updateFile("a.md", [entry("STK_0001", { file: "a.md" })]);
  index.updateFile("b.md", [entry("STK_0001", { file: "b.md" })]);

  assertEquals(
    index.getEntryByDisplayId("STK_0001")?.location.file,
    "a.md",
  );

  // Update file A to remove STK_0001 — file B's entry should be promoted.
  index.updateFile("a.md", []);

  assertEquals(
    index.getEntryByDisplayId("STK_0001")?.location.file,
    "b.md",
  );
});

Deno.test("WorkspaceIndex: removeFile promotes survivor when removed file owned a display ID", () => {
  const index = new WorkspaceIndex();

  // Index both files — a.md wins the display ID (indexed first).
  index.updateFile("a.md", [entry("STK_0001", { file: "a.md" })]);
  index.updateFile("b.md", [entry("STK_0001", { file: "b.md" })]);

  assertEquals(
    index.getEntryByDisplayId("STK_0001")?.location.file,
    "a.md",
  );

  // Remove file A entirely — file B's entry should be promoted.
  index.removeFile("a.md");

  assertEquals(
    index.getEntryByDisplayId("STK_0001")?.location.file,
    "b.md",
  );
});
