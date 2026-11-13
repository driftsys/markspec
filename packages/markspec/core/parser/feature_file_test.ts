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
  assertEquals(entry!.body, "");
  assertEquals(entry!.bodyTokens, []);
  assertEquals(entry!.bodyAst, []);
  assertEquals(entry!.endLine, 2);
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

// ---------------------------------------------------------------------------
// parseFeatureFile (Task 3)
// ---------------------------------------------------------------------------

import { assert } from "@std/assert";
import { parseFeatureFile } from "./feature_file.ts";
import { buildCriteria } from "../criteria/scenarios.ts";
import { scenarioProcedure } from "../gherkin/procedure.ts";
import { featureFileLine } from "../gherkin/position.ts";
import { checkBlockRoles } from "../validator/block_role.ts";
import { checkProcedureSteps } from "../validator/procedure.ts";
import type { FeatureNode } from "../ast/nodes.ts";
import type { Entry } from "../model/mod.ts";

/** The worked example of design §5.6. */
const WORKED = [
  "# language: en",
  "# [REQ_BRK_0011] Emergency braking for close obstacles",
  "#",
  "# The braking controller shall start braking when an obstacle is detected",
  "# closer than 40 m.",
  "#",
  "# Satisfies: STK_BRK_0001",
  "# Labels: ASIL-B",
  "Feature: Emergency braking",
  "",
  "  Background:",
  "    Given the vehicle speed is 60 km/h",
  "",
  "  Scenario: Brake at 20 m",
  "    When an obstacle appears at 20 m",
  "    Then braking starts within 200 ms",
  "",
  "  Scenario: No braking beyond 40 m",
  "    When an obstacle appears at 50 m",
  "    Then the controller does not brake",
  "",
  "  # [TST_BRK_0013] Brake command timing on the test bench",
  "  #",
  "  # Verifies: REQ_BRK_0011 [Brake at 20 m]",
  "  Scenario: Brake command timing",
  "    # Step 1",
  "    * place the target at 20 m",
  "    Then the brake command is sent within 200 ms",
  "    # Step 2",
  "    * remove the target",
  "    Then the brake command is released within 500 ms",
  "",
].join("\n");

function parseFF(text: string) {
  return parseFeatureFile(text, { file: "f.feature", api });
}

function byId(entries: readonly Entry[], id: string): Entry {
  const found = entries.find((e) => e.displayId === id);
  assert(found, `no entry ${id}`);
  return found;
}

function featureNode(entry: Entry): FeatureNode {
  const node = entry.bodyAst?.find((b) => b.kind === "feature");
  assert(node, `no feature node in ${entry.displayId}`);
  return node as FeatureNode;
}

const typed = (entry: Entry, type: string): Entry => ({ ...entry, type });

Deno.test("parseFeatureFile: §5.6 gives REQ_BRK_0011 and TST_BRK_0013", () => {
  const { entries, diagnostics } = parseFF(WORKED);
  // TST_BRK_0013 has a trailer and no prose, and its scenario has no
  // description, so it has no body.
  assertEquals(
    diagnostics.map((d) => [d.code, d.location?.line]),
    [["MSL-P030", 22]],
  );
  assertEquals(entries.map((e) => [e.displayId, e.location.line]), [
    ["REQ_BRK_0011", 2],
    ["TST_BRK_0013", 22],
  ]);
  assertEquals(entries[0].source, { kind: "feature-file", node: "feature" });
  assertEquals(entries[1].source, { kind: "feature-file", node: "scenario" });
  assertEquals(
    entries[0].rawAttributes.map((a) => a.key),
    ["Satisfies", "Labels"],
  );
});

Deno.test("parseFeatureFile: unheaded scenarios belong to the headed Feature", () => {
  const req = byId(parseFF(WORKED).entries, "REQ_BRK_0011");
  const criteria = buildCriteria(req);
  assertEquals(criteria.map((c) => c.name), [
    "Brake at 20 m",
    "No braking beyond 40 m",
  ]);
  assertEquals(criteria.map((c) => c.location.line), [14, 18]);
});

