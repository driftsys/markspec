/**
 * @module core/validator/body_blocks_test
 *
 * Unit tests for the MSL-B040 / B041 / B042 / B043 validator.
 *
 * PR 5: validates the AST-based migration. Tests build entry bodies
 * using `buildBodyAst` so `entry.bodyAst` is populated correctly.
 */

import { assertEquals } from "@std/assert";
import type { Entry } from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";
import { buildBodyAst } from "../ast/build.ts";
import { validateBodyBlocks } from "./body_blocks.ts";

function makeEntry(displayId: string, body: string): Entry {
  return {
    displayId: makeDisplayId(displayId),
    title: "Test entry",
    body,
    bodyAst: buildBodyAst(body),
    rawAttributes: [],
    id: undefined,
    shape: "Authored",
    location: { file: "test.md", line: 10, column: 1 },
    source: "markdown",
    typedAttributes: new Map(),
  };
}

// ---------------------------------------------------------------------------
// MSL-B040 — headings
// ---------------------------------------------------------------------------

Deno.test("validateBodyBlocks: heading inside entry body → MSL-B040", () => {
  const body = "Body text.\n\n## Sub-heading\n\nMore body.";
  const entry = makeEntry("REQ-001", body);
  const diags = validateBodyBlocks(entry);
  const b040 = diags.filter((d) => d.code === "MSL-B040");
  assertEquals(b040.length, 1);
  assertEquals(b040[0].severity, "error");
});

Deno.test("validateBodyBlocks: plain body — no MSL-B040", () => {
  const entry = makeEntry("REQ-001", "The system shall handle all requests.");
  assertEquals(
    validateBodyBlocks(entry).filter((d) => d.code === "MSL-B040"),
    [],
  );
});

// ---------------------------------------------------------------------------
// MSL-B041 — horizontal rules
// ---------------------------------------------------------------------------

Deno.test("validateBodyBlocks: HR inside entry body → MSL-B041", () => {
  const body = "Body text.\n\n---\n\nMore body.";
  const entry = makeEntry("REQ-001", body);
  const diags = validateBodyBlocks(entry);
  const b041 = diags.filter((d) => d.code === "MSL-B041");
  assertEquals(b041.length, 1);
  assertEquals(b041[0].severity, "error");
});

// ---------------------------------------------------------------------------
// MSL-B042 — task lists
// ---------------------------------------------------------------------------

Deno.test("validateBodyBlocks: task list inside entry body → MSL-B042", () => {
  const body = "Body text.\n\n- [ ] Open task\n- [x] Done task\n";
  const entry = makeEntry("REQ-001", body);
  const diags = validateBodyBlocks(entry);
  const b042 = diags.filter((d) => d.code === "MSL-B042");
  assertEquals(b042.length, 1);
  assertEquals(b042[0].severity, "error");
});

Deno.test("validateBodyBlocks: normal list (no tasks) — no MSL-B042", () => {
  const body = "Body text.\n\n- Item one\n- Item two\n";
  const entry = makeEntry("REQ-001", body);
  assertEquals(
    validateBodyBlocks(entry).filter((d) => d.code === "MSL-B042"),
    [],
  );
});

// ---------------------------------------------------------------------------
// MSL-B042: Path A / ADR-014 intentional behaviour change — one diag per
// task-list BLOCK, not one per item.
//
// Pre-Path-A (line-scanner): a 3-item task list emitted 3 MSL-B042 diagnostics,
// one per item line.  Post-Path-A (AST-based, PR #340): the validator fires
// once per ListNode with hasTaskItems=true, so the same 3-item list emits
// EXACTLY ONE MSL-B042.  This was accepted as intentional in ADR-014.
// This test pins that accepted behaviour.  If someone reverts the validator to
// per-item line-scanning this test will fail — that is the intended guard.
// ---------------------------------------------------------------------------

Deno.test("validateBodyBlocks: 3-item task list emits exactly ONE MSL-B042 (ADR-014 Path A intentional change)", () => {
  const body = [
    "Body text.",
    "",
    "- [ ] First task item",
    "- [x] Second task item",
    "- [ ] Third task item",
    "",
  ].join("\n");
  const entry = makeEntry("REQ-001", body);
  const b042 = validateBodyBlocks(entry).filter((d) => d.code === "MSL-B042");
  assertEquals(
    b042.length,
    1,
    "Path A AST migration (ADR-014): a multi-item task list must emit exactly 1 MSL-B042, not one per item",
  );
});

