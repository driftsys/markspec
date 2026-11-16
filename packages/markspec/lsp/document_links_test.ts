/**
 * @module lsp/document_links_test
 */

import { assertEquals } from "@std/assert";
import { type Entry, parseFile } from "../core/mod.ts";
import { buildDocumentLinks } from "./document_links.ts";

/** Resolver that accepts every path and records what it received. */
function recordingResolver(): {
  seen: Array<[string, number | undefined]>;
  resolve: (path: string, lineSuffix: number | undefined) => string;
} {
  const seen: Array<[string, number | undefined]> = [];
  return {
    seen,
    resolve: (path, lineSuffix) => {
      seen.push([path, lineSuffix]);
      return lineSuffix === undefined
        ? `file:///proj/${path}`
        : `file:///proj/${path}#L${lineSuffix}`;
    },
  };
}

/** Resolver that accepts only real paths, like the server's. */
const realPathsOnly = (path: string, lineSuffix: number | undefined) =>
  path.includes("/") || path.includes(".")
    ? `file:///proj/${path}${lineSuffix === undefined ? "" : `#L${lineSuffix}`}`
    : undefined;

const doc = (sourceLine: string) =>
  `- [STK_0001] T

      Id: 01HABC
      ${sourceLine}
`;

async function linksOf(
  text: string,
  resolve: (path: string, lineSuffix: number | undefined) => string | undefined,
  file = "/proj/reqs.md",
) {
  const { entries } = await parseFile(text, { file });
  return buildDocumentLinks(entries, text, resolve);
}

Deno.test("buildDocumentLinks: empty entries returns []", () => {
  assertEquals(buildDocumentLinks([], "", realPathsOnly), []);
});

Deno.test("buildDocumentLinks: no Source attribute returns []", async () => {
  assertEquals(
    await linksOf(
      `- [STK_0001] T

      Id: 01HABC
`,
      realPathsOnly,
    ),
    [],
  );
});

Deno.test("buildDocumentLinks: relative path value is linked", async () => {
  const links = await linksOf(doc("Source: src/sensor.rs"), realPathsOnly);
  assertEquals(links.length, 1);
  assertEquals(links[0].target, "file:///proj/src/sensor.rs");
  // `      Source: ` is 14 characters wide.
  assertEquals(links[0].range, {
    start: { line: 3, character: 14 },
    end: { line: 3, character: 14 + "src/sensor.rs".length },
  });
});

Deno.test("buildDocumentLinks: :line suffix becomes #L fragment, range excludes it", async () => {
  const links = await linksOf(doc("Source: src/foo.rs:42"), realPathsOnly);
  assertEquals(links.length, 1);
  assertEquals(links[0].target, "file:///proj/src/foo.rs#L42");
  assertEquals(links[0].range.end.character, 14 + "src/foo.rs".length);
});

Deno.test("buildDocumentLinks: :line:col suffix keeps only the line", async () => {
  const links = await linksOf(doc("Source: src/foo.rs:42:5"), realPathsOnly);
  assertEquals(links[0].target, "file:///proj/src/foo.rs#L42");
});

Deno.test("buildDocumentLinks: http, https and an uppercase scheme are linked as is", async () => {
  for (
    const uri of [
      "http://example.com/a.html",
      "https://example.com/a.html#sec",
      "HTTPS://example.com/A",
    ]
  ) {
    const links = await linksOf(doc(`Source: ${uri}`), () => {
      throw new Error("resolver must not be called for a URI");
    });
    assertEquals(links.length, 1, uri);
    assertEquals(links[0].target, uri);
    assertEquals(links[0].range.end.character, 14 + uri.length);
  }
});

Deno.test("buildDocumentLinks: a URI containing a comma is linked whole", async () => {
  const uri = "https://example.com/a,b";
  const links = await linksOf(doc(`Source: ${uri}`), realPathsOnly);
  assertEquals(links.length, 1);
  assertEquals(links[0].target, uri);
  assertEquals(links[0].range.end.character, 14 + uri.length);
});

Deno.test("buildDocumentLinks: a Windows drive path reaches the resolver unchanged, minus the line suffix", async () => {
  const rec = recordingResolver();
  await linksOf(doc("Source: C:\\x\\y.rs"), rec.resolve);
  await linksOf(doc("Source: C:\\x\\y.rs:12"), rec.resolve);
  assertEquals(rec.seen, [["C:\\x\\y.rs", undefined], ["C:\\x\\y.rs", 12]]);
});

Deno.test("buildDocumentLinks: display ID gets no link when the resolver accepts only real paths", async () => {
  assertEquals(
    await linksOf(doc("Source: STK_AEB_0001"), realPathsOnly),
    [],
  );
});

Deno.test("buildDocumentLinks: missing file (resolver returns undefined) gets no link", async () => {
  assertEquals(
    await linksOf(doc("Source: src/missing.rs"), () => undefined),
    [],
  );
});

Deno.test("buildDocumentLinks: Verified-by is not linked", async () => {
  assertEquals(
    await linksOf(doc("Verified-by: tests/sit_bar.rs"), realPathsOnly),
    [],
  );
});

Deno.test("buildDocumentLinks: a Source line in a Rust doc comment is linked", async () => {
  const text = `/// [STK_0001] T
///
/// Body.
///
///     Id: 01HABC
///     Source: src/lib.rs:7
fn f() {}
`;
  const links = await linksOf(text, realPathsOnly, "/proj/src/lib.rs");
  assertEquals(links.length, 1);
  assertEquals(links[0].target, "file:///proj/src/lib.rs#L7");
  assertEquals(links[0].range.start, { line: 5, character: 16 });
});

Deno.test("buildDocumentLinks: a fenced Source line in the body is not linked", async () => {
  const text = `- [STK_0001] T

  Example:

  \`\`\`text
      Source: fenced/example.rs
  \`\`\`

      Id: 01HABC
`;
  assertEquals(await linksOf(text, realPathsOnly), []);
});

Deno.test("buildDocumentLinks: entries with a profile or upstream origin are not linked", async () => {
  const text = doc("Source: own.rs");
  const { entries } = await parseFile(text, { file: "/proj/reqs.md" });
  const own = entries[0];
  const withOrigin = (origin: unknown) =>
    ({ ...own, origin }) as unknown as Entry;
  const rec = recordingResolver();
  assertEquals(buildDocumentLinks([own], text, rec.resolve).length, 1);
  assertEquals(
    buildDocumentLinks(
      [withOrigin({ kind: "profile", profileId: "p", profileVersion: "1" })],
      text,
      rec.resolve,
    ),
    [],
  );
  assertEquals(
    buildDocumentLinks(
      [withOrigin({ kind: "upstream", upstreamId: "u", version: "1" })],
      text,
      rec.resolve,
    ),
    [],
  );
});