Deno.test("parseFeatureFile: FeatureNode source is the owning node span", () => {
  const req = byId(parseFF(WORKED).entries, "REQ_BRK_0011");
  const node = featureNode(req);
  const lines = WORKED.split("\n");
  // Feature line (9) to the last line of its last scenario (31).
  assertEquals(node.source, lines.slice(8, 31).join("\n"));
  assertEquals(featureFileLine(req, node, 1), 9);
  const tst = byId(parseFF(WORKED).entries, "TST_BRK_0013");
  const tnode = featureNode(tst);
  assertEquals(tnode.source.split("\n")[0], "  Scenario: Brake command timing");
  assertEquals(
    featureFileLine(tst, tnode, tnode.feature!.scenarios[0].range.start.line),
    25,
  );
});

Deno.test("parseFeatureFile: a headed scenario is not owned by its Feature", () => {
  const { entries } = parseFF(WORKED);
  const req = byId(entries, "REQ_BRK_0011");
  assertEquals(
    featureNode(req).feature!.scenarios.map((s) => s.name),
    ["Brake at 20 m", "No braking beyond 40 m"],
  );
  const tst = byId(entries, "TST_BRK_0013");
  assertEquals(
    featureNode(tst).feature!.scenarios.map((s) => s.name),
    ["Brake command timing"],
  );
  assertEquals(buildCriteria(tst).map((c) => c.name), ["Brake command timing"]);
});

const RULES = [
  "# [REQ_A_0001] Feature entry",
  "#",
  "# Feature prose.",
  "Feature: F",
  "  Scenario: Top",
  "    Then a",
  "  # [REQ_A_0002] Rule entry",
  "  #",
  "  # Rule prose.",
  "  Rule: R",
  "    Scenario: Inner",
  "      Then b",
  "    # [TST_A_0003] Inner test",
  "    #",
  "    # Test prose.",
  "    Scenario: Headed inner",
  "      When c",
  "      Then d",
  "  Rule: Unheaded",
  "    Scenario: Under unheaded rule",
  "      Then e",
].join("\n");

Deno.test("parseFeatureFile: headed Rule owns its scenarios, not the Feature", () => {
  const { entries, diagnostics } = parseFF(RULES);
  assertEquals(diagnostics, []);
  assertEquals(entries.map((e) => e.displayId), [
    "REQ_A_0001",
    "REQ_A_0002",
    "TST_A_0003",
  ]);
  assertEquals(entries[1].source, { kind: "feature-file", node: "rule" });
  assertEquals(buildCriteria(entries[0]).map((c) => c.name), [
    "Top",
    "Under unheaded rule",
  ]);
  assertEquals(buildCriteria(entries[1]).map((c) => c.name), ["Inner"]);
  assertEquals(buildCriteria(entries[1])[0].location.line, 11);
  assertEquals(buildCriteria(entries[2]).map((c) => c.name), ["Headed inner"]);
});

Deno.test("parseFeatureFile: unheaded scenario with no headed ancestor is dropped", () => {
  const text = [
    "Feature: F",
    "  Scenario: Loose",
    "    Then a",
    "  # [TST_A_0001] Headed",
    "  #",
    "  # Prose.",
    "  Scenario: Headed",
    "    Then b",
  ].join("\n");
  const { entries } = parseFF(text);
  assertEquals(entries.map((e) => e.displayId), ["TST_A_0001"]);
  assertEquals(buildCriteria(entries[0]).map((c) => c.name), ["Headed"]);
});

Deno.test("parseFeatureFile: Background steps are preconditions", () => {
  const tst = byId(parseFF(WORKED).entries, "TST_BRK_0013");
  const node = featureNode(tst);
  const procedure = scenarioProcedure(
    node.feature!.scenarios[0],
    node.feature!.comments,
  );
  assertEquals(
    procedure.preconditions.map((p) => [p.step.text, p.origin]),
    [["the vehicle speed is 60 km/h", "background"]],
  );
  assertEquals(procedure.steps.map((s) => s.label), ["Step 1", "Step 2"]);
  // The inherited step maps back to its own file line.
  assertEquals(
    featureFileLine(
      tst,
      node,
      procedure.preconditions[0].step.range.start.line,
    ),
    12,
  );
});

