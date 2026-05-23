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
