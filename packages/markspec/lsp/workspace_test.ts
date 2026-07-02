/**
 * @module lsp/workspace_test
 *
 * Unit tests for WorkspaceIndex — the in-memory entry index.
 */

import { assertEquals } from "@std/assert";
import { WorkspaceIndex } from "./workspace.ts";
import type { EffectiveProfile, Entry, SourceLocation } from "../core/mod.ts";
import { makeDisplayId, parseFile } from "../core/mod.ts";

/** Helper to create a minimal identified entry. */
function entry(
  displayId: string,
  opts: { file?: string; title?: string; id?: string } = {},
): Entry {
  const file = opts.file ?? "test.md";
  const location: SourceLocation = { file, line: 1, column: 1 };
  return {
    displayId: makeDisplayId(displayId),
    title: opts.title ?? displayId,
    body: "",
    rawAttributes: opts.id ? [{ key: "Id", value: opts.id }] : [],
    id: opts.id,
    shape: "Authored",
    location,
    source: { kind: "markdown" },
    typedAttributes: new Map(),
    bodyTokens: [],
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
  assertEquals(
    index.getEntryByDisplayId(makeDisplayId("STK_AEB_0001"))?.title,
    "Braking",
  );
  assertEquals(
    index.getEntryByDisplayId(makeDisplayId("STK_AEB_0002"))?.title,
    "Steering",
  );
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
  assertEquals(index.getEntryByDisplayId(makeDisplayId("STK_001")), undefined);
  assertEquals(
    index.getEntryByDisplayId(makeDisplayId("STK_002"))?.displayId,
    makeDisplayId("STK_002"),
  );
});

Deno.test("WorkspaceIndex: removeFile removes entries", () => {
  const index = new WorkspaceIndex();
  index.updateFile("a.md", [entry("STK_001", { file: "a.md" })]);
  index.updateFile("b.md", [entry("STK_002", { file: "b.md" })]);
  assertEquals(index.getAllEntries().length, 2);

  index.removeFile("a.md");
  assertEquals(index.getAllEntries().length, 1);
  assertEquals(index.getEntryByDisplayId(makeDisplayId("STK_001")), undefined);
  assertEquals(
    index.getEntryByDisplayId(makeDisplayId("STK_002"))?.displayId,
    makeDisplayId("STK_002"),
  );
});

