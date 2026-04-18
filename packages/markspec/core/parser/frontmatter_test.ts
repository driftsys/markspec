/**
 * @module parser/frontmatter_test
 */

import { assert, assertEquals } from "@std/assert";
import { extractFrontMatter } from "./frontmatter.ts";

Deno.test("extractFrontMatter: no front matter returns input unchanged", () => {
  const md = "# Title\n\nBody.\n";
  const result = extractFrontMatter(md);
  assertEquals(result.hadFrontMatter, false);
  assertEquals(result.markdown, md);
  assertEquals(result.attributes, {});
  assertEquals(result.diagnostics.length, 0);
});

Deno.test("extractFrontMatter: extracts core keys", () => {
  const md = `---
document-id: 01HGW2D0DOCPQ4FGHIJKLMNOPQR
document-type: requirements
status: approved
---

# Title
`;
  const result = extractFrontMatter(md);
  assert(result.hadFrontMatter);
  assertEquals(
    result.attributes["document-id"],
    "01HGW2D0DOCPQ4FGHIJKLMNOPQR",
  );
  assertEquals(result.attributes["document-type"], "requirements");
  assertEquals(result.attributes.status, "approved");
  assertEquals(result.markdown, "# Title\n");
});

Deno.test("extractFrontMatter: preserves metadata map verbatim", () => {
  const md = `---
document-id: 01HGW...
metadata:
  owner: safety-team
  cost-center: ENG-042
  nested:
    jira-epic: PROJ-123
---

# Title
`;
  const result = extractFrontMatter(md);
  assertEquals(result.attributes.metadata, {
    owner: "safety-team",
    "cost-center": "ENG-042",
    nested: { "jira-epic": "PROJ-123" },
  });
});

Deno.test("extractFrontMatter: rejects forbidden keys", () => {
  const md = `---
title: My Document
author: Alice
date: 2026-04-18
---

# Title
`;
  const result = extractFrontMatter(md);
  assertEquals(result.diagnostics.length, 3);
  for (const diag of result.diagnostics) {
    assertEquals(diag.code, "MSL-D001");
    assertEquals(diag.severity, "error");
  }
  assertEquals(result.attributes, {});
});

Deno.test("extractFrontMatter: rejects unknown keys", () => {
  const md = `---
document-id: 01HGW...
bogus: something
---
`;
  const result = extractFrontMatter(md);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "MSL-D001");
  assert(result.diagnostics[0].message.includes("bogus"));
});

Deno.test("extractFrontMatter: accepts allowlisted ecosystem keys into extra", () => {
  const md = `---
document-id: 01HGW...
layout: page
sidebar_position: 3
---
`;
  const result = extractFrontMatter(md, {
    allowedKeys: ["layout", "sidebar_position"],
  });
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.attributes.extra, {
    layout: "page",
    sidebar_position: 3,
  });
});

Deno.test("extractFrontMatter: accepts profile keys into extra", () => {
  const md = `---
document-id: 01HGW...
asil: B
---
`;
  const result = extractFrontMatter(md, { profileKeys: ["asil"] });
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.attributes.extra, { asil: "B" });
});

Deno.test("extractFrontMatter: CRLF line endings work", () => {
  const md = "---\r\ndocument-id: 01HGW...\r\n---\r\n# Title\r\n";
  const result = extractFrontMatter(md);
  assert(result.hadFrontMatter);
  assertEquals(result.attributes["document-id"], "01HGW...");
});

Deno.test("extractFrontMatter: malformed YAML emits a diagnostic", () => {
  const md = `---
document-id: [unclosed
---

# Title
`;
  const result = extractFrontMatter(md);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "MSL-D001");
  assertEquals(result.diagnostics[0].severity, "error");
  assertEquals(result.attributes, {});
});

Deno.test("extractFrontMatter: non-mapping YAML is rejected", () => {
  const md = `---
- just
- a
- list
---

# Title
`;
  const result = extractFrontMatter(md);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "MSL-D001");
  assert(result.diagnostics[0].message.includes("mapping"));
});

Deno.test("extractFrontMatter: non-leading --- is not front matter", () => {
  const md = "# Title\n\n---\nnot-front-matter: true\n---\n";
  const result = extractFrontMatter(md);
  assertEquals(result.hadFrontMatter, false);
  assertEquals(result.markdown, md);
});

Deno.test("extractFrontMatter: empty front matter is valid", () => {
  const md = "---\n---\n# Title\n";
  const result = extractFrontMatter(md);
  assert(result.hadFrontMatter);
  assertEquals(result.attributes, {});
  assertEquals(result.diagnostics.length, 0);
});