Deno.test("parseFeatureFile: Gherkin description joins the body after header prose", () => {
  const text = [
    "# [REQ_A_0001] Title",
    "#",
    "# Header prose.",
    "Feature: F",
    "  First description line.",
    "  Second description line.",
    "",
    "  Scenario: S",
    "    Then a",
  ].join("\n");
  const [entry] = parseFF(text).entries;
  assertEquals(
    entry.body,
    "Header prose.\n\nFirst description line.\nSecond description line.",
  );
});

Deno.test("parseFeatureFile: description alone gives the body", () => {
  const text = [
    "# [REQ_A_0001] Title",
    "Feature: F",
    "  Only description.",
    "  Scenario: S",
    "    Then a",
  ].join("\n");
  const { entries, diagnostics } = parseFF(text);
  assertEquals(entries[0].body, "Only description.");
  assertEquals(diagnostics, []);
});

Deno.test("parseFeatureFile: MSL-P030 when no header body and no description", () => {
  const text = [
    "Feature: F",
    "  # [TST_A_0001] Title only",
    "  Scenario: S",
    "    Then a",
  ].join("\n");
  const { entries, diagnostics } = parseFF(text);
  assertEquals(entries.length, 1);
  assertEquals(
    diagnostics.map((d) => [d.code, d.location?.line]),
    [["MSL-P030", 2]],
  );
});

Deno.test("parseFeatureFile: tags are not labels", () => {
  const text = [
    "Feature: F",
    "  # [TST_A_0001] Tagged",
    "  #",
    "  # Prose.",
    "  @wip @slow",
    "  Scenario: S",
    "    Then a",
  ].join("\n");
  const [entry] = parseFF(text).entries;
  assertEquals(entry.rawAttributes.map((a) => a.key), []);
  assertEquals(featureNode(entry).feature!.scenarios[0].tags, [
    "@wip",
    "@slow",
  ]);
  // The span starts at the first tag line.
  assertEquals(featureNode(entry).source.split("\n")[0], "  @wip @slow");
});

Deno.test("parseFeatureFile: # language: fr", () => {
  const text = [
    "# language: fr",
    "Fonctionnalité: F",
    "  # [TST_A_0001] Arrêt",
    "  #",
    "  # Prose.",
    "  Scénario: S",
    "    Soit a",
    "    Quand b",
    "    Alors c",
  ].join("\n");
  const { entries, diagnostics } = parseFF(text);
  assertEquals(diagnostics, []);
  assertEquals(entries[0].source, { kind: "feature-file", node: "scenario" });
  assertEquals(
    featureNode(entries[0]).feature!.scenarios[0].steps.map((s) =>
      s.normalized
    ),
    ["given", "when", "then"],
  );
});

Deno.test("parseFeatureFile: no headers → no entries, no diagnostics", () => {
  const text = "Feature: F\n  # a comment\n  Scenario: S\n    Then a\n";
  assertEquals(parseFF(text), { entries: [], diagnostics: [] });
});

Deno.test("parseFeatureFile: empty file → no entries, no diagnostics", () => {
  assertEquals(parseFF(""), { entries: [], diagnostics: [] });
});

Deno.test("parseFeatureFile: header above Background → MSL-B069 warning at header line", () => {
  const text = [
    "Feature: F",
    "  # [REQ_A_0001] Not an entry",
    "  Background:",
    "    Given a",
    "  Scenario: S",
    "    Then b",
  ].join("\n");
  const { entries, diagnostics } = parseFF(text);
  assertEquals(entries, []);
  assertEquals(
    diagnostics.map((d) => [d.code, d.severity, d.location?.line]),
    [["MSL-B069", "warning", 2]],
  );
  assert(diagnostics[0].message.includes("background"));
});

