// packages/markspec/core/typl/lexer_test.ts
import { assertEquals } from "@std/assert";
import { tokenize } from "./lexer.ts";

Deno.test("tokenize: binding with explicit kind + range", () => {
  const tokens = tokenize("$Speed : signal float[0..300]");
  assertEquals(tokens.map((t) => t.kind), [
    "DOLLAR_IDENT", // $Speed
    "COLON", // :
    "IDENT", // signal
    "IDENT", // float
    "LBRACKET", // [
    "NUMBER", // 0
    "DOTDOT", // ..
    "NUMBER", // 300
    "RBRACKET", // ]
    "EOF",
  ]);
});

Deno.test("tokenize: typedef line", () => {
  const tokens = tokenize("type BrakeReq = { force_N: float[0..12000] }");
  assertEquals(tokens.map((t) => t.kind), [
    "TYPE",
    "IDENT",
    "EQUALS",
    "LBRACE",
    "IDENT",
    "COLON",
    "IDENT",
    "LBRACKET",
    "NUMBER",
    "DOTDOT",
    "NUMBER",
    "RBRACKET",
    "RBRACE",
    "EOF",
  ]);
});

Deno.test("tokenize: regex pattern keeps body intact", () => {
  const tokens = tokenize("$VIN : /^[A-Z]{17}$/i");
  const regex = tokens.find((t) => t.kind === "REGEX");
  assertEquals(regex?.value, "^[A-Z]{17}$");
  const flags = tokens.find((t) => t.kind === "REGEX_FLAGS");
  assertEquals(flags?.value, "i");
});

Deno.test("tokenize: comment line", () => {
  const tokens = tokenize("# this is ignored");
  assertEquals(tokens.map((t) => t.kind), ["COMMENT", "EOF"]);
});

Deno.test("tokenize: positions are 1-based; line increments on \\n", () => {
  const tokens = tokenize("$X\n$Y");
  // $X on line 1 col 1, $Y on line 2 col 1
  assertEquals(tokens[0].position, { line: 1, column: 1 });
  assertEquals(tokens[1].position, { line: 2, column: 1 });
});

Deno.test("tokenize: empty source emits only EOF at line 1 col 1", () => {
  const tokens = tokenize("");
  assertEquals(tokens.length, 1);
  assertEquals(tokens[0].kind, "EOF");
  assertEquals(tokens[0].position, { line: 1, column: 1 });
});

Deno.test("tokenize: REGEX_FLAGS position points at the flags, not the opening /", () => {
  const tokens = tokenize("/abc/i");
  const flags = tokens.find((t) => t.kind === "REGEX_FLAGS");
  // Opening / is at col 1; pattern abc is cols 2-4; closing / at col 5; flag i at col 6
  assertEquals(flags?.position, { line: 1, column: 6 });
});

Deno.test("tokenize: string with escape preserves the escaped char (backslash stripped)", () => {
  const tokens = tokenize("'\\n'");
  const str = tokens.find((t) => t.kind === "STRING");
  // Documents the design: backslash is consumed, next char taken verbatim
  assertEquals(str?.value, "n");
});
