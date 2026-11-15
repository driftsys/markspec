/**
 * @module lsp/document_links_test
 */

import { assertEquals } from "@std/assert";
import type { Entry } from "../core/mod.ts";
import { buildDocumentLinks } from "./document_links.ts";

function fakeEntry(line: number): Entry {
  // Minimal Entry stub — only the fields buildDocumentLinks reads.
  return {
    displayId: "STK_0001",
    title: "T",
    body: "",
    rawAttributes: [],
    location: { file: "/proj/reqs.md", line, column: 1 },
  } as unknown as Entry;
}

// Resolver that accepts every path; the server-side resolver adds the
// existence check.
const idResolver = (
  path: string,
  lineSuffix: number | undefined,
): string | undefined =>
  lineSuffix === undefined
    ? `file:///proj/${path}`
    : `file:///proj/${path}#L${lineSuffix}`;

const doc = (sourceLine: string) =>
  `- [STK_0001] T

      Id: 01HABC
      ${sourceLine}
`;

Deno.test("buildDocumentLinks: empty entries returns []", () => {
  assertEquals(buildDocumentLinks([], "", idResolver), []);
});

Deno.test("buildDocumentLinks: no Source attribute returns []", () => {
  const text = `- [STK_0001] T

      Id: 01HABC
`;
  assertEquals(buildDocumentLinks([fakeEntry(1)], text, idResolver), []);
});

Deno.test("buildDocumentLinks: relative path value is linked", () => {
  const links = buildDocumentLinks(
    [fakeEntry(1)],
    doc("Source: src/sensor.rs"),
    idResolver,
  );
  assertEquals(links.length, 1);
  assertEquals(links[0].target, "file:///proj/src/sensor.rs");
  // `      Source: ` is 14 characters wide.
  assertEquals(links[0].range, {
    start: { line: 3, character: 14 },
    end: { line: 3, character: 14 + "src/sensor.rs".length },
  });
});

Deno.test("buildDocumentLinks: :line suffix becomes #L fragment, range excludes it", () => {
  const links = buildDocumentLinks(
    [fakeEntry(1)],
    doc("Source: src/foo.rs:42"),
    idResolver,
  );
  assertEquals(links.length, 1);
  assertEquals(links[0].target, "file:///proj/src/foo.rs#L42");
  assertEquals(links[0].range.end.character, 14 + "src/foo.rs".length);
});

Deno.test("buildDocumentLinks: :line:col suffix keeps only the line", () => {
  const links = buildDocumentLinks(
    [fakeEntry(1)],
    doc("Source: src/foo.rs:42:5"),
    idResolver,
  );
  assertEquals(links[0].target, "file:///proj/src/foo.rs#L42");
});

Deno.test("buildDocumentLinks: http(s) URI is linked as is without the resolver", () => {
  const uri = "https://example.com/spec/page.html#sec";
  const links = buildDocumentLinks(
    [fakeEntry(1)],
    doc(`Source: ${uri}`),
    () => {
      throw new Error("resolver must not be called for a URI");
    },
  );
  assertEquals(links.length, 1);
  assertEquals(links[0].target, uri);
  assertEquals(links[0].range.end.character, 14 + uri.length);
});

Deno.test("buildDocumentLinks: display ID gets no link when the resolver rejects it", () => {
  const links = buildDocumentLinks(
    [fakeEntry(1)],
    doc("Source: STK_AEB_0001"),
    () => undefined,
  );
  assertEquals(links, []);
});

Deno.test("buildDocumentLinks: missing file (resolver returns undefined) gets no link", () => {
  const links = buildDocumentLinks(
    [fakeEntry(1)],
    doc("Source: src/missing.rs"),
    () => undefined,
  );
  assertEquals(links, []);
});

Deno.test("buildDocumentLinks: comma-separated values keep their own columns", () => {
  const links = buildDocumentLinks(
    [fakeEntry(1)],
    doc("Source: a.rs, b.kt:10"),
    idResolver,
  );
  assertEquals(links.length, 2);
  assertEquals(links[0].target, "file:///proj/a.rs");
  assertEquals(links[1].target, "file:///proj/b.kt#L10");
  assertEquals(links[0].range.start.character, 14);
  assertEquals(links[1].range.start.character, 14 + "a.rs, ".length);
  assertEquals(
    links[1].range.end.character,
    14 + "a.rs, ".length + "b.kt".length,
  );
});

Deno.test("buildDocumentLinks: Source outside any entry range is ignored", () => {
  const text = `prose line — Source: rogue.rs is not a real attribute

- [STK_0001] T

      Id: 01HABC
      Source: real.rs
`;
  const links = buildDocumentLinks([fakeEntry(3)], text, idResolver);
  assertEquals(links.length, 1);
  assertEquals(links[0].target, "file:///proj/real.rs");
});

Deno.test("buildDocumentLinks: Verified-by is not linked", () => {
  assertEquals(
    buildDocumentLinks(
      [fakeEntry(1)],
      doc("Verified-by: tests/sit_bar.rs"),
      idResolver,
    ),
    [],
  );
});

Deno.test("buildDocumentLinks: entries with an origin are not linked", () => {
  const text = `- [STK_0001] T

      Id: 01HABC
      Source: own.rs

- [STK_0002] Delivered

      Id: 01HABD
      Source: delivered.rs
`;
  const delivered = {
    ...fakeEntry(6),
    origin: { kind: "profile", profileId: "p", profileVersion: "1.0.0" },
  } as unknown as Entry;
  const links = buildDocumentLinks([fakeEntry(1), delivered], text, idResolver);
  assertEquals(links.length, 1);
  assertEquals(links[0].target, "file:///proj/own.rs");
});
