/**
 * @module parser/directives_test
 *
 * Unit tests for directive extraction from HTML comments.
 */

import { assertEquals } from "@std/assert";
import { detectDirectives } from "./directives.ts";

// ---------------------------------------------------------------------------
// Single directive
// ---------------------------------------------------------------------------

Deno.test("detectDirectives: single directive without payload", () => {
  const md = `# Slides

<!-- markspec:deck -->

Content here.
`;
  const directives = detectDirectives(md, { file: "slides.md" });
  assertEquals(directives.length, 1);
  assertEquals(directives[0].name, "deck");
  assertEquals(directives[0].payload, "");
});

// ---------------------------------------------------------------------------
// Directive with payload
// ---------------------------------------------------------------------------

Deno.test("detectDirectives: directive with inline payload", () => {
  const md = `# Old Spec

<!-- markspec:deprecated Superseded by v2 -->

Content here.
`;
  const directives = detectDirectives(md, { file: "old.md" });
  assertEquals(directives.length, 1);
  assertEquals(directives[0].name, "deprecated");
  assertEquals(directives[0].payload, "Superseded by v2");
});

// ---------------------------------------------------------------------------
// Multi-line payload
// ---------------------------------------------------------------------------

Deno.test("detectDirectives: multi-line payload with continuation lines", () => {
  const md = `# Config

<!--
markspec:layout
  title: My Presentation
  theme: dark
-->

Content here.
`;
  const directives = detectDirectives(md, { file: "config.md" });
  assertEquals(directives.length, 1);
  assertEquals(directives[0].name, "layout");
  assertEquals(directives[0].payload, "title: My Presentation\ntheme: dark");
});

// ---------------------------------------------------------------------------
// Multiple directives in one comment
// ---------------------------------------------------------------------------

Deno.test("detectDirectives: multiple directives in one comment", () => {
  const md = `# Doc

<!--
markspec:deck
markspec:deprecated Replaced by new-spec.md
-->

Content here.
`;
  const directives = detectDirectives(md, { file: "doc.md" });
  assertEquals(directives.length, 2);
  assertEquals(directives[0].name, "deck");
  assertEquals(directives[0].payload, "");
  assertEquals(directives[1].name, "deprecated");
  assertEquals(directives[1].payload, "Replaced by new-spec.md");
});

// ---------------------------------------------------------------------------
// Non-markspec HTML comment ignored
// ---------------------------------------------------------------------------

Deno.test("detectDirectives: non-markspec comment yields zero directives", () => {
  const md = `# Doc

<!-- This is a regular HTML comment -->

<!-- TODO: fix this later -->

Content here.
`;
  const directives = detectDirectives(md, { file: "doc.md" });
  assertEquals(directives.length, 0);
});

// ---------------------------------------------------------------------------
// Source location preserved
// ---------------------------------------------------------------------------

Deno.test("detectDirectives: source location is preserved", () => {
  const md = `# Title

Some paragraph.

<!-- markspec:deck -->

More content.

<!--
markspec:deprecated Old stuff
-->
`;
  const directives = detectDirectives(md, { file: "loc.md" });
  assertEquals(directives.length, 2);

  assertEquals(directives[0].location.file, "loc.md");
  assertEquals(directives[0].location.line, 5);

  assertEquals(directives[1].location.file, "loc.md");
  // The directive is on the second line of the comment block (line 10 in source).
  assertEquals(directives[1].location.line, 10);
});

// ---------------------------------------------------------------------------
// Default file path
// ---------------------------------------------------------------------------

Deno.test("detectDirectives: uses '<unknown>' when no file specified", () => {
  const md = `<!-- markspec:deck -->`;
  const directives = detectDirectives(md);
  assertEquals(directives.length, 1);
  assertEquals(directives[0].location.file, "<unknown>");
});
