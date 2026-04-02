import { assertEquals } from "@std/assert";
import { parseSummary } from "./mod.ts";

Deno.test("parseSummary: simple list of chapters", () => {
  const md = `# Summary

- [Getting started](getting-started.md)
- [Configuration](configuration.md)
`;
  const s = parseSummary(md);
  assertEquals(s.prefixChapters.length, 0);
  assertEquals(s.suffixChapters.length, 0);
  assertEquals(s.parts.length, 1);
  assertEquals(s.parts[0].title, undefined);
  assertEquals(s.parts[0].chapters.length, 2);
  assertEquals(s.parts[0].chapters[0], {
    kind: "numbered",
    title: "Getting started",
    path: "getting-started.md",
    subChapters: [],
  });
  assertEquals(s.parts[0].chapters[1], {
    kind: "numbered",
    title: "Configuration",
    path: "configuration.md",
    subChapters: [],
  });
});

Deno.test("parseSummary: no Summary heading", () => {
  const md = `- [Language](language.md)
- [AST](ast.md)
`;
  const s = parseSummary(md);
  assertEquals(s.parts.length, 1);
  assertEquals(s.parts[0].chapters.length, 2);
  assertEquals(s.parts[0].chapters[0].path, "language.md");
  assertEquals(s.parts[0].chapters[1].path, "ast.md");
});

Deno.test("parseSummary: prefix and suffix chapters", () => {
  const md = `# Summary

[Overview](overview.md)

# Product

- [Requirements](requirements.md)

[Glossary](glossary.md)
[License](license.md)
`;
  const s = parseSummary(md);
  assertEquals(s.prefixChapters.length, 1);
  assertEquals(s.prefixChapters[0].kind, "prefix");
  assertEquals(s.prefixChapters[0].title, "Overview");
  assertEquals(s.prefixChapters[0].path, "overview.md");

  assertEquals(s.parts.length, 1);
  assertEquals(s.parts[0].title, "Product");
  assertEquals(s.parts[0].chapters.length, 1);

  assertEquals(s.suffixChapters.length, 2);
  assertEquals(s.suffixChapters[0].kind, "suffix");
  assertEquals(s.suffixChapters[0].path, "glossary.md");
  assertEquals(s.suffixChapters[1].path, "license.md");
});

Deno.test("parseSummary: draft chapters", () => {
  const md = `# Summary

- [Existing chapter](existing.md)
- [Draft chapter]()
- [Another draft]()
`;
  const s = parseSummary(md);
  const chapters = s.parts[0].chapters;
  assertEquals(chapters[0].kind, "numbered");
  assertEquals(chapters[0].path, "existing.md");
  assertEquals(chapters[1].kind, "draft");
  assertEquals(chapters[1].path, undefined);
  assertEquals(chapters[2].kind, "draft");
});

Deno.test("parseSummary: sub-chapters", () => {
  const md = `# Summary

- [Requirements](requirements.md)
  - [Braking](braking.md)
  - [Steering](steering.md)
- [Architecture](architecture.md)
`;
  const s = parseSummary(md);
  const chapters = s.parts[0].chapters;
  assertEquals(chapters[0].subChapters.length, 2);
  assertEquals(chapters[0].subChapters[0], {
    kind: "numbered",
    title: "Braking",
    path: "braking.md",
    subChapters: [],
  });
  assertEquals(chapters[0].subChapters[1].path, "steering.md");
  assertEquals(chapters[1].subChapters.length, 0);
});

Deno.test("parseSummary: multiple parts", () => {
  const md = `# Summary

# Product

- [Requirements](requirements.md)

# Architecture

- [Design](design.md)
- [ADRs](adrs.md)
`;
  const s = parseSummary(md);
  assertEquals(s.parts.length, 2);
  assertEquals(s.parts[0].title, "Product");
  assertEquals(s.parts[0].chapters.length, 1);
  assertEquals(s.parts[1].title, "Architecture");
  assertEquals(s.parts[1].chapters.length, 2);
});

Deno.test("parseSummary: separator lines are ignored", () => {
  const md = `# Summary

- [Chapter A](a.md)

---

- [Chapter B](b.md)
`;
  const s = parseSummary(md);
  // Both lists fold into the same implicit part
  assertEquals(s.parts.length, 1);
  assertEquals(s.parts[0].chapters.length, 2);
});

Deno.test("parseSummary: empty input", () => {
  const s = parseSummary("");
  assertEquals(s.prefixChapters.length, 0);
  assertEquals(s.parts.length, 0);
  assertEquals(s.suffixChapters.length, 0);
});
