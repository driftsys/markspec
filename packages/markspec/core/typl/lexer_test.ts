// packages/markspec/core/typl/lexer_test.ts
import { assertEquals } from "@std/assert";
import { tokenize } from "./lexer.ts";

/** Helper: extract just the token array from tokenize result. */
function toks(source: string) {
  return tokenize(source).tokens;
}

Deno.test("tokenize: binding with explicit kind + range", () => {
  const t = toks("$Speed : signal float[0..300]");
  assertEquals(t.map((x) => x.kind), [
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
  const t = toks("type BrakeReq = { force_N: float[0..12000] }");
  assertEquals(t.map((x) => x.kind), [
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
  const t = toks("$VIN : /^[A-Z]{17}$/i");
  const regex = t.find((x) => x.kind === "REGEX");
  assertEquals(regex?.value, "^[A-Z]{17}$");
  const flags = t.find((x) => x.kind === "REGEX_FLAGS");
  assertEquals(flags?.value, "i");
});

Deno.test("tokenize: comment line", () => {
  const t = toks("# this is ignored");
  assertEquals(t.map((x) => x.kind), ["COMMENT", "EOF"]);
});

Deno.test("tokenize: positions are 1-based; line increments on \\n", () => {
  const t = toks("$X\n$Y");
  // $X on line 1 col 1, $Y on line 2 col 1
  assertEquals(t[0].position, { line: 1, column: 1 });
  assertEquals(t[1].position, { line: 2, column: 1 });
});

Deno.test("tokenize: empty source emits only EOF at line 1 col 1", () => {
  const t = toks("");
  assertEquals(t.length, 1);
  assertEquals(t[0].kind, "EOF");
  assertEquals(t[0].position, { line: 1, column: 1 });
});

Deno.test("tokenize: REGEX_FLAGS position points at the flags, not the opening /", () => {
  const t = toks("/abc/i");
  const flags = t.find((x) => x.kind === "REGEX_FLAGS");
  // Opening / is at col 1; pattern abc is cols 2-4; closing / at col 5; flag i at col 6
  assertEquals(flags?.position, { line: 1, column: 6 });
});

Deno.test("tokenize: string with escape preserves the escaped char (backslash stripped)", () => {
  const t = toks("'\\n'");
  const str = t.find((x) => x.kind === "STRING");
  // Documents the design: backslash is consumed, next char taken verbatim
  assertEquals(str?.value, "n");
});

Deno.test("tokenize: unterminated regex emits TYPL-006 diagnostic", () => {
  const { tokens, diagnostics } = tokenize("/abc");
  assertEquals(tokens.find((t) => t.kind === "REGEX")?.value, "abc");
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "TYPL-006");
  assertEquals(
    diagnostics[0].message,
    "Malformed schema: unterminated regex literal.",
  );
  assertEquals(diagnostics[0].position, { line: 1, column: 1 });
});