Deno.test("parseFeatureFile: MSL-B069 for Examples, step and orphan headers", () => {
  const text = [
    "Feature: F", // 1
    "  Scenario Outline: S", // 2
    "    # [REQ_A_0001] On a step", // 3
    "    Given <a>", // 4
    "    # [REQ_A_0002] On examples", // 5
    "    Examples:", // 6
    "      | a |", // 7
    "      | 1 |", // 8
    "", // 9
    "  # [REQ_A_0003] Orphan", // 10
    "", // 11
    "  Scenario: T", // 12
    "    Then b", // 13
  ].join("\n");
  const { entries, diagnostics } = parseFF(text);
  assertEquals(entries, []);
  assertEquals(
    diagnostics.map((d) => [d.code, d.location?.line, d.location?.column]),
    [["MSL-B069", 3, 5], ["MSL-B069", 5, 5], ["MSL-B069", 10, 3]],
  );
});

Deno.test("parseFeatureFile: syntax error → no entries, MSL-B062 at the parser line", () => {
  const text = [
    "# [REQ_A_0001] T",
    "Feature: F",
    "  Scenario: S",
    "    Given a",
    "    this is not gherkin",
  ].join("\n");
  const { entries, diagnostics } = parseFF(text);
  assertEquals(entries, []);
  assertEquals(
    diagnostics.map((d) => [d.code, d.severity, d.location?.line]),
    [["MSL-B062", "warning", 5]],
  );
});

Deno.test("parseFeatureFile: syntax error in a file with no header is silent", () => {
  const text = "Feature: F\n  Scenario: S\n    this is not gherkin\n";
  assertEquals(parseFF(text), { entries: [], diagnostics: [] });
});

// Case A validators on Case B entries ---------------------------------------

Deno.test("Case B: a Feature entry with scenarios gives criteria checks", () => {
  const text = [
    "# [REQ_A_0001] T",
    "#",
    "# Prose.",
    "Feature: F",
    "  Scenario: Has outcome",
    "    When a",
    "    Then b",
    "  Scenario: No outcome",
    "    When c",
  ].join("\n");
  const req = typed(parseFF(text).entries[0], "Requirement");
  assertEquals(buildCriteria(req).map((c) => [c.name, c.location.line]), [
    ["Has outcome", 5],
    ["No outcome", 8],
  ]);
  assertEquals(
    checkBlockRoles([req], null).map((d) => [d.code, d.location?.line]),
    [["MSL-B064", 8]],
  );
});

Deno.test("Case B: a Scenario entry typed Test gives procedure checks", () => {
  const text = [
    "Feature: F", // 1
    "  Background:", // 2
    "    When an action in the background", // 3
    "  # [TST_A_0001] T", // 4
    "  #", // 5
    "  # Prose.", // 6
    "  Scenario: S", // 7
    "    Then early result", // 8
    "    When act", // 9
  ].join("\n");
  const tst = typed(parseFF(text).entries[0], "Test");
  const procedure = scenarioProcedure(featureNode(tst).feature!.scenarios[0]);
  assertEquals(procedure.preconditions.map((p) => p.origin), ["background"]);
  assertEquals(
    checkProcedureSteps([tst], null).map((d) => [d.code, d.location?.line]),
    [["MSL-B063", 9]],
  );
  // MSL-B065 at line 8. No diagnostic is reported on the inherited
  // Background step (line 3), although it is an action.
  const roles = checkBlockRoles([tst], null);
  assertEquals(roles.map((d) => [d.code, d.location?.line]), [
    ["MSL-B065", 8],
  ]);
  for (const d of [...roles, ...checkProcedureSteps([tst], null)]) {
    assert(d.location!.line >= 7, `${d.code} at ${d.location!.line}`);
  }
});

Deno.test("Case B: an entry with an illustration role gives MSL-B068 at its span", () => {
  const text = [
    "Feature: F",
    "  # [ARC_A_0001] T",
    "  #",
    "  # Prose.",
    "  Scenario: S",
    "    Then a",
  ].join("\n");
  const entry = typed(parseFF(text).entries[0], "Component");
  assertEquals(
    checkBlockRoles([entry], null).map((d) => [d.code, d.location?.line]),
    [["MSL-B068", 5]],
  );
});
