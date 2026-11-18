/**
 * @module lsp/locators_test
 *
 * Unit tests for the scenario-locator span helpers.
 */

import { assertEquals } from "@std/assert";
import { isInsideLocator, locatorSpans } from "./locators.ts";

const at = (line: string, text: string) => line.indexOf(text);

Deno.test("isInsideLocator: indented Markdown trailer", () => {
  const line = "      Verifies: REQ_1 [Scen REQ_2]";
  assertEquals(isInsideLocator(line, at(line, "REQ_2")), true);
  assertEquals(isInsideLocator(line, at(line, "REQ_1")), false);
});

Deno.test("isInsideLocator: doc-comment trailer with 1 to 3 spaces", () => {
  for (const pad of [" ", "  ", "   "]) {
    const line = `///${pad}Verifies: REQ_1 [Scen REQ_2]`;
    assertEquals(isInsideLocator(line, at(line, "REQ_2")), true, line);
  }
  const star = " *  Satisfies: REQ_1 [Scen REQ_2]";
  assertEquals(isInsideLocator(star, at(star, "REQ_2")), true);
});

Deno.test("isInsideLocator: git-style unindented trailer", () => {
  const line = "Verifies: REQ_1 [Scen REQ_2]";
  assertEquals(isInsideLocator(line, at(line, "REQ_2")), true);
});

Deno.test("isInsideLocator: free-text locator relations", () => {
  const line = "    References: REQ_1 [REQ_2]";
  assertEquals(isInsideLocator(line, at(line, "REQ_2")), true);
});

Deno.test("isInsideLocator: a relation without a locator mode has no locator", () => {
  const line = "      Allocated-to: REQ_1 [REQ_2]";
  assertEquals(isInsideLocator(line, at(line, "REQ_2")), false);
});

Deno.test("isInsideLocator: prose line is never a locator line", () => {
  const line = "See REQ_1 [REQ_2] for details";
  assertEquals(isInsideLocator(line, at(line, "REQ_2")), false);
});

Deno.test("isInsideLocator: unclosed locator stays a reference", () => {
  const line = "      Verifies: REQ_1 [Scen REQ_2";
  assertEquals(isInsideLocator(line, at(line, "REQ_2")), false);
});

Deno.test("isInsideLocator: escaped bracket does not close the locator", () => {
  const line = "      Verifies: REQ_1 [Scen \\] REQ_2]";
  assertEquals(isInsideLocator(line, at(line, "REQ_2")), true);
});

Deno.test("isInsideLocator: a value that starts with a bracket has no locator", () => {
  const line = "      Satisfies: [REQ_1]";
  assertEquals(isInsideLocator(line, at(line, "REQ_1")), false);
  const afterComma = "      Satisfies: REQ_0, [REQ_1]";
  assertEquals(isInsideLocator(afterComma, at(afterComma, "REQ_1")), false);
});

Deno.test("isInsideLocator: the .feature gate stays out of Markdown", () => {
  const line = "# Verifies: REQ_1 [Scen REQ_2]";
  assertEquals(isInsideLocator(line, at(line, "REQ_2"), true), true);
  const note = "# Note: REQ_1 [REQ_2]";
  assertEquals(isInsideLocator(note, at(note, "REQ_2"), false), false);
  assertEquals(isInsideLocator(note, at(note, "REQ_2"), true), false);
  // A bare `Key:` line with no `#` is not a .feature header trailer.
  const bare = "Verifies: REQ_1 [Scen REQ_2]";
  assertEquals(locatorSpans(bare, true), []);
});
