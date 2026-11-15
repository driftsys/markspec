import { assertEquals } from "@std/assert";
import {
  commentPrefix,
  headerRun,
  trailerBlock,
  trailerKey,
} from "./feature_code_actions.ts";
import { splitCitationValues } from "./code_actions.ts";

Deno.test("commentPrefix: comment and non-comment lines", () => {
  assertEquals(commentPrefix("#     Key: v"), "#     ");
  assertEquals(commentPrefix("  # Key: v"), "  # ");
  assertEquals(commentPrefix("#"), "#");
  assertEquals(commentPrefix("  Given x"), undefined);
});

Deno.test("trailerKey: key lines only", () => {
  assertEquals(trailerKey("#     Verified-by: a"), "Verified-by");
  assertEquals(trailerKey("# Id : X"), "Id");
  assertEquals(trailerKey("# Body text: no"), undefined);
  assertEquals(trailerKey("# lower: no"), undefined);
  assertEquals(trailerKey("Given a: b"), undefined);
});

Deno.test("trailerBlock: git-style header", () => {
  const lines = [
    "# [SC_A_0001] Title",
    "#",
    "# Id: X",
    "# Satisfies: Y",
    "Feature: F",
  ];
  assertEquals(headerRun(lines, 0), { start: 0, end: 4 });
  assertEquals(trailerBlock(lines, 0), { start: 2, end: 4 });
});

Deno.test("trailerBlock: indented scenario header", () => {
  const lines = [
    "Feature: F",
    "  # [SC_A_0001] Title",
    "  #",
    "  # Id: X",
    "  Scenario: S",
  ];
  assertEquals(trailerBlock(lines, 1), { start: 3, end: 4 });
});

Deno.test("trailerBlock: indented trailer form", () => {
  const lines = ["# [SC_A_0001] T", "#", "#     Id: X", "#     Labels: a", "F"];
  assertEquals(trailerBlock(lines, 0), { start: 2, end: 4 });
});

Deno.test("trailerBlock: skips a trailing # line", () => {
  const lines = ["# [SC_A_0001] T", "#", "# Id: X", "#", "Feature: F"];
  assertEquals(trailerBlock(lines, 0), { start: 2, end: 3 });
});

Deno.test("trailerBlock: stops at the next header", () => {
  const lines = [
    "# [SC_A_0001] A",
    "# Id: X",
    "# [SC_A_0002] B",
    "# Id: Y",
    "F",
  ];
  assertEquals(trailerBlock(lines, 0), { start: 1, end: 2 });
});

Deno.test("trailerBlock: stops at a language line", () => {
  const lines = ["# [SC_A_0001] A", "# Id: X", "# language: fr", "F"];
  assertEquals(trailerBlock(lines, 0), { start: 1, end: 2 });
});

Deno.test("trailerBlock: never includes a step or doc-string line", () => {
  const lines = [
    "# [SC_A_0001] A",
    "# Id: X",
    "Scenario: S",
    "  Given a doc string:",
    '    """',
    "    Verified-by: z",
    '    """',
  ];
  assertEquals(trailerBlock(lines, 0), { start: 1, end: 2 });
});

Deno.test("headerRun and trailerBlock: non-header line", () => {
  const lines = ["# plain comment", "# Id: X", "Feature: F"];
  assertEquals(headerRun(lines, 0), undefined);
  assertEquals(trailerBlock(lines, 0), undefined);
  assertEquals(headerRun(lines, 2), undefined);
});

Deno.test("trailerBlock: header without a trailer", () => {
  const lines = ["# [SC_A_0001] A", "# body text", "Feature: F"];
  assertEquals(trailerBlock(lines, 0), { start: 2, end: 2 });
});

Deno.test("splitCitationValues: top-level split", () => {
  assertEquals(splitCitationValues("[@a], [@b]"), ["[@a]", "[@b]"]);
  assertEquals(splitCitationValues("[@a, p. 3], [@b]"), ["[@a, p. 3]", "[@b]"]);
  assertEquals(splitCitationValues("[@a]"), ["[@a]"]);
  assertEquals(splitCitationValues("[@a\\], b], [@c]"), ["[@a\\], b]", "[@c]"]);
  assertEquals(splitCitationValues(" , "), []);
});
