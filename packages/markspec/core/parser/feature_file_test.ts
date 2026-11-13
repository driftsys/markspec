import { assertEquals } from "@std/assert";
import { loadGherkin } from "../gherkin/load.ts";
import { findHeaders } from "./feature_file.ts";

const api = await loadGherkin();

function headers(text: string) {
  return findHeaders(api.parse(text), text);
}

const HEADER = "# [SRS_BRK_0011] Stop before a stationary obstacle";

Deno.test("findHeaders: header directly above a Scenario", () => {
  const text = `Feature: Brake\n\n  ${HEADER}\n  Scenario: Stop\n    Given a\n`;
  const map = headers(text);
  assertEquals([...map.keys()], [4]);
  const header = map.get(4)!;
  assertEquals(header.lines, [
    "[SRS_BRK_0011] Stop before a stationary obstacle",
  ]);
  assertEquals(header.startLine, 3);
  assertEquals(header.endLine, 3);
  assertEquals(header.column, 3);
  assertEquals(header.prefixWidths, [4]);
});

Deno.test("findHeaders: header directly above Feature", () => {
  const map = headers(
    `${HEADER}\nFeature: Brake\n  Scenario: S\n    Given a\n`,
  );
  assertEquals([...map.keys()], [2]);
  assertEquals(map.get(2)!.column, 1);
});

Deno.test("findHeaders: header directly above Rule", () => {
  const text =
    `Feature: F\n  ${HEADER}\n  Rule: R\n    Scenario: S\n      Given a\n`;
  assertEquals([...headers(text).keys()], [3]);
});

Deno.test("findHeaders: multi-line header keeps empty comment lines", () => {
  const text =
    `Feature: F\n  # [SRS_A_0001] T\n  #\n  # Body text\n  Scenario: S\n    Given a\n`;
  const header = headers(text).get(5)!;
  assertEquals(header.lines, ["[SRS_A_0001] T", "", "Body text"]);
  assertEquals(header.startLine, 2);
  assertEquals(header.endLine, 4);
  assertEquals(header.prefixWidths, [4, 3, 4]);
});

Deno.test("findHeaders: tag lines between header and node are allowed", () => {
  const text =
    `Feature: F\n  ${HEADER}\n  @smoke\n  @slow\n  Scenario: S\n    Given a\n`;
  assertEquals([...headers(text).keys()], [5]);
});

Deno.test("findHeaders: a blank line between header and node drops the header", () => {
  const text = `Feature: F\n  ${HEADER}\n\n  Scenario: S\n    Given a\n`;
  assertEquals(headers(text).size, 0);
});

Deno.test("findHeaders: CRLF line endings", () => {
  const text =
    `Feature: F\r\n  ${HEADER}\r\n  @smoke\r\n  Scenario: S\r\n    Given a\r\n`;
  const map = headers(text);
  assertEquals([...map.keys()], [4]);
  assertEquals(map.get(4)!.lines, [
    "[SRS_BRK_0011] Stop before a stationary obstacle",
  ]);
});

Deno.test("findHeaders: # language: at the top is never part of a header", () => {
  const text =
    `# language: fr\n# [SRS_A_0001] T\nFonctionnalité: F\n  Scénario: S\n    Soit a\n`;
  const map = headers(text);
  assertEquals([...map.keys()], [3]);
  assertEquals(map.get(3)!.lines, ["[SRS_A_0001] T"]);
  assertEquals(map.get(3)!.startLine, 2);
});

Deno.test("findHeaders: a language line alone is not a header", () => {
  const text = `# language: fr\nFonctionnalité: F\n  Scénario: S\n    Soit a\n`;
  assertEquals(headers(text).size, 0);
});

Deno.test("findHeaders: a comment run without [ID] is not a header", () => {
  const text =
    `Feature: F\n  # just a note\n  # another line\n  Scenario: S\n    Given a\n`;
  assertEquals(headers(text).size, 0);
});

Deno.test("findHeaders: a file with no headers gives an empty result", () => {
  assertEquals(headers("Feature: F\n  Scenario: S\n    Given a\n").size, 0);
});
