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

Deno.test("buildDocumentLinks: display ID gets no link when the resolver checks real files", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/real.rs`, "// code\n");
    const realFiles = (path: string) => {
      try {
        return Deno.statSync(`${dir}/${path}`).isFile
          ? `file://${dir}/${path}`
          : undefined;
      } catch {
        return undefined;
      }
    };
    assertEquals(await linksOf(doc("Source: STK_AEB_0001"), realFiles), []);
    assertEquals((await linksOf(doc("Source: real.rs"), realFiles)).length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
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

Deno.test("buildDocumentLinks: an attribute whose key only ends in Source is not linked", async () => {
  const rec = recordingResolver();
  assertEquals(await linksOf(doc("Data-Source: src/x.rs"), rec.resolve), []);
  assertEquals(rec.seen, []);
});

Deno.test("buildDocumentLinks: the value is searched after the key, not earlier on the line", async () => {
  // In a doc comment the value `/` also appears in the `///` prefix.
  const text = `/// [STK_0001] T
///
///     Id: 01HABC
///     Source: /
fn f() {}
`;
  const links = await linksOf(text, recordingResolver().resolve, "/proj/a.rs");
  assertEquals(links.length, 1);
  assertEquals(links[0].range.start, { line: 3, character: 16 });
});

Deno.test("buildDocumentLinks: a URI ending in :<digits> is linked whole", async () => {
  const uri = "https://host:8080/a:80";
  const links = await linksOf(doc(`Source: ${uri}`), realPathsOnly);
  assertEquals(links.length, 1);
  assertEquals(links[0].target, uri);
  assertEquals(links[0].range.end.character, 14 + uri.length);
});

Deno.test("buildDocumentLinks: a path with a space or a comma reaches the resolver whole", async () => {
  const rec = recordingResolver();
  await linksOf(doc("Source: my dir/a,b.rs:5"), rec.resolve);
  assertEquals(rec.seen, [["my dir/a,b.rs", 5]]);
});

Deno.test("buildDocumentLinks: every entry of a document is linked", async () => {
  const text = `- [STK_0001] A

      Id: 01HABC
      Source: a.rs

- [STK_0002] B

      Id: 01HABD
      Source: b.rs:2
`;
  const links = await linksOf(text, realPathsOnly);
  assertEquals(links.map((l) => l.target), [
    "file:///proj/a.rs",
    "file:///proj/b.rs#L2",
  ]);
  assertEquals(links.map((l) => l.range.start.line), [3, 8]);
});

Deno.test("buildDocumentLinks: a Source line in a *-prefixed block doc comment is linked", async () => {
  const text = `/**
 * [STK_0001] T
 *
 *     Id: 01HABC
 *     Source: src/lib.rs:9
 */
fn f() {}
`;
  const links = await linksOf(text, realPathsOnly, "/proj/src/lib.rs");
  assertEquals(links.length, 1);
  assertEquals(links[0].target, "file:///proj/src/lib.rs#L9");
  assertEquals(links[0].range.start, { line: 4, character: 15 });
});
