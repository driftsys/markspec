/**
 * @module lsp/document_links_test
 */

import { assertEquals } from "@std/assert";
import type { Entry } from "../core/mod.ts";
import { buildDocumentLinks } from "./document_links.ts";

function fakeEntry(line: number, title: string): Entry {
  // Minimal Entry stub — only the fields buildDocumentLinks reads.
  return {
    displayId: "STK_0001",
    title,
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    labels: [],
    location: { file: "/proj/reqs.md", line, column: 1 },
    type: undefined,
    id: undefined,
  } as unknown as Entry;
}

// Identity resolver: passes the path through unchanged and appends
// `#L<n>` when a line suffix is supplied. Mirrors the server-side
// resolver but stays platform-neutral.
const idResolver = (
  relPath: string,
  lineSuffix: number | undefined,
): string | undefined =>
  lineSuffix === undefined
    ? `file:///proj/${relPath}`
    : `file:///proj/${relPath}#L${lineSuffix}`;

Deno.test("buildDocumentLinks: empty entries returns []", () => {
  assertEquals(buildDocumentLinks([], "", idResolver), []);
});

Deno.test("buildDocumentLinks: no Verified-by attribute returns []", () => {
  const text = `- [STK_0001] T

  Body.

      Id: 01HABC
`;
  assertEquals(
    buildDocumentLinks([fakeEntry(1, "T")], text, idResolver),
    [],
  );
});

Deno.test("buildDocumentLinks: path-only value matched", () => {
  const text = `- [STK_0001] T

      Id: 01HABC
      Verified-by: tests/sit_bar.rs
`;
  const links = buildDocumentLinks(
    [fakeEntry(1, "T")],
    text,
    idResolver,
  );
  assertEquals(links.length, 1);
  assertEquals(links[0].target, "file:///proj/tests/sit_bar.rs");
  // Range covers `tests/sit_bar.rs` — line 4 (0-based 3), starting after
  // `      Verified-by: ` which is 19 chars wide.
  assertEquals(links[0].range, {
    start: { line: 3, character: 19 },
    end: { line: 3, character: 19 + "tests/sit_bar.rs".length },
  });
});

Deno.test("buildDocumentLinks: numeric :line suffix produces #L fragment", () => {
  const text = `- [STK_0001] T

      Id: 01HABC
      Verified-by: src/foo.rs:42
`;
  const links = buildDocumentLinks(
    [fakeEntry(1, "T")],
    text,
    idResolver,
  );
  assertEquals(links.length, 1);
  assertEquals(links[0].target, "file:///proj/src/foo.rs#L42");
  // Range covers only `src/foo.rs` (the path), not the `:42` suffix.
  assertEquals(links[0].range.end.character, 19 + "src/foo.rs".length);
});

Deno.test("buildDocumentLinks: numeric :line:col suffix produces #L fragment", () => {
  const text = `- [STK_0001] T

      Id: 01HABC
      Verified-by: src/foo.rs:42:5
`;
  const links = buildDocumentLinks(
    [fakeEntry(1, "T")],
    text,
    idResolver,
  );
  assertEquals(links.length, 1);
  assertEquals(links[0].target, "file:///proj/src/foo.rs#L42");
});

Deno.test("buildDocumentLinks: identifier (test-name) suffix — no fragment", () => {
  const text = `- [STK_0001] T

      Id: 01HABC
      Verified-by: src/foo.rs:test_name
`;
  const links = buildDocumentLinks(
    [fakeEntry(1, "T")],
    text,
    idResolver,
  );
  assertEquals(links.length, 1);
  // No fragment because the suffix is not numeric.
  assertEquals(links[0].target, "file:///proj/src/foo.rs");
  // Range still covers only `src/foo.rs`.
  assertEquals(links[0].range.end.character, 19 + "src/foo.rs".length);
});

Deno.test("buildDocumentLinks: display ID is not linkified", () => {
  const text = `- [STK_0001] T

      Id: 01HABC
      Verified-by: STK_AEB_0001
`;
  assertEquals(
    buildDocumentLinks([fakeEntry(1, "T")], text, idResolver),
    [],
  );
});

Deno.test("buildDocumentLinks: unknown extension is not linkified", () => {
  const text = `- [STK_0001] T

      Id: 01HABC
      Verified-by: report.pdf
`;
  assertEquals(
    buildDocumentLinks([fakeEntry(1, "T")], text, idResolver),
    [],
  );
});

Deno.test("buildDocumentLinks: multiple comma-separated values on one line", () => {
  const text = `- [STK_0001] T

      Id: 01HABC
      Verified-by: a.rs, b.kt:10
`;
  const links = buildDocumentLinks(
    [fakeEntry(1, "T")],
    text,
    idResolver,
  );
  assertEquals(links.length, 2);
  assertEquals(links[0].target, "file:///proj/a.rs");
  assertEquals(links[1].target, "file:///proj/b.kt#L10");
  // Ranges must not overlap and must reflect each path's column.
  const valuesStart = "      Verified-by: ".length;
  assertEquals(links[0].range.start.character, valuesStart);
  assertEquals(links[0].range.end.character, valuesStart + "a.rs".length);
  // `b.kt` follows `a.rs, ` — i.e. ", " of length 2.
  const bStart = valuesStart + "a.rs".length + ", ".length;
  assertEquals(links[1].range.start.character, bStart);
  assertEquals(links[1].range.end.character, bStart + "b.kt".length);
});

Deno.test("buildDocumentLinks: multiple Verified-by lines under one entry", () => {
  const text = `- [STK_0001] T

      Id: 01HABC
      Verified-by: a.rs
      Verified-by: b.go
`;
  const links = buildDocumentLinks(
    [fakeEntry(1, "T")],
    text,
    idResolver,
  );
  assertEquals(links.length, 2);
  assertEquals(links[0].target, "file:///proj/a.rs");
  assertEquals(links[0].range.start.line, 3);
  assertEquals(links[1].target, "file:///proj/b.go");
  assertEquals(links[1].range.start.line, 4);
});

Deno.test("buildDocumentLinks: links scoped to entry range — Verified-by outside any entry ignored", () => {
  const text = `prose line — Verified-by: rogue.rs is not a real attribute

- [STK_0001] T

      Id: 01HABC
      Verified-by: real.rs
`;
  const links = buildDocumentLinks(
    [fakeEntry(3, "T")],
    text,
    idResolver,
  );
  assertEquals(links.length, 1);
  assertEquals(links[0].target, "file:///proj/real.rs");
});

Deno.test("buildDocumentLinks: resolveTarget returning undefined suppresses link", () => {
  const text = `- [STK_0001] T

      Id: 01HABC
      Verified-by: src/foo.rs
`;
  const links = buildDocumentLinks(
    [fakeEntry(1, "T")],
    text,
    () => undefined,
  );
  assertEquals(links, []);
});

Deno.test("buildDocumentLinks: mixed display-ID + path on one line", () => {
  const text = `- [STK_0001] T

      Id: 01HABC
      Verified-by: STK_AEB_0002, tests/foo.rs:7
`;
  const links = buildDocumentLinks(
    [fakeEntry(1, "T")],
    text,
    idResolver,
  );
  assertEquals(links.length, 1);
  assertEquals(links[0].target, "file:///proj/tests/foo.rs#L7");
});
