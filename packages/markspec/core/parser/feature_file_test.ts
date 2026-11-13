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

Deno.test("findHeaders: a blank line between header and node leaves an orphan", () => {
  const text = `Feature: F\n  ${HEADER}\n\n  Scenario: S\n    Given a\n`;
  assertEquals([...headers(text).values()].map((h) => h.kind), [undefined]);
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

Deno.test("findHeaders: records the node kind", () => {
  const text = [
    `${HEADER}`,
    "Feature: F",
    "  # [SRS_A_0001] Bg",
    "  Background:",
    "    Given a",
    "  # [SRS_A_0002] Rule",
    "  Rule: R",
    "    # [SRS_A_0003] Out",
    "    Scenario Outline: O",
    "      Given <x>",
    "      # [SRS_A_0004] Step",
    "      Then ok",
    "      # [SRS_A_0005] Ex",
    "      Examples:",
    "        | x |",
    "        | 1 |",
    "",
  ].join("\n");
  const kinds = [...headers(text)].map(([line, h]) => [line, h.kind]);
  assertEquals(kinds, [
    [2, "feature"],
    [4, "background"],
    [7, "rule"],
    [9, "scenario"],
    [12, "step"],
    [14, "examples"],
  ]);
});

Deno.test("findHeaders: a header above a step inside a Background", () => {
  const text =
    `Feature: F\n  Background:\n    # [SRS_A_0001] T\n    Given a\n  Scenario: S\n    Given b\n`;
  assertEquals(headers(text).get(4)!.kind, "step");
});

Deno.test("findHeaders: no space after #", () => {
  const text = `Feature: F\n  #[SRS_A_0001] T\n  Scenario: S\n    Given a\n`;
  const header = headers(text).get(3)!;
  assertEquals(header.lines, ["[SRS_A_0001] T"]);
  assertEquals(header.prefixWidths, [3]);
});

Deno.test("findHeaders: extra spaces after # are trimmed", () => {
  const text =
    `Feature: F\n  #  [SRS_A_0001] T\n  #   body\n  Scenario: S\n    Given a\n`;
  const header = headers(text).get(4)!;
  assertEquals(header.lines, ["[SRS_A_0001] T", "  body"]);
  assertEquals(header.prefixWidths, [5, 4]);
});

Deno.test("findHeaders: stacked headers split, the upper has no node", () => {
  const text =
    `Feature: F\n  # [SRS_A_0001] Upper\n  # [SRS_A_0002] Lower\n  Scenario: S\n    Given a\n`;
  const map = headers(text);
  assertEquals([...map.keys()], [2, 4]);
  // An orphan header is keyed by its own first line and has no kind.
  assertEquals(map.get(2)!.kind, undefined);
  assertEquals(map.get(2)!.lines, ["[SRS_A_0001] Upper"]);
  assertEquals(map.get(4)!.kind, "scenario");
  assertEquals(map.get(4)!.lines, ["[SRS_A_0002] Lower"]);
});

Deno.test("findHeaders: a header with a blank line before the node is an orphan", () => {
  const text = `Feature: F\n  ${HEADER}\n\n  Scenario: S\n    Given a\n`;
  const map = headers(text);
  assertEquals([...map.keys()], [2]);
  assertEquals(map.get(2)!.kind, undefined);
});

// --- headerEntry ---------------------------------------------------------

import { ulid } from "@std/ulid";
import { headerEntry } from "./feature_file.ts";

function entryAt(text: string, line: number) {
  const header = headers(text).get(line)!;
  return headerEntry(header, "f.feature");
}

Deno.test("headerEntry: single-line header", () => {
  const text =
    `Feature: F\n  # [SRS_A_0001] Stop\n  Scenario: S\n    Given a\n`;
  const { entry, diagnostics } = entryAt(text, 3);
  assertEquals(entry!.displayId, "SRS_A_0001");
  assertEquals(entry!.title, "Stop");
  assertEquals(diagnostics, []);
});

Deno.test("headerEntry: git-style trailer becomes rawAttributes", () => {
  const id = ulid();
  const text =
    `Feature: F\n  # [SRS_BRK_0011] Stop\n  #\n  # Id: ${id}\n  # Satisfies: SYS_BRK_0003\n  Scenario: S\n    Given a\n`;
  const { entry, diagnostics } = entryAt(text, 6);
  assertEquals(entry!.rawAttributes.map((a) => a.key), ["Id", "Satisfies"]);
  assertEquals(diagnostics, []);
});

Deno.test("headerEntry: indented trailer becomes rawAttributes", () => {
  const text =
    `Feature: F\n  # [SRS_A_0001] Stop\n  #\n  #     Satisfies: SYS_A_0003\n  Scenario: S\n    Given a\n`;
  const { entry, diagnostics } = entryAt(text, 5);
  assertEquals(entry!.rawAttributes.map((a) => a.key), ["Satisfies"]);
  assertEquals(diagnostics, []);
});

Deno.test("headerEntry: a final paragraph with 'Note: x' stays body", () => {
  const text =
    `Feature: F\n  # [SRS_A_0001] Stop\n  #\n  # Some prose.\n  #\n  # Note: x\n  Scenario: S\n    Given a\n`;
  const { entry } = entryAt(text, 7);
  assertEquals(entry!.rawAttributes, []);
  assertEquals(entry!.body.includes("Note: x"), true);
});

Deno.test("headerEntry: location is the header line and the # column", () => {
  const text =
    `Feature: F\n\n\n\n\n\n  # [SRS_A_0001] Stop\n  Scenario: S\n    Given a\n`;
  const { entry } = entryAt(text, 8);
  assertEquals(
    { line: entry!.location.line, column: entry!.location.column },
    { line: 7, column: 3 },
  );
});

Deno.test("headerEntry: attribute lines carry file lines", () => {
  const text =
    `Feature: F\n  # [SRS_A_0001] Stop\n  #\n  # Body.\n  #\n  # Id: ${ulid()}\n  # Satisfies: SYS_A_0003\n  Scenario: S\n    Given a\n`;
  const { entry } = entryAt(text, 8);
  assertEquals(entry!.attributeLines, [6, 7]);
});

Deno.test("headerEntry: body tokens are file-relative", () => {
  const text =
    `Feature: F\n  # [SRS_A_0001] Stop\n  #\n  # The brake shall stop.\n  Scenario: S\n    Given a\n`;
  const { entry } = entryAt(text, 5);
  const tok = entry!.bodyTokens!.find((t) => t.text === "shall")!;
  assertEquals(tok.location.line, 4);
  // "  # The brake shall": `shall` starts at file column 15.
  assertEquals(tok.location.column, 15);
});

Deno.test("headerEntry: multi-line header with blank # lines", () => {
  const text =
    `Feature: F\n  # [SRS_A_0001] Stop\n  #\n  # Para one.\n  #\n  # Para two.\n  Scenario: S\n    Given a\n`;
  const { entry } = entryAt(text, 7);
  assertEquals(entry!.body.includes("Para one."), true);
  assertEquals(entry!.body.includes("Para two."), true);
});

Deno.test("headerEntry: Id absent and present", () => {
  const none = entryAt(
    `Feature: F\n  # [SRS_A_0001] Stop\n  Scenario: S\n    Given a\n`,
    3,
  ).entry!;
  assertEquals(none.id, undefined);
  const id = ulid();
  const some = entryAt(
    `Feature: F\n  # [SRS_A_0001] Stop\n  #\n  # Id: ${id}\n  Scenario: S\n    Given a\n`,
    5,
  ).entry!;
  assertEquals(some.id, id);
});

Deno.test("headerEntry: CRLF input gives the same locations", () => {
  const text =
    `Feature: F\n  # [SRS_A_0001] Stop\n  #\n  # The brake shall stop.\n  # \n  # Satisfies: SYS_A_0003\n  Scenario: S\n    Given a\n`;
  const lf = entryAt(text, 7);
  const crlf = entryAt(text.replaceAll("\n", "\r\n"), 7);
  assertEquals(crlf.entry!.location, lf.entry!.location);
  assertEquals(crlf.entry!.rawAttributes.length, 1);
  assertEquals(
    crlf.entry!.bodyTokens!.map((t) => t.location),
    lf.entry!.bodyTokens!.map((t) => t.location),
  );
  assertEquals(crlf.diagnostics, lf.diagnostics);
});

Deno.test("headerEntry: header in a Rule nested in a Feature", () => {
  const text =
    `Feature: F\n  Rule: R\n    # [SRS_A_0002] Inner\n    #\n    # It shall hold.\n    Scenario: S\n      Given a\n`;
  const { entry } = entryAt(text, 6);
  assertEquals(entry!.displayId, "SRS_A_0002");
  assertEquals(
    { line: entry!.location.line, column: entry!.location.column },
    { line: 3, column: 5 },
  );
  const tok = entry!.bodyTokens!.find((t) => t.text === "shall")!;
  assertEquals(tok.location, { file: "f.feature", line: 5, column: 10 });
});

Deno.test("headerEntry: parse diagnostics carry file positions", () => {
  const text =
    `Feature: F\n  # [SRS_A_0001] Stop\n  #\n  # Satisfies: SYS_A_0003\n  # Bad line without colon\n  Scenario: S\n    Given a\n`;
  const { diagnostics } = entryAt(text, 6);
  assertEquals(diagnostics.map((d) => [d.code, d.location]), [
    ["MSL-P020", { file: "f.feature", line: 2, column: 3 }],
  ]);
});
