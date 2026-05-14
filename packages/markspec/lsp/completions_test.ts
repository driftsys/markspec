/**
 * @module lsp/completions_test
 *
 * Unit tests for entry block scaffold and ID reference completions.
 */

import { assertEquals } from "@std/assert";
import {
  buildBlockScaffoldItems,
  buildIdReferenceItems,
  buildTypeAttributeItems,
  extractRelationName,
  isBlockScaffoldTrigger,
  isTraceAttributeTrigger,
  isTypeAttributeTrigger,
} from "./completions.ts";
import type { DisplayIdEntry } from "./workspace.ts";

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
    { displayId: "STK_AEB_0001", title: "Braking" },
    { displayId: "SAD_AEB_0001", title: "Architecture" },
  ];
  const items = buildIdReferenceItems(ids);
  assertEquals(items.length, 2);
  assertEquals(items[0].label, "STK_AEB_0001");
  assertEquals(items[0].detail, "Braking");
  assertEquals(items[1].label, "SAD_AEB_0001");
});

Deno.test("buildBlockScaffoldItems: returns generic item when no types", () => {
  const items = buildBlockScaffoldItems([]);
  assertEquals(items.length, 1);
  assertEquals(items[0].label, "New entry");
});

Deno.test("buildBlockScaffoldItems: returns one item per type", () => {
  const types = [
    { name: "stakeholder-requirement", prefix: "STK_AEB_", nextNumber: 4 },
    { name: "architecture", prefix: "SAD_AEB_", nextNumber: 2 },
  ];
  const items = buildBlockScaffoldItems(types);
  assertEquals(items.length, 2);
  assertEquals(items[0].label, "New stakeholder-requirement (STK_AEB_0004)");
  assertEquals(items[1].label, "New architecture (SAD_AEB_0002)");
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
