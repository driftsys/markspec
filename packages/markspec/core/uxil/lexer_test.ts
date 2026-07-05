import { assertEquals } from "@std/assert";
import { tokenize } from "./lexer.ts";

Deno.test("tokenize: full reference tail", () => {
  const kinds = tokenize("media.home/play:{id}!activate").map((t) => t.kind);
  assertEquals(kinds, [
    "IDENT",
    "DOT",
    "IDENT",
    "SLASH",
    "IDENT",
    "COLON",
    "LBRACE",
    "IDENT",
    "RBRACE",
    "BANG",
    "IDENT",
    "EOF",
  ]);
});

Deno.test("tokenize: arrow is a single token, columns are 1-based", () => {
  const toks = tokenize("a -> b");
  assertEquals(toks.map((t) => t.kind), ["IDENT", "ARROW", "IDENT", "EOF"]);
  assertEquals(toks[1].value, "->");
  assertEquals(toks[0].position.column, 1);
  assertEquals(toks[1].position.column, 3);
});

Deno.test("tokenize: unknown characters are skipped", () => {
  const kinds = tokenize("a?b").map((t) => t.kind);
  assertEquals(kinds, ["IDENT", "IDENT", "EOF"]);
});
