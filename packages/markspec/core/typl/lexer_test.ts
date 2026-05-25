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