Deno.test("WorkspaceIndex: getEntriesForFile returns file-scoped entries", () => {
  const index = new WorkspaceIndex();
  index.updateFile("a.md", [entry("STK_001", { file: "a.md" })]);
  index.updateFile("b.md", [entry("STK_002", { file: "b.md" })]);

  assertEquals(index.getEntriesForFile("a.md").length, 1);
  assertEquals(
    index.getEntriesForFile("a.md")[0].displayId,
    makeDisplayId("STK_001"),
  );
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

Deno.test("WorkspaceIndex: getNextDisplayIdNumber skips reserved numbers", () => {
  const index = new WorkspaceIndex();
  index.updateFile("reqs.md", [
    entry("STK_AEB_0001", { file: "reqs.md" }),
    entry("STK_AEB_0002", { file: "reqs.md" }),
  ]);

  // Without reservations the next number is 3.
  assertEquals(index.getNextDisplayIdNumber("STK_AEB_"), 3);

  // Reserving 3 bumps the next free number past it, even though 3 is
  // not yet present in the parsed index.
  assertEquals(
    index.getNextDisplayIdNumber("STK_AEB_", "", new Set([3])),
    4,
  );

  // The reserved max dominates when it exceeds the indexed max.
  assertEquals(
    index.getNextDisplayIdNumber("STK_AEB_", "", new Set([3, 7])),
    8,
  );
});

Deno.test("WorkspaceIndex: getNextDisplayIdNumber ignores reservations under a different prefix", () => {
  const index = new WorkspaceIndex();
  index.updateFile("reqs.md", [entry("STK_AEB_0001", { file: "reqs.md" })]);

  // The reserved set is the caller's responsibility — getNextDisplayIdNumber
  // simply folds it into the max. The server only ever passes the set that
  // matches (prefix, suffix), so an empty set leaves the result unchanged.
  assertEquals(
    index.getNextDisplayIdNumber("STK_AEB_", "", new Set()),
    2,
  );
});

Deno.test("WorkspaceIndex: updateFile promotes survivor when owner loses a display ID", () => {
  const index = new WorkspaceIndex();

  // Index both files — a.md wins the display ID (indexed first).
  index.updateFile("a.md", [entry("STK_0001", { file: "a.md" })]);
  index.updateFile("b.md", [entry("STK_0001", { file: "b.md" })]);

  assertEquals(
    index.getEntryByDisplayId(makeDisplayId("STK_0001"))?.location.file,
    "a.md",
  );

  // Update file A to remove STK_0001 — file B's entry should be promoted.
  index.updateFile("a.md", []);

  assertEquals(
    index.getEntryByDisplayId(makeDisplayId("STK_0001"))?.location.file,
    "b.md",
  );
});

Deno.test("WorkspaceIndex: removeFile promotes survivor when removed file owned a display ID", () => {
  const index = new WorkspaceIndex();

  // Index both files — a.md wins the display ID (indexed first).
  index.updateFile("a.md", [entry("STK_0001", { file: "a.md" })]);
  index.updateFile("b.md", [entry("STK_0001", { file: "b.md" })]);

  assertEquals(
    index.getEntryByDisplayId(makeDisplayId("STK_0001"))?.location.file,
    "a.md",
  );

  // Remove file A entirely — file B's entry should be promoted.
  index.removeFile("a.md");

  assertEquals(
    index.getEntryByDisplayId(makeDisplayId("STK_0001"))?.location.file,
    "b.md",
  );
});

Deno.test("getNextDisplayIdNumber: advances after parseAndUpdateFile", async () => {
  const index = new WorkspaceIndex();
  await index.parseAndUpdateFile(
    "/tmp/test.md",
    `- [STK_AEB_0001] First

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
  );
  assertEquals(index.getNextDisplayIdNumber("STK_AEB_"), 2);

  await index.parseAndUpdateFile(
    "/tmp/test.md",
    `- [STK_AEB_0001] First

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [STK_AEB_0002] Second

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`,
  );
  assertEquals(index.getNextDisplayIdNumber("STK_AEB_"), 3);
});

Deno.test("WorkspaceIndex: validateAll suppresses MSL-R010 for profile-declared attributes", async () => {
  const ulid = "01HGW2Q8MNP3RSTVWXYZABCDEF";
  const md = `- [REQ-001] Title

  Body.

  Id: ${ulid}
  Foo: hello
`;
  const parsed = await parseFile(md, { file: "t.md" });
  const profile: EffectiveProfile = {
    attributes: new Map([[
      "Foo",
      {
        value: {
          name: "Foo",
          type: "text",
          required: false,
          cardinality: { lower: 0, upper: 1 },
        },
        origin: "@test/p",
      },
    ]]),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map(),
    documents: { types: new Map(), frontMatter: new Map() },
    delivers: [],
    kinds: new Map(),
    prose: {
      lexicons: {
        "capitalized-allow": { value: [], origin: "" },
        "sentence-abbrev": { value: [], origin: "" },
      },
    },
    disciplineMode: { value: "none", origin: "inferred" },
  };

  const index = new WorkspaceIndex();
  index.updateFile("t.md", parsed.entries);

  // Without a profile the core check still flags the unknown attribute.
  const bare = index.validateAll();
  assertEquals(bare.some((d) => d.code === "MSL-R010"), true);

  // With the profile loaded, the declared attribute is suppressed.
  const withProfile = index.validateAll(profile);
  assertEquals(withProfile.some((d) => d.code === "MSL-R010"), false);
});

// --- ADR-029: delivered-corpus seeding determinism ---

const CORPUS_MD = `- [PLT_0001] Core platform entry

  Corpus body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

const PROJECT_MD_WITH_SAME_ID = `- [PLT_0001] Local override entry

  Project body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`;

Deno.test("WorkspaceIndex: corpus seeded first owns colliding display IDs", async () => {
  const index = new WorkspaceIndex();
  await index.parseAndUpdateFile("/cache/p/ref.md", CORPUS_MD); // corpus fixture
  // Simulate origin stamping the server applies on seed:
  index.updateFile(
    "/cache/p/ref.md",
    index.getEntriesForFile("/cache/p/ref.md").map((e) => ({
      ...e,
      origin: { kind: "profile", profileId: "p", profileVersion: "1.0.0" },
    })),
  );
  await index.parseAndUpdateFile("/repo/a.md", PROJECT_MD_WITH_SAME_ID);
  const owner = index.getEntryByDisplayId(makeDisplayId("PLT_0001"));
  assertEquals(owner?.origin?.profileId, "p");
});