// ---------------------------------------------------------------------------
// MSL-B043 — raw HTML
// ---------------------------------------------------------------------------

Deno.test("validateBodyBlocks: HTML tag in paragraph → MSL-B043", () => {
  const body = `Body text with <div class="custom">raw HTML</div> inside.`;
  const entry = makeEntry("REQ-001", body);
  const diags = validateBodyBlocks(entry);
  const b043 = diags.filter((d) => d.code === "MSL-B043");
  assertEquals(b043.length, 1);
  assertEquals(b043[0].severity, "error");
});

Deno.test("validateBodyBlocks: non-markspec HTML comment → MSL-B043", () => {
  const body = "Body text. <!-- TODO: revisit --> more text.";
  const entry = makeEntry("REQ-001", body);
  const diags = validateBodyBlocks(entry);
  const b043 = diags.filter((d) => d.code === "MSL-B043");
  assertEquals(b043.length, 1);
});

Deno.test("validateBodyBlocks: markspec directive comment → allowed, no MSL-B043", () => {
  const body = "Body text.\n\n<!-- markspec:include foo.md -->\n\nMore body.";
  const entry = makeEntry("REQ-001", body);
  const diags = validateBodyBlocks(entry);
  const b043 = diags.filter((d) => d.code === "MSL-B043");
  assertEquals(b043, []);
});

Deno.test("validateBodyBlocks: excluded construct inside fenced code block — NOT flagged", () => {
  // PR 5 migration: AST does not emit prose-bearing nodes for code blocks,
  // so headings / HR / HTML inside fenced code are automatically excluded.
  const body = [
    "Prose before the fence.",
    "",
    "```",
    "## This looks like a heading but it's code",
    "<div>raw HTML in code</div>",
    "---",
    "```",
    "",
    "Prose after the fence.",
  ].join("\n");
  const entry = makeEntry("REQ-001", body);
  const diags = validateBodyBlocks(entry);
  assertEquals(diags, []);
});

Deno.test("MSL-B042: task list still flagged after checkbox round-trip", async () => {
  const { parseFile } = await import("../mod.ts");
  const { validateBodyBlocks } = await import("./body_blocks.ts");
  const doc =
    "- [TST_BB_0001] Probe\n\n  - [ ] todo item\n  - [x] done item\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const { entries } = await parseFile(doc, { file: "t.md" });
  const diags = validateBodyBlocks(entries[0]);
  const b042 = diags.filter((d) => d.code === "MSL-B042");
  assertEquals(b042.length, 1);
});

// ---------------------------------------------------------------------------
// SP2 Task 7 — verbatim-content.text regression pins.
//
// After SP2, `InlineContent.text` stores VERBATIM source prose (markup like
// `_emphasis_`, `**strong**`, `[links](u)` preserved) while marker
// recognition runs on the flattened projection. MSL-B043 scans
// `block.content.text` for forbidden inline HTML via `HTML_TAG_RE` /
// `HTML_COMMENT_RE`, both anchored on a literal `<`. Markdown emphasis /
// strong / link markup never introduces `<` or `>`, so the verbatim
// superset cannot newly false-trigger HTML detection; real `<span>` is
// still caught. These pins lock that behaviour.
// ---------------------------------------------------------------------------

Deno.test("MSL-B043: inline emphasis in a paragraph does NOT false-positive HTML", async () => {
  const { parseFile } = await import("../mod.ts");
  const { validateBodyBlocks } = await import("./body_blocks.ts");
  const doc =
    "- [TST_BB_0002] Probe\n\n  The driver _shall_ act and **must** stop.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const { entries } = await parseFile(doc, { file: "t.md" });
  const b043 = validateBodyBlocks(entries[0]).filter((d) =>
    d.code === "MSL-B043"
  );
  assertEquals(b043.length, 0);
});

Deno.test("MSL-B043: real inline HTML is still flagged with markup present", async () => {
  const { parseFile } = await import("../mod.ts");
  const { validateBodyBlocks } = await import("./body_blocks.ts");
  const doc =
    "- [TST_BB_0003] Probe\n\n  The _driver_ <span>x</span> shall act.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const { entries } = await parseFile(doc, { file: "t.md" });
  const b043 = validateBodyBlocks(entries[0]).filter((d) =>
    d.code === "MSL-B043"
  );
  assertEquals(b043.length, 1);
});
