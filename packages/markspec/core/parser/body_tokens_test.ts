/**
 * @module core/parser/body_tokens_test
 *
 * Unit tests for {@linkcode extractBodyTokens}. One Deno.test per token
 * kind + scope rule. Fixtures are inline body strings paired with the
 * `buildBodyAst` output that the scanner expects.
 */

import { assertEquals } from "@std/assert";
import { extractBodyTokens } from "./body_tokens.ts";
import { buildBodyAst } from "../ast/build.ts";
import { loadGherkin } from "../gherkin/load.ts";
import type { BodyToken, SourceLocation } from "../model/mod.ts";

// Gherkin tokens come from the AST, which exists only once the parser is
// loaded (the same step `parseFile` runs before it builds entries).
await loadGherkin();

const BASE: SourceLocation = { file: "test.md", line: 1, column: 1 };

function tokensOf(body: string): readonly BodyToken[] {
  return extractBodyTokens(body, buildBodyAst(body), BASE);
}

Deno.test("modal: lowercase shall in prose emits one token", () => {
  const tokens = tokensOf("The driver shall debounce inputs.");
  assertEquals(tokens.length, 1);
  assertEquals(tokens[0].kind, "modal");
  if (tokens[0].kind === "modal") {
    assertEquals(tokens[0].text, "shall");
    assertEquals(tokens[0].case, "lower");
    assertEquals(tokens[0].location.line, 1);
    assertEquals(tokens[0].location.column, 12); // 1-based column of 's' in 'shall'
  }
});

Deno.test("modal: uppercase SHALL emits case='upper'", () => {
  const tokens = tokensOf("The driver SHALL debounce inputs.");
  assertEquals(tokens.length, 1);
  if (tokens[0].kind === "modal") {
    assertEquals(tokens[0].text, "SHALL");
    assertEquals(tokens[0].case, "upper");
  }
});

Deno.test("modal: all five RFC-2119 verbs recognised", () => {
  const body = "The system shall be fast and should be tested. " +
    "It may emit warnings; it must not crash. The driver will retry.";
  const tokens = tokensOf(body).filter((t) => t.kind === "modal");
  const texts = tokens.map((t) => t.text);
  assertEquals(texts, ["shall", "should", "may", "must not", "will"]);
});

Deno.test("ears-trigger: all five triggers recognised in prose", () => {
  const body = "When the brake is pressed, the system shall react. " +
    "While the engine runs, sensors poll. If pressure drops, alert. " +
    "Where applicable, log it. Then the controller resets.";
  const tokens = tokensOf(body).filter((t) => t.kind === "ears-trigger");
  const triggers = tokens.map((t) =>
    t.kind === "ears-trigger" ? t.trigger : ""
  );
  assertEquals(triggers, ["When", "While", "If", "Where", "Then"]);
});

Deno.test("ears-trigger: lowercase 'when' is NOT a trigger", () => {
  const body = "The driver shall react when the brake is pressed.";
  const ears = tokensOf(body).filter((t) => t.kind === "ears-trigger");
  assertEquals(ears.length, 0);
});

Deno.test("entity-ref: three case conventions classified correctly", () => {
  const body =
    "The $BrakeController polls $rawPressure every $DEBOUNCE_WINDOW ms.";
  const refs = tokensOf(body).filter((t) => t.kind === "entity-ref");
  assertEquals(refs.length, 3);
  if (
    refs[0].kind === "entity-ref" && refs[1].kind === "entity-ref" &&
    refs[2].kind === "entity-ref"
  ) {
    assertEquals(refs[0].convention, "type");
    assertEquals(refs[0].text, "$BrakeController");
    assertEquals(refs[1].convention, "instance");
    assertEquals(refs[1].text, "$rawPressure");
    assertEquals(refs[2].convention, "constant");
    assertEquals(refs[2].text, "$DEBOUNCE_WINDOW");
  }
});

Deno.test("entity-ref: escaped \\$ is NOT emitted", () => {
  const body = "Literal \\$Vehicle and real $Vehicle here.";
  const refs = tokensOf(body).filter((t) => t.kind === "entity-ref");
  assertEquals(refs.length, 1);
  if (refs[0].kind === "entity-ref") {
    assertEquals(refs[0].text, "$Vehicle");
  }
});

