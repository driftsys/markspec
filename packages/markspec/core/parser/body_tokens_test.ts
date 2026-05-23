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
import type { BodyToken, SourceLocation } from "../model/mod.ts";

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
  assertEquals(texts, ["shall", "should", "may", "must", "will"]);
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
  const body = "The $BrakeController polls $rawPressure every $DEBOUNCE_WINDOW ms.";
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
