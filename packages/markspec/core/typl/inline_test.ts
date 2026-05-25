import { assertEquals } from "@std/assert";
import type { BodyToken } from "../model/mod.ts";
import { extractTyplInlines } from "./inline.ts";

function inlineCode(text: string, line = 1, column = 1): BodyToken {
  return {
    kind: "inline-code",
    text,
    location: { file: "x.md", line, column },
  };
}

function modal(text: string, line = 1): BodyToken {
  return {
    kind: "modal",
    text,
    case: "lower",
    location: { file: "x.md", line, column: 1 },
  };
}

Deno.test("extractTyplInlines: empty input → empty result", () => {
  assertEquals(extractTyplInlines([]), []);
});

Deno.test("extractTyplInlines: ignores non-inline-code tokens", () => {
  const tokens: BodyToken[] = [
    modal("shall", 1),
    {
      kind: "entity-ref",
      text: "$Foo",
      convention: "type",
      location: { file: "x.md", line: 2, column: 5 },
    },
  ];
  assertEquals(extractTyplInlines(tokens), []);
});

Deno.test("extractTyplInlines: ignores inline-code that is not typl syntax", () => {
  const tokens: BodyToken[] = [
    inlineCode("foo.bar()", 1, 5),
    inlineCode("just a code reference", 2, 1),
    inlineCode("const x = 5", 3, 1),
  ];
  assertEquals(extractTyplInlines(tokens), []);
});

Deno.test("extractTyplInlines: finds typl binding span", () => {
  const span = inlineCode("$Speed : signal float[0..300]", 5, 3);
  const result = extractTyplInlines([span]);
  assertEquals(result.length, 1);
  assertEquals(result[0].source, "$Speed : signal float[0..300]");
  assertEquals(result[0].location, span.location);
});

Deno.test("extractTyplInlines: finds typl typedef span", () => {
  const span = inlineCode("type BrakeReq = { force: int[0..255] }", 7, 1);
  const result = extractTyplInlines([span]);
  assertEquals(result.length, 1);
  assertEquals(result[0].source, "type BrakeReq = { force: int[0..255] }");
});

Deno.test("extractTyplInlines: returns multiple spans in source order", () => {
  const tokens: BodyToken[] = [
    inlineCode("$A : signal", 1, 5),
    inlineCode("ignored ref", 1, 30),
    inlineCode("$B : event", 2, 1),
    modal("shall", 3),
    inlineCode("type T = int", 4, 10),
  ];
  const result = extractTyplInlines(tokens);
  assertEquals(result.length, 3);
  assertEquals(result.map((r) => r.source), [
    "$A : signal",
    "$B : event",
    "type T = int",
  ]);
});

Deno.test("extractTyplInlines: ignores `$` not followed by colon", () => {
  const tokens: BodyToken[] = [inlineCode("$Foo bar", 1, 1)];
  assertEquals(extractTyplInlines(tokens), []);
});

Deno.test("extractTyplInlines: ignores `type` not followed by `=`", () => {
  const tokens: BodyToken[] = [inlineCode("type of error", 1, 1)];
  assertEquals(extractTyplInlines(tokens), []);
});