Deno.test("inline-code: backtick spans emit one token per span", () => {
  const body = "Use `foo` and then call `bar()`.";
  const codes = tokensOf(body).filter((t) => t.kind === "inline-code");
  assertEquals(codes.length, 2);
  if (codes[0].kind === "inline-code") {
    assertEquals(codes[0].text, "`foo`"); // includes backticks
  }
});

Deno.test("gherkin-section + gherkin-step: extracted inside feature fence", () => {
  const body = "Spec:\n\n```feature\nFeature: Brake\n  Scenario: Stop\n" +
    "    Given the car is moving\n    When the brake is pressed\n" +
    "    Then the car stops\n```\n";
  const tokens = tokensOf(body);
  const sections = tokens.filter((t) => t.kind === "gherkin-section");
  const steps = tokens.filter((t) => t.kind === "gherkin-step");
  assertEquals(sections.map((t) => t.text), ["Feature", "Scenario"]);
  assertEquals(steps.map((t) => t.text), ["Given", "When", "Then"]);
});

Deno.test("scope: modal inside ```rust code fence is NOT emitted", () => {
  const body =
    "Prose with shall.\n\n```rust\nfn check() { /* shall */ }\n```\n";
  const modals = tokensOf(body).filter((t) => t.kind === "modal");
  // Only the prose modal counts; the comment inside the fence is verbatim.
  assertEquals(modals.length, 1);
  if (modals[0].kind === "modal") {
    assertEquals(modals[0].location.line, 1);
  }
});

Deno.test("scope: unknown info-string fence is verbatim — no tokens emitted (#719)", () => {
  // Verbatim-line skipping keys on block kind (`code`), not on a known
  // language identifier, so an UNKNOWN info-string (e.g. `uxil`) is opaque
  // exactly like `rust`: a modal verb and a `$Ref` inside it emit nothing.
  const body =
    "Prose with shall and $Vehicle.\n\n```uxil\nux:media.home : screen SHALL $Foo\n```\n";
  const tokens = tokensOf(body);
  const inFence = tokens.filter((t) => t.location.line >= 3);
  assertEquals(inFence.length, 0, "no tokens from inside an unknown-tag fence");
  // The prose modal + entity-ref on line 1 are still emitted (sanity).
  assertEquals(tokens.filter((t) => t.kind === "modal").length, 1);
  assertEquals(tokens.filter((t) => t.kind === "entity-ref").length, 1);
});

Deno.test("scope: entity-ref inside $$ math block is NOT emitted", () => {
  const body = "Use $Vehicle here.\n\n$$\n$x = 1$\n$$\n";
  const refs = tokensOf(body).filter((t) => t.kind === "entity-ref");
  assertEquals(refs.length, 1);
  if (refs[0].kind === "entity-ref") {
    assertEquals(refs[0].text, "$Vehicle");
  }
});

Deno.test("scope: modal/EARS suppressed inside feature fence (gherkin owns it)", () => {
  const body = "```feature\nScenario: x\n  When the brake is pressed\n```\n";
  const tokens = tokensOf(body);
  // Should emit gherkin-section + gherkin-step only; no ears-trigger,
  // no modal, even though "When" appears.
  assertEquals(tokens.filter((t) => t.kind === "modal").length, 0);
  assertEquals(tokens.filter((t) => t.kind === "ears-trigger").length, 0);
  assertEquals(tokens.filter((t) => t.kind === "gherkin-step").length, 1);
});

Deno.test("sort: tokens returned sorted by (line, column)", () => {
  const body = "When the $sensor fires, the system shall react.";
  const tokens = tokensOf(body);
  for (let i = 1; i < tokens.length; i++) {
    const prev = tokens[i - 1].location;
    const cur = tokens[i].location;
    const before = prev.line < cur.line ||
      (prev.line === cur.line && prev.column <= cur.column);
    assertEquals(
      before,
      true,
      `token ${i} not sorted: ${prev.column} vs ${cur.column}`,
    );
  }
});

Deno.test("mixed prose: modal + EARS + entity-ref on one line", () => {
  const body =
    "When the $brake fires, the controller shall debounce $rawInput.";
  const tokens = tokensOf(body);
  const kinds = tokens.map((t) => t.kind);
  assertEquals(kinds, [
    "ears-trigger",
    "entity-ref",
    "modal",
    "entity-ref",
  ]);
});

