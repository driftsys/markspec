/**
 * @module lsp/completions_test
 *
 * Unit tests for entry block scaffold and ID reference completions.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  buildBlockScaffoldItems,
  buildIdReferenceItems,
  buildTrailerKeyItems,
  buildTypeAttributeItems,
  extractRelationName,
  isBlockScaffoldTrigger,
  isTraceAttributeTrigger,
  isTrailerKeyContext,
  isTypeAttributeTrigger,
  renderScaffoldSnippet,
  TRAILER_KEYS,
} from "./completions.ts";
import type { DisplayIdEntry } from "./workspace.ts";
import { makeDisplayId } from "../core/mod.ts";

// --- Trigger detection ---

Deno.test("isBlockScaffoldTrigger: matches '- ['", () => {
  assertEquals(isBlockScaffoldTrigger("- ["), true);
});

Deno.test("isBlockScaffoldTrigger: matches '  - ['", () => {
  assertEquals(isBlockScaffoldTrigger("  - ["), true);
});

Deno.test("isBlockScaffoldTrigger: rejects mid-line '['", () => {
  assertEquals(isBlockScaffoldTrigger("some text ["), false);
});

Deno.test("isBlockScaffoldTrigger: rejects standalone '['", () => {
  assertEquals(isBlockScaffoldTrigger("["), false);
});

Deno.test("isTraceAttributeTrigger: matches 'Satisfies:'", () => {
  assertEquals(isTraceAttributeTrigger("  Satisfies:"), true);
});

Deno.test("isTraceAttributeTrigger: matches 'Derived-from:'", () => {
  assertEquals(isTraceAttributeTrigger("  Derived-from:"), true);
});

Deno.test("isTraceAttributeTrigger: matches 'Satisfies: ' with trailing space", () => {
  assertEquals(isTraceAttributeTrigger("  Satisfies: "), true);
});

Deno.test("isTraceAttributeTrigger: matches 'Satisfies: STK' partial input", () => {
  assertEquals(isTraceAttributeTrigger("  Satisfies: STK"), true);
});

Deno.test("isTraceAttributeTrigger: rejects 'Id:'", () => {
  assertEquals(isTraceAttributeTrigger("  Id:"), false);
});

Deno.test("isTraceAttributeTrigger: rejects plain text with colon", () => {
  assertEquals(isTraceAttributeTrigger("Note: something"), false);
});

Deno.test("extractRelationName: extracts 'Satisfies' from line", () => {
  assertEquals(extractRelationName("  Satisfies: STK"), "Satisfies");
});

Deno.test("extractRelationName: extracts 'Derived-from'", () => {
  assertEquals(extractRelationName("  Derived-from: "), "Derived-from");
});

// --- Completion item building ---

Deno.test("buildIdReferenceItems: returns items for all display IDs", () => {
  const ids: DisplayIdEntry[] = [
    { displayId: makeDisplayId("STK_AEB_0001"), title: "Braking" },
    { displayId: makeDisplayId("SAD_AEB_0001"), title: "Architecture" },
  ];
  const items = buildIdReferenceItems(ids);
  assertEquals(items.length, 2);
  assertEquals(items[0].label, "STK_AEB_0001");
  assertEquals(items[0].detail, "Braking");
  assertEquals(items[1].label, "SAD_AEB_0001");
});

Deno.test("buildBlockScaffoldItems: returns generic item when no types", () => {
  const items = buildBlockScaffoldItems([], () => "01HGW2Q8MNP3RSTVWXYZABCDEF");
  assertEquals(items.length, 1);
  assertEquals(items[0].label, "New entry");
});

Deno.test("buildBlockScaffoldItems: returns one item per type", () => {
  const types = [
    { name: "stakeholder-requirement", prefix: "STK_AEB_", nextNumber: 4 },
    { name: "architecture", prefix: "SAD_AEB_", nextNumber: 2 },
  ];
  const items = buildBlockScaffoldItems(
    types,
    () => "01HGW2Q8MNP3RSTVWXYZABCDEF",
  );
  assertEquals(items.length, 2);
  assertEquals(items[0].label, "New stakeholder-requirement (STK_AEB_0004)");
  assertEquals(items[1].label, "New architecture (SAD_AEB_0002)");
});

Deno.test("buildBlockScaffoldItems: bakes provided ULID into snippet", () => {
  const items = buildBlockScaffoldItems(
    [{ name: "stakeholder-requirement", prefix: "STK_AEB_", nextNumber: 1 }],
    () => "01HGW2Q8MNP3RSTVWXYZABCDEF",
  );
  assertEquals(items.length, 1);
  const text = items[0].insertText ?? "";
  assertEquals(text.includes("01HGW2Q8MNP3RSTVWXYZABCDEF"), true);
  assertEquals(text.includes("${ULID}"), false);
  assertEquals(text.includes("\\${ULID}"), false);
});

Deno.test("buildBlockScaffoldItems: calls provider once per item", () => {
  let counter = 0;
  const provider = () =>
    `01HGW2Q8MNP3RSTVWXYZ${(counter++).toString().padStart(6, "0")}`;
  const types = [
    { name: "stakeholder-requirement", prefix: "STK_", nextNumber: 1 },
    { name: "architecture", prefix: "SAD_", nextNumber: 1 },
  ];
  const items = buildBlockScaffoldItems(types, provider);
  assertEquals(items.length, 2);
  assertNotEquals(items[0].insertText, items[1].insertText);
  assertEquals(counter, 2);
});

Deno.test("buildBlockScaffoldItems: zero-types fallback keeps literal placeholder", () => {
  const items = buildBlockScaffoldItems([], () => "01HGW2Q8MNP3RSTVWXYZABCDEF");
  // Zero-types fallback intentionally keeps the literal ${ULID}
  // placeholder — no profile context to anchor a real ULID. Documented
  // so the behavior change is intentional.
  assertEquals(items.length, 1);
  assertEquals(items[0].insertText?.includes("${ULID}"), true);
});

// --- Type-attribute completion ---

Deno.test("isTypeAttributeTrigger: matches '      Type:'", () => {
  assertEquals(isTypeAttributeTrigger("      Type:"), true);
});

Deno.test("isTypeAttributeTrigger: matches 'Type: ' with trailing space", () => {
  assertEquals(isTypeAttributeTrigger("      Type: "), true);
});

Deno.test("isTypeAttributeTrigger: matches partial value 'Type: Req'", () => {
  assertEquals(isTypeAttributeTrigger("      Type: Req"), true);
});

Deno.test("isTypeAttributeTrigger: rejects unrelated key 'Source:'", () => {
  assertEquals(isTypeAttributeTrigger("      Source: foo"), false);
});

Deno.test("isTypeAttributeTrigger: rejects 'Type-foo:' suffix", () => {
  assertEquals(isTypeAttributeTrigger("      Type-foo:"), false);
});

Deno.test("buildTypeAttributeItems: returns core types when no profile types", () => {
  const items = buildTypeAttributeItems([]);
  // 4 abstract + 12 concrete = 16 core types.
  assertEquals(items.length, 16);
  const labels = items.map((i) => i.label);
  // Spot-check a couple of core types are present.
  assertEquals(labels.includes("Item"), true);
  assertEquals(labels.includes("Requirement"), true);
  assertEquals(labels.includes("SoftwareUnit"), true);
});

Deno.test("buildTypeAttributeItems: appends profile-declared types after core", () => {
  const items = buildTypeAttributeItems(["requirement", "test"]);
  assertEquals(items.length, 18);
  // Profile types come after core types in the listing.
  assertEquals(items[16].label, "requirement");
  assertEquals(items[17].label, "test");
});

// --- renderScaffoldSnippet helper ---

Deno.test("renderScaffoldSnippet: formats display ID and ULID", () => {
  const snippet = renderScaffoldSnippet({
    typeName: "stakeholder-requirement",
    prefix: "STK_AEB_",
    nextNumber: 42,
    ulid: "01HGW2Q8MNP3RSTVWXYZABCDEF",
  });
  assertEquals(snippet.label, "New stakeholder-requirement (STK_AEB_0042)");
  // Display ID is the bracket opener.
  assertEquals(snippet.insertText.startsWith("STK_AEB_0042]"), true);
  // ULID appears on the `Id:` line.
  assertEquals(
    snippet.insertText.includes(`Id: 01HGW2Q8MNP3RSTVWXYZABCDEF`),
    true,
  );
});

// --- Trailer key trigger ---

Deno.test("TRAILER_KEYS: includes the documented trace + label + type keys", () => {
  assertEquals(TRAILER_KEYS.length, 13);
  // Trace attribute keys.
  assertEquals(TRAILER_KEYS.includes("Satisfies"), true);
  assertEquals(TRAILER_KEYS.includes("Derived-from"), true);
  assertEquals(TRAILER_KEYS.includes("Verified-by"), true);
  assertEquals(TRAILER_KEYS.includes("References"), true);
  assertEquals(TRAILER_KEYS.includes("Tests"), true);
  assertEquals(TRAILER_KEYS.includes("Depends-on"), true);
  assertEquals(TRAILER_KEYS.includes("Part-of"), true);
  assertEquals(TRAILER_KEYS.includes("Allocated-to"), true);
  assertEquals(TRAILER_KEYS.includes("Realizes"), true);
  assertEquals(TRAILER_KEYS.includes("Generated-from"), true);
  assertEquals(TRAILER_KEYS.includes("Supersedes"), true);
  // Non-trace keys we also suggest.
  assertEquals(TRAILER_KEYS.includes("Labels"), true);
  assertEquals(TRAILER_KEYS.includes("Type"), true);
});

Deno.test("isTrailerKeyContext: blank indented line matches", () => {
  assertEquals(isTrailerKeyContext("    "), true); // exactly 4 spaces (boundary)
  assertEquals(isTrailerKeyContext("      "), true); // 6 spaces (canonical)
});

Deno.test("isTrailerKeyContext: indented partial uppercase key matches", () => {
  assertEquals(isTrailerKeyContext("      Sa"), true);
  assertEquals(isTrailerKeyContext("      Der"), true);
});

Deno.test("isTrailerKeyContext: less than 4 spaces of indent rejected", () => {
  assertEquals(isTrailerKeyContext("  "), false);
  assertEquals(isTrailerKeyContext("   S"), false);
});

Deno.test("isTrailerKeyContext: lowercase first letter rejected", () => {
  assertEquals(isTrailerKeyContext("      satisfies"), false);
});

Deno.test("isTrailerKeyContext: completed key (colon present) rejected", () => {
  assertEquals(isTrailerKeyContext("      Satisfies:"), false);
});

Deno.test("buildTrailerKeyItems: returns one item per key", () => {
  const items = buildTrailerKeyItems();
  assertEquals(items.length, TRAILER_KEYS.length);
  for (const item of items) {
    assertEquals(item.insertText?.endsWith(": "), true);
    assertEquals(item.isSnippet, false);
  }
});

Deno.test("buildTrailerKeyItems: each label matches a TRAILER_KEYS entry", () => {
  const labels = buildTrailerKeyItems().map((i) => i.label);
  for (const key of TRAILER_KEYS) {
    assertEquals(labels.includes(key), true);
  }
});
