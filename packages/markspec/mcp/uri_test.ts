/**
 * @module mcp/uri_test
 *
 * Unit tests for the markspec:// URI scheme helpers.
 */

import { assertEquals } from "@std/assert";
import {
  ENTRIES_URI,
  entryUri,
  isEntryUri,
  isProfileDetailUri,
  parseEntryUri,
  parseProfileDetailUri,
  PROFILE_URI,
  profileDetailUri,
} from "./uri.ts";

Deno.test("PROFILE_URI is the canonical constant", () => {
  assertEquals(PROFILE_URI, "markspec://profile");
});

Deno.test("ENTRIES_URI is the canonical constant", () => {
  assertEquals(ENTRIES_URI, "markspec://entries");
});

Deno.test("entryUri: builds entry URI from display ID", () => {
  assertEquals(entryUri("STK_AEB_0001"), "markspec://entry/STK_AEB_0001");
});

Deno.test("entryUri: encodes special characters in display ID", () => {
  // Display IDs are normally [A-Z0-9_] but be defensive.
  assertEquals(
    entryUri("FOO BAR"),
    "markspec://entry/FOO%20BAR",
  );
});

Deno.test("parseEntryUri: extracts display ID", () => {
  assertEquals(
    parseEntryUri("markspec://entry/STK_AEB_0001"),
    "STK_AEB_0001",
  );
});

Deno.test("parseEntryUri: decodes percent-encoded characters", () => {
  assertEquals(parseEntryUri("markspec://entry/FOO%20BAR"), "FOO BAR");
});

Deno.test("parseEntryUri: returns undefined for non-entry URIs", () => {
  assertEquals(parseEntryUri("markspec://profile"), undefined);
  assertEquals(parseEntryUri("https://example.com/STK_AEB_0001"), undefined);
  assertEquals(parseEntryUri("markspec://entry/"), undefined);
});

Deno.test("isEntryUri: true for entry URIs", () => {
  assertEquals(isEntryUri("markspec://entry/STK_AEB_0001"), true);
});

Deno.test("isEntryUri: false for other URIs", () => {
  assertEquals(isEntryUri("markspec://profile"), false);
  assertEquals(isEntryUri("markspec://entries"), false);
  assertEquals(isEntryUri("markspec://entry/"), false);
});

Deno.test("profileDetailUri: builds correct URI", () => {
  assertEquals(
    profileDetailUri("type", "software-requirement"),
    "markspec://profile/type/software-requirement",
  );
  assertEquals(
    profileDetailUri("label-concern", "asil"),
    "markspec://profile/label/asil",
  );
});

Deno.test("parseProfileDetailUri: parses type URI", () => {
  const parsed = parseProfileDetailUri(
    "markspec://profile/type/software-requirement",
  );
  assertEquals(parsed?.kind, "type");
  assertEquals(parsed?.name, "software-requirement");
});

Deno.test("parseProfileDetailUri: label-concern uses short form 'label'", () => {
  const parsed = parseProfileDetailUri("markspec://profile/label/asil");
  assertEquals(parsed?.kind, "label-concern");
  assertEquals(parsed?.name, "asil");
});

Deno.test("parseProfileDetailUri: overview URI returns undefined", () => {
  assertEquals(parseProfileDetailUri(PROFILE_URI), undefined);
});

Deno.test("isProfileDetailUri: correctly identifies detail URIs", () => {
  assertEquals(
    isProfileDetailUri("markspec://profile/type/software-requirement"),
    true,
  );
  assertEquals(isProfileDetailUri(PROFILE_URI), false);
  assertEquals(isProfileDetailUri("markspec://entry/SRS_0001"), false);
});
