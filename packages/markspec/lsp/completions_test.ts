/**
 * @module lsp/completions_test
 *
 * Unit tests for entry block scaffold and ID reference completions.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  buildBlockScaffoldItems,
  buildIdReferenceItems,
  buildMidTypedScaffoldItems,
  buildTrailerKeyItems,
  buildTypeAttributeItems,
  extractMidTypedPartial,
  extractRelationName,
  extractTracePartial,
  isBlockScaffoldTrigger,
  isMidTypedScaffoldTrigger,
  isTraceAttributeTrigger,
  isTrailerKeyContext,
  isTypeAttributeTrigger,
  renderScaffoldSnippet,
  type ReplacementRange,
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

Deno.test("isTraceAttributeTrigger: matches 'Provides:'", () => {
  assertEquals(isTraceAttributeTrigger("      Provides:"), true);
});

Deno.test("isTraceAttributeTrigger: matches 'Requires:'", () => {
  assertEquals(isTraceAttributeTrigger("      Requires:"), true);
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

// --- extractTracePartial ---

Deno.test("extractTracePartial: empty after colon returns empty string", () => {
  assertEquals(extractTracePartial("  Satisfies:"), "");
  assertEquals(extractTracePartial("  Satisfies: "), "");
  assertEquals(extractTracePartial("  Satisfies:   "), "");
});

Deno.test("extractTracePartial: returns partial after colon", () => {
  assertEquals(extractTracePartial("  Satisfies: SY"), "SY");
  assertEquals(extractTracePartial("  Satisfies: SYS_AEB"), "SYS_AEB");
});

Deno.test("extractTracePartial: trims surrounding whitespace", () => {
  assertEquals(extractTracePartial("  Satisfies:   SY  "), "SY");
});

Deno.test("extractTracePartial: CSV form takes text after last comma", () => {
  assertEquals(
    extractTracePartial("  Satisfies: STK_001, SY"),
    "SY",
  );
  assertEquals(
    extractTracePartial("  Satisfies: STK_001, STK_002, SY"),
    "SY",
  );
});

Deno.test("extractTracePartial: empty partial after trailing comma", () => {
  assertEquals(extractTracePartial("  Satisfies: STK_001, "), "");
});

Deno.test("extractTracePartial: returns empty when no colon present", () => {
  assertEquals(extractTracePartial("  Satisfies SY"), "");
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
    {
      name: "stakeholder-requirement",
      prefix: "STK_AEB_",
      width: 4,
      suffix: "",
      nextNumber: 4,
    },
    {
      name: "architecture",
      prefix: "SAD_AEB_",
      width: 4,
      suffix: "",
      nextNumber: 2,
    },
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
    [{
      name: "stakeholder-requirement",
      prefix: "STK_AEB_",
      width: 4,
      suffix: "",
      nextNumber: 1,
    }],
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
    {
      name: "stakeholder-requirement",
      prefix: "STK_",
      width: 4,
      suffix: "",
      nextNumber: 1,
    },
    {
      name: "architecture",
      prefix: "SAD_",
      width: 4,
      suffix: "",
      nextNumber: 1,
    },
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
    width: 4,
    suffix: "",
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
  // Tab-stop ordering must match the inserted-snippet contract.
  assertEquals(snippet.insertText.includes("${1:Title}"), true);
  assertEquals(snippet.insertText.includes("${2:Body.}"), true);
  assertEquals(snippet.insertText.includes("${3:Satisfies: }"), true);
});

Deno.test("renderScaffoldSnippet: escapes $ in profile-provided prefix and typeName", () => {
  const snippet = renderScaffoldSnippet({
    typeName: "type-with-$",
    prefix: "STK_$_",
    width: 4,
    suffix: "",
    nextNumber: 1,
    ulid: "01HGW2Q8MNP3RSTVWXYZABCDEF",
  });
  // The $ characters must be escaped as \$ so the editor's snippet parser
  // does not interpret them as tab stops.
  assertEquals(snippet.insertText.includes("STK_\\$_0001"), true);
  assertEquals(snippet.label.includes("type-with-\\$"), true);
});

Deno.test("renderScaffoldSnippet: 6-digit profile pattern produces 6-digit ID", () => {
  // Regression test: profiles declared with `{n:6d}` previously
  // produced 4-digit IDs from the LSP scaffold completion because
  // the LSP hardcoded `padStart(4, "0")`. The resulting ID failed
  // validation against the pattern. Plumbing width through the
  // shared formatDisplayId fixes this.
  const snippet = renderScaffoldSnippet({
    typeName: "stakeholder-requirement",
    prefix: "STK_",
    width: 6,
    suffix: "",
    nextNumber: 7,
    ulid: "01HGW2Q8MNP3RSTVWXYZABCDEF",
  });
  assertEquals(snippet.label, "New stakeholder-requirement (STK_000007)");
  assertEquals(snippet.insertText.startsWith("STK_000007]"), true);
});

Deno.test("renderScaffoldSnippet: pattern suffix is preserved in the ID", () => {
  const snippet = renderScaffoldSnippet({
    typeName: "draft-requirement",
    prefix: "REQ-",
    width: 3,
    suffix: "-draft",
    nextNumber: 12,
    ulid: "01HGW2Q8MNP3RSTVWXYZABCDEF",
  });
  assertEquals(snippet.label, "New draft-requirement (REQ-012-draft)");
  assertEquals(snippet.insertText.startsWith("REQ-012-draft]"), true);
});

// --- Trailer key trigger ---

Deno.test("TRAILER_KEYS: includes the documented trace + label + type keys", () => {
  assertEquals(TRAILER_KEYS.length, 15);
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
  assertEquals(TRAILER_KEYS.includes("Provides"), true);
  assertEquals(TRAILER_KEYS.includes("Requires"), true);
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

Deno.test("isTrailerKeyContext: tab-indented line matches (≥4 whitespace chars)", () => {
  assertEquals(isTrailerKeyContext("\t\t\t\t"), true); // 4 tabs
  assertEquals(isTrailerKeyContext("\t   "), true); // tab + 3 spaces = 4 ws chars
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

// --- Slice 5: mode-recommended ordering and detail suffix ---

Deno.test("Slice 5 LSP: buildBlockScaffoldItems sorts modeRecommended items first", () => {
  const types = [
    {
      name: "Aaa",
      prefix: "AAA_",
      width: 4,
      suffix: "",
      nextNumber: 1,
      modeRecommended: false,
    },
    {
      name: "Bbb",
      prefix: "BBB_",
      width: 4,
      suffix: "",
      nextNumber: 1,
      modeRecommended: true,
    },
    {
      name: "Ccc",
      prefix: "CCC_",
      width: 4,
      suffix: "",
      nextNumber: 1,
      modeRecommended: true,
    },
    {
      name: "Ddd",
      prefix: "DDD_",
      width: 4,
      suffix: "",
      nextNumber: 1,
      modeRecommended: false,
    },
  ];
  const items = buildBlockScaffoldItems(
    types,
    () => "01HFAKEULID00000000000000",
  );
  // Order: Bbb, Ccc (recommended, stable), then Aaa, Ddd (stable).
  assertEquals(items[0].detail, "Bbb (recommended)");
  assertEquals(items[1].detail, "Ccc (recommended)");
  assertEquals(items[2].detail, "Aaa");
  assertEquals(items[3].detail, "Ddd");
});

Deno.test("Slice 5 LSP: buildBlockScaffoldItems leaves order unchanged when modeRecommended is absent", () => {
  const types = [
    { name: "Aaa", prefix: "AAA_", width: 4, suffix: "", nextNumber: 1 },
    { name: "Bbb", prefix: "BBB_", width: 4, suffix: "", nextNumber: 1 },
  ];
  const items = buildBlockScaffoldItems(
    types,
    () => "01HFAKEULID00000000000000",
  );
  // No modeRecommended set anywhere → all treated equally → input order preserved.
  assertEquals(items[0].detail, "Aaa");
  assertEquals(items[1].detail, "Bbb");
});

Deno.test("Slice 5 LSP: '(recommended)' suffix appears only on modeRecommended items", () => {
  const types = [
    {
      name: "Yes",
      prefix: "YES_",
      width: 4,
      suffix: "",
      nextNumber: 1,
      modeRecommended: true,
    },
    {
      name: "No",
      prefix: "NO_",
      width: 4,
      suffix: "",
      nextNumber: 1,
      modeRecommended: false,
    },
  ];
  const items = buildBlockScaffoldItems(
    types,
    () => "01HFAKEULID00000000000000",
  );
  const yes = items.find((i) => i.detail?.startsWith("Yes"));
  const no = items.find((i) => i.detail?.startsWith("No"));
  assertEquals(yes?.detail, "Yes (recommended)");
  assertEquals(no?.detail, "No");
});

// --- Item #4: mid-typed display-ID scaffold trigger ---

Deno.test("isMidTypedScaffoldTrigger: matches '- [S' (single char)", () => {
  assertEquals(isMidTypedScaffoldTrigger("- [S"), true);
});

Deno.test("isMidTypedScaffoldTrigger: matches '- [STK_' (full prefix, underscore)", () => {
  assertEquals(isMidTypedScaffoldTrigger("- [STK_"), true);
});

Deno.test("isMidTypedScaffoldTrigger: matches '- [STK_AEB_0' (with digit)", () => {
  assertEquals(isMidTypedScaffoldTrigger("- [STK_AEB_0"), true);
});

Deno.test("isMidTypedScaffoldTrigger: matches '- [REQ-' (with hyphen)", () => {
  assertEquals(isMidTypedScaffoldTrigger("- [REQ-"), true);
});

Deno.test("isMidTypedScaffoldTrigger: matches indented '  - [STK'", () => {
  assertEquals(isMidTypedScaffoldTrigger("  - [STK"), true);
});

Deno.test("isMidTypedScaffoldTrigger: rejects bare '- [' (no partial)", () => {
  assertEquals(isMidTypedScaffoldTrigger("- ["), false);
});

Deno.test("isMidTypedScaffoldTrigger: rejects closed bracket '- [STK]'", () => {
  assertEquals(isMidTypedScaffoldTrigger("- [STK]"), false);
});

Deno.test("isMidTypedScaffoldTrigger: rejects mid-line text 'foo - [STK'", () => {
  assertEquals(isMidTypedScaffoldTrigger("foo - [STK"), false);
});

Deno.test("extractMidTypedPartial: extracts 'STK_' from '- [STK_'", () => {
  assertEquals(extractMidTypedPartial("- [STK_"), "STK_");
});

Deno.test("extractMidTypedPartial: extracts single char 'S' from '- [S'", () => {
  assertEquals(extractMidTypedPartial("- [S"), "S");
});

Deno.test("extractMidTypedPartial: extracts 'REQ-0' from indented '  - [REQ-0'", () => {
  assertEquals(extractMidTypedPartial("  - [REQ-0"), "REQ-0");
});

Deno.test("extractMidTypedPartial: returns '' for bare '- ['", () => {
  assertEquals(extractMidTypedPartial("- ["), "");
});

Deno.test("extractMidTypedPartial: returns '' for non-matching line", () => {
  assertEquals(extractMidTypedPartial("random text"), "");
});

// --- Item #4: buildMidTypedScaffoldItems ---

const MID_RANGE: ReplacementRange = {
  start: { line: 2, character: 3 },
  end: { line: 2, character: 7 },
};

Deno.test("buildMidTypedScaffoldItems: subset matches by prefix-extends", () => {
  const types = [
    {
      name: "stakeholder-requirement",
      prefix: "STK_AEB_",
      width: 4,
      suffix: "",
      nextNumber: 4,
    },
    {
      name: "architecture",
      prefix: "SAD_AEB_",
      width: 4,
      suffix: "",
      nextNumber: 2,
    },
  ];
  const items = buildMidTypedScaffoldItems(
    types,
    "STK_",
    () => "01HGW2Q8MNP3RSTVWXYZABCDEF",
    MID_RANGE,
  );
  // Only STK_AEB_ has a prefix that starts with the partial "STK_".
  assertEquals(items.length, 1);
  assertEquals(items[0].prefix, "STK_AEB_");
  assertEquals(items[0].label, "New stakeholder-requirement (STK_AEB_0004)");
});

Deno.test("buildMidTypedScaffoldItems: matches when partial extends a declared prefix", () => {
  const types = [
    {
      name: "stakeholder-requirement",
      prefix: "STK_AEB_",
      width: 4,
      suffix: "",
      nextNumber: 1,
    },
  ];
  const items = buildMidTypedScaffoldItems(
    types,
    "STK_AEB_0001",
    () => "01HGW2Q8MNP3RSTVWXYZABCDEF",
    MID_RANGE,
  );
  // The partial already extends the declared prefix → still a match.
  assertEquals(items.length, 1);
  assertEquals(items[0].prefix, "STK_AEB_");
});

Deno.test("buildMidTypedScaffoldItems: exact-prefix match comes first", () => {
  const types = [
    { name: "scoped", prefix: "STK_AEB_", width: 4, suffix: "", nextNumber: 1 },
    { name: "bare", prefix: "STK_", width: 4, suffix: "", nextNumber: 1 },
  ];
  const items = buildMidTypedScaffoldItems(
    types,
    "STK_",
    () => "01HGW2Q8MNP3RSTVWXYZABCDEF",
    MID_RANGE,
  );
  // Both match the partial "STK_"; the exact prefix match (STK_) is first.
  assertEquals(items.length, 2);
  assertEquals(items[0].prefix, "STK_");
  assertEquals(items[1].prefix, "STK_AEB_");
});

Deno.test("buildMidTypedScaffoldItems: no matches → empty array", () => {
  const types = [
    {
      name: "stakeholder-requirement",
      prefix: "STK_AEB_",
      width: 4,
      suffix: "",
      nextNumber: 1,
    },
  ];
  const items = buildMidTypedScaffoldItems(
    types,
    "XYZ",
    () => "01HGW2Q8MNP3RSTVWXYZABCDEF",
    MID_RANGE,
  );
  assertEquals(items.length, 0);
});

Deno.test("buildMidTypedScaffoldItems: attaches the replacement range to each textEdit", () => {
  const types = [
    {
      name: "stakeholder-requirement",
      prefix: "STK_AEB_",
      width: 4,
      suffix: "",
      nextNumber: 4,
    },
  ];
  const items = buildMidTypedScaffoldItems(
    types,
    "STK_",
    () => "01HGW2Q8MNP3RSTVWXYZABCDEF",
    MID_RANGE,
  );
  assertEquals(items[0].textEdit.range, MID_RANGE);
  // The replacement text is the full display ID + skeleton — replacing
  // the typed partial with the rest of the entry.
  assertEquals(items[0].textEdit.newText.startsWith("STK_AEB_0004]"), true);
  assertEquals(
    items[0].textEdit.newText.includes("Id: 01HGW2Q8MNP3RSTVWXYZABCDEF"),
    true,
  );
});

Deno.test("buildMidTypedScaffoldItems: empty types → empty array", () => {
  const items = buildMidTypedScaffoldItems(
    [],
    "STK_",
    () => "01HGW2Q8MNP3RSTVWXYZABCDEF",
    MID_RANGE,
  );
  assertEquals(items.length, 0);
});

// --- Issue #593: ID-reference completion inserts display ID, never ULID ---

Deno.test(
  "buildIdReferenceItems: inserts the display ID, never a ULID (issue #593)",
  () => {
    const items = buildIdReferenceItems([
      { displayId: makeDisplayId("SYS_0001"), title: "Target one" },
      { displayId: makeDisplayId("SWE_0002"), title: "Target two" },
    ]);
    assertEquals(items.length, 2);
    for (const item of items) {
      // No insertText — the editor inserts the label (the display ID).
      assertEquals(item.insertText, undefined);
      // The label must not look like a ULID (26 Crockford base-32 chars after "01").
      assertEquals(/^01[0-9A-HJKMNP-TV-Z]{24}$/.test(item.label), false);
    }
    assertEquals(items[0].label, "SYS_0001");
    assertEquals(items[1].label, "SWE_0002");
  },
);

// --- #598: named (counter-less) type scaffolds ---

const NAMED_ULID = "01HGW2Q8MNP3RSTVWXYZABCDEF";

Deno.test("renderScaffoldSnippet: named type emits a ${1:NAME} placeholder snippet (#598)", () => {
  const snippet = renderScaffoldSnippet({
    typeName: "sw-component",
    prefix: "SWC_",
    width: 0,
    suffix: "",
    nextNumber: 0,
    ulid: NAMED_ULID,
    named: true,
  });
  assertEquals(snippet.label, "New sw-component (SWC_<name>)");
  // The author types the identifier into the first tab stop after the prefix.
  assertEquals(snippet.insertText.startsWith("SWC_${1:NAME}]"), true);
  assertEquals(snippet.insertText.includes(`Id: ${NAMED_ULID}`), true);
  // Trailer tab stops shift past the name placeholder.
  assertEquals(snippet.insertText.includes("${2:Title}"), true);
  assertEquals(snippet.insertText.includes("${3:Body.}"), true);
  assertEquals(snippet.insertText.includes("${4:Satisfies: }"), true);
});

Deno.test("buildBlockScaffoldItems: includes named types with a name placeholder (#598)", () => {
  const items = buildBlockScaffoldItems(
    [{
      name: "sw-component",
      prefix: "SWC_",
      width: 0,
      suffix: "",
      nextNumber: 0,
      named: true,
    }],
    () => NAMED_ULID,
  );
  assertEquals(items.length, 1);
  assertEquals(items[0].label, "New sw-component (SWC_<name>)");
  assertEquals(items[0].insertText?.startsWith("SWC_${1:NAME}]"), true);
});

Deno.test("buildMidTypedScaffoldItems: matches a named type by its leading literal (#598)", () => {
  const items = buildMidTypedScaffoldItems(
    [{
      name: "sw-component",
      prefix: "SWC_",
      width: 0,
      suffix: "",
      nextNumber: 0,
      named: true,
    }],
    "SWC_",
    () => NAMED_ULID,
    MID_RANGE,
  );
  assertEquals(items.length, 1);
  assertEquals(items[0].named, true);
  assertEquals(items[0].textEdit.newText.startsWith("SWC_${1:NAME}]"), true);
});