Deno.test("modal: multi-word forms (SHALL NOT, MUST NOT) emit single tokens", () => {
  const body = "The system MUST NOT crash and shall not retry.";
  const modals = tokensOf(body).filter((t) => t.kind === "modal");
  assertEquals(modals.length, 2);
  if (modals[0].kind === "modal") {
    assertEquals(modals[0].text, "MUST NOT");
    assertEquals(modals[0].case, "upper");
  }
  if (modals[1].kind === "modal") {
    assertEquals(modals[1].text, "shall not");
    assertEquals(modals[1].case, "lower");
  }
});

// ---------------------------------------------------------------------------
// Gherkin tokens from the AST (ADR-016, Gherkin AST slice)
// ---------------------------------------------------------------------------

const gherkinOf = (tokens: readonly BodyToken[]) =>
  tokens.filter((t) =>
    t.kind === "gherkin-section" || t.kind === "gherkin-step"
  );

Deno.test("gherkin tokens: a `*` step emits a gherkin-step token", () => {
  const body = "```gherkin\nScenario: s\n  * the car moves\n```\n";
  const steps = tokensOf(body).filter((t) => t.kind === "gherkin-step");
  assertEquals(steps.map((t) => t.text), ["*"]);
  assertEquals(steps[0].location.line, 3);
  assertEquals(steps[0].location.column, 3);
});

Deno.test("gherkin tokens: a French block emits authored keywords", () => {
  const body = "```gherkin\n# language: fr\nFonctionnalité: Frein\n" +
    "  Scénario: Arrêt\n    Soit une voiture\n    Quand on freine\n" +
    "    Alors elle s'arrête\n```\n";
  const tokens = gherkinOf(tokensOf(body));
  assertEquals(
    tokens.map((t) => t.text),
    ["Fonctionnalité", "Scénario", "Soit", "Quand", "Alors"],
  );
});

Deno.test("gherkin tokens: keywords in step text, description, doc string emit nothing", () => {
  const body = "```gherkin\nFeature: f\n  When and Then appear here\n\n" +
    "  Scenario: s\n    Given the text Then But Scenario: x\n" +
    '      """\n      Scenario: y\n      Given z\n      """\n```\n';
  const tokens = gherkinOf(tokensOf(body));
  assertEquals(tokens.map((t) => t.text), ["Feature", "Scenario", "Given"]);
});

Deno.test("gherkin tokens: a block that does not parse emits none", () => {
  const body = "```gherkin\nScenario: s\n  Given a\n  Banana\n```\n";
  const ast = buildBodyAst(body);
  const node = ast.find((b) => b.kind === "feature");
  assertEquals(node?.kind === "feature" && node.parseError !== undefined, true);
  assertEquals(
    gherkinOf(extractBodyTokens(body, ast, BASE)).length,
    0,
  );
});

Deno.test("gherkin tokens: Background steps are emitted once", () => {
  const body = "```gherkin\nFeature: f\n  Background:\n    Given a\n\n" +
    "  Scenario: one\n    When b\n\n  Scenario: two\n    When c\n```\n";
  const tokens = gherkinOf(tokensOf(body));
  assertEquals(
    tokens.map((t) => `${t.text}@${t.location.line}`),
    [
      "Feature@2",
      "Background@3",
      "Given@4",
      "Scenario@6",
      "When@7",
      "Scenario@9",
      "When@10",
    ],
  );
});

Deno.test("gherkin tokens: columns include the column offset", () => {
  const body = "```gherkin\nScenario: s\n  Given a\n```\n";
  const ast = buildBodyAst(body);
  const tokens = gherkinOf(extractBodyTokens(body, ast, BASE, 4));
  assertEquals(tokens.map((t) => t.location.column), [5, 7]);
});

Deno.test("determinism: a node without the AST drops only Gherkin tokens", () => {
  const body = "The brake shall hold, `x`.\n\n" +
    "```gherkin\nScenario: s\n  Given a\n```\n";
  const loadedAst = buildBodyAst(body);
  // The same blocks as they are built when the parser is not loaded.
  const unloadedAst = loadedAst.map((b) =>
    b.kind === "feature"
      ? { kind: "feature" as const, source: b.source, range: b.range }
      : b
  );
  const loaded = extractBodyTokens(body, loadedAst, BASE);
  const unloaded = extractBodyTokens(body, unloadedAst, BASE);
  assertEquals(gherkinOf(unloaded).length, 0);
  assertEquals(gherkinOf(loaded).length, 2);
  assertEquals(
    loaded.filter((t) => !gherkinOf([t]).length),
    unloaded,
  );
});
